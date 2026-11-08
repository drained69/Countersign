// HTTP API + dashboard. Binds to 127.0.0.1 by default; set HOST to expose it.
//
// Two ways to run it:
// - Demo (default): KITE_MODE=mock, no owner token, loopback only. Open dashboard, scripted demo, no real money.
// - Live: KITE_MODE=kpass pays real money through Kite. Requires TRIPWIRE_OWNER_TOKEN (dashboard login),
//   per-agent API keys in TRIPWIRE_AGENT_KEYS, and the owner's policy (POLICY_FILE or a saved one).
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, normalize, sep } from "node:path";
import { Calibration } from "./calibration.ts";
import { DEMO_POLICY, PROJECT_ROOT, describeModes, loadConfig, loadPolicyFile, policyProblems } from "./config.ts";
import { compilePolicy, type PolicyProposal } from "./policyCompiler.ts";
import { randomUUID } from "node:crypto";
import { COOKIE, LoginLimiter, identify, loadAuth, same, sameOrigin, sessionValue, type Caller } from "./auth.ts";
import { Engine } from "./engine.ts";
import { runReplay, type WeekResult } from "./replay.ts";
import { AGENTS, demoScript } from "./scenarios.ts";
import { validateIntent } from "./validate.ts";
import type { PaymentIntent, Policy, Receipt } from "./types.ts";

const ROOT = PROJECT_ROOT;
const PUBLIC = join(ROOT, "public");

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";
const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://${host.includes(":") ? `[${host}]` : host}:${port}`).replace(/\/$/, "");
const NOTIFY_URL = process.env.NOTIFY_WEBHOOK_URL || undefined;

const cfg = loadConfig();
const LIVE = cfg.kiteMode === "kpass";
// Live and demo never share state: demo receipts are not real payments.
const STATE_FILE = process.env.STATE_FILE ?? join(ROOT, "data", LIVE ? "live-state.json" : "state.json");
const loopback = /^(127\.\d+\.\d+\.\d+|::1|localhost)$/.test(host);
/** PUBLIC_DEMO=true: anyone can use the demo dashboard (never in live mode; costly calls are rate-limited). */
const PUBLIC_DEMO = process.env.PUBLIC_DEMO === "true";
/** TRUST_PROXY=true: take the client address from the proxy (Railway, Fly, nginx) for rate limits. */
const TRUST_PROXY = process.env.TRUST_PROXY === "true";

function fail(msg: string): never {
  console.error(`\nTripwire can't start: ${msg}\n`);
  process.exit(1);
}

let auth: ReturnType<typeof loadAuth>;
try {
  auth = loadAuth();
} catch (err) {
  fail((err as Error).message);
}
if (PUBLIC_DEMO && LIVE) fail("PUBLIC_DEMO=true is only for the demo: it opens the dashboard to anyone, which must never control real money.");
if (!auth.ownerToken && (LIVE || (!loopback && !PUBLIC_DEMO))) {
  fail(`${LIVE ? "KITE_MODE=kpass moves real money" : `HOST=${host} is reachable beyond this machine`}, so set TRIPWIRE_OWNER_TOKEN (24+ random characters, e.g. \`openssl rand -hex 24\`).`);
}
if (LIVE && !auth.agentKeys.size) fail("Live mode needs at least one agent key: TRIPWIRE_AGENT_KEYS=agent-id:key (24+ characters each).");
if (cfg.kite?.payFrom === "session" && !cfg.kite.sessionId) fail("KITE_PAY_FROM=session needs KITE_SESSION_ID.");

/** Agents shown on the dashboard and accepted by the policy compiler. Live: the ones with API keys. */
const agentList = () =>
  auth.agentKeys.size ? [...new Set(auth.agentKeys.values())].map((id) => ({ id, task: "" })) : Object.values(AGENTS);

function startingPolicy(): Policy {
  // The scripted demo always runs on the demo policy, so a live POLICY_FILE in .env can't break it.
  if (!LIVE) return structuredClone(DEMO_POLICY);
  if (process.env.POLICY_FILE) {
    try {
      return loadPolicyFile(process.env.POLICY_FILE);
    } catch (err) {
      fail((err as Error).message);
    }
  }
  if (LIVE) return undefined as never; // filled from the state file below, or startup fails
  return structuredClone(DEMO_POLICY);
}

cfg.policy = startingPolicy();
/** Compiled policy proposals waiting for the owner to apply or discard them. */
const proposals = new Map<string, PolicyProposal & { basedOn: string }>();
let engine = createEngine();
if (!cfg.policy) fail("Live mode needs your policy: set POLICY_FILE (start from policy.example.json).");
let demoQueue: PaymentIntent[] = LIVE ? [] : demoScript();
let replayCache: { calibrated: WeekResult[]; baseline: WeekResult[] } | undefined;
const sseClients = new Set<ServerResponse>();
const limiter = new LoginLimiter();

function createEngine(fresh = false): Engine {
  let calibration = new Calibration();
  let receipts: Receipt[] = [];
  if (!fresh && existsSync(STATE_FILE)) {
    let saved: any;
    try {
      saved = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    } catch (err) {
      // Never silently start clean in live mode: the file holds what was paid.
      if (LIVE) fail(`${STATE_FILE} is unreadable (${(err as Error).message}). Restore it from a backup or move it aside.`);
    }
    if (saved) {
      calibration = Calibration.fromJSON(saved.calibration);
      // POLICY_FILE only seeds the first start; after that the saved policy (edited on the dashboard) wins.
      if (saved.policy && !policyProblems(saved.policy).length) cfg.policy = saved.policy;
      const now = new Date().toISOString();
      receipts = (saved.receipts ?? []).map((r: Receipt) => {
        // A payment interrupted mid-flight may have gone through: keep it counted until it's rechecked.
        if (r.status === "paying") return { ...r, status: "payment_unknown", payment: { ...r.payment, error: "Tripwire stopped while this payment was being made. Recheck it." } };
        // Anything left waiting for a decision can no longer be answered: record it as blocked.
        if (r.status.startsWith("pending")) return { ...r, status: "blocked", decidedAt: r.decidedAt ?? now };
        return r;
      });
    }
  }
  const e = new Engine(cfg, calibration);
  for (const r of receipts) e.receipts.set(r.intent.id, r);
  e.onChange = (r, durable) => {
    // After a demo reset, decisions still running on the replaced engine must not write its state back.
    if (e !== engine) return;
    persist(e, durable);
    broadcast({ type: "receipt", receipt: r });
  };
  e.onHumanNeeded = (r, approvalUrl) => notify(r, approvalUrl);
  return e;
}

let persistTimer: NodeJS.Timeout | undefined;
/** Atomic write (temp file + rename). `now` writes immediately, e.g. right before money moves. */
function persist(e: Engine, now = false) {
  clearTimeout(persistTimer);
  const write = () => {
    mkdirSync(dirname(STATE_FILE), { recursive: true });
    const tmp = `${STATE_FILE}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ receipts: [...e.receipts.values()], calibration: e.calibration.toJSON(), policy: cfg.policy }, null, 2), { mode: 0o600 });
    renameSync(tmp, STATE_FILE);
  };
  if (now) write();
  else persistTimer = setTimeout(write, 200);
}

function broadcast(msg: unknown) {
  const line = `data: ${JSON.stringify(msg)}\n\n`;
  for (const c of sseClients) c.write(line);
}

/** Tells the owner a payment is waiting on them (Slack-compatible incoming webhook). */
function notify(r: Receipt, approvalUrl?: string) {
  if (!NOTIFY_URL) return;
  const i = r.intent;
  const link = `${PUBLIC_URL}/r/${i.id}`;
  const text = `Tripwire: ${i.agentId} wants to pay $${i.amountUsd.toFixed(2)} to ${i.payeeName} (${i.payee}) for "${i.purpose}". ${approvalUrl ? `Approve or decline with your passkey: ${approvalUrl}` : `Review: ${link}`}`;
  fetch(NOTIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, receiptUrl: link, approvalUrl, id: i.id, amountUsd: i.amountUsd, payee: i.payee, agentId: i.agentId }),
    signal: AbortSignal.timeout(5000),
  }).catch((err) => console.error("notify failed:", err.message));
}

function state() {
  return {
    live: LIVE,
    modes: describeModes(cfg),
    policy: cfg.policy,
    spentUsd: engine.spentUsd(),
    demoRemaining: demoQueue.length,
    receipts: [...engine.receipts.values()].sort((a, b) => b.intent.createdAt.localeCompare(a.intent.createdAt)),
    calibration: engine.calibration.view(),
    agents: agentList(),
  };
}

/** What an agent may see: its limits, never other agents' payments. */
function agentPolicy(agentId: string) {
  const p = cfg.policy;
  return {
    agentId,
    allowanceUsd: p.allowanceUsd,
    spentUsd: engine.spentUsd(),
    leftUsd: Math.max(0, p.allowanceUsd - engine.spentUsd()),
    maxPerTxUsd: Math.min(p.maxPerTxUsd, p.agentRules?.find((r) => r.agentId === agentId)?.maxPerTxUsd ?? Infinity),
    tier1MinUsd: p.tier1MinUsd,
    tier2MinUsd: p.tier2MinUsd,
    resetPeriod: p.resetPeriod ?? "never",
    knownPayees: p.knownPayees,
    denyPayees: p.denyPayees,
    rules: p.agentRules?.filter((r) => r.agentId === agentId) ?? [],
  };
}

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...SECURITY_HEADERS, ...headers });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, limit = 64 * 1024): Promise<any> {
  let size = 0;
  const chunks: Buffer[] = [];
  let body: unknown;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error("Body too large"), { status: 413 });
    chunks.push(c);
  }
  try {
    body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
  } catch {
    throw Object.assign(new Error("Body must be JSON"), { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw Object.assign(new Error("Body must be a JSON object"), { status: 400 });
  return body;
}

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

function serveStatic(res: ServerResponse, path: string) {
  const file = normalize(join(PUBLIC, path === "/" ? "index.html" : path));
  if (!file.startsWith(PUBLIC + sep) || !existsSync(file) || !statSync(file).isFile()) return json(res, 404, { error: "not found" });
  res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream", "Content-Security-Policy": CSP, "Cache-Control": "no-cache", ...SECURITY_HEADERS });
  res.end(readFileSync(file));
}

const clientIp = (req: IncomingMessage) => {
  if (TRUST_PROXY) {
    const real = req.headers["x-real-ip"];
    if (typeof real === "string" && real) return real.trim();
    const fwd = req.headers["x-forwarded-for"];
    const last = (Array.isArray(fwd) ? fwd.join(",") : fwd ?? "").split(",").map((x) => x.trim()).filter(Boolean).at(-1);
    if (last) return last;
  }
  return req.socket.remoteAddress ?? "?";
};
/** Public demo: calls that spend SERV or Reppo credit, per visitor address. */
const costlyLimiter = new LoginLimiter(Number(process.env.PUBLIC_RATE_LIMIT ?? 40), 60 * 60_000);
const COSTLY = new Set(["/api/intents", "/api/demo/next", "/api/policy/compile"]);
const cookieFlags = (req: IncomingMessage) =>
  `HttpOnly; SameSite=Strict; Path=/; Max-Age=${30 * 24 * 3600}${process.env.COOKIE_SECURE === "true" || req.headers["x-forwarded-proto"] === "https" || PUBLIC_URL.startsWith("https:") ? "; Secure" : ""}`;

/** Who is calling. In the public demo every visitor gets the demo owner's view (no real money exists there). */
const caller = (req: IncomingMessage): Caller => {
  const who = identify(req, auth);
  return PUBLIC_DEMO && who.role === "anon" ? { role: "owner" } : who;
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  const method = req.method ?? "GET";
  try {
    // ---------- Public: pages, login ----------
    if (method === "GET" && path === "/api/session") {
      const who = caller(req);
      return json(res, 200, { authRequired: Boolean(auth.ownerToken) && !PUBLIC_DEMO, role: who.role, live: LIVE, publicDemo: PUBLIC_DEMO });
    }
    if (method === "POST" && path === "/api/login") {
      if (!auth.ownerToken || PUBLIC_DEMO) return json(res, 200, { ok: true });
      if (limiter.blocked(clientIp(req))) return json(res, 429, { error: "Too many attempts. Try again in a few minutes." });
      const { token } = await readBody(req, 4096);
      if (typeof token !== "string" || !same(token, auth.ownerToken)) {
        limiter.fail(clientIp(req));
        return json(res, 401, { error: "Wrong owner token." });
      }
      return json(res, 200, { ok: true }, { "Set-Cookie": `${COOKIE}=${sessionValue(auth.ownerToken)}; ${cookieFlags(req)}` });
    }
    if (method === "POST" && path === "/api/logout") {
      return json(res, 200, { ok: true }, { "Set-Cookie": `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
    }
    if (method === "GET" && path === "/api/health") return json(res, 200, { ok: true, live: LIVE });

    if (!path.startsWith("/api/")) {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      if (/^\/r\/[\w-]+$/.test(path)) return serveStatic(res, "/receipt.html");
      if (path === "/docs" || path === "/docs/") return serveStatic(res, "/docs.html");
      return serveStatic(res, path);
    }

    // ---------- Everything else needs a caller ----------
    const who: Caller = caller(req);
    if (PUBLIC_DEMO && method === "POST" && COSTLY.has(path)) {
      if (costlyLimiter.blocked(clientIp(req))) return json(res, 429, { error: "Demo limit reached for now. Try again in an hour, or run Tripwire locally." });
      costlyLimiter.fail(clientIp(req));
    }
    if (who.role === "anon") return json(res, 401, { error: "Sign in with the owner token, or send an agent API key as a Bearer token." });
    if (method !== "GET" && !req.headers.authorization && !sameOrigin(req)) return json(res, 403, { error: "Cross-site request refused." });
    const owner = who.role === "owner";
    const ownerOnly = () => json(res, 403, { error: "Only the owner can do this." });

    // Agents submit intents here. Responds immediately; the decision streams over /api/events.
    if (method === "POST" && path === "/api/intents") {
      const body = await readBody(req);
      if (who.role === "agent") {
        if (body.agentId !== undefined && body.agentId !== who.agentId) return json(res, 403, { error: `This key belongs to ${who.agentId}.` });
        body.agentId = who.agentId;
      }
      const v = validateIntent(body);
      if (typeof v === "string") return json(res, 400, { error: v });
      if (LIVE && !v.url) return json(res, 400, { error: "url is required in live mode: it is the x402 endpoint Kite pays." });
      // Same agent + same requestKey: return the original decision instead of paying twice.
      if (v.requestKey) {
        const prior = [...engine.receipts.values()].find((r) => r.intent.agentId === v.agentId && r.intent.requestKey === v.requestKey);
        if (prior) return json(res, 200, { id: prior.intent.id, receipt: `/api/receipts/${prior.intent.id}`, duplicate: true, status: prior.status });
      }
      engine.decide(v).catch((e) => console.error("decide failed", e));
      return json(res, 202, { id: v.id, receipt: `/api/receipts/${v.id}` });
    }

    const receiptMatch = path.match(/^\/api\/receipts\/([\w-]+)$/);
    if (method === "GET" && receiptMatch) {
      const r = engine.receipts.get(receiptMatch[1]);
      if (!r || (who.role === "agent" && r.intent.agentId !== who.agentId)) return json(res, 404, { error: "unknown receipt" });
      return json(res, 200, r);
    }

    if (method === "GET" && path === "/api/agent/policy") {
      return json(res, 200, agentPolicy(who.role === "agent" ? who.agentId : (url.searchParams.get("agentId") ?? "owner")));
    }

    if (!owner) return ownerOnly();

    // ---------- Owner ----------
    if (method === "GET" && path === "/api/state") return json(res, 200, state());

    if (method === "GET" && path === "/api/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", ...SECURITY_HEADERS });
      res.write(": connected\n\n");
      sseClients.add(res);
      const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
      req.on("close", () => {
        clearInterval(ping);
        sseClients.delete(res);
      });
      return;
    }

    // The owner's verdict after the fact: it teaches calibration and Reppo's track record.
    const fb = path.match(/^\/api\/receipts\/([\w-]+)\/feedback$/);
    if (method === "POST" && fb) {
      const { rating, note } = await readBody(req);
      if (rating !== "good" && rating !== "bad") return json(res, 400, { error: "rating must be good|bad" });
      if (note !== undefined && typeof note !== "string") return json(res, 400, { error: "note must be a string" });
      const out = engine.feedback(fb[1], rating, note);
      if (typeof out === "string") return json(res, out === "unknown receipt" ? 404 : 409, { error: out });
      return json(res, 200, out);
    }

    // Unknown payment outcomes: ask Kite again (same idempotency key, never pays twice), or settle by hand.
    const act = path.match(/^\/api\/receipts\/([\w-]+)\/(recheck|resolve)$/);
    if (method === "POST" && act) {
      const r = engine.receipts.get(act[1]);
      if (!r) return json(res, 404, { error: "unknown receipt" });
      if (r.status !== "payment_unknown") return json(res, 409, { error: "Only payments with an unknown outcome can be rechecked or resolved." });
      if (act[2] === "recheck") return json(res, 200, await engine.recheck(act[1]));
      const { answer } = await readBody(req);
      if (answer !== "paid" && answer !== "not_paid") return json(res, 400, { error: "answer must be paid|not_paid" });
      return json(res, 200, engine.resolve(act[1], answer));
    }

    if (method === "POST" && path === "/api/demo/next") {
      if (LIVE) return json(res, 409, { error: "The scripted demo is off in live mode." });
      const next = demoQueue.shift();
      if (!next) return json(res, 409, { error: "Demo script finished; reset to run again." });
      const fresh = { ...next, createdAt: new Date().toISOString() };
      engine.decide(fresh).catch((e) => console.error("decide failed", e));
      return json(res, 202, { id: fresh.id, remaining: demoQueue.length });
    }

    if (method === "POST" && path === "/api/demo/reset") {
      if (LIVE) return json(res, 409, { error: "Reset is off in live mode: the history records real payments." });
      cfg.policy = structuredClone(DEMO_POLICY);
      proposals.clear();
      replayCache = undefined;
      engine = createEngine(true);
      demoQueue = demoScript();
      persist(engine, true);
      broadcast({ type: "reset" });
      return json(res, 200, { ok: true });
    }

    // Plain-English policy: compile returns a preview; nothing changes until the owner applies it.
    if (method === "POST" && path === "/api/policy/compile") {
      const { text } = await readBody(req);
      if (typeof text !== "string" || !text.trim() || text.length > 2000) return json(res, 400, { error: "text must be 1–2000 characters" });
      const proposal = await compilePolicy(text, cfg.policy, agentList(), cfg.serv);
      const id = randomUUID();
      proposals.set(id, { ...proposal, basedOn: JSON.stringify(cfg.policy) });
      if (proposals.size > 20) proposals.delete(proposals.keys().next().value!);
      return json(res, 200, { id, ...proposal }); // basedOn stays server-side
    }

    if (method === "POST" && path === "/api/policy/apply") {
      const { id } = await readBody(req);
      const proposal = proposals.get(id);
      if (!proposal) return json(res, 404, { error: "Unknown or expired proposal; compile again." });
      if (proposal.basedOn !== JSON.stringify(cfg.policy)) return json(res, 409, { error: "The policy changed since this preview; compile again." });
      proposals.delete(id);
      cfg.policy = proposal.policy;
      replayCache = undefined; // the replay runs against the current policy
      persist(engine, true);
      broadcast({ type: "policy" });
      return json(res, 200, { ok: true, policy: cfg.policy });
    }

    const stepUp = path.match(/^\/api\/stepup\/([\w-]+)$/);
    if (method === "POST" && stepUp) {
      if (LIVE) return json(res, 409, { error: "Live mode: approve with your passkey in Kite Passport." });
      const { answer } = await readBody(req);
      if (answer !== "approved" && answer !== "declined") return json(res, 400, { error: "answer must be approved|declined" });
      return engine.answerHuman(stepUp[1], answer) ? json(res, 200, { ok: true }) : json(res, 404, { error: "nothing pending" });
    }

    if (method === "GET" && path === "/api/replay") {
      // Runs against the current policy; runReplay forces the offline adapters, so this costs nothing.
      replayCache ??= {
        calibrated: await runReplay(cfg, 6, { calibrate: true }),
        baseline: await runReplay(cfg, 6, { calibrate: false }),
      };
      return json(res, 200, replayCache);
    }

    json(res, method === "GET" ? 404 : 405, { error: method === "GET" ? "not found" : "method not allowed" });
  } catch (err) {
    const status = (err as any).status ?? 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) json(res, status, { error: status === 500 ? "Internal error" : (err as Error).message });
  }
});

server.listen(port, host, () => {
  console.log(`Tripwire on http://${host.includes(":") ? `[${host}]` : host}:${port}${PUBLIC_URL.startsWith("http://127") ? "" : ` (public: ${PUBLIC_URL})`}`);
  console.log("Modes:", describeModes(cfg));
  console.log(PUBLIC_DEMO ? "Public demo: open to anyone, rate-limited, no real money." : auth.ownerToken ? `Owner login required. ${auth.agentKeys.size} agent key(s) loaded.` : "Open local demo: no login (loopback only).");
});

// Finish the in-flight write before exiting.
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    persist(engine, true);
    process.exit(0);
  });
}
