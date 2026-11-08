// Who is calling: the owner (dashboard login or owner token) or an agent (its own API key).
// With no owner token configured, Tripwire runs as an open local demo; the server refuses to start that
// way when it could move real money or is reachable beyond this machine.
import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export type Caller = { role: "owner" } | { role: "agent"; agentId: string } | { role: "anon" };

export interface AuthConfig {
  ownerToken?: string;
  /** API key -> agent id. */
  agentKeys: Map<string, string>;
}

export const COOKIE = "tw_owner";
const MIN_SECRET = 24;

export function loadAuth(env = process.env): AuthConfig {
  const ownerToken = env.TRIPWIRE_OWNER_TOKEN || undefined;
  if (ownerToken && ownerToken.length < MIN_SECRET) throw new Error(`TRIPWIRE_OWNER_TOKEN must be at least ${MIN_SECRET} characters.`);
  const agentKeys = new Map<string, string>();
  for (const pair of (env.TRIPWIRE_AGENT_KEYS ?? "").split(",").map((p) => p.trim()).filter(Boolean)) {
    const i = pair.indexOf(":");
    const agentId = pair.slice(0, i).trim();
    const key = pair.slice(i + 1).trim();
    if (i < 1 || !agentId) throw new Error(`TRIPWIRE_AGENT_KEYS entries look like agentId:key (got "${pair.slice(0, 20)}…").`);
    if (key.length < MIN_SECRET) throw new Error(`The API key for ${agentId} must be at least ${MIN_SECRET} characters.`);
    if (key === ownerToken) throw new Error(`The API key for ${agentId} must differ from the owner token.`);
    agentKeys.set(key, agentId);
  }
  return { ownerToken, agentKeys };
}

const digest = (s: string) => createHash("sha256").update(s).digest();
/** Constant-time string comparison. */
export const same = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

/** The dashboard cookie: derived from the owner token, so rotating the token signs everyone out. */
export const sessionValue = (ownerToken: string) => createHmac("sha256", ownerToken).update("tripwire-owner-session-v1").digest("base64url");

function cookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
}

/** The open demo only answers requests addressed to this machine, which defeats DNS rebinding. */
export const loopbackHost = (host = "") => /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(:\d+)?$/i.test(host);

export function identify(req: IncomingMessage, auth: AuthConfig): Caller {
  if (!auth.ownerToken) return loopbackHost(req.headers.host) ? { role: "owner" } : { role: "anon" }; // open local demo
  const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) {
    if (same(bearer, auth.ownerToken)) return { role: "owner" };
    for (const [key, agentId] of auth.agentKeys) if (same(bearer, key)) return { role: "agent", agentId };
    return { role: "anon" };
  }
  const c = cookie(req, COOKIE);
  if (c && same(c, sessionValue(auth.ownerToken))) return { role: "owner" };
  return { role: "anon" };
}

/** Cookie-authenticated writes must come from this site (SameSite=Strict covers browsers; this covers the rest). */
export function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return !req.headers.cookie || /^application\/json/i.test(req.headers["content-type"] ?? "");
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/** Simple per-address limit on failed logins. */
export class LoginLimiter {
  private fails = new Map<string, number[]>();
  private max: number;
  private windowMs: number;
  constructor(max = 10, windowMs = 10 * 60_000) {
    this.max = max;
    this.windowMs = windowMs;
  }
  blocked(ip: string): boolean {
    const now = Date.now();
    const recent = (this.fails.get(ip) ?? []).filter((t) => now - t < this.windowMs);
    this.fails.set(ip, recent);
    return recent.length >= this.max;
  }
  fail(ip: string) {
    this.fails.set(ip, [...(this.fails.get(ip) ?? []), Date.now()]);
    if (this.fails.size > 10_000) this.fails.clear();
  }
}
