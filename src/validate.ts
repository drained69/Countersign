// Validation for intents submitted by agents over HTTP.
import { intent as makeIntent } from "./scenarios.ts";
import type { PaymentIntent } from "./types.ts";

/** Upper bound on any single amount, far above any sane policy; stops absurd values reaching the ladder. */
export const MAX_AMOUNT_USD = 1_000_000;

/**
 * Canonical form of a payee: domains and hex wallet addresses are case-insensitive, and a trailing dot names the
 * same host. Every policy list is stored in this form, so `Mixer.Example.` can't slip past a deny list for `mixer.example`.
 */
export function normalizePayee(payee: string): string {
  return payee.trim().toLowerCase().replace(/\.+$/, "");
}

/** Validates an agent-submitted intent. Returns an error message or the normalized intent. */
export function validateIntent(b: any): string | PaymentIntent {
  if (!b || typeof b !== "object" || Array.isArray(b)) return "body must be a JSON object";
  const str = (k: string, max: number, required = true) => {
    const v = b?.[k];
    if (v === undefined || v === "") return required ? `${k} is required` : undefined;
    if (typeof v !== "string" || v.length > max) return `${k} must be a string up to ${max} chars`;
  };
  for (const [k, max, req] of [
    ["agentId", 100, true], ["agentTask", 500, true], ["payee", 200, true], ["payeeName", 200, true],
    ["category", 100, true], ["purpose", 500, true], ["url", 2000, false], ["method", 10, false], ["vendorText", 8000, false], ["requestKey", 200, false],
  ] as const) {
    const err = str(k, max, req);
    if (err) return err;
  }
  if (typeof b.amountUsd !== "number" || !Number.isFinite(b.amountUsd) || b.amountUsd <= 0) return "amountUsd must be a positive number";
  if (b.amountUsd > MAX_AMOUNT_USD) return `amountUsd must be at most ${MAX_AMOUNT_USD.toLocaleString("en-US")}`;
  const payee = normalizePayee(b.payee);
  if (!payee) return "payee is required";
  if (b.url && !/^https:\/\//.test(b.url)) return "url must be https";
  if (b.method && !/^(GET|POST|PUT|PATCH|DELETE)$/i.test(b.method)) return "method must be GET, POST, PUT, PATCH or DELETE";
  if (b.headers !== undefined) {
    if (typeof b.headers !== "object" || b.headers === null || Array.isArray(b.headers)) return "headers must be an object";
    if (!Object.values(b.headers).every((v) => typeof v === "string")) return "header values must be strings";
    if (JSON.stringify(b.headers).length > 2000) return "headers must be under 2000 chars";
  }
  if (b.body !== undefined && JSON.stringify(b.body).length > 8000) return "body must be under 8000 chars of JSON";
  return makeIntent({
    agentId: b.agentId, agentTask: b.agentTask, payee, payeeName: b.payeeName, amountUsd: b.amountUsd,
    category: b.category, purpose: b.purpose, url: b.url, method: b.method, vendorText: b.vendorText,
    headers: b.headers, body: b.body, requestKey: b.requestKey,
  });
}
