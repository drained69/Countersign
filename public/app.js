// Dashboard: live feed over SSE, metrics, agents, payee trust, policy, demo controls, step-up, replay chart.
const { esc, usd, time, modeClass } = window.CS;
const $ = (id) => document.getElementById(id);
const MAX_MULTIPLIER = 4;

let state;
let filter = "all";
let replayData;
const seen = new Set();
let firstLoad = true;

async function refresh() {
  state = await (await fetch("/api/state")).json();
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

  // Demo controls
  $("next").disabled = demoRemaining === 0;
  $("demoHint").textContent = demoRemaining
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
  renderTrust(policy, state.calibration ?? []);
  renderPolicy(policy);
}

const group = (s) => (s.startsWith("pending") ? "pending" : s);
function countBy(receipts) {
  const c = { approved: 0, blocked: 0, pending: 0, waitingHuman: 0 };
  for (const r of receipts) {
    c[group(r.status)]++;
    if (r.status === "pending_human") c.waitingHuman++;
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

const STATUS = { approved: "Approved", blocked: "Blocked", pending_human: "Waiting for you", pending_network: "Checking" };

function decision(r) {
  const i = r.intent;
  const trail = r.steps
    .map((s) => `<span class="rung-chip ${s.kind} o-${s.outcome}" title="${esc(s.reasons.join(" "))}">
        <span class="n">${s.tier}</span>${esc(window.CS.tierName[s.tier])}
        <span class="o">${outcomeLabel(s, r)}</span>${String(s.detail?.promptGuard ?? "").startsWith("triggered") ? '<span class="m guard">PromptGuard</span>' : ""}${s.mode !== "live" ? `<span class="m">${s.mode}</span>` : ""}
      </span>`)
    .join('<span class="sep"></span>');
  const flagged = r.steps.filter((s) => s.outcome !== "pass").flatMap((s) => s.reasons);
  const why = [...new Set(flagged.length ? flagged : r.steps.at(-1)?.reasons ?? [])].slice(0, 4);
  const est = liveCost(r);
  const live = state.modes.kite.startsWith("live");
  const stepUp = r.status === "pending_human"
    ? `<div class="stepup">
        <p><b>Step-up requested.</b> Approve ${usd(i.amountUsd)} to ${esc(i.payeeName)}?${live ? " Confirm it with your passkey in Kite Passport." : ""}</p>
        ${live ? "" : `<div class="actions">
          <button class="btn sm approve" data-answer="approved" data-id="${esc(i.id)}">Approve</button>
          <button class="btn sm decline" data-answer="declined" data-id="${esc(i.id)}">Decline</button></div>`}
      </div>`
    : "";
  return `<article class="decision ${seen.has(i.id) ? "" : "new"}">
    <div class="d-top">
      <div>
        <div class="d-amount">${usd(i.amountUsd)}</div>
        <div class="d-payee">${esc(i.payeeName)}<span class="mono">${esc(i.payee)}</span></div>
        <div class="d-meta"><span class="agent">${esc(i.agentId)}</span>${esc(i.purpose)}</div>
      </div>
      <span class="pill ${r.status}">${STATUS[r.status]}</span>
    </div>
    <div class="trail">${trail}</div>
    <ul class="reasons">${why.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    ${stepUp}
    <div class="d-foot">
      <span>${time(i.createdAt)} · planned tier ${r.plannedTier} · checks ${usd(r.verificationCostUsd)}${est > r.verificationCostUsd + 1e-9 ? ` (≈${usd(est)} live)` : ""}</span>
      <a href="/r/${encodeURIComponent(i.id)}">View receipt →</a>
    </div>
  </article>`;
}

function renderAgents(receipts, policy) {
  const agents = state.agents ?? [];
  $("agents").innerHTML = agents.map((a) => {
    const mine = receipts.filter((r) => r.intent.agentId === a.id);
    const spent = mine.filter((r) => r.status === "approved").reduce((s, r) => s + r.intent.amountUsd, 0);
    const blocked = mine.filter((r) => r.status === "blocked").length;
    return `<li>
      <div class="agent-row"><b>${esc(a.id)}</b><span class="mono small">${usd(spent)}</span></div>
      <div class="agent-task">${esc(a.task)}</div>
      <div class="mini-meter"><i style="width:${Math.min(100, (spent / policy.allowanceUsd) * 100)}%"></i></div>
      <div class="small muted" style="margin-top:6px">${mine.length} payment${mine.length === 1 ? "" : "s"} · ${blocked} blocked</div>
    </li>`;
  }).join("");
}

function multiplier(s) {
  if (!s) return 1;
  if (s.incidents > 0) return 0.5;
  if (s.clean < 2) return 1;
  return Math.min(MAX_MULTIPLIER, 1 + (s.clean - 1) * 0.5);
}

function renderTrust(policy, stats) {
  const byPayee = new Map(stats.map((s) => [s.payee, s]));
  const payees = [...new Set([...policy.knownPayees.map((k) => k.payee), ...stats.map((s) => s.payee)])];
  const rows = payees.map((p) => {
    const s = byPayee.get(p);
    const m = multiplier(s);
    const known = policy.knownPayees.some((k) => k.payee === p) || s?.learnedKnown;
    return `<tr>
      <td><span class="mono">${esc(p)}</span>${known ? "" : ' <span class="tag">new</span>'}</td>
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
    const res = await fetch("/api/policy/compile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
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
    const res = await fetch("/api/policy/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: proposalId }) });
    if (!res.ok) return alert((await res.json()).error);
    proposalId = undefined;
    $("proposalMeta").textContent = "Applied";
    $("proposalBody").innerHTML = '<p style="margin:0">Applied. The new rules are in force for the next payment.</p>';
    refresh();
  }
});

// ---------- Connect an agent (MCP) ----------
$("mcpCli").textContent = `claude mcp add countersign \\
  --env COUNTERSIGN_URL=${location.origin} \\
  -- node /path/to/countersign/src/mcp.ts`;
$("mcpJson").textContent = JSON.stringify(
  { mcpServers: { countersign: { command: "node", args: ["/path/to/countersign/src/mcp.ts"], env: { COUNTERSIGN_URL: location.origin } } } },
  null, 2,
);

function renderIntegrations(modes) {
  const items = [
    ["serv", "SERV Reasoning", "Tier 1 task check with PromptGuard and Shadow Agent on every call. Also compiles your plain-English rules into strict policy.", "OpenServ"],
    ["reppo", "Reppo Eval API", "Tier 2. Independent network verdict on larger or flagged payments: proceed, re-evaluate or block.", "Reppo"],
    ["kite", "Kite Agent Passport", "Payments, the service directory check (ksearch), and a one-shot passkey session that the approved payment goes through.", "Kite"],
  ];
  $("integrations").innerHTML = items.map(([k, name, body]) => {
    const v = modes[k];
    const cls = modeClass(v);
    const label = cls === "live" ? "Live" : cls === "sandbox" ? "Sandbox" : "Offline stand-in";
    return `<div class="card integ">
      <div class="top"><h3 class="h3">${name}</h3><span class="status ${cls}">${label}</span></div>
      <p>${body}</p>
      <span class="small mono muted">${esc(v)}</span>
    </div>`;
  }).join("");
}

// ---------- Interactions ----------
$("feed").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-answer]");
  if (!b) return;
  b.closest(".actions").querySelectorAll("button").forEach((x) => (x.disabled = true));
  const res = await fetch(`/api/stepup/${encodeURIComponent(b.dataset.id)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answer: b.dataset.answer }),
  });
  if (!res.ok) alert((await res.json()).error);
});

$("filters").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-f]");
  if (!b) return;
  filter = b.dataset.f;
  for (const x of $("filters").querySelectorAll("button")) x.setAttribute("aria-pressed", String(x === b));
  render();
});

$("next").onclick = async () => {
  $("next").disabled = true;
  const res = await fetch("/api/demo/next", { method: "POST" });
  if (!res.ok) alert((await res.json()).error);
};
$("reset").onclick = async () => {
  seen.clear();
  await fetch("/api/demo/reset", { method: "POST" });
  refresh();
};

new EventSource("/api/events").onmessage = (e) => {
  refresh();
  // A new policy changes what the replay would have decided.
  try {
    if (["policy", "reset"].includes(JSON.parse(e.data).type)) replay();
  } catch {}
};

// ---------- Replay ----------
async function replay() {
  replayData = await (await fetch("/api/replay")).json();
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

refresh();
replay();
