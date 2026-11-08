// The ladder: tier 0 code rules -> tier 1 SERV reasoning -> tier 2 Reppo verdict -> tier 3 human step-up.
// Verification gets stricter as the amount at risk grows; any "block" stops the payment,
// any "escalate" moves it up a rung. Nothing is paid until the receipt says "approved".
import { Calibration } from "./calibration.ts";
import { executePayment, lookupDirectory, pollStepUp, requestStepUp, type KiteMode } from "./adapters/kite.ts";
import { runTier0 } from "./tiers/tier0.ts";
import { runTier1, type ServConfig } from "./tiers/tier1Serv.ts";
import { runTier2, type ReppoConfig } from "./tiers/tier2Reppo.ts";
import type { PaymentIntent, Policy, Receipt, StepRecord } from "./types.ts";

export interface EngineConfig {
  policy: Policy;
  serv: ServConfig;
  reppo: ReppoConfig;
  kiteMode: KiteMode;
  /** Execute the Kite payment after approval. Replays turn this off. */
  executePayments: boolean;
}

/** Tier-0 flags that force at least a Reppo review regardless of amount or calibration. */
const SERIOUS = /looks like|instructions aimed|duplicate charge|above 80%|Unusual amount|Split payment|not listed in Kite|Outside .* allowed purchases|Would overdraw/i;

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
  onChange?: (r: Receipt) => void;

  constructor(cfg: EngineConfig, calibration = new Calibration()) {
    this.cfg = cfg;
    this.calibration = calibration;
  }

  spentUsd(): number {
    let total = 0;
    for (const r of this.receipts.values()) if (r.status === "approved") total += r.intent.amountUsd;
    return total;
  }

  private approvedHistory(): PaymentIntent[] {
    return [...this.receipts.values()].filter((r) => r.status === "approved").map((r) => r.intent);
  }

  private effectivePolicy(): Policy {
    const learned = this.calibration
      .toJSON()
      .filter((s) => s.learnedKnown)
      .map((s) => ({ payee: s.payee, name: s.payee }));
    return { ...this.cfg.policy, knownPayees: [...this.cfg.policy.knownPayees, ...learned] };
  }

  private emit(r: Receipt) {
    this.onChange?.(r);
  }

  /** Run the ladder for one intent. Resolves once the receipt is approved or blocked. */
  async decide(intent: PaymentIntent): Promise<Receipt> {
    const policy = this.effectivePolicy();
    const inFlight = [...this.receipts.values()].filter((r) => r.status.startsWith("pending")).map((r) => r.intent);
    const known = policy.knownPayees.some((k) => k.payee === intent.payee);
    // Known payees are already on the allowlist; only new ones are looked up in Kite's directory.
    const directory = known ? undefined : await lookupDirectory(intent, this.cfg.kiteMode);
    const tier0 = runTier0(intent, { policy, spentUsd: this.spentUsd(), history: this.approvedHistory(), inFlight, directory });
    const payeeKnown = policy.knownPayees.some((k) => k.payee === intent.payee);
    const thresholds = this.calibration.thresholds(intent.payee, policy);
    const plannedTier = planTier(intent.amountUsd, tier0, thresholds, payeeKnown);
    tier0.detail = { ...tier0.detail, thresholds };

    const receipt: Receipt = { intent, status: "pending_network", steps: [tier0], verificationCostUsd: 0, plannedTier };
    this.receipts.set(intent.id, receipt);
    this.emit(receipt);

    if (tier0.outcome === "block") return this.finish(receipt, "blocked");

    let next: 1 | 2 | 3 | "done" = plannedTier >= 1 ? 1 : "done";
    const flags = () => receipt.steps.filter((s) => s.outcome !== "pass").flatMap((s) => s.reasons);

    if (next === 1) {
      const s1 = await runTier1(intent, this.cfg.serv);
      this.push(receipt, s1);
      if (s1.outcome === "block") return this.finish(receipt, "blocked");
      next = s1.outcome === "escalate" || plannedTier >= 2 ? 2 : "done";
    }

    if (next === 2) {
      const s2 = await runTier2(intent, flags(), this.cfg.reppo);
      this.push(receipt, s2);
      if (s2.outcome === "block") {
        this.calibration.recordIncident(intent.payee);
        return this.finish(receipt, "blocked");
      }
      if (s2.outcome === "pass") {
        this.calibration.recordClean(intent.payee);
        next = "done";
      } else next = 3;
    }

    if (next === 3) {
      const answer = await this.askHuman(receipt);
      if (answer === "declined") {
        this.calibration.recordIncident(intent.payee);
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

  private async askHuman(receipt: Receipt): Promise<HumanAnswer> {
    receipt.status = "pending_human";
    const started = Date.now();
    let req;
    try {
      req = await requestStepUp(receipt.intent, this.cfg.kiteMode);
    } catch (err) {
      this.push(receipt, humanStep("declined", [`Could not open a Kite step-up session: ${(err as Error).message}`], started, this.cfg.kiteMode));
      return "declined";
    }
    const pending = humanStep("escalate", [req.approvalHint], started, this.cfg.kiteMode);
    pending.detail = { requestId: req.requestId };
    this.push(receipt, pending);

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
      receipt.payment = { executed: false, mode: this.cfg.kiteMode === "kpass" ? "live" : "mock", error: "Allowance used up by payments approved while this one was being checked." };
    }
    receipt.status = status;
    receipt.decidedAt = new Date().toISOString();
    receipt.verificationCostUsd = receipt.steps.reduce((a, s) => a + s.costUsd, 0);
    if (status === "approved" && this.cfg.executePayments) {
      const sessionId = this.stepUpSessions.get(receipt.intent.id);
      this.stepUpSessions.delete(receipt.intent.id);
      receipt.payment = await executePayment(receipt.intent, this.cfg.kiteMode, { sessionId });
      if (!receipt.payment.executed) receipt.status = "blocked";
    }
    this.emit(receipt);
    return receipt;
  }
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
