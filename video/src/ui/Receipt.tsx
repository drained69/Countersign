// The receipt page (public/receipt.html + receipt.js) for the blocked lookalike invoice.
import React from "react";
import { UI } from "../copy";
import { ATTACK, AGENT_TASKS, VENDOR_TEXT, usd } from "../data";
import { CUE } from "../timeline";
import { prog } from "../anim";

const NODE_AT = [CUE.node0, CUE.node1, CUE.node2, CUE.node3];

export const Receipt: React.FC<{ t: number; narrow: boolean }> = ({ t, narrow }) => {
  const r = ATTACK;
  return (
    <div>
      <section className="hero">
        <div className="hero-card compact">
          <div className="crumbs"><a>Dashboard</a> / Receipt / <span>{r.id}</span></div>
          <div className="receipt-head">
            <div>
              <span className="live-label"><i></i>Receipt · {r.agent}</span>
              <h1 className="display" data-anchor="r-amount">{usd(r.amountUsd)}</h1>
              <p className="lead">to <b>{r.payeeName}</b> <span className="mono">{r.payee}</span></p>
            </div>
            <span><span className="pill blocked" data-anchor="r-pill">{UI.status.blocked}</span></span>
          </div>
        </div>
      </section>
      <section className="section" style={{ paddingTop: narrow ? 28 : undefined }}>
        <div className="container receipt-grid" style={narrow ? { gridTemplateColumns: "minmax(0, 1fr)" } : undefined}>
          <div style={{ display: "flex", flexDirection: "column", gap: 24, minWidth: 0 }}>
            <div className="card" data-anchor="r-timeline">
              <div className="card-head"><h3>{UI.receipt.checks}</h3><span className="label">4 of 4 tiers · planned {r.plannedTier}</span></div>
              <ol className="timeline">
                {r.steps.map((s, i) => {
                  const k = prog(t, NODE_AT[i], 0.45);
                  const cost = `${usd(0)}${s.mode === "mock" && s.liveCostUsd ? ` · ≈${usd(s.liveCostUsd)} live` : ""}`;
                  return (
                    <li key={s.tier} style={{ opacity: 0.25 + 0.75 * k }} data-anchor={`r-step-${i}`}>
                      <span className="node" style={{ background: `var(--${s.kind})`, transform: `scale(${0.7 + 0.3 * k})` }}>{s.tier}</span>
                      <div className="t-head"><b>{s.name}</b><span className={`outcome ${s.outcome}`}>{s.outcome}</span></div>
                      <div className="t-facts" data-anchor={`r-facts-${i}`}>
                        <span>{UI.tierName[s.tier]}</span><span>{s.kind}</span>
                        <span>{s.mode}</span>
                        <span>{cost}</span>
                        <span>{s.ms.toLocaleString("en-US")} ms</span>
                        {(s.facts ?? []).map((f) => <span key={f}>{f}</span>)}
                      </div>
                      <ul className="reasons">{s.reasons.map((x) => <li key={x}>{x}</li>)}</ul>
                    </li>
                  );
                })}
              </ol>
            </div>
            <details className="card raw"><summary>{UI.receipt.raw}</summary></details>
          </div>
          <aside className="side">
            <div className="card">
              <div className="card-head"><h3>{UI.receipt.payment}</h3></div>
              <dl className="kv">
                <dt>Status</dt><dd>{UI.status.blocked}</dd>
                <dt>Amount</dt><dd>{usd(r.amountUsd)}</dd>
                <dt>Category</dt><dd>{r.category}</dd>
                <dt>Cost of checks</dt><dd>$0.00</dd>
                <dt>Kite payment</dt><dd>Not paid</dd>
                <dt>Requested</dt><dd>11/9/2026, 10:08:34 AM</dd>
                <dt>Decided</dt><dd>11/9/2026, 10:09:09 AM</dd>
              </dl>
            </div>
            <div className="card" data-anchor="r-context">
              <div className="card-head"><h3>{UI.receipt.context}</h3></div>
              <div className="card-pad" style={{ display: "flex", flexDirection: "column", gap: 16, fontSize: 14.5 }}>
                <div><div className="label" style={{ marginBottom: 6 }}>Agent task</div><div style={{ color: "var(--ink-2)" }}>{AGENT_TASKS[r.agent]}</div></div>
                <div><div className="label" style={{ marginBottom: 6 }}>Stated purpose</div><div style={{ color: "var(--ink-2)" }}>{r.purpose}</div></div>
                <div>
                  <div className="label" style={{ marginBottom: 6, color: "var(--bad)" }}>{UI.receipt.vendorLabel}</div>
                  <div style={{ color: "var(--ink-2)" }}><span className="mono">{VENDOR_TEXT.join("\n")}</span></div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
};
