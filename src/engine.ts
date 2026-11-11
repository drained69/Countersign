// The ladder: tier 0 code rules -> tier 1 SERV reasoning -> tier 2 Reppo verdict -> tier 3 human step-up.
// Verification gets stricter as the amount at risk grows; any "block" stops the payment,
// any "escalate" moves it up a rung. Nothing is paid until the receipt says "approved".
import { Calibration } from "./calibration.ts";
import { DEFAULT_KITE, executePayment, lookupDirectory, pollStepUp, recheckPayment, requestStepUp, type KiteMode, type KiteOptions } from "./adapters/kite.ts";
import { quotePrice } from "./adapters/x402.ts";
import { PRICE_UNVERIFIED, runTier0 } from "./tiers/tier0.ts";
import { randomUUID } from "node:crypto";
import { runTier1, type ServConfig } from "./tiers/tier1Serv.ts";
import { reppoConfigured, reppoOverDailyLimit, runTier2, type ReppoConfig } from "./tiers/tier2Reppo.ts";
import type { PaymentIntent, PaymentResult, Policy, Receipt, StepRecord } from "./types.ts";

export interface EngineConfig {
  policy: Policy;
  serv: ServConfig;
  reppo: ReppoConfig;
  kiteMode: KiteMode;
  /** Where live payments are paid from. */
  kite?: KiteOptions;
  /** Execute the Kite payment after approval. Replays turn this off. */
  executePayments: boolean;
}

/** Tier-0 flags that force at least a Reppo review regardless of amount or calibration. */
/** Prefix of the tier-0 reason added when the owner recently reported a problem with this payee. */
export const OWNER_REPORTED = "You reported a problem with a payment to";

const SERIOUS = /You reported a problem with a payment to|Couldn't confirm the merchant's price|looks like|instructions aimed|duplicate charge|above 80%|Unusual amount|Split payment|not listed in Kite|Outside .* allowed purchases|Would overdraw/i;

export function planTier(
  amountUsd: number,
  tier0: StepRecord,
  thresholds: { tier1MinUsd: number; tier2MinUsd: number },
  payeeKnown: boolean,
): 0 | 1 | 2 | 3 {
  if (tier0.outcome === "block") return 0;
  let tier: 0 | 1 | 2 = 0;
  if (amountUsd >= thresholds.tier2MinUsd) tier = 2;
  else if (amountUsd >= thresholds.tier1MinUsd) tier = 1;
  if (!payeeKnown && tier < 1) tier = 1;
  if (tier0.reasons.some((r) => SERIOUS.test(r))) tier = 2;
  // An unconfirmed price is only safe through a passkey session capped at the requested amount.
  if (tier0.reasons.some((r) => r.startsWith(PRICE_UNVERIFIED))) return 3;
  // The owner reported this payee recently: the owner approves its payments for the window.
  if (tier0.reasons.some((r) => r.startsWith(OWNER_REPORTED))) return 3;
  return tier;
}

type HumanAnswer = "approved" | "declined";

export class Engine {
  cfg: EngineConfig;
  calibration: Calibration;
  receipts = new Map<string, Receipt>();
  private humanWaiters = new Map<string, (a: HumanAnswer) => void>();
  /** One-shot Kite sessions the owner approved, keyed by intent id; the payment executes through them. */
  private stepUpSessions = new Map<string, string>();
  /** Called on every receipt change. `durable` asks for an immediate write (before money moves). */
  onChange?: (r: Receipt, durable?: boolean) => void;
  /** Called when a payment needs the owner's answer. */
  onHumanNeeded?: (r: Receipt, approvalUrl?: string) => void;

  constructor(cfg: EngineConfig, calibration = new Calibration()) {
    this.cfg = cfg;
    this.calibration = calibration;
  }

  /** Money that has left, or may have left, the allowance. Unknown and held payments count until resolved. */
  spentUsd(now = new Date()): number {
    const since = periodStart(this.cfg.policy.resetPeriod, now);
    let total = 0;
    for (const r of this.receipts.values()) {
      // Payments still in flight always count; settled ones count in the period they were decided.
      const settled = r.status === "approved" ? Date.parse(r.decidedAt ?? r.intent.createdAt) : Infinity;
      if (settled >= since) total += committedUsd(r);
    }
    return total;
  }

  private effectivePolicy(): Policy {
    const learned = this.calibration
      .payees()
      .filter((s) => s.learnedKnown)
      .map((s) => ({ payee: s.payee, name: s.payee }));
    return { ...this.cfg.policy, knownPayees: [...this.cfg.policy.knownPayees, ...learned] };
  }

  private emit(r: Receipt) {
    this.onChange?.(r);
  }

  /**
   * Run the ladder for one intent. Resolves once the receipt reaches a final state; never rejects.
   * An unexpected error fails closed: before payment it blocks, and during payment the outcome becomes
   * "payment_unknown" (still counted against the allowance), because money may already have moved.
   */
  async decide(intent: PaymentIntent): Promise<Receipt> {
    // Register the payment before anything awaits, so payments arriving meanwhile see it as in flight
    // (duplicates, splits, reserved allowance) and a retried requestKey finds it.
    const receipt: Receipt = { intent, status: "pending_network", steps: [], verificationCostUsd: 0, plannedTier: 0 };
    this.receipts.set(intent.id, receipt);
    try {
      return await this.climb(receipt);
    } catch (err) {
      const message = `Internal error, failing closed: ${(err as Error)?.message ?? String(err)}`;
      this.humanWaiters.delete(intent.id);
      this.stepUpSessions.delete(intent.id);
      const mode = this.cfg.kiteMode === "kpass" ? "live" : "mock";
      if (receipt.status === "paying") {
        receipt.status = "payment_unknown";
        receipt.payment = { ...(receipt.payment ?? { executed: false, mode }), executed: false, state: "unknown", error: `${message}. The payment may have gone through; recheck it.` };
      } else {
        receipt.status = "blocked";
        receipt.payment = { executed: false, state: "not_paid", mode, error: message };
      }
      receipt.decidedAt ??= new Date().toISOString();
      this.emit(receipt);
      return receipt;
    }
  }

  private async climb(receipt: Receipt): Promise<Receipt> {
    const { intent } = receipt;
    const policy = this.effectivePolicy();
    const known = policy.knownPayees.some((k) => k.payee === intent.payee);
    // Known payees are already on the allowlist; only new ones are looked up in Kite's directory.
    const live = this.cfg.kiteMode === "kpass";
    const [directory, quote] = await Promise.all([
      known ? undefined : lookupDirectory(intent, this.cfg.kiteMode),
      // Live payments only: the merchant's own price for this exact request.
      live && intent.url ? quotePrice(intent) : undefined,
    ]);
    const others = [...this.receipts.values()].filter((r) => r.intent.id !== intent.id);
    const tier0 = runTier0(intent, {
      policy,
      spentUsd: this.spentUsd(),
      history: others.filter((r) => committedUsd(r) > 0).map((r) => r.intent),
      // Everything still being checked, including payments that arrived while this one was being looked up.
      inFlight: others.filter((r) => r.status.startsWith("pending")).map((r) => r.intent),
      directory,
      quote,
    });
    const payeeKnown = policy.knownPayees.some((k) => k.payee === intent.payee);
    // Learned from the owner: a reported payee needs the owner's approval for the report window.
    const report = this.calibration.recentReport(intent.payee);
    if (report && tier0.outcome !== "block") {
      tier0.outcome = "escalate";
      tier0.reasons.unshift(`${OWNER_REPORTED} ${intent.payee} on ${report.reportedAt.slice(0, 10)}, so you approve its payments until ${report.until.slice(0, 10)}.`);
    }
    const thresholds = this.calibration.thresholds(intent.payee, policy, intent.agentId);
    const plannedTier = planTier(intent.amountUsd, tier0, thresholds, payeeKnown);
    tier0.detail = { ...tier0.detail, thresholds };

    receipt.steps.push(tier0);
    receipt.plannedTier = plannedTier;
    this.emit(receipt);

    if (tier0.outcome === "block") return this.finish(receipt, "blocked");

    let next: 1 | 2 | 3 | "done" = plannedTier >= 1 ? 1 : "done";
    const flags = () => receipt.steps.filter((s) => s.outcome !== "pass").flatMap((s) => s.reasons);

    if (next === 1) {
      const s1 = live && !this.cfg.serv.apiKey ? notConfigured(1, "SERV task check", "llm", "SERV_API_KEY") : await runTier1(intent, this.cfg.serv);
      this.push(receipt, s1);
      if (s1.outcome === "block") return this.finish(receipt, "blocked");
      next = s1.outcome === "escalate" || plannedTier >= 2 ? 2 : "done";
    }

    if (next === 2) {
      const s2 = live && (!reppoConfigured(this.cfg.reppo) || reppoOverDailyLimit(this.cfg.reppo))
        ? notConfigured(2, "Reppo network verdict", "network", reppoConfigured(this.cfg.reppo) ? "a higher REPPO_DAILY_LIMIT" : "REPPO_API_KEY or REPPO_CREDIT_TOKEN")
        : await runTier2(intent, flags(), this.cfg.reppo);
      this.push(receipt, s2);
      if (typeof s2.detail?.route === "string") this.calibration.recordReppo(s2.detail.route);
      if (s2.outcome === "block") {
        this.calibration.recordIncident(intent.payee);
        return this.finish(receipt, "blocked");
      }
      if (s2.outcome === "pass") {
        this.calibration.recordClean(intent.payee);
        next = plannedTier === 3 ? 3 : "done";
      } else next = 3;
    }

    if (next === 3) {
      const answer = await this.askHuman(receipt);
      // Reppo's track record: did the owner agree with the review it asked for?
      if (answer !== "failed") this.calibration.recordOwnerAnswer(reppoRoute(receipt), answer);
      if (answer !== "approved") {
        // A Kite failure says nothing about the payee; only the owner's decline is an incident.
        if (answer === "declined") this.calibration.recordIncident(intent.payee);
        return this.finish(receipt, "blocked");
      }
      this.calibration.recordClean(intent.payee, { humanApprovedNewPayee: !payeeKnown });
    }

    return this.finish(receipt, "approved");
  }

  private push(receipt: Receipt, step: StepRecord) {
    receipt.steps.push(step);
    receipt.verificationCostUsd = receipt.steps.reduce((a, s) => a + s.costUsd, 0);
    this.emit(receipt);
  }

  private async askHuman(receipt: Receipt): Promise<HumanAnswer | "failed"> {
    receipt.status = "pending_human";
    const started = Date.now();
    let req;
    try {
      req = await requestStepUp(receipt.intent, this.cfg.kiteMode);
    } catch (err) {
      this.push(receipt, humanStep("declined", [`Could not open a Kite step-up session: ${(err as Error).message}`], started, this.cfg.kiteMode));
      return "failed";
    }
    const pending = humanStep("escalate", [req.approvalHint], started, this.cfg.kiteMode);
    pending.detail = { requestId: req.requestId, approvalUrl: req.approvalUrl, expiresAt: req.expiresAt };
    this.push(receipt, pending);
    this.onHumanNeeded?.(receipt, req.approvalUrl);

    const answer = await new Promise<HumanAnswer>((resolve) => {
      this.humanWaiters.set(receipt.intent.id, resolve);
      if (req.mode === "kpass" && req.requestId) this.pollKite(receipt.intent.id, req.requestId);
    });
    this.humanWaiters.delete(receipt.intent.id);
    receipt.steps[receipt.steps.length - 1] = {
      ...humanStep(answer, [answer === "approved" ? "Owner approved this payment." : "Owner declined this payment."], started, this.cfg.kiteMode),
      detail: pending.detail,
    };
    return answer;
  }

  private async pollKite(id: string, requestId: string) {
    // Kite's approval link expires after about 10 minutes; wait a little longer than that.
    const deadline = Date.now() + 15 * 60_000;
    while (this.humanWaiters.has(id) && Date.now() < deadline) {
      try {
        // `status --wait` blocks up to a minute per call, so this loop rarely spins.
        const a = await pollStepUp(requestId);
        if (a) {
          if (a.sessionId) this.stepUpSessions.set(id, a.sessionId);
          return this.answerHuman(id, a.answer);
        }
      } catch {
        /* keep waiting; a transient CLI error is not an answer */
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (this.humanWaiters.has(id)) this.answerHuman(id, "declined");
  }

  /** Called by the dashboard (mock mode) or the Kite poller. Returns false if nothing was waiting. */
  answerHuman(id: string, answer: HumanAnswer): boolean {
    const w = this.humanWaiters.get(id);
    if (!w) return false;
    w(answer);
    return true;
  }

  private async finish(receipt: Receipt, status: "approved" | "blocked"): Promise<Receipt> {
    // Final guard: payments approved while this one was being checked may have used up the allowance.
    if (status === "approved" && this.spentUsd() + receipt.intent.amountUsd > this.cfg.policy.allowanceUsd + 1e-9) {
      status = "blocked";
      receipt.payment = { executed: false, state: "not_paid", mode: this.cfg.kiteMode === "kpass" ? "live" : "mock", error: "Allowance used up by payments approved while this one was being checked." };
    }
    receipt.decidedAt = new Date().toISOString();
    receipt.verificationCostUsd = receipt.steps.reduce((a, s) => a + s.costUsd, 0);
    if (status === "blocked" || !this.cfg.executePayments) {
      receipt.status = status;
      this.emit(receipt);
      return receipt;
    }

    // Record the attempt (and its idempotency key) durably before any money moves.
    const sessionId = this.stepUpSessions.get(receipt.intent.id);
    this.stepUpSessions.delete(receipt.intent.id);
    const idempotencyKey = randomUUID();
    // Public visitors run Tiers 0 and 1 live (real SERV call) but execute Tier 2 in mock — the
    // server's kpass is not signed in as a real person and cannot move money on their behalf.
    const execMode: KiteMode = receipt.intent.agentId === "public-visitor" ? "mock" : this.cfg.kiteMode;
    receipt.status = "paying";
    receipt.payment = { executed: false, state: "unknown", mode: execMode === "kpass" ? "live" : "mock", idempotencyKey, sessionId };
    this.onChange?.(receipt, true);

    const result = await executePayment(receipt.intent, execMode, { sessionId, idempotencyKey, kite: this.cfg.kite ?? DEFAULT_KITE });
    this.applyPayment(receipt, result);
    return receipt;
  }

  private applyPayment(receipt: Receipt, result: PaymentResult) {
    receipt.payment = result;
    receipt.status = result.state === "paid" ? "approved" : result.state === "not_paid" ? "blocked" : "payment_unknown";
    if (result.amountUsd !== undefined && result.amountUsd > receipt.intent.amountUsd + 1e-6) {
      receipt.payment.error = `Kite reports $${result.amountUsd.toFixed(4)} paid, more than the $${receipt.intent.amountUsd.toFixed(2)} approved.${result.error ? ` ${result.error}` : ""}`;
      this.calibration.recordIncident(receipt.intent.payee);
    }
    this.emit(receipt);
  }

  /** Ask Kite again about a payment whose outcome was unknown or held. Never pays twice. */
  async recheck(id: string): Promise<Receipt | undefined> {
    const r = this.receipts.get(id);
    if (!r || r.status !== "payment_unknown" || !r.payment) return r;
    if (this.cfg.kiteMode !== "kpass") return r;
    const result = await recheckPayment(r.intent, r.payment, this.cfg.kite ?? DEFAULT_KITE);
    this.applyPayment(r, result);
    return r;
  }

  /**
   * The owner's verdict after the fact. "bad" on a paid payment: an incident for the payee, a report against the
   * agent, and the owner approves that payee's payments for the report window. "good" on a blocked payment:
   * a clean signal for the payee. Either way Reppo's track record is updated if Reppo judged it.
   */
  feedback(id: string, rating: "good" | "bad", note?: string): Receipt | string {
    const r = this.receipts.get(id);
    if (!r) return "unknown receipt";
    if (r.status !== "approved" && r.status !== "blocked") return "Only decided payments take feedback.";
    if (r.feedback) return "Feedback was already given for this payment.";
    if (rating === "bad" && r.status !== "approved") return "Only a paid payment can be reported as a problem.";
    if (rating === "good" && r.status !== "blocked") return "Only a blocked payment can be marked as fine.";
    r.feedback = { rating, note: note?.slice(0, 500), at: new Date().toISOString() };
    if (rating === "bad") this.calibration.recordReport(r.intent.payee, r.intent.agentId);
    else this.calibration.recordClean(r.intent.payee);
    this.calibration.recordFeedbackOnReppo(reppoRoute(r), rating);
    this.emit(r);
    return r;
  }

  /** The owner settles an unknown outcome after checking Kite's Activity page. */
  resolve(id: string, answer: "paid" | "not_paid"): Receipt | undefined {
    const r = this.receipts.get(id);
    if (!r || r.status !== "payment_unknown" || !r.payment) return undefined;
    r.payment = { ...r.payment, executed: answer === "paid", state: answer, error: `${r.payment.error ? `${r.payment.error} ` : ""}Resolved by the owner as ${answer === "paid" ? "paid" : "not paid"}.` };
    r.status = answer === "paid" ? "approved" : "blocked";
    this.emit(r);
    return r;
  }
}

/** The route Reppo gave this payment, if Reppo judged it. */
function reppoRoute(r: Receipt): string | undefined {
  const s = r.steps.find((x) => x.tier === 2 && typeof x.detail?.route === "string");
  return s?.detail?.route as string | undefined;
}

/** Start of the current allowance period in UTC (weeks start Monday). */
export function periodStart(period: Policy["resetPeriod"], now = new Date()): number {
  if (period === "monthly") return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  if (period === "weekly") {
    const day = (now.getUTCDay() + 6) % 7;
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day);
  }
  return -Infinity;
}

/** What a receipt takes out of the allowance: paid, being paid, or possibly paid. */
export function committedUsd(r: Receipt): number {
  if (r.status === "approved" && r.payment?.state === "paid" && r.payment.amountUsd !== undefined) return r.payment.amountUsd;
  if (r.status === "approved" || r.status === "paying" || r.status === "payment_unknown") {
    return Math.max(r.payment?.amountUsd ?? 0, r.intent.amountUsd);
  }
  return 0;
}

/** Live payments never rely on an offline stand-in: an unconfigured check hands the decision to the owner. */
function notConfigured(tier: 1 | 2, name: string, kind: "llm" | "network", key: string): StepRecord {
  return {
    tier, name, kind, outcome: "escalate", costUsd: 0, latencyMs: 0, mode: "live",
    reasons: [`${name} is not configured (${key}), so the owner decides this payment.`],
    detail: { notConfigured: true },
  };
}

function humanStep(outcome: "approved" | "declined" | "escalate", reasons: string[], started: number, mode: KiteMode): StepRecord {
  return {
    tier: 3,
    name: "Kite passkey step-up",
    kind: "human",
    outcome: outcome === "approved" ? "pass" : outcome === "declined" ? "block" : "escalate",
    reasons,
    costUsd: 0,
    latencyMs: Date.now() - started,
    mode: mode === "kpass" ? "live" : "mock",
  };
}
