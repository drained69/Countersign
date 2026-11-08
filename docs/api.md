# API and agent integration

The MCP server for agents, the HTTP API, intent fields and the receipt format.

[← Back to the README](../README.md)

## Contents

- [Connect an agent (MCP)](#connect-an-agent-mcp)
- [API reference](#api-reference)
- [Receipts](#receipts)

## Connect an agent (MCP)

Tripwire ships as a dependency-free MCP server (stdio). An agent adds it once and pays through it instead of calling Kite directly. It forwards to the running Tripwire server.

```bash
claude mcp add tripwire \
  --env TRIPWIRE_URL=http://127.0.0.1:8787 \
  --env TRIPWIRE_AGENT_KEY=<this agent's key> \
  -- node /path/to/tripwire/src/mcp.ts
```

Or in any MCP client's JSON config:

```json
{
  "mcpServers": {
    "tripwire": {
      "command": "node",
      "args": ["/path/to/tripwire/src/mcp.ts"],
      "env": { "TRIPWIRE_URL": "http://127.0.0.1:8787", "TRIPWIRE_AGENT_KEY": "<this agent's key>" }
    }
  }
}
```

`TRIPWIRE_AGENT_KEY` is the agent's key from `TRIPWIRE_AGENT_KEYS`; the key decides which agent is paying. The open local demo needs no key.

| Tool | What it does |
|---|---|
| `tripwire_pay` | Intent fields plus optional `requestKey` and `waitSeconds` (default 120, max 900). Returns `APPROVED`, `BLOCKED`, `PENDING_*`, `PAYING` or `PAYMENT_UNKNOWN` with every check and a receipt link. Blocked and unknown results tell the agent not to retry or pay by other means. |
| `tripwire_receipt` | Look up a decision by id, e.g. one waiting for the owner's passkey. |
| `tripwire_policy` | This agent's limits: allowance left, caps, thresholds, known/blocked payees and its own rules. |

Results come back as text for the model and as `structuredContent` with the full receipt. Errors come back as `isError: true` tool results, so the agent sees why and stops. Tested end to end with an MCP client: initialize, list tools, an approved payment, a blocked one, a pending one and invalid input.

## API reference

The server binds to `127.0.0.1:8787` by default. Request bodies must be JSON objects, up to 64 KB.

**Authentication.** With `TRIPWIRE_OWNER_TOKEN` set, every `/api/*` call except sign-in needs a caller. Agents send `Authorization: Bearer <agent key>`; the owner signs in on the dashboard (an HttpOnly, SameSite=Strict cookie) or sends the owner token as a Bearer token. Without an owner token (the local demo), callers addressing `localhost` are the owner.

| Method | Path | Who | Description |
|---|---|---|---|
| `POST` | `/api/intents` | agent, owner | Submit a payment intent → `202 { id, receipt }`. An agent key fixes `agentId`. A repeated `requestKey` → `200 { id, duplicate: true, status }`. |
| `GET` | `/api/receipts/:id` | agent (own), owner | Full receipt (`404` if unknown or another agent's). |
| `GET` | `/api/agent/policy` | agent, owner | The calling agent's limits: allowance left, caps, thresholds, payees, its rules. |
| `GET` | `/api/events` | owner | Server-sent events: `{type:"receipt", receipt}` on every change, `{type:"policy"}`, `{type:"reset"}`. |
| `GET` | `/api/state` | owner | Modes, policy, amount spent, receipts (newest first), calibration, agents. |
| `POST` | `/api/receipts/:id/recheck` | owner | For a `payment_unknown` receipt: ask Kite again with the same idempotency key, or fetch a held payment's result. |
| `POST` | `/api/receipts/:id/resolve` | owner | `{ "answer": "paid" \| "not_paid" }` for a `payment_unknown` receipt, after checking Kite's Activity page. |
| `POST` | `/api/stepup/:id` | owner | `{ "answer": "approved" \| "declined" }`. Mock mode only; with `KITE_MODE=kpass` it returns `409`, and the owner uses their passkey. |
| `GET` | `/api/replay` | owner | Six-week replay, with and without calibration. Always offline, cached. |
| `POST` | `/api/policy/compile` | owner | `{ text }` → preview `{ id, changes[], unsupported[], policy, mode, costUsd }`. Changes nothing. |
| `POST` | `/api/policy/apply` | owner | `{ id }` → applies that exact preview, saves it, re-runs the replay. `409` if the policy changed since. |
| `POST` | `/api/demo/next` · `/api/demo/reset` | owner | Play the next scripted payment, or clear everything. Off (`409`) in live mode. |
| `GET` | `/api/session` · `/api/health` | anyone | Whether sign-in is required and who you are; liveness. |
| `POST` | `/api/login` · `/api/logout` | anyone | `{ token }` → sets the owner cookie (10 failures per 10 minutes per address, then `429`). |

**Errors** are JSON `{ "error": "…" }` with a meaningful status: `400` invalid input, `401` no caller, `403` wrong role or cross-site write, `404` unknown, `409` wrong state, `413` body too large, `429` rate-limited.

### Submitting a payment

```bash
curl -X POST http://127.0.0.1:8787/api/intents \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $AGENT_KEY" \
  -d '{
    "requestKey": "invoice-1042",
    "agentTask": "Pay approved vendor invoices for the Acme Design brand refresh project",
    "payee": "acme-billing.example",
    "payeeName": "Acme Design (billing)",
    "amountUsd": 60,
    "category": "design invoice",
    "purpose": "Invoice #1042 for brand refresh milestone 2",
    "url": "https://acme-billing.example/x402/invoices/1042",
    "method": "POST"
  }'
```

The response is `202 { "id": "pi-…", "receipt": "/api/receipts/pi-…" }`. Follow the decision on `/api/events`, poll the receipt, or let the MCP `tripwire_pay` tool wait for you.

### Intent fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `agentId` | string ≤ 100 | ✓ | Which agent is paying. Set by the API key when one is used. |
| `agentTask` | string ≤ 500 | ✓ | The task the agent was given (its Kite session summary). |
| `payee` | string ≤ 200 | ✓ | Domain or wallet address. Normalized to lower case, trailing dot removed. |
| `payeeName` | string ≤ 200 | ✓ | Human-readable vendor name. |
| `amountUsd` | number, > 0 and ≤ 1,000,000 | ✓ | |
| `category` | string ≤ 100 | ✓ | e.g. `transcription`. |
| `purpose` | string ≤ 500 | ✓ | What this specific purchase is for. |
| `url` | https string ≤ 2000 | live: ✓ | x402 endpoint Kite pays once approved. Must be on the payee's domain. |
| `method` | `GET` `POST` `PUT` `PATCH` `DELETE` | | Defaults to `GET`. |
| `requestKey` | string ≤ 200 | | Your id for this purchase. Resubmitting it returns the first decision instead of paying twice. |
| `headers` | object of strings | | Extra headers for the x402 call. |
| `body` | any JSON | | Request body for the x402 call (e.g. an invoice POST). |
| `vendorText` | string ≤ 8000 | | Invoice or quote text. Screened, never obeyed. |

## Receipts

Every payment gets a receipt at `/r/<id>` (JSON at `/api/receipts/<id>`):

```ts
interface Receipt {
  intent: PaymentIntent;
  status: "approved" | "blocked" | "pending_network" | "pending_human"
        | "paying"            // approved, Kite payment in progress
        | "payment_unknown";  // Kite couldn't confirm it: counted until rechecked or resolved
  steps: StepRecord[];          // one per tier that ran
  verificationCostUsd: number;
  plannedTier: 0 | 1 | 2 | 3;
  payment?: {
    executed: boolean;                    // true only when known to be paid
    state: "paid" | "not_paid" | "unknown" | "held";
    mode: "live" | "mock";
    idempotencyKey?: string;              // saved before paying; any retry reuses it
    amountUsd?: number;                   // what Kite reports it paid
    merchantStatus?: number;              // the merchant's HTTP status after payment
    paymentId?: string; ref?: string; txHash?: string;
    errorCode?: string; userMessage?: string;  // Kite's own code and message
    explorerUrl?: string;   // only a link Kite itself returned
    sessionId?: string;     // the one-shot step-up session it paid through
    error?: string;
  };
  decidedAt?: string;
}

interface StepRecord {
  tier: 0 | 1 | 2 | 3;
  name: string;
  kind: "code" | "llm" | "network" | "human";
  outcome: "pass" | "escalate" | "block";
  reasons: string[];
  costUsd: number;
  latencyMs: number;
  mode: "live" | "mock" | "sandbox";
  detail?: Record<string, unknown>;  // promptGuard, servTools, kiteDirectory, priceQuote, approvalUrl, splitTotalUsd, Reppo evalId, …
}
```

The authoritative definitions are in [`src/types.ts`](../src/types.ts).
