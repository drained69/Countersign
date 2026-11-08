// `npm run doctor`: checks a setup before real money moves. Read-only: sends no payment and spends nothing.
import { existsSync, readFileSync } from "node:fs";
import { kiteHealth } from "../src/adapters/kite.ts";
import { loadAuth } from "../src/auth.ts";
import { PROJECT_ROOT, loadConfig, loadPolicyFile, policyProblems } from "../src/config.ts";
import { join } from "node:path";

const cfg = loadConfig();
const live = cfg.kiteMode === "kpass";
let blocking = 0;
const line = (ok: boolean | "warn", text: string) => {
  if (ok === false) blocking++;
  console.log(`${ok === true ? "ok " : ok === "warn" ? "-- " : "!! "} ${text}`);
};

console.log(`\nTripwire doctor · ${live ? "LIVE (real payments through Kite)" : "demo (KITE_MODE=mock, no real money)"}\n`);

const [maj, min] = process.versions.node.split(".").map(Number);
line(maj > 23 || (maj === 23 && min >= 6), `Node ${process.versions.node} (need 23.6 or later)`);

try {
  const auth = loadAuth();
  line(auth.ownerToken ? true : live ? false : "warn", auth.ownerToken ? "Owner token set (dashboard login on)" : "No TRIPWIRE_OWNER_TOKEN: open local demo only");
  line(auth.agentKeys.size ? true : live ? false : "warn", `${auth.agentKeys.size} agent API key(s): ${[...new Set(auth.agentKeys.values())].join(", ") || "none"}`);
} catch (err) {
  line(false, (err as Error).message);
}

const stateFile = process.env.STATE_FILE ?? join(PROJECT_ROOT, "data", live ? "live-state.json" : "state.json");
let saved: any;
if (existsSync(stateFile)) {
  try {
    saved = JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    line(false, `${stateFile} is unreadable`);
  }
}
if (saved?.policy && !policyProblems(saved.policy).length) {
  line(true, `Saved policy in ${stateFile}: $${saved.policy.allowanceUsd} allowance${saved.policy.resetPeriod ? `, resets ${saved.policy.resetPeriod}` : ""}`);
} else if (process.env.POLICY_FILE) {
  try {
    const p = loadPolicyFile(process.env.POLICY_FILE);
    line(true, `POLICY_FILE ${process.env.POLICY_FILE}: $${p.allowanceUsd} allowance, max $${p.maxPerTxUsd} per payment, ${p.knownPayees.length} known payee(s)`);
  } catch (err) {
    line(false, (err as Error).message);
  }
} else line(live ? false : "warn", "No POLICY_FILE (live mode needs one; start from policy.example.json)");

if (cfg.serv.apiKey) {
  try {
    const res = await fetch(`${cfg.serv.baseUrl}/v1/models`, { headers: { Authorization: `Bearer ${cfg.serv.apiKey}` }, signal: AbortSignal.timeout(10_000) });
    line(res.ok, `SERV key ${res.ok ? "accepted" : `rejected (HTTP ${res.status})`} · model ${cfg.serv.model}`);
  } catch (err) {
    line(false, `SERV unreachable: ${(err as Error).message}`);
  }
} else line("warn", `No SERV_API_KEY: ${live ? "tier 1 hands every checked payment to you" : "tier 1 uses the offline stand-in"}`);

const reppoLive = Boolean(cfg.reppo.creditToken && !cfg.reppo.sandbox);
line(reppoLive ? true : "warn", reppoLive ? "Reppo credit token set (live verdicts)" : `Reppo ${cfg.reppo.sandbox ? "sandbox (placeholder verdicts)" : "not configured"}: ${live ? "tier 2 hands those payments to you" : "tier 2 uses the offline stand-in"}`);

if (process.env.NOTIFY_WEBHOOK_URL) line(/^https:\/\//.test(process.env.NOTIFY_WEBHOOK_URL), "Step-up notifications go to NOTIFY_WEBHOOK_URL");
else line("warn", "No NOTIFY_WEBHOOK_URL: you'll only see step-ups on the dashboard");

if (live) {
  line(true, `Payments come from ${cfg.kite?.payFrom === "session" ? `Kite session ${cfg.kite.sessionId ?? "(KITE_SESSION_ID missing!)"}` : "your Kite account allowance"}`);
  const k = await kiteHealth();
  for (const l of k.lines) console.log(l);
  if (!k.ok) {
    blocking++;
    console.log("\n   Install and sign in to Kite yourself:\n     curl -fsSL https://cli.gokite.ai/install.sh | bash\n     kpass login\n   Then set an account allowance in the Kite Passport dashboard.");
  }
}

console.log(blocking ? `\n${blocking} problem(s) to fix before ${live ? "real payments" : "running"}.\n` : "\nReady.\n");
process.exit(blocking ? 1 : 0);
