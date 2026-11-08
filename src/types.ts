// Core domain types for Tripwire.

/** A payment an agent wants to make out of a shared Kite allowance. */
export interface PaymentIntent {
  id: string;
  agentId: string;
  /** What the agent says it is working on (from its Kite session task summary). */
  agentTask: string;
  /** Payee identifier (domain or wallet address). */
  payee: string;
  payeeName: string;
  amountUsd: number;
  category: string;
  /** What the agent says this specific purchase is for. */
  purpose: string;
  /** x402 endpoint to call if approved. */
  url?: string;
  method?: string;
  /** Extra request headers and JSON body for the x402 call (e.g. an invoice POST). */
  headers?: Record<string, string>;
  body?: unknown;
  /** Agent-chosen key: resubmitting the same key returns the original decision instead of paying twice. */
  requestKey?: string;
  /** Untrusted text returned by the vendor (invoice body, quote). Screened, never obeyed. */
  vendorText?: string;
  createdAt: string;
}

export type StepKind = "code" | "llm" | "network" | "human";
export type StepOutcome = "pass" | "escalate" | "block";

/** One rung of the ladder that ran for an intent. Goes on the receipt. */
export interface StepRecord {
  tier: 0 | 1 | 2 | 3;
  name: string;
  kind: StepKind;
  outcome: StepOutcome;
  reasons: string[];
  costUsd: number;
  latencyMs: number;
  /** "live" when a real sponsor API answered, "mock" when the local stand-in did. */
  mode: "live" | "mock" | "sandbox";
  detail?: Record<string, unknown>;
}

export type DecisionStatus =
  | "approved"
  | "blocked"
  | "pending_network"
  | "pending_human"
  /** Approved and being paid through Kite right now. Counts against the allowance. */
  | "paying"
  /** Kite could not confirm whether the payment went through. Counts against the allowance until resolved; never retried blindly. */
  | "payment_unknown";

export interface Receipt {
  intent: PaymentIntent;
  status: DecisionStatus;
  steps: StepRecord[];
  verificationCostUsd: number;
  /** Highest tier the intent was routed to before any step ran. */
  plannedTier: 0 | 1 | 2 | 3;
  payment?: PaymentResult;
  decidedAt?: string;
}

export interface Policy {
  allowanceUsd: number;
  maxPerTxUsd: number;
  /** Known-good payees; anything else is "new vendor". */
  knownPayees: { payee: string; name: string }[];
  /** Payees that are always blocked. */
  denyPayees: string[];
  /** Base thresholds; calibration moves them per payee. */
  tier1MinUsd: number;
  tier2MinUsd: number;
  duplicateWindowMinutes: number;
  /** Hard cap on any payment to a payee not yet on the allowlist. */
  newPayeeMaxUsd?: number;
  /** Per-agent rules, usually compiled from the owner's plain-English policy. */
  agentRules?: AgentRule[];
  /** When the allowance starts over (UTC). Weekly periods start on Monday. Default: never. */
  resetPeriod?: "never" | "weekly" | "monthly";
}

export interface AgentRule {
  agentId: string;
  /** Keywords; a purchase matches when its category or purpose contains one. Outside them -> network review. */
  allowedCategories?: string[];
  /** Hard per-payment cap for this agent. */
  maxPerTxUsd?: number;
  /** Payees this agent may never pay. */
  blockedPayees?: string[];
  /** The owner's sentence this rule came from. */
  note: string;
}

export interface PaymentResult {
  /** True only when the payment is known to have gone through. */
  executed: boolean;
  /** paid: went through. not_paid: nothing was charged. unknown: may have gone through. held: charged amount is held by Kite pending the merchant's result. */
  state: "paid" | "not_paid" | "unknown" | "held";
  mode: "live" | "mock";
  /** Sent to Kite as the idempotency key; any retry of this payment reuses it. */
  idempotencyKey?: string;
  /** Amount Kite reports it paid, when it says. */
  amountUsd?: number;
  /** HTTP status the merchant answered with after payment. */
  merchantStatus?: number;
  paymentId?: string;
  /** Kite's machine-readable error code, if any. */
  errorCode?: string;
  /** Kite's message for the owner, passed through as is. */
  userMessage?: string;
  ref?: string;
  txHash?: string;
  /** Only ever a link returned by Kite. */
  explorerUrl?: string;
  /** The one-shot step-up session the payment went through, if any. */
  sessionId?: string;
  error?: string;
}
