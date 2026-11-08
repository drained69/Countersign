// HTTP API + dashboard. Binds to 127.0.0.1 by default; set HOST to expose it.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { Calibration } from "./calibration.ts";
import { DEMO_POLICY, describeModes, loadConfig } from "./config.ts";
import { compilePolicy, type PolicyProposal } from "./policyCompiler.ts";
import { randomUUID } from "node:crypto";
import { Engine } from "./engine.ts";
import { runReplay, type WeekResult } from "./replay.ts";
import { AGENTS, demoScript } from "./scenarios.ts";
import { validateIntent } from "./validate.ts";
import type { PaymentIntent, Receipt } from "./types.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const PUBLIC = join(ROOT, "public");
const STATE_FILE = process.env.STATE_FILE ?? join(ROOT, "data", "state.json");

const cfg = loadConfig();
cfg.policy = structuredClone(DEMO_POLICY);
/** Compiled policy proposals waiting for the owner to apply or discard them. */
const proposals = new Map<string, PolicyProposal & { basedOn: string }>();
let engine = createEngine();
let demoQueue: PaymentIntent[] = demoScript();
let replayCache: { calibrated: WeekResult[]; baseline: WeekResult[] } | undefined;
const sseClients = new Set<ServerResponse>();

function createEngine(fresh = false): Engine {
  let calibration = new Calibration();
  let receipts: Receipt[] = [];
  if (!fresh && existsSync(STATE_FILE)) {
    try {
      const saved = JSON.parse(readFileSync(STATE_FILE, "utf8"));
      calibration = Calibration.fromJSON(saved.calibration);
      if (saved.policy) cfg.policy = saved.policy;
      // Anything left pending when the server stopped can no longer be answered: record it as blocked.
      receipts = (saved.receipts ?? []).map((r: Receipt) =>
        r.status.startsWith("pending") ? { ...r, status: "blocked", decidedAt: r.decidedAt ?? new Date().toISOString() } : r,
      );
    } catch {
      /* corrupt state file: start clean */
    }
  }
  const e = new Engine(cfg, calibration);
  for (const r of receipts) e.receipts.set(r.intent.id, r);
  e.onChange = (r) => {
    persist(e);
    broadcast({ type: "receipt", receipt: r });
  };
  return e;
}

let persistTimer: NodeJS.Timeout | undefined;
function persist(e: Engine) {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    mkdirSync(dirname(STATE_FILE), { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify({ receipts: [...e.receipts.values()], calibration: e.calibration.toJSON(), policy: cfg.policy }, null, 2));
  }, 200);
}

function broadcast(msg: unknown) {
  const line = `data: ${JSON.stringify(msg)}\n\n`;
  for (const c of sseClients) c.write(line);
}

function state() {
  return {
    modes: describeModes(cfg),
    policy: cfg.policy,
    spentUsd: engine.spentUsd(),
    demoRemaining: demoQueue.length,
    receipts: [...engine.receipts.values()].sort((a, b) => b.intent.createdAt.localeCompare(a.intent.createdAt)),
    calibration: engine.calibration.toJSON(),
    agents: Object.values(AGENTS),
  };
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, limit = 64 * 1024): Promise<any> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error("Body too large");
    chunks.push(c);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

function serveStatic(res: ServerResponse, path: string) {
  const file = normalize(join(PUBLIC, path === "/" ? "index.html" : path));
  if (!file.startsWith(PUBLIC) || !existsSync(file)) return json(res, 404, { error: "not found" });
  res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  try {
    if (req.method === "GET" && path === "/api/state") return json(res, 200, state());

    if (req.method === "GET" && path === "/api/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
      res.write(": connected\n\n");
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }

    const receiptMatch = path.match(/^\/api\/receipts\/([\w-]+)$/);
    if (req.method === "GET" && receiptMatch) {
      const r = engine.receipts.get(receiptMatch[1]);
      return r ? json(res, 200, r) : json(res, 404, { error: "unknown receipt" });
    }

    // Agents submit intents here. Responds immediately; the decision streams over /api/events.
    if (req.method === "POST" && path === "/api/intents") {
      const v = validateIntent(await readBody(req));
      if (typeof v === "string") return json(res, 400, { error: v });
      engine.decide(v).catch((e) => console.error("decide failed", e));
      return json(res, 202, { id: v.id, receipt: `/api/receipts/${v.id}` });
    }

    if (req.method === "POST" && path === "/api/demo/next") {
      const next = demoQueue.shift();
      if (!next) return json(res, 409, { error: "Demo script finished; reset to run again." });
      const fresh = { ...next, createdAt: new Date().toISOString() };
      engine.decide(fresh).catch((e) => console.error("decide failed", e));
      return json(res, 202, { id: fresh.id, remaining: demoQueue.length });
    }

    // Plain-English policy: compile returns a preview; nothing changes until the owner applies it.
    if (req.method === "POST" && path === "/api/policy/compile") {
      const { text } = await readBody(req);
      if (typeof text !== "string" || !text.trim() || text.length > 2000) return json(res, 400, { error: "text must be 1–2000 characters" });
      const proposal = await compilePolicy(text, cfg.policy, Object.values(AGENTS), cfg.serv);
      const id = randomUUID();
      proposals.set(id, { ...proposal, basedOn: JSON.stringify(cfg.policy) });
      if (proposals.size > 20) proposals.delete(proposals.keys().next().value!);
      return json(res, 200, { id, ...proposal }); // basedOn stays server-side
    }

    if (req.method === "POST" && path === "/api/policy/apply") {
      const { id } = await readBody(req);
      const proposal = proposals.get(id);
      if (!proposal) return json(res, 404, { error: "Unknown or expired proposal; compile again." });
      if (proposal.basedOn !== JSON.stringify(cfg.policy)) return json(res, 409, { error: "The policy changed since this preview; compile again." });
      proposals.delete(id);
      cfg.policy = proposal.policy;
      replayCache = undefined; // the replay runs against the current policy
      persist(engine);
      broadcast({ type: "policy" });
      return json(res, 200, { ok: true, policy: cfg.policy });
    }

    if (req.method === "POST" && path === "/api/demo/reset") {
      cfg.policy = structuredClone(DEMO_POLICY);
      proposals.clear();
      replayCache = undefined;
      engine = createEngine(true);
      demoQueue = demoScript();
      persist(engine);
      broadcast({ type: "reset" });
      return json(res, 200, { ok: true });
    }

    const stepUp = path.match(/^\/api\/stepup\/([\w-]+)$/);
    if (req.method === "POST" && stepUp) {
      if (cfg.kiteMode === "kpass") return json(res, 409, { error: "Live mode: approve with your passkey in Kite Passport." });
      const { answer } = await readBody(req);
      if (answer !== "approved" && answer !== "declined") return json(res, 400, { error: "answer must be approved|declined" });
      return engine.answerHuman(stepUp[1], answer) ? json(res, 200, { ok: true }) : json(res, 404, { error: "nothing pending" });
    }

    if (req.method === "GET" && path === "/api/replay") {
      // Runs against the current policy; runReplay forces the offline adapters, so this costs nothing.
      replayCache ??= {
        calibrated: await runReplay(cfg, 6, { calibrate: true }),
        baseline: await runReplay(cfg, 6, { calibrate: false }),
      };
      return json(res, 200, replayCache);
    }

    if (req.method === "GET" && /^\/r\/[\w-]+$/.test(path)) return serveStatic(res, "/receipt.html");
    if (req.method === "GET" && (path === "/docs" || path === "/docs/")) return serveStatic(res, "/docs.html");
    if (req.method === "GET") return serveStatic(res, path);
    json(res, 405, { error: "method not allowed" });
  } catch (err) {
    json(res, 400, { error: (err as Error).message });
  }
});

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";
server.listen(port, host, () => {
  console.log(`Countersign on http://${host}:${port}`);
  console.log("Modes:", describeModes(cfg));
});
