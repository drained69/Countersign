// Loads configuration from the environment (and an optional .env file) with demo defaults.
import { existsSync, readFileSync } from "node:fs";
import type { EngineConfig } from "./engine.ts";
import type { Policy } from "./types.ts";

export function loadDotEnv(path = new URL("../.env", import.meta.url).pathname): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*([^#]*?)\s*(#.*)?$/);
    if (m && process.env[m[1]] === undefined && m[2] !== "") process.env[m[1]] = m[2];
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
    executePayments: true,
    ...overrides,
  };
}

export function describeModes(cfg: EngineConfig): Record<string, string> {
  return {
    serv: cfg.serv.apiKey ? `live (${cfg.serv.model})` : "mock",
    reppo: cfg.reppo.creditToken ? (cfg.reppo.sandbox ? "sandbox" : "live") : cfg.reppo.sandbox ? "sandbox" : "mock",
    kite: cfg.kiteMode === "kpass" ? "live (kpass)" : "mock",
  };
}
