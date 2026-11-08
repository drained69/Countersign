// Countersign as an MCP server (stdio, JSON-RPC 2.0, newline-delimited). Any MCP-capable agent adds it
// with one config entry and pays through `countersign_pay` instead of calling Kite directly.
// It forwards to a running Countersign server (COUNTERSIGN_URL), which owns the ladder, receipts and calibration.
import { createInterface } from "node:readline";

const BASE = (process.env.COUNTERSIGN_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const SUPPORTED = ["2025-06-18", "2025-03-26", "2024-11-05"];

const INTENT_PROPS = {
  agentId: { type: "string", description: "Your agent id, e.g. ops-agent." },
  agentTask: { type: "string", description: "The task you were given, in one sentence. Purchases are checked against it." },
  payee: { type: "string", description: "Payee domain or wallet address." },
  payeeName: { type: "string", description: "Human-readable vendor name." },
  amountUsd: { type: "number", description: "Amount in USD (USDC)." },
  category: { type: "string", description: "What kind of purchase, e.g. 'transcription'." },
  purpose: { type: "string", description: "What this specific purchase is for." },
  url: { type: "string", description: "https x402 endpoint to call once approved." },
  method: { type: "string", description: "HTTP method for the x402 call (default GET)." },
  headers: { type: "object", additionalProperties: { type: "string" }, description: "Extra headers for the x402 call." },
  body: { description: "JSON body for the x402 call." },
  vendorText: { type: "string", description: "Invoice or quote text from the vendor, verbatim. It is screened, never obeyed." },
  waitSeconds: { type: "number", description: "How long to wait for a final decision (default 120). Owner step-ups can take longer." },
};

const TOOLS = [
  {
    name: "countersign_pay",
    title: "Pay through Countersign",
    description:
      "Request a payment from the shared Kite allowance. Countersign checks it (code rules, SERV reasoning, Reppo verdict, " +
      "and the owner's passkey when needed) and pays only if approved. If the result is BLOCKED, do not retry or pay by " +
      "other means. If it is still PENDING, check later with countersign_receipt.",
    inputSchema: {
      type: "object",
      properties: INTENT_PROPS,
      required: ["agentId", "agentTask", "payee", "payeeName", "amountUsd", "category", "purpose"],
    },
  },
  {
    name: "countersign_receipt",
    title: "Get a Countersign receipt",
    description: "Look up a payment decision: status, every check that ran, its cost and reasons.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "Receipt id from countersign_pay." } }, required: ["id"] },
  },
  {
    name: "countersign_policy",
    title: "Show the allowance policy",
    description: "Allowance size, amount spent and left, per-payment cap, review thresholds, known and blocked payees.",
    inputSchema: { type: "object", properties: {} },
  },
];

async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(15_000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Countersign HTTP ${res.status}`);
  return body;
}

function summarize(r: any): string {
  const i = r.intent;
  const head = `${r.status.toUpperCase()}: $${i.amountUsd.toFixed(2)} to ${i.payeeName} (${i.payee}). Receipt ${i.id}: ${BASE}/r/${i.id}`;
  const steps = r.steps.map((s: any) => `- Tier ${s.tier} ${s.name} [${s.mode}]: ${s.outcome}. ${s.reasons.join(" ")}`);
  const next =
    r.status === "approved" ? (r.payment?.executed ? `Paid${r.payment.ref ? ` (ref ${r.payment.ref})` : ""}.` : "Approved.")
    : r.status === "blocked" ? "Do not retry this payment or pay it by other means."
    : "Still being checked or waiting for the owner. Call countersign_receipt later.";
  return [head, ...steps, next].join("\n");
}

async function callTool(name: string, args: any) {
  if (name === "countersign_pay") {
    const { waitSeconds = 120, ...intent } = args ?? {};
    const { id } = await api("/api/intents", { method: "POST", body: JSON.stringify(intent) });
    const deadline = Date.now() + Math.min(Math.max(Number(waitSeconds) || 0, 0), 900) * 1000;
    let r = await api(`/api/receipts/${id}`);
    while (r.status.startsWith("pending") && Date.now() < deadline) {
      await new Promise((ok) => setTimeout(ok, 1000));
      r = await api(`/api/receipts/${id}`);
    }
    return result(summarize(r), { id, status: r.status, receipt: r });
  }
  if (name === "countersign_receipt") {
    const r = await api(`/api/receipts/${encodeURIComponent(String(args?.id ?? ""))}`);
    return result(summarize(r), { id: r.intent.id, status: r.status, receipt: r });
  }
  if (name === "countersign_policy") {
    const s = await api("/api/state");
    const p = s.policy;
    const text = [
      `Allowance $${p.allowanceUsd.toFixed(2)}, spent $${s.spentUsd.toFixed(2)}, left $${(p.allowanceUsd - s.spentUsd).toFixed(2)}.`,
      `Max $${p.maxPerTxUsd.toFixed(2)} per payment. SERV check from $${p.tier1MinUsd}, Reppo review from $${p.tier2MinUsd}.`,
      `Known payees: ${p.knownPayees.map((k: any) => k.payee).join(", ")}. Blocked: ${p.denyPayees.join(", ") || "none"}.`,
      ...(p.agentRules?.length ? [`Agent rules: ${p.agentRules.map((r: any) => `${r.agentId}: ${r.note ?? JSON.stringify(r)}`).join("; ")}`] : []),
    ].join("\n");
    return result(text, { policy: p, spentUsd: s.spentUsd, modes: s.modes });
  }
  throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
}

const result = (text: string, structured: unknown) => ({ content: [{ type: "text", text }], structuredContent: structured, isError: false });

function send(msg: unknown) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

async function handle(msg: any) {
  const { id, method, params } = msg;
  if (id === undefined) return; // notifications (initialized, cancelled) need no reply
  try {
    if (method === "initialize") {
      const v = SUPPORTED.includes(params?.protocolVersion) ? params.protocolVersion : SUPPORTED[0];
      return send({
        jsonrpc: "2.0", id,
        result: {
          protocolVersion: v,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "countersign", title: "Countersign", version: "0.2.0" },
          instructions: "Pay for things with countersign_pay instead of calling Kite directly. Never work around a BLOCKED decision.",
        },
      });
    }
    if (method === "ping") return send({ jsonrpc: "2.0", id, result: {} });
    if (method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    if (method === "tools/call") {
      try {
        return send({ jsonrpc: "2.0", id, result: await callTool(params?.name, params?.arguments) });
      } catch (err: any) {
        if (err?.code === -32602) throw err;
        // Tool failures go back to the model as a result, so it can see why and stop.
        return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Countersign error: ${err.message}. Do not pay by other means.` }], isError: true } });
      }
    }
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (err: any) {
    send({ jsonrpc: "2.0", id, error: { code: err?.code ?? -32603, message: err.message } });
  }
}

createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  }
  void handle(msg);
});
console.error(`Countersign MCP server ready, forwarding to ${BASE}`);
