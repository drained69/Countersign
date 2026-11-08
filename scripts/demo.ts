// Runs the stage demo in the terminal: the human step-up is answered "declined" automatically.
import { loadConfig, describeModes } from "../src/config.ts";
import { Engine } from "../src/engine.ts";
import { demoScript } from "../src/scenarios.ts";

const cfg = loadConfig();
console.log("Modes:", describeModes(cfg), "\n");
const engine = new Engine(cfg);
engine.onChange = (r) => {
  if (r.status === "pending_human" && r.steps.at(-1)?.tier === 3 && cfg.kiteMode === "mock") {
    queueMicrotask(() => engine.answerHuman(r.intent.id, "declined"));
  }
};
for (const intent of demoScript()) {
  const r = await engine.decide(intent);
  console.log(`${r.status.toUpperCase().padEnd(8)} $${intent.amountUsd.toFixed(2).padStart(6)} -> ${intent.payee}`);
  for (const s of r.steps) console.log(`   T${s.tier} ${s.kind.padEnd(7)} ${s.outcome.padEnd(8)} [${s.mode}] ${s.reasons[0]}`);
}
console.log(`\nSpent $${engine.spentUsd().toFixed(2)} of $${cfg.policy.allowanceUsd}`);
