// Core domain types for Countersign.

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
  | "pending_human";

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
  executed: boolean;
  mode: "live" | "mock";
  ref?: string;
  txHash?: string;
  /** Only ever a link returned by Kite. */
  explorerUrl?: string;
  /** The one-shot step-up session the payment went through, if any. */
  sessionId?: string;
  error?: string;
}
