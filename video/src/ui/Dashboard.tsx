// The dashboard page (public/index.html + public/app.js), rebuilt as a pure function of time.
import React from "react";
import { UI } from "../copy";
import { AGENT_TASKS, ALLOWANCE, KNOWN_PAYEES, MAX_PER_TX, REPLAY, feedAt, totalsAt, usd, ATTACK } from "../data";
import { CUE, POLICY_TEXT, typingTimes } from "../timeline";
import { Decision, Grow } from "./Decision";
import { prog, mix } from "../anim";

export interface DashState {
  t: number;
  narrow: boolean;
  filter: "all" | "blocked";
  pressed: Set<string>;
}

const Eyebrow: React.FC<{ n: string; children: React.ReactNode }> = ({ n, children }) => (
  <span className="eyebrow"><span className="num">{n}</span>{children}</span>
);

const Hero: React.FC<DashState> = ({ t, narrow, pressed }) => {
  const left = 7 - feedAt(t).length;
  return (
    <section className="hero">
      <div className="hero-card">
        <div className="hero-grid" style={narrow ? { gridTemplateColumns: "1fr" } : undefined}>
          <div className="hero-copy">
            <span className="live-label"><i></i><span>{UI.hero.mode}</span></span>
            <h1 className="display">{UI.hero.title[0]}<br />{UI.hero.title[1]}</h1>
            <p className="lead">{UI.hero.lead}</p>
            <div className="hero-actions">
              <button className="btn lime go" data-anchor="run" style={pressed.has("run") ? { transform: "translateY(1px) scale(0.97)" } : undefined}>{UI.hero.run}</button>
              <a className="btn ghost go">{UI.hero.view}</a>
              <button className="btn text on-deep">{UI.hero.reset}</button>
            </div>
            <p className="hero-hint">{UI.hero.hint(left)}</p>
          </div>
          {narrow ? null : (
            <div className="hero-visual">
              <Slip />
            </div>
          )}
        </div>
        <div className="hero-strip"><span>{UI.hero.strip}</span><a>{UI.hero.stripLink}</a></div>
      </div>
    </section>
  );
};

export const Slip: React.FC<{ style?: React.CSSProperties }> = ({ style }) => (
  <div className="slip" style={style}>
    <div className="slip-head">{UI.slip.head}</div>
    <div className="slip-amt">{UI.slip.amount} <small>{UI.slip.to}</small></div>
    <ul>
      {UI.slip.rows.map((r) => (
        <li key={r.n}><i className={`k ${r.k}`}>{r.n}</i><span>{r.name}<em>{r.em}</em></span><b className={r.cls}>{r.out}</b></li>
      ))}
    </ul>
    <div className="slip-foot">{UI.slip.foot}</div>
  </div>
);

const Metrics: React.FC<DashState> = ({ t, narrow }) => {
  const tot = totalsAt(t);
  // Ease the money counter between payments instead of jumping.
  const spent = tot.spent;
  const pct = Math.min(100, (spent / ALLOWANCE) * 100);
  return (
    <section className="section tight soft">
      <div className="container">
        <div className="metrics" style={narrow ? { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" } : undefined} data-anchor="metrics">
          <div className="card metric" data-anchor="m-spent">
            <div className="label">{UI.metrics.spent}</div>
            <div className="value">{usd(spent)} <small>/ {usd(ALLOWANCE)}</small></div>
            <div className={`meter ${pct >= 80 ? "warn" : ""}`}><i style={{ width: `${pct}%` }}></i></div>
            <div className="sub">{usd(Math.max(0, ALLOWANCE - spent))} left · max {usd(MAX_PER_TX)} per payment</div>
          </div>
          <div className="card metric">
            <div className="label">{UI.metrics.decisions}</div>
            <div className="value">{tot.decisions}</div>
            <div className="split">
              <span><i className="dot" style={{ background: "var(--ok)" }}></i>{tot.approved} approved</span>
              <span><i className="dot" style={{ background: "var(--bad)" }}></i>{tot.blocked} blocked</span>
              <span><i className="dot" style={{ background: "var(--wait)" }}></i>{tot.pending} waiting</span>
            </div>
          </div>
          <div className="card metric">
            <div className="label">{UI.metrics.cost}</div>
            <div className="value">$0.00</div>
            <div className="sub">{tot.liveEstimate > 0 ? `≈${usd(tot.liveEstimate)} if every tier ran live` : UI.metrics.costSub}</div>
          </div>
          <div className="card metric">
            <div className="label">{UI.metrics.human}</div>
            <div className="value">{tot.asked}</div>
            <div className="sub">{tot.waitingHuman ? `${tot.waitingHuman} need owner review` : `of ${tot.decisions} payments · Kite passkey step-ups`}</div>
          </div>
        </div>
      </div>
    </section>
  );
};

/** Payee trust rows as calibration changed during the demo run. */
function trustRows(t: number) {
  const rows = KNOWN_PAYEES.map((p) => ({ p, clean: 0, inc: 0, m: 1, isNew: false }));
  const bump = (p: string, at: number, kind: "clean" | "inc") => {
    if (t < at) return;
    let r = rows.find((x) => x.p === p);
    if (!r) rows.push((r = { p, clean: 0, inc: 0, m: 1, isNew: true }));
    if (kind === "clean") r.clean++;
    else { r.inc++; r.m = 0.5; }
  };
  bump("acme-bi11ing.example", CUE.p3Blocked, "inc");
  bump("acme-billing.example", CUE.p4Reppo, "clean");
  bump("cloudhost.example", CUE.p6Blocked, "inc");
  return rows;
}

const Side: React.FC<DashState> = ({ t }) => {
  const tot = totalsAt(t);
  const verdicts = { ship: t >= CUE.p4Reppo ? 1 : 0, review: (t >= CUE.p3Reppo ? 1 : 0) + (t >= CUE.p6Reppo ? 1 : 0) };
  const n = verdicts.ship + verdicts.review;
  const judged = (t >= CUE.p3Blocked ? 1 : 0) + (t >= CUE.p6Blocked ? 1 : 0);
  return (
    <aside className="side">
      <div className="card">
        <div className="card-head"><h3>{UI.board.agents}</h3><span className="label">3 on this allowance</span></div>
        <ul className="list">
          {Object.entries(AGENT_TASKS).map(([id, task]) => {
            const a = tot.byAgent(id);
            return (
              <li key={id}>
                <div className="agent-row"><b>{id}</b><span className="mono small">{usd(a.spent)}</span></div>
                <div className="agent-task">{task}</div>
                <div className="mini-meter"><i style={{ width: `${Math.min(100, a.spent)}%` }}></i></div>
                <div className="small muted" style={{ marginTop: 6 }}>{a.n} payment{a.n === 1 ? "" : "s"} · {a.blocked} blocked</div>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="card">
        <div className="card-head"><h3>{UI.board.trust}</h3><span className="label">{UI.board.calibration}</span></div>
        <div className="table-scroll">
          <table className="trust">
            <thead><tr><th>Payee</th><th className="num">OK/Inc</th><th className="num">Mult</th><th className="num">Reppo ≥</th></tr></thead>
            <tbody>
              {trustRows(t).map((r) => (
                <tr key={r.p}>
                  <td><span className="mono">{r.p}</span>{r.isNew ? <> <span className="tag">new</span></> : null}</td>
                  <td className="num">{r.clean}/{r.inc}</td>
                  <td className={`num ${r.m < 1 ? "mult-down" : ""}`}>{r.m}×</td>
                  <td className="num">{usd(20 * r.m)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ margin: 0, padding: "12px 14px 16px", borderTop: "1px solid var(--line)" }}>Clean verdicts raise a payee's thresholds (up to 4×) after two signals; an incident halves them for 30 days. Serious flags ignore this.</p>
      </div>
      <div className="card">
        <div className="card-head"><h3>What Tripwire has learned</h3><span className="label">From you and Reppo</span></div>
        <dl className="kv">
          <dt>Reppo verdicts</dt><dd>{n ? `${n} · ${verdicts.ship} ship · ${verdicts.review} review · 0 block` : "none yet"}</dd>
          <dt>Agreed with you</dt><dd>{judged ? `100% of ${judged} you judged` : "nothing to compare yet"}</dd>
          <dt>You overruled it</dt><dd>0</dd>
          <dt>It shipped, you reported</dt><dd>0</dd>
        </dl>
      </div>
    </aside>
  );
};

const Board: React.FC<DashState> = (s) => {
  const { t, narrow, filter, pressed } = s;
  const all = feedAt(t);
  const shown = filter === "blocked" ? all.filter((v) => v.status === "blocked") : all;
  const tot = totalsAt(t);
  const counts: Record<string, number> = { All: tot.decisions, Waiting: tot.pending, Approved: tot.approved, Blocked: tot.blocked };
  return (
    <section className="section board-section">
      <div className="container">
        <div className="section-head">
          <div>
            <Eyebrow n="01">{UI.board.eyebrow}</Eyebrow>
            <h2 className="h2">{UI.board.title}</h2>
          </div>
          {narrow ? null : <p>{UI.board.lead}</p>}
        </div>
      </div>
      <div className="container board" style={narrow ? { gridTemplateColumns: "minmax(0, 1fr)" } : undefined}>
        <div className="card" data-anchor="feedcard">
          <div className="card-head">
            <h3>{UI.board.feed}</h3>
            <div className="tabs">
              {UI.board.tabs.map((name) => (
                <button key={name} aria-pressed={(filter === "blocked" ? "Blocked" : "All") === name} data-anchor={`tab-${name}`}>
                  {name}<span className="count">{counts[name]}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="feed-status"><span>{UI.board.connection}</span></div>
          <div className="feed" data-anchor="feed">
            {shown.length === 0 ? (
              <div className="empty"><div className="h3">No payments yet</div><p>Run the first demo payment to see how Tripwire checks it.</p></div>
            ) : (
              shown.map((v) => {
                const isAttack = v.p.id === ATTACK.id;
                const grow = filter === "all" ? prog(t, v.p.arrive, 0.45) : 1;
                const rise = prog(t, v.p.arrive, 0.5);
                return (
                  <Grow key={v.p.id} p={grow}>
                    <div style={{ opacity: rise, transform: `translateY(${(1 - rise) * -6}px)` }}>
                      <Decision
                        v={v}
                        t={t}
                        anchorPrefix={`d${v.p.id.slice(-1)}`}
                        markPayee={isAttack ? { from: 7, to: 9, p: prog(t, CUE.p3Code - 0.2, 0.5) * (1 - prog(t, CUE.p3Serv - 0.4, 0.5)) } : undefined}
                        pressedDecline={pressed.has(`decline-${v.p.id}`)}
                      />
                    </div>
                  </Grow>
                );
              })
            )}
          </div>
        </div>
        {narrow ? null : <Side {...s} />}
      </div>
    </section>
  );
};

const Policy: React.FC<DashState> = ({ t, narrow, pressed }) => {
  const times = typingTimes(POLICY_TEXT, CUE.typeStart, CUE.typeEnd);
  const typed = POLICY_TEXT.slice(0, times.filter((x) => t >= x).length);
  const focused = t >= CUE.textareaClick && t < CUE.compileClick;
  const compiling = t >= CUE.compileClick && t < CUE.proposal;
  const proposalP = prog(t, CUE.proposal, 0.5);
  const caretOn = focused && Math.floor(t * 2.4) % 2 === 0;
  return (
    <section className="section soft" data-anchor="policy-section">
      <div className="container">
        <div className="section-head">
          <div>
            <Eyebrow n="02">{UI.policy.eyebrow}</Eyebrow>
            <h2 className="h2">{UI.policy.title}</h2>
          </div>
          {narrow ? null : <p>{UI.policy.lead}</p>}
        </div>
        <div className="policy-grid" style={narrow ? { gridTemplateColumns: "minmax(0, 1fr)" } : undefined}>
          <div className="card card-pad" data-anchor="policy-input">
            <label className="label">{UI.policy.label}</label>
            <div
              className="textarea-fake"
              data-anchor="textarea"
              style={{
                width: "100%", marginTop: 12, font: "400 15px/1.55 var(--font-body)", color: typed ? "var(--ink)" : "var(--muted)",
                background: "var(--bg-soft)", border: "1px solid var(--line)", borderRadius: 16, padding: 16, minHeight: 6 * 15 * 1.55 + 34,
                outline: focused ? "2px solid var(--lime)" : undefined, outlineOffset: 1, borderColor: focused ? "transparent" : undefined, whiteSpace: "pre-wrap",
              }}
            >
              {typed || (focused ? "" : UI.policy.placeholder)}
              {focused ? <span style={{ display: "inline-block", width: 1.5, height: "1.1em", verticalAlign: "-0.15em", background: caretOn ? "var(--ink)" : "transparent", marginLeft: 1 }} /> : null}
            </div>
            <div className="examples">{UI.policy.chips.map((c) => <button key={c} className="chip">{c}</button>)}</div>
            <div className="hero-actions" style={{ marginTop: 18 }}>
              <button className="btn" data-anchor="compile" disabled={compiling} style={pressed.has("compile") ? { transform: "translateY(1px) scale(0.97)" } : undefined}>{UI.policy.compile}</button>
              <span className="small muted">{compiling ? UI.policy.compiling : ""}</span>
            </div>
          </div>
          <div className="card" data-anchor="proposal">
            <div className="card-head"><h3>{UI.policy.proposed}</h3><span className="label">{proposalP > 0 ? UI.policy.meta : UI.policy.nothingYet}</span></div>
            <div className="card-pad">
              {proposalP <= 0 ? (
                <p className="muted" style={{ margin: 0 }}>{UI.policy.emptyBody}</p>
              ) : (
                <div style={{ opacity: proposalP }}>
                  <div className="label" style={{ marginBottom: 10 }}>{UI.policy.willChange}</div>
                  <ul className="diff" data-anchor="diff">
                    {UI.policy.changes.map((c, i) => {
                      const k = prog(t, CUE.proposal + 0.15 + i * 0.25, 0.4);
                      return <li key={c} style={{ opacity: k, transform: `translateX(${(1 - k) * 12}px)` }}>{c}</li>;
                    })}
                  </ul>
                  <div className="label" style={{ margin: "18px 0 10px" }}>{UI.policy.notApplied}</div>
                  <ul className="diff unsupported" data-anchor="unsupported">
                    {UI.policy.unsupported.map((c) => {
                      const k = prog(t, CUE.proposal + 0.7, 0.4);
                      return <li key={c} style={{ opacity: k, transform: `translateX(${(1 - k) * 12}px)` }}>{c}</li>;
                    })}
                  </ul>
                  <div className="proposal-actions" data-anchor="apply">
                    <button className="btn">{UI.policy.apply}</button>
                    <button className="btn outline">{UI.policy.discard}</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="card" style={{ marginTop: 24, borderRadius: "var(--radius-lg)" }}>
          <div className="card-head"><h3>{UI.policy.rules}</h3><span className="label">{UI.policy.rulesLabel}</span></div>
          <ul className="list"><li><div className="agent-row"><b>all agents</b><span className="small muted">max $75.00 per payment · deny mixer.example</span></div></li></ul>
        </div>
      </div>
    </section>
  );
};

const How: React.FC<DashState> = ({ narrow }) => (
  <section className="section">
    <div className="container">
      <div className="section-head">
        <div>
          <Eyebrow n="03">{UI.how.eyebrow}</Eyebrow>
          <h2 className="h2">{UI.how.title}</h2>
        </div>
      </div>
      <div className="steps4" style={narrow ? { gridTemplateColumns: "repeat(2, 1fr)" } : undefined}>
        {UI.how.steps.map((s) => (
          <div key={s.n} className="card stepcard">
            <div className="step-num">{s.n}</div><div className="kind-bar" style={{ background: `var(${s.c})` }}></div>
            <h3 className="h3">{s.h}</h3>
            <p className="step-sub">{s.sub}</p>
          </div>
        ))}
      </div>
    </div>
  </section>
);

const Replay: React.FC<DashState> = ({ t, narrow }) => {
  const k = prog(t, CUE.kpis, 1.6);
  const count = (to: number, from = 0) => Math.round(mix(from, to, k));
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const on = REPLAY.interruptionsOn, off = REPLAY.interruptionsOff;
  const kpi = (big: React.ReactNode, label: string, sub: string, anchor?: string) => (
    <div className="card metric" data-anchor={anchor}><div className="label">{label}</div><div className="value">{big}</div><div className="sub">{sub}</div></div>
  );
  // Chart (drawChart in app.js)
  const W = 1000, H = 260, L = 44, R = 36, T = 16, B = 30;
  const max = Math.max(1, ...on, ...off);
  const x = (i: number) => L + (i * (W - L - R)) / (on.length - 1);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const draw = prog(t, CUE.chart, 1.6);
  const line = (vals: number[], color: string, dash: boolean) => (
    <g>
      <polyline fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeDasharray={dash ? "5 5" : undefined} points={vals.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
        style={{ clipPath: `inset(0 ${100 - draw * 100}% 0 0)` }} />
      {vals.map((v, i) => (draw * (vals.length - 1) >= i - 0.01 ? <circle key={i} cx={x(i)} cy={y(v)} r={4} fill="var(--card)" stroke={color} strokeWidth={2} /> : null))}
    </g>
  );
  const ticks: number[] = [];
  for (let v = 0; v <= max; v += Math.max(1, Math.ceil(max / 4))) ticks.push(v);
  return (
    <section className="section soft" data-anchor="replay-section">
      <div className="container">
        <div className="section-head">
          <div>
            <Eyebrow n="04">{UI.replay.eyebrow}</Eyebrow>
            <h2 className="h2">{UI.replay.title}</h2>
          </div>
          {narrow ? null : <p>{UI.replay.note}</p>}
        </div>
        <div className="kpis" style={narrow ? { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" } : undefined} data-anchor="kpis">
          {kpi(<>{count(sum(on), sum(off))} <small>vs {sum(off)}</small></>, "Interruptions", `on legitimate payments · ${Math.round((1 - sum(on) / sum(off)) * 100)}% fewer`, "kpi-int")}
          {kpi(<>{count(REPLAY.caught)}<small>/{REPLAY.bad}</small></>, "Bad payments blocked", "lookalike, duplicate, off-task, inflated, split", "kpi-bad")}
          {kpi(<>{REPLAY.falseBlocksOn} <small>vs {REPLAY.falseBlocksOff}</small></>, "Legitimate payments blocked", "with vs without calibration", "kpi-fb")}
          {kpi(<>{usd(REPLAY.costOn)} <small>vs {usd(REPLAY.costOff)}</small></>, "Cost of checks", "at live SERV and Reppo prices")}
        </div>
        <div className="card chart-card" data-anchor="chart">
          <div className="section-head" style={{ marginBottom: 0, alignItems: "center" }}>
            <h3 className="h3">{UI.replay.chartTitle}</h3>
            <div className="legend"><span><i style={{ background: "var(--ink)" }}></i>{UI.replay.legendOn}</span><span><i className="dash"></i>{UI.replay.legendOff}</span></div>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", marginTop: 12 }}>
            {ticks.map((v) => (
              <g key={v}>
                <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--line)" />
                <text x={L - 10} y={y(v) + 4} textAnchor="end" style={{ fill: "var(--muted)", font: "400 11px var(--font-mono)" }}>{v}</text>
              </g>
            ))}
            {on.map((_, i) => <text key={i} x={x(i)} y={H - 8} textAnchor="middle" style={{ fill: "var(--muted)", font: "400 11px var(--font-mono)" }}>Week {i + 1}</text>)}
            {line(off, "var(--muted)", true)}
            {line(on, "var(--ink)", false)}
          </svg>
        </div>
      </div>
    </section>
  );
};

export const Dashboard: React.FC<DashState & { sections: ("hero" | "board" | "policy" | "replay")[] }> = (s) => (
  <div className="dashboard">
    {s.sections.includes("hero") ? <><Hero {...s} /><Metrics {...s} /></> : null}
    {s.sections.includes("board") ? <Board {...s} /> : null}
    {s.sections.includes("policy") ? <Policy {...s} /> : null}
    {s.sections.includes("replay") ? <><How {...s} /><Replay {...s} /></> : null}
  </div>
);

export const Nav: React.FC<{ narrow: boolean; current?: "activity" | "receipt"; pressed: Set<string> }> = ({ narrow, current = "activity", pressed }) => (
  <header className="nav" style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
    <div className="container">
      <a className="brand">
        <svg className="mark" viewBox="0 0 28 28"><rect width="28" height="28" rx="7" /><path d="M4.5 17.5h5.5l2.6-7 3.2 10 2.6-6.5h5.1" /></svg>
        <span className="wordmark">Tripwire</span>
      </a>
      <nav className="nav-links">
        {current === "receipt" ? (
          <><a>{UI.nav.dashboard}</a><a>{UI.nav.activity}</a><a>{UI.nav.docs}</a></>
        ) : (
          <>
            <a aria-current="page">{UI.nav.activity}</a>
            <a data-anchor="nav-policy">{UI.nav.policy}</a>
            <a data-anchor="nav-replay" style={pressed.has("nav-replay") ? { color: "var(--accent)" } : undefined}>{UI.nav.replay}</a>
            <a>{UI.nav.docs}</a>
          </>
        )}
      </nav>
      <div className="nav-right">
        {narrow || current === "receipt" ? null : <div className="modes-mini">{UI.modes.map((m) => <span key={m}>{m}</span>)}</div>}
        <button className="theme-toggle"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" /></svg></button>
        {narrow || current === "receipt" ? null : <a className="btn sm go nav-cta">{UI.nav.cta}</a>}
      </div>
    </div>
  </header>
);
