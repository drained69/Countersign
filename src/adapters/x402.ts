// Price check: before a live payment, ask the merchant what it will charge (its x402 "402 Payment Required"
// challenge) and compare that with the amount the agent asked to pay. Kite has no per-payment price cap on
// allowance payments, so this is what stops an agent claiming $1 for a call the merchant prices at $50.
//
// The URL comes from an agent, so the request is guarded against reaching internal addresses: every
// resolved IP is checked at connect time (no DNS-rebinding gap), redirects are not followed, and the
// response is size- and time-limited.
import { lookup as dnsLookup } from "node:dns";
import { request } from "node:https";
import { isIP } from "node:net";
import type { PaymentIntent } from "../types.ts";

export interface PriceQuote {
  /** Cheapest price, in USD, among the merchant's options Kite can pay. Undefined when it couldn't be read. */
  priceUsd?: number;
  /** Highest price among the options Kite could settle on. */
  maxUsd?: number;
  /** Whether the merchant offered a network Kite can pay on. */
  kiteNetwork?: boolean;
  /** HTTP status of the unpaid request. 402 means the merchant asked for payment. */
  status?: number;
  error?: string;
}

/** Blocks loopback, private, link-local, CGNAT, multicast and reserved ranges (IPv4, IPv6, mapped IPv4). */
export function isPublicIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return !(
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicIp(mapped[1]);
    const hex = s.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const [a, b] = [parseInt(hex[1], 16), parseInt(hex[2], 16)];
      return isPublicIp(`${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`);
    }
    return !(s === "::" || s === "::1" || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s) || s.startsWith("64:ff9b") || s.startsWith("2001:db8"));
  }
  return false;
}

const safeLookup: any = (host: string, opts: any, cb: any) => {
  dnsLookup(host, { ...opts, all: true }, (err, addrs: any) => {
    if (err) return cb(err);
    const list = Array.isArray(addrs) ? addrs : [{ address: addrs, family: opts?.family ?? 4 }];
    const bad = list.find((a: any) => !isPublicIp(a.address));
    if (bad || !list.length) return cb(Object.assign(new Error(`Refusing to contact non-public address ${bad?.address ?? "(none)"}`), { code: "EBLOCKED" }));
    return opts?.all ? cb(null, list) : cb(null, list[0].address, list[0].family);
  });
};

/** Converts an x402 amount to USD. x402 `accepts` amounts are in the token's smallest unit (USDC: 6 decimals). */
function toUsd(raw: unknown, atomic: boolean, decimals = 6): number | undefined {
  if (typeof raw === "number") return atomic && Number.isInteger(raw) ? raw / 10 ** decimals : raw;
  if (typeof raw !== "string") return undefined;
  const s = raw.trim().replace(/^\$/, "");
  if (atomic && /^\d+$/.test(s)) return Number(s) / 10 ** decimals;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Networks Kite Passport can settle on (CAIP-2), per Kite's published reference: Base, Polygon, Avalanche,
 * Arc (and Arc testnet) and Solana. Merchants often list many more; only these can be what Kite pays.
 */
const KITE_NETWORKS = /^(eip155:(8453|137|43114|5042|5042002)|solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp)$/;

export interface ChallengePrice {
  /** What Tripwire compares against the agent's amount: the cheapest option Kite can pay. */
  priceUsd: number;
  /** The highest option on a Kite network, for the receipt (Kite chooses where it settles). */
  maxUsd: number;
  /** Whether any option was on a network Kite can pay; if none was, the prices are from every option. */
  kiteNetwork: boolean;
}

/** Reads the price from an x402 challenge (header or body). */
export function parseChallengePrice(headers: Record<string, string | string[] | undefined>, body: string): ChallengePrice | undefined {
  const docs: any[] = [];
  for (const h of ["payment-required", "x-payment-required"]) {
    const v = headers[h];
    if (typeof v !== "string") continue;
    try {
      docs.push(JSON.parse(Buffer.from(v, "base64").toString("utf8")));
    } catch {
      try {
        docs.push(JSON.parse(v));
      } catch {}
    }
  }
  try {
    docs.push(JSON.parse(body));
  } catch {}

  const options: { price: number; kite: boolean }[] = [];
  for (const doc of docs) {
    if (!doc || typeof doc !== "object") continue;
    const accepts = doc.accepts ?? doc.payment?.accepts ?? doc.paymentRequirements;
    if (Array.isArray(accepts)) {
      for (const a of accepts) {
        const decimals = Number(a?.extra?.decimals ?? a?.decimals ?? 6);
        const atomic = a?.maxAmountRequired !== undefined || doc.x402Version !== undefined || /^0x[0-9a-f]{40}$/i.test(String(a?.asset ?? ""));
        const p = toUsd(a?.maxAmountRequired ?? a?.amount ?? a?.price, atomic, Number.isFinite(decimals) ? decimals : 6);
        if (p !== undefined) options.push({ price: p, kite: KITE_NETWORKS.test(String(a?.network ?? "")) });
      }
      continue;
    }
    for (const v of [doc.price, doc.amount, doc.cost?.amount, doc.fee, doc.required_payment?.amount]) {
      const p = toUsd(v, false);
      if (p !== undefined) {
        options.push({ price: p, kite: true });
        break;
      }
    }
  }
  const kite = options.filter((o) => o.kite);
  const pool = (kite.length ? kite : options).map((o) => o.price);
  if (!pool.length) return undefined;
  return { priceUsd: Math.min(...pool), maxUsd: Math.max(...pool), kiteNetwork: kite.length > 0 };
}

/** The price Tripwire checks against: the cheapest option Kite can pay. */
export function parseChallenge(headers: Record<string, string | string[] | undefined>, body: string): number | undefined {
  return parseChallengePrice(headers, body)?.priceUsd;
}

/** Sends the request the payment would make, unpaid, and reads the merchant's price. Never pays. */
export function quotePrice(intent: PaymentIntent, timeoutMs = 10_000): Promise<PriceQuote> {
  return new Promise((resolve) => {
    let url: URL;
    try {
      url = new URL(intent.url ?? "");
    } catch {
      return resolve({ error: "Invalid payment URL." });
    }
    if (url.protocol !== "https:") return resolve({ error: "Payment URL must be https." });
    if (isIP(url.hostname.replace(/^\[|\]$/g, "")) && !isPublicIp(url.hostname.replace(/^\[|\]$/g, ""))) {
      return resolve({ error: "Payment URL points at a non-public address." });
    }
    const body = intent.body === undefined ? undefined : JSON.stringify(intent.body);
    const req = request(
      url,
      {
        method: (intent.method ?? "GET").toUpperCase(),
        lookup: safeLookup,
        timeout: timeoutMs,
        headers: {
          ...(intent.headers ?? {}),
          ...(body ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {}),
          "user-agent": "tripwire-price-check",
        },
      },
      (res) => {
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > 64 * 1024) return res.destroy();
          chunks.push(c);
        });
        res.on("close", () => {
          const status = res.statusCode;
          if (status !== 402) return resolve({ status });
          const price = parseChallengePrice(res.headers, Buffer.concat(chunks).toString("utf8"));
          resolve(price === undefined ? { status, error: "Couldn't read the merchant's price from its payment challenge." } : { status, ...price });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("Merchant did not answer the price check in time.")));
    req.on("error", (err) => resolve({ error: err.message.slice(0, 200) }));
    if (body) req.write(body);
    req.end();
  });
}
