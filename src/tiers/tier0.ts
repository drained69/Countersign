// Tier 0: deterministic rules. No model calls, ~zero cost, always runs.
import type { PaymentIntent, Policy, StepRecord } from "../types.ts";
import type { DirectoryResult } from "../adapters/kite.ts";
import type { PriceQuote } from "../adapters/x402.ts";

export interface Tier0Context {
  policy: Policy;
  /** USD already spent from the allowance (approved payments only). */
  spentUsd: number;
  /** Previously approved intents, for duplicate and split detection. */
  history: PaymentIntent[];
  /** Intents still being checked. Their amounts are reserved, and they count toward duplicates and splits. */
  inFlight?: PaymentIntent[];
  /** Kite service-directory lookup for the payee, if one ran. */
  directory?: DirectoryResult;
  /** The merchant's own price for this request, read from its x402 challenge (live payments only). */
  quote?: PriceQuote;
}

/** Reason prefix that forces the owner's passkey even when every network check passes. */
export const PRICE_UNVERIFIED = "Couldn't confirm the merchant's price";

/** Classic edit distance, used to catch lookalike payees (acme-billing.io vs acme-bi11ing.io). */
export function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length][b.length];
}

const HOMOGLYPHS: Record<string, string> = { "0": "o", "1": "l", "3": "e", "5": "s", "rn": "m", "vv": "w" };

function normalizeLookalike(s: string): string {
  let out = s.toLowerCase();
  for (const [from, to] of Object.entries(HOMOGLYPHS)) out = out.split(from).join(to);
  return out;
}

/** Returns the known payee this one imitates, if any. Exact matches are not lookalikes. */
export function findLookalike(payee: string, known: Policy["knownPayees"]): string | undefined {
  const p = payee.toLowerCase();
  for (const k of known) {
    const kp = k.payee.toLowerCase();
    if (kp === p) return undefined;
  }
  for (const k of known) {
    const kp = k.payee.toLowerCase();
    if (normalizeLookalike(kp) === normalizeLookalike(p)) return k.payee;
    if (levenshtein(kp, p) <= 2 && Math.abs(kp.length - p.length) <= 2) return k.payee;
  }
  return undefined;
}

// Patterns that indicate vendor-supplied text is trying to instruct the agent or the checker.
const INJECTION_PATTERNS = [
  /ignore (all |any |your )?(previous|prior) (instructions|rules)/i,
  /note to (ai|agents?|assistants?)|ai assistants? processing/i,
  /you (must|should) (approve|pay|transfer)/i,
  /approve (this|immediately)/i,
  /system prompt/i,
  /do not (escalate|verify|check)/i,
  /change (the )?(payee|recipient|wallet|bank)/i,
];

export function detectInjection(text: string | undefined): string[] {
  if (!text) return [];
  return INJECTION_PATTERNS.filter((re) => re.test(text)).map((re) => re.source);
}

const FILLER = new Set(["and", "the", "for", "any", "all", "with", "from"]);

/** Keyword match against category and purpose, word by word and tolerant of plurals ("data apis" matches "search api"). */
export function matchesCategory(intent: PaymentIntent, keywords: string[]): boolean {
  const hay = `${intent.category} ${intent.purpose}`.toLowerCase();
  return keywords.some((k) =>
    k.toLowerCase().split(/[^a-z0-9]+/).some((w) => {
      const stem = w.replace(/s$/, "");
      return stem.length > 2 && !FILLER.has(w) && hay.includes(stem);
    }),
  );
}

export function runTier0(intent: PaymentIntent, ctx: Tier0Context): StepRecord {
  const started = Date.now();
  const { policy } = ctx;
  const block: string[] = [];
  const escalate: string[] = [];

  if (!(intent.amountUsd > 0)) block.push("Amount must be positive.");
  if (policy.denyPayees.includes(intent.payee)) block.push(`Payee ${intent.payee} is on the deny list.`);
  if (intent.amountUsd > policy.maxPerTxUsd) {
    block.push(`$${intent.amountUsd.toFixed(2)} exceeds the per-transaction cap of $${policy.maxPerTxUsd.toFixed(2)}.`);
  }
  const inFlight = ctx.inFlight ?? [];
  const reserved = inFlight.reduce((a, i) => a + i.amountUsd, 0);
  const remaining = policy.allowanceUsd - ctx.spentUsd;
  if (intent.amountUsd > remaining) {
    block.push(`Only $${remaining.toFixed(2)} left in the allowance.`);
  } else if (intent.amountUsd > remaining - reserved) {
    // Payments still being checked may be declined, so this is a question for review, not a block.
    escalate.push(`Would overdraw the allowance if the $${reserved.toFixed(2)} still being checked is approved.`);
  } else if (ctx.spentUsd + reserved + intent.amountUsd > policy.allowanceUsd * 0.8) {
    escalate.push("This payment would push allowance use above 80%.");
  }

  const isKnown = policy.knownPayees.some((k) => k.payee === intent.payee);
  if (policy.newPayeeMaxUsd !== undefined && !isKnown && intent.amountUsd > policy.newPayeeMaxUsd) {
    block.push(`New payees are capped at $${policy.newPayeeMaxUsd.toFixed(2)} by policy.`);
  }

  // Per-agent rules from the owner's policy.
  const rule = policy.agentRules?.find((r) => r.agentId === intent.agentId);
  if (rule?.maxPerTxUsd !== undefined && intent.amountUsd > rule.maxPerTxUsd) {
    block.push(`$${intent.amountUsd.toFixed(2)} exceeds ${intent.agentId}'s cap of $${rule.maxPerTxUsd.toFixed(2)} per payment (policy: "${rule.note}").`);
  }
  if (rule?.blockedPayees?.includes(intent.payee)) block.push(`${intent.agentId} may not pay ${intent.payee} (policy: "${rule.note}").`);
  if (rule?.allowedCategories?.length && !matchesCategory(intent, rule.allowedCategories)) {
    escalate.push(`Outside ${intent.agentId}'s allowed purchases (${rule.allowedCategories.join(", ")}); policy: "${rule.note}".`);
  }

  const imitated = findLookalike(intent.payee, policy.knownPayees);
  if (imitated) escalate.push(`Payee "${intent.payee}" looks like known payee "${imitated}".`);

  const windowMs = policy.duplicateWindowMinutes * 60_000;
  const now = Date.parse(intent.createdAt);
  const recent = [...ctx.history, ...inFlight];
  const dup = recent.find(
    (h) =>
      h.payee === intent.payee &&
      Math.abs(h.amountUsd - intent.amountUsd) < 0.005 &&
      Math.abs(now - Date.parse(h.createdAt)) <= windowMs,
  );
  if (dup) escalate.push(`Same payee and amount were already paid at ${dup.createdAt} (possible duplicate charge).`);

  // Split payment: several payments that each stay under the Reppo threshold but together cross it.
  const parts = recent.filter(
    (h) => h !== dup && h.agentId === intent.agentId && h.payee === intent.payee && Math.abs(now - Date.parse(h.createdAt)) <= windowMs,
  );
  const splitTotal = parts.reduce((a, h) => a + h.amountUsd, 0) + intent.amountUsd;
  if (parts.length && intent.amountUsd < policy.tier2MinUsd && splitTotal >= policy.tier2MinUsd) {
    escalate.push(
      `Split payment: ${parts.length + 1} payments from ${intent.agentId} to ${intent.payee} within ${policy.duplicateWindowMinutes} min total $${splitTotal.toFixed(2)}, over the $${policy.tier2MinUsd.toFixed(2)} review threshold.`,
    );
  }

  const past = ctx.history.filter((h) => h.payee === intent.payee).map((h) => h.amountUsd).sort((a, b) => a - b);
  if (past.length >= 3 && intent.amountUsd >= 5) {
    const median = past[Math.floor(past.length / 2)];
    const max = past[past.length - 1];
    // Amounts inside the range already paid to this payee are not "unusual", however skewed the median.
    if (intent.amountUsd > median * 3 && intent.amountUsd > max * 1.5) {
      escalate.push(`Unusual amount: $${intent.amountUsd.toFixed(2)} is over 3x this payee's median of $${median.toFixed(2)}.`);
    }
  }

  const injections = detectInjection(intent.vendorText);
  if (injections.length) escalate.push("Vendor text contains instructions aimed at the agent; treated as untrusted.");

  if (!isKnown && !imitated) escalate.push("Payee has not been paid before.");
  // A new payee that Kite's own service directory doesn't list gets network review.
  const dir = ctx.directory;
  const q = ctx.quote;
  if (!isKnown && dir?.listed === false) escalate.push(`Payee is not listed in Kite's service directory.`);
  const note: string[] = [];
  if (dir?.listed) note.push(`Listed in Kite's service directory${dir.name ? ` as ${dir.name}` : ""}.`);
  if (dir?.error) note.push("Kite directory lookup failed; payee treated as unverified.");
  if (q?.priceUsd !== undefined && q.priceUsd <= intent.amountUsd + 1e-6) note.push(`Merchant's price confirmed: $${q.priceUsd.toFixed(4)}.`);

  // The money goes to whatever the URL charges, so the URL must belong to the payee being checked.
  if (intent.url) {
    let urlHost = "";
    try {
      urlHost = new URL(intent.url).hostname.toLowerCase();
    } catch {}
    const payeeHost = intent.payee.toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
    const isDomain = /^[a-z0-9.-]+\.[a-z]{2,}$/.test(payeeHost) && !/^0x[0-9a-f]{40}$/.test(payeeHost);
    if (isDomain && urlHost !== payeeHost && !urlHost.endsWith(`.${payeeHost}`)) {
      block.push(`Payment URL goes to ${urlHost || "an invalid host"}, not to the payee ${payeeHost}.`);
    }
  }

  // Live payments: what the merchant actually charges, from its own payment challenge.
  if (q?.priceUsd !== undefined) {
    if (q.priceUsd > intent.amountUsd + 1e-6) {
      block.push(`Merchant charges $${q.priceUsd.toFixed(4)}, more than the $${intent.amountUsd.toFixed(2)} the agent asked to pay.`);
    }
  } else if (q && q.status !== undefined && q.status !== 402 && !q.error) {
    // No payment challenge: Kite would find nothing to pay and charge nothing.
  } else if (q) {
    escalate.push(`${PRICE_UNVERIFIED}${q.error ? ` (${q.error})` : ""}; your passkey caps this payment at the requested amount.`);
  }

  const outcome = block.length ? "block" : escalate.length ? "escalate" : "pass";
  return {
    tier: 0,
    name: "Deterministic rules",
    kind: "code",
    outcome,
    reasons: [...(block.length ? block : escalate.length ? escalate : ["Known payee, within caps, no duplicates."]), ...(block.length ? [] : note)],
    costUsd: 0,
    latencyMs: Date.now() - started,
    mode: "live",
    detail: { lookalikeOf: imitated, injections, newPayee: !isKnown, remainingUsd: remaining, splitTotalUsd: parts.length ? splitTotal : undefined, kiteDirectory: dir, priceQuote: q },
  };
}
