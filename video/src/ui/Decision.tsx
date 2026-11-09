// One card in the decision feed, rebuilt from decision() in public/app.js.
import React from "react";
import { UI } from "../copy";
import { usd, type PaymentView } from "../data";
import { pop, prog } from "../anim";

const Chip: React.FC<{ s: PaymentView["steps"][number]; t: number }> = ({ s, t }) => {
  const k = pop(t, s.at, 0.38);
  const flash = 1 - prog(t, s.at, 0.9);
  return (
    <span
      className={`rung-chip ${s.kind} o-${s.shownOutcome}`}
      style={{
        transform: `scale(${0.6 + 0.4 * k})`,
        opacity: Math.min(1, k * 1.4),
        boxShadow: flash > 0 ? `0 0 0 ${4 * flash}px color-mix(in srgb, var(--${s.kind}) ${Math.round(35 * flash)}%, transparent)` : undefined,
      }}
      data-anchor={`chip-${s.tier}`}
    >
      <span className="n">{s.tier}</span>
      {UI.tierName[s.tier]}
      <span className="o">{s.label}</span>
      {s.guard ? <span className="m guard" data-anchor="guard">PromptGuard</span> : null}
      {s.mode !== "live" ? <span className="m">{s.mode}</span> : null}
    </span>
  );
};

/** Expands from zero height to its natural height (the grid 0fr→1fr technique). */
export const Grow: React.FC<{ p: number; children: React.ReactNode; anchor?: string }> = ({ p, children, anchor }) => (
  <div style={{ display: "grid", gridTemplateRows: `${p}fr`, opacity: Math.min(1, p * 1.5) }} data-anchor={anchor}>
    <div style={{ minHeight: 0, overflow: "hidden" }}>{children}</div>
  </div>
);

export const Decision: React.FC<{
  v: PaymentView;
  t: number;
  /** Characters of the payee to highlight, e.g. the "11" in acme-bi11ing. */
  markPayee?: { from: number; to: number; p: number };
  pressedDecline?: boolean;
  anchorPrefix?: string;
}> = ({ v, t, markPayee, pressedDecline, anchorPrefix }) => {
  const { p } = v;
  const passkey = p.steps.find((s) => s.tier === 3);
  // The step-up card shows while the owner decides, then folds away once they answer.
  const stepUpP = passkey ? prog(t, passkey.at + 0.05, 0.45) * (1 - prog(t, p.finalAt + 0.05, 0.35)) : 0;
  const final = v.status === "approved" || v.status === "blocked";
  const pillFlash = final ? 1 - prog(t, p.finalAt, 0.8) : 0;
  const payee = markPayee ? (
    <>
      {p.payee.slice(0, markPayee.from)}
      <span style={{ background: `color-mix(in srgb, var(--bad) ${Math.round(22 * markPayee.p)}%, transparent)`, color: markPayee.p > 0.5 ? "var(--bad)" : undefined, borderRadius: 3, boxShadow: `0 0 0 ${2 * markPayee.p}px color-mix(in srgb, var(--bad) ${Math.round(55 * markPayee.p)}%, transparent)` }}>
        {p.payee.slice(markPayee.from, markPayee.to)}
      </span>
      {p.payee.slice(markPayee.to)}
    </>
  ) : p.payee;
  const a = (n: string) => (anchorPrefix ? `${anchorPrefix}-${n}` : undefined);

  return (
    <article className="decision" data-anchor={a("card")}>
      <div className="d-top">
        <div>
          <div className="d-amount" data-anchor={a("amount")}>{usd(p.amountUsd)}</div>
          <div className="d-payee" data-anchor={a("payee")}>{p.payeeName}<span className="mono">{payee}</span></div>
          <div className="d-meta"><span className="agent">{p.agent}</span>{p.purpose}</div>
        </div>
        <span
          className={`pill ${v.status}`}
          data-anchor={a("pill")}
          style={{ transform: `scale(${1 + 0.12 * pillFlash})`, boxShadow: pillFlash > 0 ? `0 0 0 ${6 * pillFlash}px color-mix(in srgb, currentColor ${Math.round(25 * pillFlash)}%, transparent)` : undefined }}
        >
          {UI.status[v.status]}
        </span>
      </div>
      <div className="trail">{v.steps.map((s) => <Chip key={s.tier} s={s} t={t} />)}</div>
      <ul className="reasons" data-anchor={a("reasons")}>
        {v.reasons.map((x) => {
          const s = v.steps.find((st) => st.reasons.includes(x));
          const k = s ? prog(t, s.at + 0.1, 0.35) : 1;
          return <li key={x} style={{ opacity: k, transform: `translateY(${(1 - k) * 4}px)` }}>{x}</li>;
        })}
      </ul>
      {stepUpP > 0 ? (
        <Grow p={stepUpP} anchor={a("stepup")}>
          <div className="stepup">
            <p><b>{UI.stepup(usd(p.amountUsd), p.payeeName).b}</b>{UI.stepup(usd(p.amountUsd), p.payeeName).rest}</p>
            <div className="actions">
              <a className="btn sm approve" data-anchor={a("decline")} style={pressedDecline ? { transform: "translateY(1px) scale(0.96)" } : undefined}>{UI.openPasskey}</a>
            </div>
          </div>
        </Grow>
      ) : null}
      {v.status === "approved" ? <div className="paid-note" style={{ opacity: prog(t, p.finalAt, 0.4) }}>{UI.paidThroughKite(usd(p.amountUsd))}</div> : null}
      {final ? (
        <div className="feedback-actions" style={{ opacity: prog(t, p.finalAt + 0.2, 0.4) }}>
          <button className="btn text sm">{v.status === "approved" ? UI.reportProblem : UI.wasFine}</button>
        </div>
      ) : null}
      <div className="d-foot">
        <span>
          {p.clock} · planned tier {p.plannedTier} · checks {usd(v.cost)}
        </span>
        <a data-anchor={a("receipt")}>{UI.viewReceipt}</a>
      </div>
    </article>
  );
};
