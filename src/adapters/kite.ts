// Kite Passport adapter. Kite has no public HTTP API yet; agents drive it through the kpass and ksearch CLIs.
// Countersign sits in front of `kpass agent:session execute`: nothing is paid until a decision is "approved".
//
// Tier 3 (human step-up) uses a documented Kite primitive: a one-shot spending session scoped to exactly
// this payment. Creating it makes Kite ask the owner for passkey approval; the approved payment is then
// executed through that session, so it can only pay this amount once.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PaymentIntent, PaymentResult } from "../types.ts";

const run = promisify(execFile);

export type KiteMode = "mock" | "kpass";

async function cli(bin: "kpass" | "ksearch", args: string[], timeoutMs = 30_000): Promise<any> {
  // execFile, not a shell: intent fields can never be interpreted as shell syntax.
  const flags = bin === "kpass" ? ["--output", "json", "--no-interactive"] : ["--output", "json"];
  const { stdout } = await run(bin, [...args, ...flags], { timeout: timeoutMs });
  try {
    return JSON.parse(stdout);
  } catch {
    return { raw: stdout.trim() };
  }
}

const kpass = (args: string[], timeoutMs?: number) => cli("kpass", args, timeoutMs);

/** First string found under any of these keys, at the top level or one level down. */
function pick(out: any, keys: string[]): string | undefined {
  for (const src of [out, out?.data, out?.payment, out?.result, out?.session]) {
    for (const k of keys) if (src && (typeof src[k] === "string" || typeof src[k] === "number")) return String(src[k]);
  }
  return undefined;
}

// ---------- Kite service directory (ksearch) ----------

export interface DirectoryResult {
  listed?: boolean;
  serviceId?: string;
  name?: string;
  mode: "live" | "mock";
  error?: string;
}

/** Offline stand-in for Kite's service directory: the legitimate demo vendors are listed, attackers are not. */
const MOCK_DIRECTORY: Record<string, { serviceId: string; name: string }> = {
  "searchapi.example": { serviceId: "svc_searchapi", name: "SearchAPI" },
  "scrape.example": { serviceId: "svc_pagescrape", name: "PageScrape" },
  "transcribe.example": { serviceId: "svc_transcribe", name: "Transcribe Co" },
  "cloudhost.example": { serviceId: "svc_cloudhost", name: "CloudHost" },
  "acme-billing.example": { serviceId: "svc_acme", name: "Acme Design" },
  "fonts.example": { serviceId: "svc_typefoundry", name: "TypeFoundry" },
};

const hostOf = (s: string) => {
  try {
    return new URL(/^https?:\/\//.test(s) ? s : `https://${s}`).hostname.toLowerCase();
  } catch {
    return s.toLowerCase();
  }
};

/**
 * Is the payee a service listed in Kite's directory? Matches on the payee's host appearing in a
 * listed service's URLs. A failed lookup returns `listed: undefined` and never approves anything.
 */
export async function lookupDirectory(intent: PaymentIntent, mode: KiteMode): Promise<DirectoryResult> {
  const host = hostOf(intent.payee);
  if (mode === "mock") {
    const hit = MOCK_DIRECTORY[host];
    return hit ? { listed: true, ...hit, mode: "mock" } : { listed: false, mode: "mock" };
  }
  try {
    const out = await cli("ksearch", [
      "services", "list", "--query", intent.payeeName.slice(0, 100),
      "--payment-approach", "x402_http", "--asset", "USDC", "--limit", "10",
    ], 15_000);
    const list: any[] = Array.isArray(out) ? out : out.services ?? out.data ?? out.results ?? [];
    const hit = list.find((svc) => JSON.stringify(svc).toLowerCase().includes(host));
    if (!hit) return { listed: false, mode: "live" };
    return { listed: true, mode: "live", serviceId: pick(hit, ["id", "serviceId", "service_id"]), name: pick(hit, ["name", "title"]) };
  } catch (err) {
    return { mode: "live", error: (err as Error).message.slice(0, 200) };
  }
}

// ---------- Payment ----------

// kpass has one active session for the whole CLI, so payments run one at a time.
let queue: Promise<unknown> = Promise.resolve();
const serialized = <T>(fn: () => Promise<T>): Promise<T> => {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
};

/** The CLI's currently active session, if `kpass status` reports one. */
async function activeSessionId(): Promise<string | undefined> {
  try {
    return pick(await kpass(["status"], 15_000), ["activeSessionId", "active_session_id", "sessionId", "session_id"]);
  } catch {
    return undefined;
  }
}

export function executePayment(intent: PaymentIntent, mode: KiteMode, opts: { sessionId?: string } = {}): Promise<PaymentResult> {
  if (mode === "mock" || !intent.url) {
    return Promise.resolve({ executed: true, mode: "mock", ref: `mock-tx-${intent.id}`, sessionId: opts.sessionId });
  }
  return serialized(() => executeLive(intent, opts));
}

async function executeLive(intent: PaymentIntent, opts: { sessionId?: string }): Promise<PaymentResult> {
  // A step-up approval created a session for exactly this payment: pay through it, then switch back.
  // If the previous session can't be determined, pay through the default session instead of stranding later payments.
  const previous = opts.sessionId ? await activeSessionId() : undefined;
  const viaStepUp = Boolean(opts.sessionId && previous);
  try {
    if (viaStepUp) await kpass(["agent:session", "use", "--session-id", opts.sessionId!]);
    const args = ["agent:session", "execute", "--url", intent.url!, "--method", intent.method ?? "GET"];
    if (intent.headers) args.push("--headers", JSON.stringify(intent.headers));
    if (intent.body !== undefined) args.push("--body", JSON.stringify(intent.body));
    const out = await kpass(args, 60_000);
    return {
      executed: true,
      mode: "live",
      ref: pick(out, ["paymentId", "payment_id", "id", "voucherId"]),
      txHash: pick(out, ["txHash", "tx_hash", "transactionHash", "hash"]),
      // Only a link Kite itself returns; Countersign never builds explorer URLs.
      explorerUrl: pick(out, ["explorerUrl", "explorer_url", "exploreUrl"]),
      sessionId: viaStepUp ? opts.sessionId : undefined,
    };
  } catch (err) {
    return { executed: false, mode: "live", error: (err as Error).message.slice(0, 300), sessionId: viaStepUp ? opts.sessionId : undefined };
  } finally {
    if (viaStepUp) await kpass(["agent:session", "use", "--session-id", previous!]).catch(() => {});
  }
}

// ---------- Step-up ----------

export interface StepUpRequest {
  mode: KiteMode;
  requestId?: string;
  approvalHint: string;
}

/** Ask the owner to approve this one payment. In mock mode the dashboard button stands in for the passkey. */
export async function requestStepUp(intent: PaymentIntent, mode: KiteMode): Promise<StepUpRequest> {
  if (mode === "mock") {
    return { mode, approvalHint: "Approve or decline on the Countersign dashboard (stands in for the Kite passkey prompt)." };
  }
  const amount = intent.amountUsd.toFixed(2);
  const out = await kpass([
    "agent:session", "create",
    "--task-summary", `Countersign step-up: $${amount} to ${intent.payeeName} for ${intent.purpose}`.slice(0, 200),
    "--max-amount-per-tx", amount,
    "--max-total-amount", amount,
    "--ttl", "15m",
    "--assets", "USDC",
    "--payment-approach", "x402_http",
  ]);
  const requestId = pick(out, ["requestId", "request_id", "id"]);
  return {
    mode,
    requestId,
    approvalHint: "Approve the one-shot session with your passkey in the Kite Passport dashboard.",
  };
}

export interface StepUpAnswer {
  answer: "approved" | "declined";
  sessionId?: string;
}

/**
 * Wait (up to `waitMs`) for the owner's answer with `agent:session status --wait`.
 * Returns undefined while still pending, so the caller can keep waiting until its own deadline.
 */
export async function pollStepUp(requestId: string, waitMs = 60_000): Promise<StepUpAnswer | undefined> {
  let out;
  try {
    out = await kpass(["agent:session", "status", "--request-id", requestId, "--wait"], waitMs);
  } catch (err: any) {
    if (err?.killed || err?.signal === "SIGTERM") return undefined; // --wait outlived our window: still pending
    throw err;
  }
  const status = String(pick(out, ["status", "state"]) ?? "").toLowerCase();
  const sessionId = pick(out, ["sessionId", "session_id"]);
  if (["approved", "active"].includes(status)) return { answer: "approved", sessionId };
  if (["rejected", "declined", "denied", "expired", "cancelled", "canceled"].includes(status)) return { answer: "declined" };
  return undefined;
}
