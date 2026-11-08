// Replays synthetic weeks through the ladder. Calibration carries over between weeks; the allowance resets.
// The human is simulated as an oracle that approves good payments and declines bad ones.
import { Calibration } from "./calibration.ts";
import { Engine, type EngineConfig } from "./engine.ts";
import { syntheticWeek } from "./scenarios.ts";

export { SERV_CALL_USD } from "./tiers/tier1Serv.ts";
import { SERV_CALL_USD } from "./tiers/tier1Serv.ts";

export interface WeekResult {
  week: number;
  payments: number;
  bad: number;
  caught: number;
  missed: string[];
  falseBlocks: number;
  humanPrompts: number;
  /** Human prompts on legitimate payments: the interruptions calibration is meant to remove. */
  humanPromptsOnGood: number;
  tier1Calls: number;
  tier2Calls: number;
  verificationCostUsd: number;
  /** What this week's checks would cost at live prices (SERV ~$0.00077/call, Reppo lite $0.22). */
  projectedCostUsd: number;
}

export async function runReplay(cfg: EngineConfig, weeks = 6, opts: { calibrate?: boolean } = {}): Promise<WeekResult[]> {
  // Always offline: hundreds of payments must not hit paid APIs, and runs must be reproducible.
  const base: EngineConfig = { ...cfg, serv: { ...cfg.serv, apiKey: undefined }, reppo: { ...cfg.reppo, apiKey: undefined, creditToken: undefined }, kiteMode: "mock" };
  const calibrate = opts.calibrate ?? true;
  let calibration = new Calibration();
  const results: WeekResult[] = [];

  for (let w = 0; w < weeks; w++) {
    const traffic = syntheticWeek(w);
    // Generous weekly allowance so the replay measures checks, not budget exhaustion.
    const cfg: EngineConfig = { ...base, executePayments: false, policy: { ...base.policy, allowanceUsd: 10_000 } };
    const engine = new Engine(cfg, calibrate ? calibration : new Calibration());
    const labels = new Map(traffic.map((t) => [t.intent.id, t]));
    engine.onChange = (r) => {
      if (r.status === "pending_human" && r.steps.at(-1)?.tier === 3) {
        const bad = labels.get(r.intent.id)!.bad;
        queueMicrotask(() => engine.answerHuman(r.intent.id, bad ? "declined" : "approved"));
      }
    };

    const res: WeekResult = { week: w + 1, payments: traffic.length, bad: 0, caught: 0, missed: [], falseBlocks: 0, humanPrompts: 0, humanPromptsOnGood: 0, tier1Calls: 0, tier2Calls: 0, verificationCostUsd: 0, projectedCostUsd: 0 };
    for (const t of traffic) {
      const r = await engine.decide(t.intent);
      if (t.bad) {
        res.bad++;
        if (r.status === "blocked") res.caught++;
        else res.missed.push(t.kind);
      } else if (r.status === "blocked") res.falseBlocks++;
      for (const s of r.steps) {
        if (s.tier === 1) res.tier1Calls++;
        if (s.tier === 2) res.tier2Calls++;
        if (s.tier === 3) {
          res.humanPrompts++;
          if (!t.bad) res.humanPromptsOnGood++;
        }
      }
      res.verificationCostUsd += r.verificationCostUsd;
    }
    res.projectedCostUsd = res.tier1Calls * SERV_CALL_USD + res.tier2Calls * base.reppo.costUsd;
    results.push(res);
    if (calibrate) calibration = engine.calibration;
  }
  return results;
}
