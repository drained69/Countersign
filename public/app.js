// Dashboard: live feed over SSE, metrics, agents, payee trust, policy, demo controls, step-up, replay chart.
const { esc, usd, time, modeClass } = window.TW;
const $ = (id) => document.getElementById(id);

let state;
let filter = "all";
let replayData;
const seen = new Set();
let firstLoad = true;
let session;
let owner = false;
let publicLive = false;
let demoBusy = false;
let events;
let refreshQueue = Promise.resolve();
const pageSize = 8;
let visible = pageSize;
const pendingActions = new Set();

/** Fetch with JSON headers; a 401 means the dashboard needs the owner to sign in. */
async function api(path, opts = {}) {
  const res = await fetch(path, { signal: AbortSignal.timeout(15000), ...opts, headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) } });
  if (res.status === 401) {
    showLogin();
    throw new Error("Sign in required");
  }
  return res;
}

async function checked(res) {
  if (res.ok) return res;
  const body = await res.json().catch(() => ({}));
  throw new Error(body.error || `Request failed (HTTP ${res.status}).`);
}

function refresh() {
  // Serialize reads so an older response cannot overwrite a newer snapshot.
  const update = refreshQueue.then(async () => {
    state = await (await checked(await api("/api/state"))).json();
    if (firstLoad) state.receipts.forEach((r) => seen.add(r.intent.id));
    firstLoad = false;
    render();
    for (const id of ["overviewMetrics", "dashboardSide", "filters"]) $(id).hidden = false;
    $("feed").setAttribute("aria-busy", "false");
    $("retry").hidden = true;
    $("connection").textContent = events?.readyState === EventSource.OPEN ? "Live updates connected" : "Activity loaded · connecting to updates…";
  });
  refreshQueue = update.catch(() => {});
  return update;
}

function showConnectionError() {
  $("connection").textContent = state ? "Activity may be out of date." : "Couldn’t load payment activity.";
  $("retry").hidden = false;
  $("feed").setAttribute("aria-busy", "false");
  if (!state) {
    $("heroMode").textContent = "Dashboard unavailable";
    $("feed").innerHTML = '<div class="empty">Use Retry connection to load the dashboard again.</div>';
  }
}

function render() {
  const { modes, policy, spentUsd, receipts, demoRemaining } = state;

  // Nav + integrations
  const short = { serv: "SERV", reppo: "Reppo", kite: "Kite" };
  $("modesMini").innerHTML = Object.entries(modes)
    .map(([k, v]) => `<span class="${modeClass(v) === "live" ? "live" : ""}" title="${esc(v)}">${short[k]} ${modeClass(v) === "live" ? "live" : esc(v.split(" ")[0])}</span>`)
    .join("");
  renderIntegrations(modes);

  $("heroMode").textContent = publicLive ? "Public demo · real payments" : state.live ? "Live · Kite payments" : "Scripted demo · simulated payments";
  $("next").hidden = !publicLive && (state.live || !owner);
  $("reset").hidden = state.live || !owner;
  $("next").textContent = publicLive ? "Run a real test payment" : "Run next demo payment";
  $("next").disabled = demoBusy || (!publicLive && demoRemaining === 0);
  $("reset").disabled = demoBusy;
  $("demoHint").textContent = publicLive
    ? `Requests one real payment of up to ${usd(session.testPayment.amountUsd)} to ${session.testPayment.payee} from the shared allowance.`
    : state.live
      ? "Approved payments use real funds through Kite."
      : demoRemaining ? `${demoRemaining} scripted payments left. Each shows a different decision path.` : "All scripted payments complete. Reset to run them again.";

  // Metrics
  const pct = policy.allowanceUsd > 0 ? Math.min(100, (spentUsd / policy.allowanceUsd) * 100) : 0;
  $("meter").setAttribute("aria-valuenow", String(Math.round(pct)));
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
  $("mHumanSub").textContent = counts.waitingHuman ? `${counts.waitingHuman} need owner review` : `of ${receipts.length} payments · Kite passkey step-ups`;

  // Feed
  for (const [k, n] of Object.entries({ all: receipts.length, pending: counts.pending, approved: counts.approved, blocked: counts.blocked })) {
    document.querySelector(`[data-c="${k}"]`).textContent = n;
  }
  const shown = receipts.filter((r) => filter === "all" || group(r.status) === filter);
  renderFeed(shown.slice(0, visible), receipts.length);
  $("feedMore").hidden = shown.length <= pageSize;
  $("feedCount").textContent = `Showing ${Math.min(shown.length, visible)} of ${shown.length}`;
  $("showMore").setAttribute("aria-disabled", String(shown.length <= visible));
  for (const r of receipts) seen.add(r.intent.id);

  renderAgents(receipts, policy);
  renderTrust(policy, state.calibration?.payees ?? []);
  renderLearning(state.calibration ?? {});
  renderPolicy(policy);
}

// Keep unchanged cards in place so live refreshes don't steal keyboard focus.
function renderFeed(receipts, total) {
  const feed = $("feed");
  if (!receipts.length) {
    feed.innerHTML = emptyFeed(total);
    return;
  }
  const active = feed.contains(document.activeElement) ? document.activeElement : null;
  const activeCard = active?.closest("[data-receipt]");
  const action = active && ["answer", "pay", "fb"].find((key) => active.dataset[key]);
  const existing = new Map([...feed.children].map((el) => [el.dataset.receipt, el]));
  for (const [index, r] of receipts.entries()) {
    const id = r.intent.id;
    const key = JSON.stringify(r);
    let card = existing.get(id);
    if (card?.renderKey !== key) {
      const template = document.createElement("template");
      template.innerHTML = decision(r);
      const replacement = template.content.firstElementChild;
      if (pendingActions.has(id)) replacement.querySelectorAll("button").forEach((b) => { b.setAttribute("aria-disabled", "true"); });
      replacement.dataset.receipt = id;
      replacement.renderKey = key;
      card?.replaceWith(replacement);
      card = replacement;
    }
    existing.delete(id);
    if (feed.children[index] !== card) feed.insertBefore(card, feed.children[index] ?? null);
  }
  for (const el of existing.values()) el.remove();
  if (active && document.activeElement !== active) {
    const card = [...feed.children].find((el) => el.dataset.receipt === activeCard?.dataset.receipt);
    const sameAction = action && [...(card?.querySelectorAll("button:not(:disabled)") ?? [])].find((b) => b.dataset[action] === active.dataset[action]);
    (sameAction || card?.querySelector(".d-foot a") || card || $("filters").querySelector('[aria-pressed="true"]'))?.focus({ preventScroll: true });
  }
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
  if (total) return `<div class="empty"><p>No decisions match this filter.</p><button class="btn outline sm" data-clear-filter>Show all decisions</button></div>`;
  return `<div class="empty"><div class="h3">No payments yet</div><p>${publicLive ? "Run a real test payment to see how Tripwire checks it." : state.live ? "Requests will appear here as your agents submit them." : "Run the first demo payment to see how Tripwire checks it."}</p></div>`;
}

/** A passkey step still open is waiting on you, not escalating further. */
const outcomeLabel = (s, r) => (s.tier === 3 && s.outcome === "escalate" && r.status === "pending_human" ? "waiting" : s.outcome);

const STATUS = { approved: "Approved", blocked: "Blocked", pending_human: "Needs approval", pending_network: "Checking", paying: "Paying", payment_unknown: "Check payment" };

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
  const stepUp = owner && r.status === "pending_human"
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
        ${owner ? `<div class="actions">
          <button class="btn sm" data-pay="recheck" data-id="${esc(i.id)}">Ask Kite again</button>
          <button class="btn sm outline" data-pay="paid" data-id="${esc(i.id)}">It was paid</button>
          <button class="btn sm outline" data-pay="not_paid" data-id="${esc(i.id)}">It wasn't paid</button>
        </div>` : ""}
      </div>`
    : "";
  const paidNote = p && r.status !== "payment_unknown" && (p.error || p.mode === "live")
    ? `<div class="paid-note ${p.error ? "warn" : ""}">${p.state === "paid" ? `Paid through Kite${p.amountUsd !== undefined ? ` · ${usd(p.amountUsd)}` : ""}${p.paymentId ? ` · ${esc(p.paymentId)}` : ""}` : "Not paid"}${p.error ? ` · ${esc(p.error)}` : ""}</div>`
    : "";
  return `<article tabindex="-1" class="decision ${seen.has(i.id) ? "" : "new"}">
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
    ${stepUp}${unknown}${paidNote}${owner ? feedbackBox(r) : ""}
    <div class="d-foot">
      <span>${time(i.createdAt)} · planned tier ${r.plannedTier} · checks ${usd(r.verificationCostUsd)}${est > r.verificationCostUsd + 1e-9 ? ` (≈${usd(est)} live)` : ""}</span>
      ${owner || i.agentId === session.agentId ? `<a href="/r/${encodeURIComponent(i.id)}" aria-label="View receipt for ${esc(i.payeeName)}, ${usd(i.amountUsd)}">View receipt →</a>` : ""}
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
      <div class="mini-meter"><i style="width:${policy.allowanceUsd > 0 ? Math.min(100, (spent / policy.allowanceUsd) * 100) : 0}%"></i></div>
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
  if (!rows.length) rows.push('<tr><td colspan="4" class="muted">No payees yet. Trust builds as payments are checked.</td></tr>');
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
    <dt>Agent rules</dt><dd>${owner ? `<a href="#policy-editor">${(p.agentRules ?? []).length}</a>` : (p.agentRules ?? []).length}</dd>
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
let applying = false;
let editVersion = 0;
$("policyText").addEventListener("input", () => {
  editVersion++;
  if (!proposalId || applying) return;
  proposalId = undefined;
  $("proposalMeta").textContent = "Draft changed";
  $("proposalBody").textContent = "Compile your updated rules to review a new proposal.";
});
$("examples").addEventListener("click", (e) => {
  const c = e.target.closest(".chip");
  if (!c) return;
  const t = $("policyText");
  const value = [t.value.trim(), c.textContent].filter(Boolean).join("\n");
  if (value.length > t.maxLength) {
    $("compileStatus").textContent = "Your rules can be up to 2,000 characters.";
    return;
  }
  t.value = value;
  t.dispatchEvent(new Event("input"));
  t.focus();
});

$("compile").onclick = async () => {
  const text = $("policyText").value.trim();
  if (!text) return $("policyText").focus();
  const version = editVersion;
  $("compile").disabled = true;
  $("compileStatus").textContent = state?.modes.serv.startsWith("live") ? "SERV is compiling your rules…" : "Compiling with the offline stand-in…";
  try {
    const res = await api("/api/policy/compile", { method: "POST", body: JSON.stringify({ text }) });
    const p = await res.json();
    if (!res.ok) throw new Error(p.error);
    if (version !== editVersion) {
      $("compileStatus").textContent = "Your draft changed. Compile it again to review the latest rules.";
      return;
    }
    proposalId = p.changes.length ? p.id : undefined;
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
    if (!proposalId || applying) return;
    applying = true;
    const controls = [e.target, $("discardProposal"), $("compile"), $("policyText"), ...$("examples").querySelectorAll("button")];
    for (const control of controls) control.disabled = true;
    try {
      await checked(await api("/api/policy/apply", { method: "POST", body: JSON.stringify({ id: proposalId }) }));
      proposalId = undefined;
      $("proposalMeta").textContent = "Applied";
      $("proposalBody").innerHTML = '<p style="margin:0">Applied. The new rules are in force for the next payment.</p>';
      $("compileStatus").textContent = "Policy changes applied.";
      refresh().catch(showConnectionError);
    } catch (err) {
      $("compileStatus").textContent = `Couldn’t apply changes: ${err.message}`;
    } finally {
      applying = false;
      for (const control of controls) control.disabled = false;
      $("compile").focus({ preventScroll: true });
    }
  }
});

// ---------- Connect an agent (MCP) ----------
$("mcpCli").textContent = `claude mcp add tripwire \\
  --env TRIPWIRE_URL=${location.origin} \\
  --env TRIPWIRE_AGENT_KEY='YOUR_AGENT_KEY' \\
  -- node /path/to/tripwire/src/mcp.ts`;
$("mcpJson").textContent = JSON.stringify(
  { mcpServers: { tripwire: { command: "node", args: ["/path/to/tripwire/src/mcp.ts"], env: { TRIPWIRE_URL: location.origin, TRIPWIRE_AGENT_KEY: "YOUR_AGENT_KEY" } } } },
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
function feedNotice(message) {
  $("feedStatus").hidden = !message;
  $("feedStatus").textContent = message;
}

$("feed").addEventListener("click", async (e) => {
  if (e.target.closest("[data-clear-filter]")) {
    const all = $("filters").querySelector('[data-f="all"]');
    all.click();
    all.focus();
    return;
  }
  const b = e.target.closest("button[data-answer], button[data-fb], button[data-pay]");
  if (!b || !owner || pendingActions.has(b.dataset.id)) return;
  const { answer, fb, pay, id: receiptId } = b.dataset;
  const id = encodeURIComponent(receiptId);
  let path, body;
  if (answer) {
    path = `/api/stepup/${id}`;
    body = { answer };
  } else if (fb) {
    if (fb === "bad" && !confirm("Report this payment? For 30 days you’ll approve this payee’s payments and the agent will face stricter checks.")) return;
    path = `/api/receipts/${id}/feedback`;
    body = { rating: fb };
  } else {
    if (pay !== "recheck" && !confirm(pay === "paid"
      ? "Mark this payment as paid? Verify it in Kite Passport Activity first."
      : "Mark this payment as unpaid? Verify it in Kite Passport Activity first. This frees the amount in the allowance.")) return;
    path = `/api/receipts/${id}/${pay === "recheck" ? "recheck" : "resolve"}`;
    if (pay !== "recheck") body = { answer: pay };
  }
  pendingActions.add(receiptId);
  // Keep focus on the control while the request is in progress.
  const controls = b.closest("article").querySelectorAll("button");
  controls.forEach((control) => control.setAttribute("aria-disabled", "true"));
  feedNotice("Saving…");
  try {
    await checked(await api(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }));
    feedNotice(pay === "recheck" ? "Kite recheck complete. See the updated decision." : "Decision updated.");
    await refresh().catch(showConnectionError);
  } catch (err) {
    feedNotice(`Couldn’t complete the action: ${err.message}`);
  } finally {
    pendingActions.delete(receiptId);
    [...$("feed").children].find((card) => card.dataset.receipt === receiptId)?.querySelectorAll("button").forEach((control) => control.removeAttribute("aria-disabled"));
    render();
  }
});

$("filters").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-f]");
  if (!b) return;
  filter = b.dataset.f;
  visible = pageSize;
  for (const x of $("filters").querySelectorAll("button")) x.setAttribute("aria-pressed", String(x === b));
  render();
});
$("showMore").onclick = () => {
  if ($("showMore").getAttribute("aria-disabled") === "true") return;
  const firstNew = visible;
  visible += pageSize;
  render();
  $("feed").children[firstNew]?.focus();
};

async function runPayment(reset = false) {
  if (demoBusy || !state) return;
  if (reset && !confirm("Reset the scripted demo? This clears its receipts, calibration, and policy edits.")) return;
  if (publicLive && !confirm(`Send one real payment of up to ${usd(session.testPayment.amountUsd)} to ${session.testPayment.payee} from the shared allowance?`)) return;
  demoBusy = true;
  render();
  const status = $("paymentStatus");
  status.textContent = reset ? "Resetting demo…" : "Submitting payment request…";
  try {
    const path = reset ? "/api/demo/reset" : publicLive ? "/api/public/pay" : "/api/demo/next";
    const result = await (await checked(await api(path, { method: "POST" }))).json();
    if (reset) {
      seen.clear();
      visible = pageSize;
      $("filters").querySelector('[data-f="all"]').click();
      status.textContent = "Demo reset.";
    } else {
      status.innerHTML = `Request received. <a href="/r/${encodeURIComponent(result.id)}">Open its receipt →</a>`;
      $("filters").querySelector('[data-f="all"]').click();
    }
    await refresh().catch(showConnectionError);
  } catch (err) {
    status.textContent = err.name === "TimeoutError" || err instanceof TypeError
      ? "Couldn’t confirm the request. Check activity before trying again."
      : `Couldn’t complete the request: ${err.message}`;
  } finally {
    demoBusy = false;
    render();
  }
}
$("next").onclick = () => runPayment();
$("reset").onclick = () => runPayment(true);

// ---------- Sign-in ----------
function showLogin(optional = false) {
  if (!$("loginGate").hidden) return;
  if (!optional) events?.close();
  $("loginCancel").hidden = !optional;
  $("loginGate").hidden = false;
  for (const el of document.querySelectorAll("body > header, body > main, body > footer, body > .skip-link")) el.inert = true;
  $("loginToken").focus();
}

$("loginForm").addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("loginCancel").hidden) {
    $("loginCancel").click();
    return;
  }
  if (e.key !== "Tab") return;
  const first = $("loginToken");
  const last = $("loginCancel").hidden ? $("loginSubmit") : $("loginCancel");
  if (e.shiftKey && document.activeElement === first || !e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  }
});

$("ownerSignIn").onclick = () => showLogin(true);
$("loginCancel").onclick = () => {
  $("loginToken").value = "";
  $("loginError").textContent = "";
  $("loginGate").hidden = true;
  for (const el of document.querySelectorAll("body > header, body > main, body > footer, body > .skip-link")) el.inert = false;
  $("ownerSignIn").focus();
};

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = $("loginSubmit");
  if (button.disabled) return;
  button.disabled = true;
  $("loginError").textContent = "";
  try {
    const res = await fetch("/api/login", { signal: AbortSignal.timeout(15000), method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: $("loginToken").value }) });
    await checked(res);
    location.reload();
  } catch (err) {
    $("loginError").textContent = `Couldn’t sign in: ${err.message}`;
    $("loginToken").focus();
  } finally {
    button.disabled = false;
  }
});

$("logout").onclick = async () => {
  try {
    await checked(await api("/api/logout", { method: "POST" }));
    location.reload();
  } catch (err) {
    feedNotice(`Couldn’t sign out: ${err.message}`);
  }
};

function connect() {
  events?.close();
  events = new EventSource("/api/events");
  events.onmessage = (e) => {
    const updated = refresh().catch(showConnectionError);
    try {
      if (["policy", "reset"].includes(JSON.parse(e.data).type)) updated.then(loadReplay);
    } catch {}
  };
  events.onopen = () => refresh().catch(showConnectionError);
  events.onerror = showConnectionError;
}

function loadReplay() {
  if (!owner) return;
  replay().catch(() => {
    $("replayNote").textContent = "Couldn’t load the replay.";
    $("retryReplay").hidden = false;
  });
}

// ---------- Replay ----------
$("retryReplay").onclick = loadReplay;
async function replay() {
  replayData = await (await checked(await api("/api/replay"))).json();
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
  $("retryReplay").hidden = true;
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

// Number the visible sections in order, so hiding owner-only ones leaves no gaps.
function numberSections() {
  let n = 0;
  for (const num of document.querySelectorAll("main .section .eyebrow .num")) {
    if (num.closest("[hidden]")) continue;
    num.textContent = String(++n).padStart(2, "0");
  }
}

async function boot() {
  session = await (await checked(await api("/api/session"))).json();
  owner = session.role === "owner";
  publicLive = Boolean(session.publicLive && session.role === "agent");
  $("ownerSignIn").hidden = !publicLive;
  $("logout").hidden = !(owner && (session.authRequired || session.publicLive));
  if (session.authRequired && !owner) return showLogin();
  for (const el of document.querySelectorAll("[data-owner-only]")) el.hidden = !owner;
  numberSections();
  await refresh();
  loadReplay();
  connect();
}

$("retry").onclick = () => boot().catch(showConnectionError);
boot().catch(showConnectionError);
