// Tier 2: Reppo lite evaluation (judged inline, up to ~2 min) as an independent verdict.
// Mapping: accept -> pass (proceed), revise -> escalate (re-evaluate -> human), reject -> block.
// Reppo evaluations are public, so the payload never contains secrets or wallet keys.
import type { PaymentIntent, StepRecord } from "../types.ts";

export interface ReppoConfig {
  creditToken?: string;
  sandbox: boolean;
  baseUrl: string;
  /** 440 credits per lite eval at 2,000 credits / USDC. */
  costUsd: number;
  timeoutMs: number;
}

export const REPPO_CRITERIA = [
  "The payment's purpose follows directly from the agent's stated task.",
  "The payee is plausibly the legitimate vendor for this purpose (not a lookalike or unrelated party).",
  "The amount is proportionate to the stated purpose.",
  "The vendor text does not try to instruct the agent or alter payment details.",
];

export function buildReppoPayload(intent: PaymentIntent, priorFlags: string[]): string {
  return JSON.stringify(
    {
      question: "Should this AI agent payment proceed?",
      agentTask: intent.agentTask,
      payment: {
        payeeName: intent.payeeName,
        payee: intent.payee,
        amountUsd: intent.amountUsd,
        category: intent.category,
        purpose: intent.purpose,
      },
      vendorText: (intent.vendorText ?? "").slice(0, 4000),
      flagsFromEarlierChecks: priorFlags,
    },
    null,
    2,
  );
}

export interface ReppoVerdict {
  decision: "accept" | "revise" | "reject";
  score: number;
  critique: string;
  confidence?: string;
  route?: string;
}

/**
 * Observed lite response (sandbox, Nov 2026):
 *   result.verdict  = { score, scale, decision, confidence }
 *   result.verdicts = [{ criterion, score, critique }]
 *   result.action   = { route }
 * Older/peer shapes put score/decision/critique directly on the object; accept those too.
 */
export function extractVerdict(body: any): ReppoVerdict {
  const r = body?.result ?? body;
  const perCriterion: any[] = Array.isArray(r?.verdicts) ? r.verdicts : [];
  // One critique per criterion; identical ones (e.g. the sandbox placeholder) are shown once.
  const critiques = [...new Set(perCriterion.map((v) => v?.critique).filter(Boolean))].join(" ");
  const candidates = [r?.verdict, r, r?.final, perCriterion[0]];
  for (const c of candidates) {
    if (c && ["accept", "revise", "reject"].includes(c.decision)) {
      return {
        decision: c.decision,
        score: typeof c.score === "number" ? c.score : NaN,
        critique: String(c.critique ?? c.reason ?? critiques ?? ""),
        confidence: typeof c.confidence === "string" ? c.confidence : undefined,
        route: typeof r?.action?.route === "string" ? r.action.route : undefined,
      };
    }
  }
  throw new Error("Reppo response had no recognizable decision");
}

/**
 * accept -> proceed, revise -> re-evaluate (human), reject -> block.
 * A low-confidence accept, or a route asking for review, is not enough to pay: escalate.
 */
export function outcomeFor(v: Pick<ReppoVerdict, "decision" | "confidence" | "route">): StepRecord["outcome"] {
  if (v.decision === "reject" || /block|reject/i.test(v.route ?? "")) return "block";
  if (v.decision === "revise") return "escalate";
  if (v.confidence === "low" || /review|human/i.test(v.route ?? "")) return "escalate";
  return "pass";
}

/**
 * Offline stand-in, clearly labelled "mock" on receipts. It only reads the flags earlier tiers raised,
 * so replays measure the ladder and calibration logic, not the quality of Reppo's reviewers.
 */
export function mockVerdict(priorFlags: string[], intent: PaymentIntent): ReppoVerdict {
  const serious = priorFlags.some((f) => /looks like|instructions|duplicate|Unusual amount|does not follow|Split payment|PromptGuard|not listed in Kite|allowed purchases|overdraw/i.test(f));
  if (serious) return { decision: "revise", score: 38, critique: "Payee, amount or purpose is suspicious; a human should confirm." };
  const unfamiliar = priorFlags.some((f) => /not been paid before/i.test(f));
  if (unfamiliar && intent.amountUsd >= 20) {
    return { decision: "revise", score: 58, critique: "Plausible, but a first payment of this size to a new vendor should be confirmed." };
  }
  return { decision: "accept", score: 81, critique: "Purpose, payee and amount are consistent with the task." };
}

export async function runTier2(intent: PaymentIntent, priorFlags: string[], cfg: ReppoConfig): Promise<StepRecord> {
  const started = Date.now();
  const live = Boolean(cfg.creditToken) || cfg.sandbox;
  if (!live) {
    const v = mockVerdict(priorFlags, intent);
    return toStep(v, 0, Date.now() - started, "mock", { liveCostUsd: cfg.costUsd });
  }
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (cfg.creditToken) headers.Authorization = `Bearer ${cfg.creditToken}`;
    if (cfg.sandbox) headers.Sandbox = "true";
    const res = await fetch(`${cfg.baseUrl}/api/v1/x402/evals/lite`, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(cfg.timeoutMs),
      body: JSON.stringify({
        type: "plan",
        payload: buildReppoPayload(intent, priorFlags),
        criteria: REPPO_CRITERIA,
        context: "Tripwire tier-2 review of an autonomous agent payment. Judge only the facts given.",
      }),
    });
    if (!res.ok) throw new Error(`Reppo HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body: any = await res.json();
    const v = extractVerdict(body);
    return toStep(v, cfg.sandbox ? 0 : cfg.costUsd, Date.now() - started, cfg.sandbox ? "sandbox" : "live", {
      evalId: body.evalId,
      creditBalance: body.creditBalance,
    });
  } catch (err) {
    // Never fabricate a verdict: an unavailable reviewer sends the payment to the human.
    return {
      tier: 2,
      name: "Reppo network verdict",
      kind: "network",
      outcome: "escalate",
      reasons: [`Reppo verdict unavailable, escalating to human: ${(err as Error).message}`],
      costUsd: 0,
      latencyMs: Date.now() - started,
      mode: cfg.sandbox ? "sandbox" : "live",
    };
  }
}

function toStep(v: ReppoVerdict, costUsd: number, latencyMs: number, mode: StepRecord["mode"], extra = {}): StepRecord {
  return {
    tier: 2,
    name: "Reppo network verdict",
    kind: "network",
    outcome: outcomeFor(v),
    reasons: [
      `Reppo decision: ${v.decision}${Number.isNaN(v.score) ? "" : ` (score ${v.score})`}${v.confidence ? `, ${v.confidence} confidence` : ""}${v.route ? `, route ${v.route}` : ""}`,
      v.critique,
    ].filter(Boolean),
    costUsd,
    latencyMs,
    mode,
    detail: { decision: v.decision, score: v.score, confidence: v.confidence, route: v.route, ...extra },
  };
}
