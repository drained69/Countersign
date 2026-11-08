// Calibration: what Tripwire learns from Reppo verdicts and from the owner.
// - Per payee: clean history raises its thresholds (fewer checks); a recent incident drops them below base.
// - Owner reports: "this payment was a problem" makes the owner approve that payee's payments for 30 days,
//   and halves the reporting agent's thresholds for the same period.
// - Reviewer track record: how often the owner agreed with Reppo, overruled it, or later reported a
//   payment Reppo had shipped. Shown on the dashboard so the owner can see whether to trust it.
// Serious tier-0 flags (lookalike, injection, duplicate, over-cap) ignore calibration entirely.
import type { Policy } from "./types.ts";

export interface PayeeStats {
  payee: string;
  /** Independent "this was fine" signals: a Reppo ship, an owner approval, or "this was fine" feedback. */
  clean: number;
  /** Reppo blocks, owner declines, overcharges and owner reports. */
  incidents: number;
  /** A human approved a payment to this new payee, so tier 0 stops flagging it as unknown. */
  learnedKnown: boolean;
  /** When the last incident happened; incidents older than the window stop tightening thresholds. */
  lastIncidentAt?: string;
  /** When the owner last reported a problem with a payment to this payee. */
  reportedAt?: string;
}

export interface AgentStats {
  agentId: string;
  /** Payments by this agent that the owner reported as a problem. */
  reports: number;
  reportedAt?: string;
}

export interface ReviewerStats {
  /** Reppo verdicts received, by route. */
  ship: number;
  review: number;
  block: number;
  /** Reppo sent it to the owner, and the owner declined: Reppo was right to stop it. */
  ownerAgreed: number;
  /** Reppo sent it to the owner (or blocked it), and the owner approved / said it was fine. */
  ownerOverruled: number;
  /** Reppo shipped it, and the owner later reported a problem. */
  missed: number;
}

export const MAX_MULTIPLIER = 4;
/** How long an incident or an owner report keeps tightening things. */
export const WINDOW_DAYS = 30;
const WINDOW_MS = WINDOW_DAYS * 24 * 3600 * 1000;
const within = (iso: string | undefined, now: number) => iso !== undefined && now - Date.parse(iso) < WINDOW_MS;

export class Calibration {
  stats = new Map<string, PayeeStats>();
  agents = new Map<string, AgentStats>();
  reviewer: ReviewerStats = { ship: 0, review: 0, block: 0, ownerAgreed: 0, ownerOverruled: 0, missed: 0 };

  get(payee: string): PayeeStats {
    let s = this.stats.get(payee);
    if (!s) {
      s = { payee, clean: 0, incidents: 0, learnedKnown: false };
      this.stats.set(payee, s);
    }
    return s;
  }

  agent(agentId: string): AgentStats {
    let a = this.agents.get(agentId);
    if (!a) {
      a = { agentId, reports: 0 };
      this.agents.set(agentId, a);
    }
    return a;
  }

  /** Threshold multiplier for a payee. Needs 2+ clean signals before relaxing anything. */
  multiplier(payee: string, now = Date.now()): number {
    const s = this.stats.get(payee);
    if (!s) return 1;
    // Incidents recorded before timestamps existed count as recent.
    if (s.incidents > 0 && (s.lastIncidentAt === undefined || within(s.lastIncidentAt, now))) return 0.5;
    if (s.clean < 2) return 1;
    return Math.min(MAX_MULTIPLIER, 1 + (s.clean - 1) * 0.5);
  }

  /** An agent whose payment the owner reported gets half thresholds for the window. */
  agentMultiplier(agentId: string | undefined, now = Date.now()): number {
    return agentId && within(this.agents.get(agentId)?.reportedAt, now) ? 0.5 : 1;
  }

  thresholds(payee: string, policy: Policy, agentId?: string): { tier1MinUsd: number; tier2MinUsd: number; multiplier: number } {
    const m = Math.min(this.multiplier(payee), this.agentMultiplier(agentId));
    return { tier1MinUsd: policy.tier1MinUsd * m, tier2MinUsd: policy.tier2MinUsd * m, multiplier: m };
  }

  /** The owner reported a problem with this payee recently: the owner approves its payments until then. */
  recentReport(payee: string, now = Date.now()): { reportedAt: string; until: string } | undefined {
    const at = this.stats.get(payee)?.reportedAt;
    if (!within(at, now)) return undefined;
    return { reportedAt: at!, until: new Date(Date.parse(at!) + WINDOW_MS).toISOString() };
  }

  recordClean(payee: string, opts: { humanApprovedNewPayee?: boolean } = {}): void {
    const s = this.get(payee);
    s.clean++;
    if (opts.humanApprovedNewPayee) s.learnedKnown = true;
  }

  recordIncident(payee: string, now = new Date()): void {
    const s = this.get(payee);
    // Trust in amounts resets; knowing who the payee is does not (a declined duplicate is not a new vendor).
    s.incidents++;
    s.clean = 0;
    s.lastIncidentAt = now.toISOString();
  }

  /** The owner says a payment was a problem: an incident for the payee, and a report against the agent. */
  recordReport(payee: string, agentId: string, now = new Date()): void {
    this.recordIncident(payee, now);
    this.get(payee).reportedAt = now.toISOString();
    const a = this.agent(agentId);
    a.reports++;
    a.reportedAt = now.toISOString();
  }

  /** Every Reppo verdict, by route. */
  recordReppo(route: string): void {
    if (route === "ship" || route === "review" || route === "block") this.reviewer[route]++;
  }

  /** The owner answered a payment Reppo sent them. */
  recordOwnerAnswer(reppoRoute: string | undefined, answer: "approved" | "declined"): void {
    if (reppoRoute !== "review") return;
    if (answer === "declined") this.reviewer.ownerAgreed++;
    else this.reviewer.ownerOverruled++;
  }

  /** After-the-fact owner feedback on a payment Reppo had judged. */
  recordFeedbackOnReppo(reppoRoute: string | undefined, rating: "good" | "bad"): void {
    if (reppoRoute === "ship" && rating === "bad") this.reviewer.missed++;
    if ((reppoRoute === "block" || reppoRoute === "review") && rating === "good") this.reviewer.ownerOverruled++;
  }

  /** Share of the owner's judgements that matched Reppo's, once there is any to compare. */
  reviewerAgreement(): number | undefined {
    const r = this.reviewer;
    const judged = r.ownerAgreed + r.ownerOverruled + r.missed;
    return judged ? r.ownerAgreed / judged : undefined;
  }

  /** What the dashboard shows: stats with the multipliers and report windows already worked out. */
  view(now = Date.now()) {
    return {
      ...this.toJSON(),
      payees: this.payees().map((p) => ({ ...p, multiplier: this.multiplier(p.payee, now), ownerApprovesUntil: this.recentReport(p.payee, now)?.until })),
      agents: [...this.agents.values()].map((a) => ({ ...a, multiplier: this.agentMultiplier(a.agentId, now) })),
    };
  }

  payees(): PayeeStats[] {
    return [...this.stats.values()];
  }

  toJSON() {
    return { payees: this.payees(), agents: [...this.agents.values()], reviewer: { ...this.reviewer }, reviewerAgreement: this.reviewerAgreement() };
  }

  /** Accepts the current shape or the older plain list of payee rows. */
  static fromJSON(saved: any = []): Calibration {
    const c = new Calibration();
    const payees: PayeeStats[] = Array.isArray(saved) ? saved : saved?.payees ?? [];
    for (const r of payees) c.stats.set(r.payee, { ...r });
    for (const a of Array.isArray(saved) ? [] : saved?.agents ?? []) c.agents.set(a.agentId, { ...a });
    if (!Array.isArray(saved) && saved?.reviewer) c.reviewer = { ...c.reviewer, ...saved.reviewer };
    return c;
  }
}
