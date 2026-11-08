// Loads configuration from the environment (and an optional .env file) with demo defaults.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { EngineConfig } from "./engine.ts";
import type { Policy } from "./types.ts";
import { normalizePayee } from "./validate.ts";

/** The project root, resolved correctly even when the path contains spaces or non-ASCII characters. */
export const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * Parses one `.env` line: `KEY=value`, `export KEY=value`, single- or double-quoted values,
 * and trailing `# comments` on unquoted values. Returns undefined for blanks and comments.
 */
export function parseEnvLine(line: string): [string, string] | undefined {
  const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (!m) return undefined;
  let value = m[2].trim();
  const quoted = value.match(/^(["'])(.*)\1(\s+#.*)?$/);
  if (quoted) value = quoted[2];
  else value = value.replace(/\s+#.*$/, "").replace(/^#.*$/, "").trim();
  return [m[1], value];
}

/** Loads `.env` into process.env. Real environment variables always win; empty values are ignored. */
export function loadDotEnv(path = `${PROJECT_ROOT}.env`): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const kv = parseEnvLine(line);
    if (kv && process.env[kv[0]] === undefined && kv[1] !== "") process.env[kv[0]] = kv[1];
  }
}

/** Demo policy: one $100 allowance shared by three agents. Payees use reserved .example domains. */
export const DEMO_POLICY: Policy = {
  allowanceUsd: 100,
  maxPerTxUsd: 75,
  knownPayees: [
    { payee: "searchapi.example", name: "SearchAPI" },
    { payee: "transcribe.example", name: "Transcribe Co" },
    { payee: "cloudhost.example", name: "CloudHost" },
    { payee: "acme-billing.example", name: "Acme Design (billing)" },
  ],
  denyPayees: ["mixer.example"],
  tier1MinUsd: 1,
  tier2MinUsd: 20,
  duplicateWindowMinutes: 60,
};

export function loadConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  loadDotEnv();
  const env = process.env;
  return {
    policy: DEMO_POLICY,
    serv: {
      apiKey: env.SERV_API_KEY || undefined,
      baseUrl: env.SERV_BASE_URL || "https://inference-api.openserv.ai",
      model: env.SERV_MODEL || "gpt-5.4-mini",
      // Placeholder prices for the receipt; set to the model's listed SERV price.
      priceIn: Number(env.SERV_PRICE_IN ?? 0.75),
      priceOut: Number(env.SERV_PRICE_OUT ?? 4.5),
    },
    reppo: {
      creditToken: env.REPPO_CREDIT_TOKEN || undefined,
      sandbox: env.REPPO_SANDBOX === "true",
      baseUrl: env.REPPO_BASE_URL || "https://eval.reppo.xyz",
      costUsd: 0.22,
      timeoutMs: 150_000,
    },
    kiteMode: env.KITE_MODE === "kpass" ? "kpass" : "mock",
    kite: {
      payFrom: env.KITE_PAY_FROM === "session" ? "session" : "allowance",
      sessionId: env.KITE_SESSION_ID || undefined,
    },
    executePayments: true,
    ...overrides,
  };
}

export function describeModes(cfg: EngineConfig): Record<string, string> {
  // With real payments, an unconfigured check doesn't fall back to a stand-in: the owner decides instead.
  const off = cfg.kiteMode === "kpass" ? "off (owner decides)" : "mock";
  return {
    serv: cfg.serv.apiKey ? `live (${cfg.serv.model})` : off,
    reppo: cfg.reppo.creditToken && !cfg.reppo.sandbox ? "live" : cfg.kiteMode === "kpass" ? off : cfg.reppo.sandbox ? "sandbox" : "mock",
    kite: cfg.kiteMode === "kpass" ? "live (kpass)" : "mock",
  };
}

/** Checks a policy loaded from a file or the state file. Returns problems, or an empty list. */
export function policyProblems(p: any): string[] {
  const errs: string[] = [];
  const money = (k: string, required = true) => {
    const v = p?.[k];
    if (v === undefined && !required) return;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1_000_000) errs.push(`${k} must be a number from 0 to 1,000,000`);
  };
  if (!p || typeof p !== "object") return ["policy must be a JSON object"];
  for (const k of ["allowanceUsd", "maxPerTxUsd", "tier1MinUsd", "tier2MinUsd"]) money(k);
  money("newPayeeMaxUsd", false);
  if (p.agentRules !== undefined && Array.isArray(p.agentRules) && !p.agentRules.every((r: any) => typeof r?.agentId === "string" && typeof r?.note === "string")) {
    errs.push("agentRules entries need an agentId and a note");
  }
  if (p.maxPerTxUsd > p.allowanceUsd) errs.push("maxPerTxUsd can't exceed allowanceUsd");
  if (p.tier1MinUsd > p.tier2MinUsd) errs.push("tier1MinUsd can't be above tier2MinUsd");
  if (!(p.duplicateWindowMinutes >= 1 && p.duplicateWindowMinutes <= 1440)) errs.push("duplicateWindowMinutes must be 1-1440");
  if (!Array.isArray(p.knownPayees) || !p.knownPayees.every((k: any) => typeof k?.payee === "string" && typeof k?.name === "string")) errs.push("knownPayees must be a list of { payee, name }");
  if (!Array.isArray(p.denyPayees) || !p.denyPayees.every((d: any) => typeof d === "string")) errs.push("denyPayees must be a list of strings");
  if (p.agentRules !== undefined && !Array.isArray(p.agentRules)) errs.push("agentRules must be a list");
  if (p.resetPeriod !== undefined && !["never", "weekly", "monthly"].includes(p.resetPeriod)) errs.push('resetPeriod must be "never", "weekly" or "monthly"');
  return errs;
}

/** Loads the owner's starting policy from POLICY_FILE. */
export function loadPolicyFile(path: string): Policy {
  // A relative POLICY_FILE means the project folder, wherever the server is started from.
  const p = JSON.parse(readFileSync(resolve(PROJECT_ROOT, path), "utf8"));
  const errs = policyProblems(p);
  if (errs.length) throw new Error(`${path}: ${errs.join("; ")}`);
  p.knownPayees = p.knownPayees.map((k: any) => ({ payee: normalizePayee(k.payee), name: k.name }));
  p.denyPayees = p.denyPayees.map(normalizePayee);
  p.agentRules = (p.agentRules ?? []).map((r: any) => (r.blockedPayees ? { ...r, blockedPayees: r.blockedPayees.map(normalizePayee) } : r));
  return p;
}
