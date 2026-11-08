// Dashboard: live feed over SSE, metrics, agents, payee trust, policy, demo controls, step-up, replay chart.
const { esc, usd, time, modeClass } = window.TW;
const $ = (id) => document.getElementById(id);

let state;
let filter = "all";
let replayData;
const seen = new Set();
let firstLoad = true;

/** Fetch with JSON headers; a 401 means the dashboard needs the owner to sign in. */
async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) } });
  if (res.status === 401) {
    showLogin();
    throw new Error("Sign in required");
  }
  return res;
}

async function refresh() {
  state = await (await api("/api/state")).json();
  // Only animate decisions that arrive while the page is open.
  if (firstLoad) state.receipts.forEach((r) => seen.add(r.intent.id));
  firstLoad = false;
  render();
}

function render() {
  const { modes, policy, spentUsd, receipts, demoRemaining } = state;

  // Nav + integrations
  const short = { serv: "SERV", reppo: "Reppo", kite: "Kite" };
  $("modesMini").innerHTML = Object.entries(modes)
    .map(([k, v]) => `<span class="${modeClass(v) === "live" ? "live" : ""}" title="${esc(v)}">${short[k]} ${modeClass(v) === "live" ? "live" : esc(v.split(" ")[0])}</span>`)
    .join("");
  renderIntegrations(modes);

  $("heroMode").textContent = state.live ? "Live · real payments through Kite" : "Demo · no real money moves";
  // Demo controls (off in live mode: every payment there is real)
  $("next").hidden = $("reset").hidden = state.live;
  $("next").disabled = demoRemaining === 0;
  $("demoHint").textContent = state.live
    ? "Live: approved payments are paid through Kite with real money."
    : demoRemaining
      ? `${demoRemaining} of 7 scripted payments left · each one shows a different rung deciding`
      : "Demo script finished · reset to run it again";

  // Metrics
  const pct = Math.min(100, (spentUsd / policy.allowanceUsd) * 100);
  $("mSpent").innerHTML = `${usd(spentUsd)} <small>/ ${usd(policy.allowanceUsd)}</small>`;
  $("bar").style.width = `${pct}%`;
  $("meter").classList.toggle("warn", pct >= 80);
  $("mCap").textContent = `${usd(Math.max(0, policy.allowanceUsd - spentUsd))} left · max ${usd(policy.maxPerTxUsd)} per payment`;

  const counts = countBy(receipts);
  $("mDecisions").textContent = receipts.length;
  $("mSplit").innerHTML = [
    ["approved", "var(--ok)", "approved"],
    ["blocked", "var(--bad)", "blocked"],
    ["pending", "var(--wait)", "waiting"],
  ].map(([k, c, l]) => `<span><i class="dot" style="background:${c}"></i>${counts[k]} ${l}</span>`).join("");

  const cost = receipts.reduce((a, r) => a + r.verificationCostUsd, 0);
  const est = receipts.reduce((a, r) => a + liveCost(r), 0);
  $("mCost").textContent = usd(cost);
  $("mCostSub").textContent = est > cost + 1e-9 ? `≈${usd(est)} if every tier ran live` : "Across all tiers that ran";

  const asked = receipts.filter((r) => r.steps.some((s) => s.tier === 3)).length;
  $("mHuman").textContent = asked;
  $("mHumanSub").textContent = counts.waitingHuman ? `${counts.waitingHuman} waiting for you now` : `of ${receipts.length} payments · Kite passkey step-ups`;

  // Feed
  for (const [k, n] of Object.entries({ all: receipts.length, pending: counts.pending, approved: counts.approved, blocked: counts.blocked })) {
    document.querySelector(`[data-c="${k}"]`).textContent = n;
  }
  const shown = receipts.filter((r) => filter === "all" || group(r.status) === filter);
  $("feed").innerHTML = shown.length ? shown.map(decision).join("") : emptyFeed(receipts.length);
  for (const r of receipts) seen.add(r.intent.id);

  renderAgents(receipts, policy);
  renderTrust(policy, state.calibration?.payees ?? []);
  renderLearning(state.calibration ?? {});
  renderPolicy(policy);
}

// Anything not yet settled (including a payment Kite couldn't confirm) sits under "waiting".
const group = (s) => (s.startsWith("pending") || s === "paying" || s === "payment_unknown" ? "pending" : s);
function countBy(receipts) {
  const c = { approved: 0, blocked: 0, pending: 0, waitingHuman: 0 };
  for (const r of receipts) {
    c[group(r.status)]++;
    if (r.status === "pending_human" || r.status === "payment_unknown") c.waitingHuman++;
  }
  return c;
}

/** Mock steps cost nothing; this is what the same checks cost against the live APIs. */
function liveCost(r) {
  return r.steps.reduce((a, s) => a + (s.mode === "mock" ? s.detail?.liveCostUsd ?? 0 : s.costUsd), 0);
}

function emptyFeed(total) {
  if (total) return `<div class="empty"><p>No decisions match this filter.</p></div>`;
  return `<div class="empty"><div class="h3">No payments yet</div><p>Run the first demo payment to watch the ladder decide.</p></div>`;
}

/** A passkey step still open is waiting on you, not escalating further. */
const outcomeLabel = (s, r) => (s.tier === 3 && s.outcome === "escalate" && r.status === "pending_human" ? "waiting" : s.outcome);

const STATUS = { approved: "Approved", blocked: "Blocked", pending_human: "Waiting for you", pending_network: "Checking", paying: "Paying", payment_unknown: "Check payment" };

function decision(r) {
  const i = r.intent;
  const trail = r.steps
    .map((s) => `<span class="rung-chip ${s.kind} o-${s.outcome}" title="${esc(s.reasons.join(" "))}">
        <span class="n">${s.tier}</span>${esc(window.TW.tierName[s.tier])}
        <span class="o">${outcomeLabel(s, r)}</span>${String(s.detail?.promptGuard ?? "").startsWith("triggered") ? '<span class="m guard">PromptGuard</span>' : ""}${s.mode !== "live" ? `<span class="m">${s.mode}</span>` : ""}
      </span>`)
    .join('<span class="sep"></span>');
  const flagged = r.steps.filter((s) => s.outcome !== "pass").flatMap((s) => s.reasons);
  const why = [...new Set(flagged.length ? flagged : r.steps.at(-1)?.reasons ?? [])].slice(0, 4);
  const est = liveCost(r);
  const live = state.modes.kite.startsWith("live");
  const approvalUrl = r.steps.at(-1)?.detail?.approvalUrl;
  const safeLink = typeof approvalUrl === "string" && /^https:\/\//.test(approvalUrl) ? approvalUrl : undefined;
  const stepUp = r.status === "pending_human"
    ? `<div class="stepup">
        <p><b>Step-up requested.</b> Approve ${usd(i.amountUsd)} to ${esc(i.payeeName)}?${live ? " Approve or decline with your passkey in Kite Passport; nothing is paid until you do." : ""}</p>
        ${live
          ? safeLink ? `<div class="actions"><a class="btn sm approve" href="${esc(safeLink)}" target="_blank" rel="noopener noreferrer">Open passkey approval →</a></div>` : ""
          : `<div class="actions">
          <button class="btn sm approve" data-answer="approved" data-id="${esc(i.id)}">Approve</button>
          <button class="btn sm decline" data-answer="declined" data-id="${esc(i.id)}">Decline</button></div>`}
      </div>`
    : "";
  const p = r.payment;
  const unknown = r.status === "payment_unknown"
    ? `<div class="unknown-box">
        <p><b>${p?.state === "held" ? "Kite is holding this payment." : "Kite couldn't confirm this payment."}</b> ${esc(sentence(p?.userMessage ?? p?.error ?? "It may have gone through"))} It still counts against the allowance. Never pay it again by other means.</p>
        <div class="actions">
          <button class="btn sm" data-pay="recheck" data-id="${esc(i.id)}">Ask Kite again</button>
          <button class="btn sm outline" data-pay="paid" data-id="${esc(i.id)}">It was paid</button>
          <button class="btn sm outline" data-pay="not_paid" data-id="${esc(i.id)}">It wasn't paid</button>
        </div>
      </div>`
    : "";
  const paidNote = p && r.status !== "payment_unknown" && (p.error || p.mode === "live")
    ? `<div class="paid-note ${p.error ? "warn" : ""}">${p.state === "paid" ? `Paid through Kite${p.amountUsd !== undefined ? ` · ${usd(p.amountUsd)}` : ""}${p.paymentId ? ` · ${esc(p.paymentId)}` : ""}` : "Not paid"}${p.error ? ` · ${esc(p.error)}` : ""}</div>`
    : "";
  return `<article class="decision ${seen.has(i.id) ? "" : "new"}">
    <div class="d-top">
      <div>
        <div class="d-amount">${usd(i.amountUsd)}</div>
        <div class="d-payee">${esc(i.payeeName)}<span class="mono">${esc(i.payee)}</span></div>
        <div class="d-meta"><span class="agent">${esc(i.agentId)}</span>${esc(i.purpose)}</div>
      </div>
      <span class="pill ${r.status}">${STATUS[r.status] ?? esc(r.status)}</span>
    </div>
    <div class="trail">${trail}</div>
    <ul class="reasons">${why.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    ${stepUp}${unknown}${paidNote}${feedbackBox(r)}
    <div class="d-foot">
      <span>${time(i.createdAt)} · planned tier ${r.plannedTier} · checks ${usd(r.verificationCostUsd)}${est > r.verificationCostUsd + 1e-9 ? ` (≈${usd(est)} live)` : ""}</span>
      <a href="/r/${encodeURIComponent(i.id)}">View receipt →</a>
    </div>
  </article>`;
}

const sentence = (t) => (/[.!?]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`);

/** After-the-fact feedback: report a paid payment, or say a block was wrong. */
function feedbackBox(r) {
  const id = esc(r.intent.id);
  if (r.feedback) {
    const when = r.feedback.at.slice(0, 10);
    return `<div class="feedback-note ${r.feedback.rating}">${r.feedback.rating === "bad" ? `You reported a problem · ${when}${r.feedback.note ? ` · “${esc(r.feedback.note)}”` : ""}` : `You marked this block as wrong · ${when}`}</div>`;
  }
  if (r.status === "approved") return `<div class="feedback-actions"><button class="btn text sm" data-fb="bad" data-id="${id}">Report a problem</button></div>`;
  if (r.status === "blocked" && r.steps.length) return `<div class="feedback-actions"><button class="btn text sm" data-fb="good" data-id="${id}">This was fine</button></div>`;
  return "";
}

function renderAgents(receipts, policy) {
  const agents = state.agents ?? [];
  $("agentCount").textContent = `${agents.length} on this allowance`;
  $("policyLabel").textContent = state.live ? `Live${policy.resetPeriod && policy.resetPeriod !== "never" ? ` · resets ${policy.resetPeriod}` : ""}` : "Demo allowance";
  $("agents").innerHTML = agents.map((a) => {
    const mine = receipts.filter((r) => r.intent.agentId === a.id);
    // Paid, being paid, or possibly paid: the same money the allowance meter counts.
    const spent = mine.filter((r) => ["approved", "paying", "payment_unknown"].includes(r.status)).reduce((s, r) => s + Math.max(r.payment?.amountUsd ?? 0, r.intent.amountUsd), 0);
    const blocked = mine.filter((r) => r.status === "blocked").length;
    return `<li>
      <div class="agent-row"><b>${esc(a.id)}</b><span class="mono small">${usd(spent)}</span></div>
      ${a.task ? `<div class="agent-task">${esc(a.task)}</div>` : ""}
      <div class="mini-meter"><i style="width:${Math.min(100, (spent / policy.allowanceUsd) * 100)}%"></i></div>
      <div class="small muted" style="margin-top:6px">${mine.length} payment${mine.length === 1 ? "" : "s"} · ${blocked} blocked</div>
    </li>`;
  }).join("");
}

// Multipliers come from the server, which applies the 30-day windows.
const multiplier = (s) => s?.multiplier ?? 1;

/** Reppo's track record against the owner, and what the owner's reports changed. */
function renderLearning(c) {
  const r = c.reviewer ?? {};
  const judged = (r.ownerAgreed ?? 0) + (r.ownerOverruled ?? 0) + (r.missed ?? 0);
  const verdicts = (r.ship ?? 0) + (r.review ?? 0) + (r.block ?? 0);
  const watched = (c.payees ?? []).filter((p) => p.ownerApprovesUntil);
  const strict = (c.agents ?? []).filter((a) => a.multiplier < 1);
  const rows = [
    ["Reppo verdicts", verdicts ? `${verdicts} · ${r.ship ?? 0} ship · ${r.review ?? 0} review · ${r.block ?? 0} block` : "none yet"],
    ["Agreed with you", judged ? `${Math.round(((r.ownerAgreed ?? 0) / judged) * 100)}% of ${judged} you judged` : "nothing to compare yet"],
    ["You overruled it", String(r.ownerOverruled ?? 0)],
    ["It shipped, you reported", String(r.missed ?? 0)],
  ];
  $("learning").innerHTML = `<dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
    ${watched.length || strict.length ? `<ul class="list learn-list">
      ${watched.map((p) => `<li><b class="mono">${esc(p.payee)}</b><div class="agent-task">You reported a payment. You approve its payments until ${esc(p.ownerApprovesUntil.slice(0, 10))}.</div></li>`).join("")}
      ${strict.map((a) => `<li><b class="mono">${esc(a.agentId)}</b><div class="agent-task">Stricter checks (half thresholds) until 30 days after your report.</div></li>`).join("")}
    </ul>` : `<p class="small muted learn-hint">Report a problem on a paid payment, or mark a blocked one as fine. Tripwire adjusts at once.</p>`}`;
}

function renderTrust(policy, stats) {
  const byPayee = new Map(stats.map((s) => [s.payee, s]));
  const payees = [...new Set([...policy.knownPayees.map((k) => k.payee), ...stats.map((s) => s.payee)])];
  const rows = payees.map((p) => {
    const s = byPayee.get(p);
    const m = multiplier(s);
    const known = policy.knownPayees.some((k) => k.payee === p) || s?.learnedKnown;
    const watch = s?.ownerApprovesUntil ? ' <span class="tag bad">you approve</span>' : "";
    return `<tr>
      <td><span class="mono">${esc(p)}</span>${known ? "" : ' <span class="tag">new</span>'}${watch}</td>
      <td class="num">${s?.clean ?? 0}/${s?.incidents ?? 0}</td>
      <td class="num ${m > 1 ? "mult-up" : m < 1 ? "mult-down" : ""}">${m}×</td>
      <td class="num">${usd(policy.tier2MinUsd * m)}</td>
    </tr>`;
  });
  $("trust").innerHTML = `<thead><tr><th>Payee</th><th class="num" title="Clean signals / incidents">OK/Inc</th><th class="num">Mult</th><th class="num" title="Reppo threshold for this payee">Reppo ≥</th></tr></thead><tbody>${rows.join("")}</tbody>`;
}

function renderPolicy(p) {
  $("policy").innerHTML = `
    <dt>Allowance</dt><dd>${usd(p.allowanceUsd)}</dd>
    <dt>Per-payment cap</dt><dd>${usd(p.maxPerTxUsd)}</dd>
    <dt>SERV check from</dt><dd>${usd(p.tier1MinUsd)}</dd>
    <dt>Reppo check from</dt><dd>${usd(p.tier2MinUsd)}</dd>
    <dt>Duplicate window</dt><dd>${p.duplicateWindowMinutes} min</dd>
    ${p.newPayeeMaxUsd !== undefined ? `<dt>New-payee cap</dt><dd>${usd(p.newPayeeMaxUsd)}</dd>` : ""}
    <dt>Known payees</dt><dd>${p.knownPayees.length}</dd>
    <dt>Agent rules</dt><dd><a href="#policy-editor">${(p.agentRules ?? []).length}</a></dd>
    <dt>Deny list</dt><dd>${p.denyPayees.map((d) => `<span class="tag bad">${esc(d)}</span>`).join("") || "none"}</dd>`;

  const rules = [
    ...(p.agentRules ?? []).map((r) => {
      const parts = [
        r.allowedCategories && `only ${r.allowedCategories.join(", ")} (else Reppo review)`,
        r.maxPerTxUsd !== undefined && `max ${usd(r.maxPerTxUsd)} per payment`,
        r.blockedPayees?.length && `never ${r.blockedPayees.join(", ")}`,
      ].filter(Boolean);
      return `<li><div class="agent-row"><b>${esc(r.agentId)}</b><span class="small muted">${esc(parts.join(" · "))}</span></div><div class="agent-task">“${esc(r.note)}”</div></li>`;
    }),
    ...(p.newPayeeMaxUsd !== undefined ? [`<li><div class="agent-row"><b>all agents</b><span class="small muted">new payees capped at ${usd(p.newPayeeMaxUsd)}</span></div></li>`] : []),
    `<li><div class="agent-row"><b>all agents</b><span class="small muted">max ${usd(p.maxPerTxUsd)} per payment · deny ${esc(p.denyPayees.join(", ") || "none")}</span></div></li>`,
  ];
  $("rulesInForce").innerHTML = rules.join("");
}

// ---------- Plain-English policy ----------
let proposalId;
$("examples").addEventListener("click", (e) => {
  const c = e.target.closest(".chip");
  if (!c) return;
  const t = $("policyText");
  t.value = (t.value.trim() ? t.value.trim() + " " : "") + c.textContent;
  t.focus();
});

$("compile").onclick = async () => {
  const text = $("policyText").value.trim();
  if (!text) return $("policyText").focus();
  $("compile").disabled = true;
  $("compileStatus").textContent = state?.modes.serv.startsWith("live") ? "SERV is compiling your rules…" : "Compiling with the offline stand-in…";
  try {
    const res = await api("/api/policy/compile", { method: "POST", body: JSON.stringify({ text }) });
    const p = await res.json();
    if (!res.ok) throw new Error(p.error);
    proposalId = p.id;
    $("proposalMeta").textContent = `${p.mode === "live" ? `SERV ${p.model ?? ""}` : "offline stand-in"} · ${(p.latencyMs / 1000).toFixed(1)} s · ${usd(p.costUsd)}`;
    $("proposalBody").innerHTML = `
      ${p.changes.length ? `<div class="label" style="margin-bottom:10px">Will change</div><ul class="diff">${p.changes.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : `<p class="muted" style="margin:0">No changes to apply.</p>`}
      ${p.unsupported.length ? `<div class="label" style="margin:18px 0 10px">Not applied: can't be expressed or failed checks</div><ul class="diff unsupported">${p.unsupported.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
      <div class="proposal-actions">
        ${p.changes.length ? '<button class="btn" id="applyProposal">Apply changes</button>' : ""}
        <button class="btn outline" id="discardProposal">Discard</button>
      </div>`;
    $("compileStatus").textContent = "";
  } catch (err) {
    $("compileStatus").textContent = `Couldn't compile: ${err.message}`;
  } finally {
    $("compile").disabled = false;
  }
};

$("proposalBody").addEventListener("click", async (e) => {
  if (e.target.id === "discardProposal") {
    proposalId = undefined;
    $("proposalMeta").textContent = "Discarded";
    $("proposalBody").innerHTML = '<p class="muted" style="margin:0">Nothing applied.</p>';
  }
  if (e.target.id === "applyProposal") {
    e.target.disabled = true;
    const res = await api("/api/policy/apply", { method: "POST", body: JSON.stringify({ id: proposalId }) });
    if (!res.ok) return alert((await res.json()).error);
    proposalId = undefined;
    $("proposalMeta").textContent = "Applied";
    $("proposalBody").innerHTML = '<p style="margin:0">Applied. The new rules are in force for the next payment.</p>';
    refresh();
  }
});

// ---------- Connect an agent (MCP) ----------
$("mcpCli").textContent = `claude mcp add tripwire \\
  --env TRIPWIRE_URL=${location.origin} \\
  --env TRIPWIRE_AGENT_KEY=<this agent's key> \\
  -- node /path/to/tripwire/src/mcp.ts`;
$("mcpJson").textContent = JSON.stringify(
  { mcpServers: { tripwire: { command: "node", args: ["/path/to/tripwire/src/mcp.ts"], env: { TRIPWIRE_URL: location.origin, TRIPWIRE_AGENT_KEY: "<this agent's key>" } } } },
  null, 2,
);

const CHAINS = { 8453: "Base", 137: "Polygon", 43114: "Avalanche", 5042: "Arc" };
const short = (s) => (s && s.length > 22 ? `${s.slice(0, 10)}…${s.slice(-8)}` : s);

/** The newest real evidence from each sponsor, taken from this dashboard's own receipts. */
function liveProof(receipts) {
  const out = {};
  for (const r of receipts) {
    for (const s of r.steps) {
      if (s.mode !== "live") continue;
      if (!out.serv && s.tier === 1 && s.detail?.servRequestId) out.serv = `SERV request ${short(s.detail.servRequestId)} · ${(s.detail.servFeatures ?? []).join(", ")}`;
      if (!out.reppo && s.tier === 2 && s.detail?.evalId && s.detail?.route) out.reppo = `Eval ${short(s.detail.evalId)} · ${s.detail.route}, ${s.detail.score}/100`;
    }
    const p = r.payment;
    if (!out.kite && p?.mode === "live" && p.state === "paid") out.kite = `Paid ${usd(p.amountUsd ?? r.intent.amountUsd)} on ${CHAINS[p.chainId] ?? "Kite"}${p.txHash ? ` · tx ${short(p.txHash)}` : ""}`;
  }
  return out;
}

function renderIntegrations(modes) {
  const items = [
    ["serv", "SERV Reasoning", "Tier 1 task check through SERV's reasoning graphs (Multipath, audited by Kronos), with PromptGuard and Shadow Agent on every call. Also compiles your plain-English rules into strict policy.", "OpenServ"],
    ["reppo", "Reppo Eval API", "Tier 2. A panel of independent evaluators scores larger or flagged payments and routes them ship, review or block. Its track record against your decisions is kept.", "Reppo"],
    ["kite", "Kite Agent Passport", "Pays from your allowance with idempotency keys, checks payees in Kite's service catalog, and asks for your passkey through a session capped at one payment.", "Kite"],
  ];
  const proof = liveProof(state?.receipts ?? []);
  $("integrations").innerHTML = items.map(([k, name, body]) => {
    const v = modes[k];
    const cls = modeClass(v);
    const label = cls === "live" ? "Live" : cls === "sandbox" ? "Sandbox" : v.startsWith("off") ? "Off · you decide" : "Offline stand-in";
    return `<div class="card integ">
      <div class="top"><h3 class="h3">${name}</h3><span class="status ${cls}">${label}</span></div>
      <p>${body}</p>
      <span class="small mono muted">${esc(v)}</span>
      ${proof[k] ? `<div class="proof"><span class="label">Last live proof</span><span class="mono">${esc(proof[k])}</span></div>` : ""}
    </div>`;
  }).join("");
}

// ---------- Interactions ----------
$("feed").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-answer]");
  if (!b) return;
  b.closest(".actions").querySelectorAll("button").forEach((x) => (x.disabled = true));
  const res = await api(`/api/stepup/${encodeURIComponent(b.dataset.id)}`, { method: "POST", body: JSON.stringify({ answer: b.dataset.answer }) });
  if (!res.ok) alert((await res.json()).error);
});

// Feedback teaches calibration and Reppo's track record.
$("feed").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-fb]");
  if (!b) return;
  const bad = b.dataset.fb === "bad";
  if (bad && !confirm("Report this payment as a problem? For 30 days you'll approve this payee's payments yourself, and this agent gets stricter checks.")) return;
  b.disabled = true;
  const res = await api(`/api/receipts/${encodeURIComponent(b.dataset.id)}/feedback`, { method: "POST", body: JSON.stringify({ rating: b.dataset.fb }) });
  if (!res.ok) alert((await res.json()).error);
  refresh();
});

// Payments Kite couldn't confirm: recheck (same idempotency key, never pays twice) or settle by hand.
$("feed").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-pay]");
  if (!b) return;
  const what = b.dataset.pay;
  if (what !== "recheck" && !confirm(what === "paid"
    ? "Mark this payment as paid? Check Kite Passport's Activity page first."
    : "Mark this payment as NOT paid? It stops counting against the allowance. Check Kite Passport's Activity page first.")) return;
  b.closest(".actions").querySelectorAll("button").forEach((x) => (x.disabled = true));
  const id = encodeURIComponent(b.dataset.id);
  const res = what === "recheck"
    ? await api(`/api/receipts/${id}/recheck`, { method: "POST" })
    : await api(`/api/receipts/${id}/resolve`, { method: "POST", body: JSON.stringify({ answer: what }) });
  if (!res.ok) alert((await res.json()).error);
  refresh();
});

$("filters").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-f]");
  if (!b) return;
  filter = b.dataset.f;
  for (const x of $("filters").querySelectorAll("button")) x.setAttribute("aria-pressed", String(x === b));
  render();
});

let publicLive = false;
$("next").onclick = async () => {
  $("next").disabled = true;
  const res = await api(publicLive ? "/api/public/pay" : "/api/demo/next", { method: "POST" });
  if (!res.ok) alert((await res.json()).error);
};
$("reset").onclick = async () => {
  seen.clear();
  await api("/api/demo/reset", { method: "POST" });
  refresh();
};

// ---------- Sign-in ----------
function showLogin() {
  $("loginGate").hidden = false;
  $("loginToken").focus();
}

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("loginError").textContent = "";
  const res = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: $("loginToken").value }) });
  if (!res.ok) return ($("loginError").textContent = (await res.json()).error ?? "Couldn't sign in.");
  location.reload();
});

$("logout").onclick = async () => {
  await fetch("/api/logout", { method: "POST", headers: { "Content-Type": "application/json" } });
  location.reload();
};

function connect() {
  const events = new EventSource("/api/events");
  events.onmessage = (e) => {
    refresh().catch(() => {});
    // A new policy changes what the replay would have decided.
    try {
      if (["policy", "reset"].includes(JSON.parse(e.data).type)) replay();
    } catch {}
  };
  // Catch up on anything missed while the stream was down.
  events.onopen = () => refresh().catch(() => {});
}

// ---------- Replay ----------
async function replay() {
  replayData = await (await api("/api/replay")).json();
  const { calibrated: on, baseline: off } = replayData;
  const sum = (rows, k) => rows.reduce((a, r) => a + r[k], 0);
  const kpi = (big, label, sub) => `<div class="card metric"><div class="label">${label}</div><div class="value">${big}</div><div class="sub">${sub}</div></div>`;
  const onGood = sum(on, "humanPromptsOnGood"), offGood = sum(off, "humanPromptsOnGood");
  $("kpis").innerHTML = [
    kpi(`${onGood} <small>vs ${offGood}</small>`, "Interruptions", `on legitimate payments · ${Math.round((1 - onGood / Math.max(1, offGood)) * 100)}% fewer`),
    kpi(`${sum(on, "caught")}<small>/${sum(on, "bad")}</small>`, "Bad payments blocked", "lookalike, duplicate, off-task, inflated, split"),
    kpi(`${sum(on, "falseBlocks")} <small>vs ${sum(off, "falseBlocks")}</small>`, "Legitimate payments blocked", "with vs without calibration"),
    kpi(`${usd(sum(on, "projectedCostUsd"))} <small>vs ${usd(sum(off, "projectedCostUsd"))}</small>`, "Cost of checks", "at live SERV and Reppo prices"),
  ].join("");
  const custom = (state?.policy.agentRules ?? []).length || state?.policy.newPayeeMaxUsd !== undefined;
  $("replayNote").textContent =
    `${custom ? "Replayed against your current rules. " : ""}The same seeded traffic both times: ${on[0].payments} payments a week across 3 agents, ${on[0].bad} of them bad. ` +
    "It runs on offline stand-ins and a simulated human who always answers correctly, so it measures the ladder and calibration logic, not reviewer quality.";
  $("weeks").innerHTML = `<thead><tr><th>Week</th><th>Payments</th><th>Bad caught</th><th>False blocks</th><th>Interruptions</th><th>SERV calls</th><th>Reppo calls</th><th>Cost</th></tr></thead><tbody>${on
    .map((r, k) => `<tr><td>Week ${r.week}</td><td>${r.payments}</td><td>${r.caught}/${r.bad}</td><td>${r.falseBlocks}</td><td>${r.humanPromptsOnGood} <span class="muted">/ ${off[k].humanPromptsOnGood}</span></td><td>${r.tier1Calls}</td><td>${r.tier2Calls} <span class="muted">/ ${off[k].tier2Calls}</span></td><td>${usd(r.projectedCostUsd)} <span class="muted">/ ${usd(off[k].projectedCostUsd)}</span></td></tr>`)
    .join("")}</tbody>`;
  drawChart();
}

function drawChart() {
  if (!replayData) return;
  const a = replayData.calibrated.map((r) => r.humanPromptsOnGood);
  const b = replayData.baseline.map((r) => r.humanPromptsOnGood);
  const css = getComputedStyle(document.documentElement);
  const ink = css.getPropertyValue("--ink").trim(), muted = css.getPropertyValue("--muted").trim(), card = css.getPropertyValue("--card").trim();
  const W = 1000, H = 260, L = 44, R = 36, T = 16, B = 30;
  const max = Math.max(1, ...a, ...b);
  const x = (i) => L + (i * (W - L - R)) / Math.max(1, a.length - 1);
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const line = (vals, color, dash) =>
    `<polyline fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" ${dash ? 'stroke-dasharray="5 5"' : ""} points="${vals.map((v, i) => `${x(i)},${y(v)}`).join(" ")}"/>` +
    vals.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="4" fill="${card}" stroke="${color}" stroke-width="2"><title>Week ${i + 1}: ${v}</title></circle>`).join("");
  let grid = "";
  for (let v = 0; v <= max; v += Math.max(1, Math.ceil(max / 4))) {
    grid += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 10}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  }
  const labels = a.map((_, i) => `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">Week ${i + 1}</text>`).join("");
  $("chart").innerHTML = grid + labels + line(b, muted, true) + line(a, ink, false);
}
document.addEventListener("themechange", drawChart);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", drawChart);

(async function boot() {
  const session = await (await fetch("/api/session")).json();
  $("logout").hidden = !session.authRequired;
  publicLive = Boolean(session.publicLive);
  if (publicLive) {
    $("next").textContent = "Spend a real payment";
    $("reset").hidden = true;
    const hint = $("demoHint");
    if (hint) hint.textContent = "Live \u2014 real money from a shared $0.40/week allowance. Each click pays agent402.tools a few hundredths of a cent through Kite, and you watch the ladder decide.";
  }
  if (session.authRequired && session.role !== "owner") return showLogin();
  await refresh();
  replay();
  connect();
})();
