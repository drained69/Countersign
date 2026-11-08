// Prints the calibration replay: with vs without learning, same synthetic traffic.
import { loadConfig } from "../src/config.ts";
import { runReplay } from "../src/replay.ts";

const cfg = loadConfig();
console.log("Replay always uses offline stand-ins for SERV, Reppo and Kite.");
const on = await runReplay(cfg, 6, { calibrate: true });
const off = await runReplay(cfg, 6, { calibrate: false });
const row = (r: any) =>
  `wk${r.week}  payments=${r.payments}  bad=${r.bad} caught=${r.caught}${r.missed.length ? ` MISSED=${r.missed.join("|")}` : ""}  falseBlocks=${r.falseBlocks}  human=${r.humanPrompts} (on good: ${r.humanPromptsOnGood})  serv=${r.tier1Calls}  reppo=${r.tier2Calls}  projected=$${r.projectedCostUsd.toFixed(2)}`;
console.log("\nWith calibration:");
on.forEach((r) => console.log(row(r)));
console.log("\nWithout calibration (baseline):");
off.forEach((r) => console.log(row(r)));
