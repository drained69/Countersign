// Calibration: Reppo verdicts and human answers move each payee's escalation thresholds.
// Clean history raises a payee's thresholds (fewer checks); any incident drops them below base.
// Serious tier-0 flags (lookalike, injection, duplicate, over-cap) ignore calibration entirely.
import type { Policy } from "./types.ts";

export interface PayeeStats {
  payee: string;
  /** Independent "this was fine" signals: Reppo accept or human approve. */
  clean: number;
  /** Reppo reject/revise that a human confirmed, or a human decline. */
  incidents: number;
  /** A human approved a payment to this new payee, so tier 0 stops flagging it as unknown. */
  learnedKnown: boolean;
}

export const MAX_MULTIPLIER = 4;

export class Calibration {
  stats = new Map<string, PayeeStats>();

  get(payee: string): PayeeStats {
    let s = this.stats.get(payee);
    if (!s) {
      s = { payee, clean: 0, incidents: 0, learnedKnown: false };
      this.stats.set(payee, s);
    }
    return s;
  }

  /** Threshold multiplier for a payee. Needs 2+ clean signals before relaxing anything. */
  multiplier(payee: string): number {
    const s = this.stats.get(payee);
    if (!s) return 1;
    if (s.incidents > 0) return 0.5;
    if (s.clean < 2) return 1;
    return Math.min(MAX_MULTIPLIER, 1 + (s.clean - 1) * 0.5);
  }

  thresholds(payee: string, policy: Policy): { tier1MinUsd: number; tier2MinUsd: number; multiplier: number } {
    const m = this.multiplier(payee);
    return { tier1MinUsd: policy.tier1MinUsd * m, tier2MinUsd: policy.tier2MinUsd * m, multiplier: m };
  }

  recordClean(payee: string, opts: { humanApprovedNewPayee?: boolean } = {}): void {
    const s = this.get(payee);
    s.clean++;
    if (opts.humanApprovedNewPayee) s.learnedKnown = true;
  }

  recordIncident(payee: string): void {
    const s = this.get(payee);
    // Trust in amounts resets; knowing who the payee is does not (a declined duplicate is not a new vendor).
    s.incidents++;
    s.clean = 0;
  }

  toJSON(): PayeeStats[] {
    return [...this.stats.values()];
  }

  static fromJSON(rows: PayeeStats[] = []): Calibration {
    const c = new Calibration();
    for (const r of rows) c.stats.set(r.payee, { ...r });
    return c;
  }
}
