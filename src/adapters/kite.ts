// Kite Passport adapter. Kite has no public HTTP API; agents drive it through the kpass and ksearch CLIs.
// Tripwire sits in front of `kpass session execute`: nothing is paid until a decision is "approved".
// Written against Kite's published CLI reference (gokite-ai/passport-skills, kpass >= 6.8.9).
//
// Paying:   kpass session execute --url .. --method .. --idempotency-key <key> [--use-allowance | --session-id <id>]
// Step-up:  kpass session create --delegation <one payment, exact amount> --separate --no-reuse --no-browser
//           kpass session status --request-id <req> --wait
//           The owner approves with their passkey; the payment then goes through that capped session.
// Directory: ksearch service search <words>
//
// Money safety: an outcome Kite doesn't confirm is never treated as "not paid". Ambiguous results become
// "unknown" (still counted against the allowance) and are rechecked with the same idempotency key.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { PaymentIntent, PaymentResult } from "../types.ts";

export type KiteMode = "mock" | "kpass";

export interface KiteOptions {
  /** Where approved payments are paid from: the owner's account allowance (default) or one named session. */
  payFrom: "allowance" | "session";
  sessionId?: string;
}

export const DEFAULT_KITE: KiteOptions = { payFrom: "allowance" };

interface CliResult {
  /** Process exit code; null when the process was killed (timeout). */
  code: number | null;
  out: any;
  stdout: string;
  timedOut: boolean;
}

/** Runs a Kite CLI. execFile, not a shell: intent fields can never be interpreted as shell syntax. */
function cli(bin: "kpass" | "ksearch", args: string[], timeoutMs: number): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, KPASS_NO_BROWSER: "1" } },
      (err: any, stdout, stderr) => {
        if (err?.code === "ENOENT") return reject(new Error(`${bin} is not installed or not on PATH (install: curl -fsSL https://cli.gokite.ai/install.sh | bash)`));
        const text = String(stdout ?? "").trim();
        let out: any;
        try {
          out = JSON.parse(text);
        } catch {
          out = { raw: text, stderr: String(stderr ?? "").trim().slice(0, 500) };
        }
        resolve({
          code: err ? (typeof err.code === "number" ? err.code : null) : 0,
          out,
          stdout: text,
          timedOut: Boolean(err?.killed),
        });
      },
    );
  });
}

// --no-interactive: a server must fail fast rather than wait on a prompt nobody will answer.
const kpass = (args: string[], timeoutMs = 30_000) => cli("kpass", [...args, "--output", "json", "--no-interactive"], timeoutMs);

const str = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : undefined);
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[$,\s]/g, "")) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const message = (out: any) => str(out?.user_message) ?? str(out?.error) ?? str(out?.hint) ?? str(out?.raw) ?? "no output";

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

export const hostOf = (s: string) => {
  try {
    return new URL(/^https?:\/\//.test(s) ? s : `https://${s}`).hostname.toLowerCase();
  } catch {
    return s.toLowerCase();
  }
};

/**
 * Is the payee a service listed in Kite's catalog? Searches by the vendor's name and looks for the payee's
 * host among the results. A failed lookup returns `listed: undefined` and never approves anything.
 */
export async function lookupDirectory(intent: PaymentIntent, mode: KiteMode): Promise<DirectoryResult> {
  const host = hostOf(intent.url ?? intent.payee);
  if (mode === "mock") {
    const hit = MOCK_DIRECTORY[host];
    return hit ? { listed: true, ...hit, mode: "mock" } : { listed: false, mode: "mock" };
  }
  const words = intent.payeeName.replace(/[^\p{L}\p{N}\s.-]/gu, " ").split(/\s+/).filter(Boolean).slice(0, 4);
  if (!words.length) words.push(host.split(".")[0]);
  try {
    const r = await cli("ksearch", ["service", "search", ...words, "--top", "10"], 20_000);
    if (r.code !== 0) return { mode: "live", error: message(r.out).slice(0, 200) };
    // The payee's host (or a subdomain of it) as a whole word: "billing.example" must not match "acme-billing.example".
    const word = new RegExp(`(^|[\\s/.@])${host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[\\s/:])`, "i");
    const line = r.stdout.split("\n").find((l) => word.test(l));
    if (!line) return { listed: false, mode: "live" };
    return { listed: true, mode: "live", serviceId: line.match(/\b[0-9a-f]{24}\b/i)?.[0] };
  } catch (err) {
    return { mode: "live", error: (err as Error).message.slice(0, 200) };
  }
}

// ---------- Payment ----------

/**
 * Pay an approved intent. `opts.sessionId` is the one-shot step-up session the owner approved for this payment.
 * `opts.idempotencyKey` must be stored before calling, so a retry after a crash reuses it.
 */
export async function executePayment(
  intent: PaymentIntent,
  mode: KiteMode,
  opts: { sessionId?: string; idempotencyKey?: string; kite?: KiteOptions } = {},
): Promise<PaymentResult> {
  const idempotencyKey = opts.idempotencyKey ?? randomUUID();
  if (mode === "mock") {
    return { executed: true, state: "paid", mode: "mock", ref: `mock-tx-${intent.id}`, idempotencyKey, amountUsd: intent.amountUsd, sessionId: opts.sessionId };
  }
  if (!intent.url) return { executed: false, state: "not_paid", mode: "live", idempotencyKey, error: "No x402 URL to pay." };

  const kite = opts.kite ?? DEFAULT_KITE;
  const args = ["session", "execute", "--url", intent.url, "--method", (intent.method ?? "GET").toUpperCase(), "--idempotency-key", idempotencyKey];
  if (intent.headers) args.push("--headers", JSON.stringify(intent.headers));
  if (intent.body !== undefined) args.push("--body", JSON.stringify(intent.body));
  if (opts.sessionId) args.push("--session-id", opts.sessionId);
  else if (kite.payFrom === "session" && kite.sessionId) args.push("--session-id", kite.sessionId);
  else args.push("--use-allowance");

  const startedAt = new Date().toISOString();
  let r: CliResult;
  try {
    // Kite documents up to 5 minutes for cross-chain settlement.
    r = await kpass(args, 330_000);
  } catch (err) {
    return { executed: false, state: "not_paid", mode: "live", idempotencyKey, startedAt, error: (err as Error).message };
  }
  const result: PaymentResult = { ...classifyExecute(r), mode: "live", idempotencyKey, startedAt, sessionId: opts.sessionId };
  // Kite's execute reply carries no transaction hash; its activity log does.
  if (result.state === "paid" && !result.txHash) {
    const a = await findPaymentActivity(intent, startedAt).catch(() => undefined);
    if (a?.txHash) Object.assign(result, { txHash: a.txHash, chainId: a.chainId });
  }
  return result;
}

export interface PaymentActivity {
  status: string;
  txHash?: string;
  chainId?: number;
  amountUsd?: number;
}

/**
 * Finds this payment in Kite's activity log (`kpass activity --kind x402_payment`): the most recent
 * x402 payment to the same URL since the attempt started. Read-only.
 */
export async function findPaymentActivity(intent: PaymentIntent, since: string): Promise<PaymentActivity | undefined> {
  if (!intent.url) return undefined;
  const r = await kpass(["activity", "--kind", "x402_payment", "--limit", "50"], 20_000);
  if (r.code !== 0) return undefined;
  const from = Date.parse(since) - 60_000; // clock skew between this machine and Kite
  const hit = (r.out?.events ?? [])
    .filter((e: any) => e?.details?.transaction?.x402?.request_url === intent.url && Date.parse(e.occurred_at ?? e.created_at) >= from)
    .sort((a: any, b: any) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))[0];
  if (!hit) return undefined;
  const t = hit.details.transaction;
  const raw = num(t.amount_raw), decimals = num(t.decimals);
  return {
    status: String(hit.status ?? "").toLowerCase(),
    txHash: str(t.tx_hash),
    chainId: num(t.chain_id),
    amountUsd: raw !== undefined && decimals !== undefined ? raw / 10 ** decimals : undefined,
  };
}

/** Errors Kite documents as "nothing moved". Everything else that fails is treated as possibly paid. */
const NOTHING_MOVED = /^(provider_unavailable|route_unavailable|route_uneconomical|routing_cost_exceeded|slippage_exceeded|unsupported_asset|payment_not_settled)$/;

export function classifyExecute(r: CliResult): Omit<PaymentResult, "mode"> {
  const out = r.out ?? {};
  const d = out.details ?? {};
  const base = {
    errorCode: str(out.error_code),
    userMessage: str(out.user_message),
    paymentId: str(d.payment_id) ?? str(out.payment_id),
    txHash: str(d.tx_hash) ?? str(out.tx_hash),
  };
  if (r.timedOut || r.code === null) {
    return { ...base, executed: false, state: "unknown", error: "Kite did not answer in time. The payment may have gone through; recheck before paying again." };
  }
  if (r.code === 0) {
    if (out.status !== "success") {
      return { ...base, executed: false, state: "unknown", error: `Unexpected reply from kpass: ${message(out).slice(0, 200)}` };
    }
    const merchantStatus = num(out.x402?.status_code);
    return {
      ...base,
      executed: true,
      state: "paid",
      ref: base.paymentId,
      amountUsd: num(out.payment_requirement?.amount),
      merchantStatus,
      error: merchantStatus !== undefined && (merchantStatus < 200 || merchantStatus >= 300) ? `Merchant answered HTTP ${merchantStatus} after payment.` : undefined,
    };
  }
  const err = message(out).slice(0, 300);
  if (r.code === 7) {
    if (d.outcome === "merchant_failed_held") {
      return { ...base, executed: false, state: "held", amountUsd: num(d.held_amount), error: err };
    }
    if (base.errorCode === "payment_not_settled") return { ...base, executed: false, state: "not_paid", error: err };
    return { ...base, executed: false, state: "unknown", error: err };
  }
  if (base.errorCode === "payment_settled_unfulfilled") {
    return { ...base, executed: true, state: "paid", error: `Charged, but the merchant did not deliver: ${err}` };
  }
  if (r.code === 1 && !NOTHING_MOVED.test(base.errorCode ?? "")) {
    // bridge_failed, swap_failed, swap_slippage_realized, or an unexpected crash: Kite says funds may have moved.
    return { ...base, executed: false, state: "unknown", error: err };
  }
  // Exit 2 (usage), 3 (auth), 4 (not found), 6 (policy: allowance, balance, caps), or a documented nothing-moved code.
  return { ...base, executed: false, state: "not_paid", error: err };
}

/**
 * Re-check a payment whose outcome was unknown or held. Unknown: Kite's documented retry with the SAME
 * idempotency key, which never pays twice. Held: ask Kite for the merchant's final result.
 */
export async function recheckPayment(intent: PaymentIntent, previous: PaymentResult, kite: KiteOptions = DEFAULT_KITE): Promise<PaymentResult> {
  if (previous.state !== "unknown" && previous.state !== "held") return previous;
  // Kite's own record first: read-only, and it settles the question without sending anything.
  const a = await findPaymentActivity(intent, previous.startedAt ?? intent.createdAt).catch(() => undefined);
  if (a?.status === "completed") {
    return { ...previous, executed: true, state: "paid", txHash: a.txHash ?? previous.txHash, chainId: a.chainId, amountUsd: a.amountUsd ?? previous.amountUsd, error: undefined };
  }
  if (a && /fail|refund|releas|cancel|revers/.test(a.status)) {
    return { ...previous, executed: false, state: "not_paid", error: `Kite's activity log shows this payment as ${a.status}; nothing is counted.` };
  }
  // Held money waits for the merchant's result: never send it again. Check later, or settle by hand.
  if (previous.state === "held" || !previous.idempotencyKey) {
    return { ...previous, error: `${a ? `Kite's activity log shows it as ${a.status}. ` : "Not in Kite's activity log yet. "}Check again later, or resolve it after checking Kite's Activity page.` };
  }
  // Unknown and not in the log: Kite's documented retry with the SAME key, which never charges twice.
  return executePayment(intent, "kpass", { idempotencyKey: previous.idempotencyKey, sessionId: previous.sessionId, kite });
}

// ---------- Step-up ----------

export interface StepUpRequest {
  mode: KiteMode;
  requestId?: string;
  approvalUrl?: string;
  expiresAt?: string;
  approvalHint: string;
}

/**
 * Ask the owner to approve this one payment: a separate Kite session capped at exactly this amount,
 * which Kite only activates after the owner's passkey. In mock mode the dashboard stands in for the passkey.
 */
export async function requestStepUp(intent: PaymentIntent, mode: KiteMode): Promise<StepUpRequest> {
  if (mode === "mock") {
    return { mode, approvalHint: "Approve or decline on the Tripwire dashboard (stands in for the Kite passkey prompt)." };
  }
  const amount = intent.amountUsd.toFixed(2);
  const delegation = {
    task: { summary: `Tripwire step-up: one payment of $${amount} to ${intent.payeeName} for ${intent.purpose}`.slice(0, 240) },
    payment_policy: { max_amount_per_tx: amount, max_total_amount: amount, ttl_seconds: 900 },
  };
  const r = await kpass(["session", "create", "--delegation", JSON.stringify(delegation), "--separate", "--no-reuse", "--no-browser"]);
  if (r.code !== 0 || r.out?.status !== "human_action_required" || !r.out?.request_id) {
    throw new Error(message(r.out).slice(0, 300));
  }
  return {
    mode,
    requestId: str(r.out.request_id),
    approvalUrl: str(r.out.approval_url),
    expiresAt: str(r.out.expires_at),
    approvalHint: `Approve this payment with your passkey in Kite Passport${r.out.approval_url ? `: ${r.out.approval_url}` : "."}`,
  };
}

export interface StepUpAnswer {
  answer: "approved" | "declined";
  sessionId?: string;
}

/**
 * Wait (up to ~a minute) for the owner's answer. Returns undefined while still pending,
 * so the caller can keep waiting until its own deadline.
 */
export async function pollStepUp(requestId: string, waitSeconds = 55): Promise<StepUpAnswer | undefined> {
  const r = await kpass(["session", "status", "--request-id", requestId, "--wait", "--timeout", String(waitSeconds)], (waitSeconds + 20) * 1000);
  if (r.timedOut) return undefined;
  const out = r.out ?? {};
  if (r.code === 0 && out.status === "success") {
    const sessionId = str(out.session_id) ?? str(out.session?.id);
    return sessionId ? { answer: "approved", sessionId } : undefined;
  }
  // Rejected or expired (exit 3).
  if (r.code === 3 && /reject|expire/i.test(message(out))) return { answer: "declined" };
  if (r.code === 0 && out.status === "pending") return undefined;
  throw new Error(message(out).slice(0, 200));
}

// ---------- Health check ----------

/** Read-only checks for `npm run doctor`. Sends no payment. */
export async function kiteHealth(): Promise<{ ok: boolean; lines: string[] }> {
  const lines: string[] = [];
  let ok = true;
  try {
    const v = await cli("kpass", ["--version"], 15_000);
    const version = (v.stdout.match(/\d+\.\d+\.\d+/) ?? [])[0];
    const [maj, min, pat] = (version ?? "0.0.0").split(".").map(Number);
    const fresh = maj > 6 || (maj === 6 && (min > 8 || (min === 8 && pat >= 9)));
    lines.push(`${fresh ? "ok " : "!! "} kpass ${version ?? "(unknown version)"}${fresh ? "" : " (need 6.8.9 or later: kpass upgrade)"}`);
    ok &&= fresh;
    const s = await kpass(["status"], 20_000);
    const loggedIn = s.code === 0;
    lines.push(`${loggedIn ? "ok " : "!! "} kpass login: ${loggedIn ? "logged in" : message(s.out)}`);
    ok &&= loggedIn;
    if (loggedIn) {
      const a = await kpass(["allowance", "status"], 20_000);
      const state = str(a.out?.state);
      lines.push(`${state === "active" ? "ok " : "!! "} account allowance: ${state ?? "unknown"}${a.out?.user_message ? ` (${a.out.user_message})` : ""}`);
    }
  } catch (err) {
    ok = false;
    lines.push(`!!  ${(err as Error).message}`);
  }
  try {
    const k = await cli("ksearch", ["--version"], 15_000);
    lines.push(`${k.code === 0 ? "ok " : "!! "} ksearch ${k.stdout.split("\n")[0] || "available"}`);
  } catch (err) {
    lines.push(`!!  ${(err as Error).message} (directory checks will flag every new payee for review)`);
  }
  return { ok, lines };
}
