  const { esc, usd, tierName } = window.TW;
  const $ = (id) => document.getElementById(id);
  const STATUS = { approved: "Approved", blocked: "Blocked", pending_human: "Waiting for you", pending_network: "Checking", paying: "Paying", payment_unknown: "Payment unconfirmed" };
  const id = location.pathname.split("/").pop();
  $("rid").textContent = id;

  /** Sponsor-specific evidence recorded on a step. */
  function facts(s) {
    const d = s.detail ?? {};
    const out = [];
    if (d.promptGuard) out.push(`PromptGuard: ${d.promptGuard}`);
    if (d.servFeatures) out.push(`SERV: ${d.servFeatures.join(", ")}`);
    else if (d.servTools) out.push(`SERV tools: ${d.servTools.join(", ")}`);
    if (d.model && s.tier === 1) out.push(`model ${d.model}`);
    if (d.servRequestId) out.push(`SERV request ${d.servRequestId}`);
    if (d.reasoningTokens) out.push(`${d.reasoningTokens} reasoning tokens`);
    if (s.tier === 2 && d.route) out.push(`Reppo route ${d.route}${Number.isFinite(d.score) ? ` · ${d.score}/100` : ""}${d.evaluators ? ` · ${d.evaluators} evaluators` : ""}`);
    if (d.creditsCharged) out.push(`${d.creditsCharged} Reppo credits`);
    if (d.kiteDirectory) {
      const k = d.kiteDirectory;
      out.push(k.listed ? `Kite directory: listed${k.serviceId ? ` (${k.serviceId})` : ""}` : k.error ? "Kite directory: lookup failed" : "Kite directory: not listed");
    }
    if (d.splitTotalUsd) out.push(`split total ${usd(d.splitTotalUsd)}`);
    if (d.evalId) out.push(`Reppo eval ${d.evalId}`);
    if (d.requestId) out.push(`Kite session request ${d.requestId}`);
    if (d.priceQuote?.priceUsd !== undefined) out.push(`merchant price ${usd(d.priceQuote.priceUsd)}`);
    else if (d.priceQuote?.error) out.push("merchant price: unconfirmed");
    if (d.notConfigured) out.push("not configured");
    return out.map((x) => `<span>${esc(x)}</span>`).join("");
  }

  let loaded = false;
  async function load() {
    $("retryReceipt").hidden = true;
    const res = await fetch(`/api/receipts/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(15000) });
    if (res.status === 401) return location.replace("/");
    if (res.status === 404) {
      $("amount").textContent = "Receipt not found";
      $("payee").textContent = "It may have been cleared by a demo reset.";
      $("receiptDetails").hidden = true;
      return;
    }
    if (!res.ok) throw new Error("Receipt request failed");
    const r = await res.json();
    loaded = true;
    $("receiptDetails").hidden = false;
    const i = r.intent;
    document.title = `${usd(i.amountUsd)} to ${i.payeeName} · Tripwire receipt`;
    $("eyebrow").innerHTML = `<i></i>Receipt · ${esc(i.agentId)}`;
    $("amount").textContent = usd(i.amountUsd);
    $("payee").innerHTML = `to <b>${esc(i.payeeName)}</b> <span class="mono">${esc(i.payee)}</span>`;
    $("status").innerHTML = `<span class="pill ${r.status}">${STATUS[r.status] ?? esc(r.status)}</span>`;
    $("stepCount").textContent = `${r.steps.length} of 4 tiers · planned ${r.plannedTier}`;

    $("steps").innerHTML = r.steps.map((s) => `<li>
      <span class="node ${s.kind}">${s.tier}</span>
      <div class="t-head"><b>${esc(s.name)}</b><span class="outcome ${s.outcome}">${s.tier === 3 && s.outcome === "escalate" && r.status === "pending_human" ? "waiting" : s.outcome}</span></div>
      <div class="t-facts">
        <span>${tierName[s.tier]}</span><span>${s.kind}</span><span>${s.mode}</span>
        <span>${usd(s.costUsd)}${s.mode === "mock" && s.detail?.liveCostUsd ? ` · ≈${usd(s.detail.liveCostUsd)} live` : ""}</span>
        <span>${s.latencyMs.toLocaleString()} ms</span>
        ${facts(s)}
      </div>
      <ul class="reasons">${s.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    </li>`).join("");

    const pm = r.payment;
    const STATE = { paid: "Paid", not_paid: "Not paid", unknown: "Outcome unconfirmed", held: "Held by Kite" };
    const pay = pm
      ? `${STATE[pm.state] ?? (pm.executed ? "Paid" : "Not paid")} · ${pm.mode}${pm.amountUsd !== undefined ? ` · ${usd(pm.amountUsd)}` : ""}${pm.ref ? ` · ${esc(pm.ref)}` : ""}${pm.error ? ` · ${esc(pm.error)}` : ""}`
      : r.status === "approved" ? "Not executed" : "Not paid";
    const fmt = (d) => (d ? new Date(d).toLocaleString() : "—");
    $("summary").innerHTML = `
      <dt>Status</dt><dd>${STATUS[r.status] ?? esc(r.status)}</dd>
      <dt>Amount</dt><dd>${usd(i.amountUsd)}</dd>
      <dt>Category</dt><dd>${esc(i.category)}</dd>
      <dt>Cost of checks</dt><dd>${usd(r.verificationCostUsd)}</dd>
      <dt>Kite payment</dt><dd>${pay}</dd>
      <dt>Requested</dt><dd>${fmt(i.createdAt)}</dd>
      <dt>Decided</dt><dd>${r.decidedAt ? fmt(r.decidedAt) : "pending"}</dd>
      ${i.url ? `<dt>Endpoint</dt><dd>${esc(i.method ?? "GET")} ${esc(i.url)}</dd>` : ""}
      ${pm?.sessionId ? `<dt>Step-up session</dt><dd>${esc(pm.sessionId)}</dd>` : ""}
      ${pm?.merchantStatus !== undefined ? `<dt>Merchant answered</dt><dd>HTTP ${esc(pm.merchantStatus)}</dd>` : ""}
      ${pm?.userMessage ? `<dt>Kite says</dt><dd>${esc(pm.userMessage)}</dd>` : ""}
      ${pm?.idempotencyKey ? `<dt>Idempotency key</dt><dd class="mono">${esc(pm.idempotencyKey)}</dd>` : ""}
      ${pm?.txHash ? `<dt>Transaction</dt><dd class="mono">${esc(pm.txHash)}</dd>` : ""}
      ${pm?.chainId ? `<dt>Settled on</dt><dd>${esc({ 8453: "Base", 137: "Polygon", 43114: "Avalanche", 5042: "Arc" }[pm.chainId] ?? `chain ${pm.chainId}`)}</dd>` : ""}
      ${r.feedback ? `<dt>Your feedback</dt><dd>${r.feedback.rating === "bad" ? "Reported a problem" : "Marked the block as wrong"} · ${esc(r.feedback.at.slice(0, 10))}${r.feedback.note ? ` · “${esc(r.feedback.note)}”` : ""}</dd>` : ""}
      ${pm?.explorerUrl && /^https:\/\//.test(pm.explorerUrl) ? `<dt>Explorer</dt><dd><a href="${esc(pm.explorerUrl)}" target="_blank" rel="noopener">View on Kite →</a></dd>` : ""}`;

    const block = (label, body, warn) => `<div><div class="label" style="margin-bottom:6px${warn ? ";color:var(--bad)" : ""}">${label}</div><div style="color:var(--ink-2)">${body}</div></div>`;
    $("context").innerHTML = [
      block("Agent task", esc(i.agentTask)),
      block("Stated purpose", esc(i.purpose)),
      i.vendorText ? block("Vendor text · untrusted, never obeyed", `<span class="mono">${esc(i.vendorText)}</span>`, true) : "",
    ].join("");
    $("raw").textContent = JSON.stringify(r, null, 2);
    if (r.status.startsWith("pending") || r.status === "paying") setTimeout(refresh, 2000);
  }
  function refresh() {
    load().catch(() => {
      if (!loaded) $("amount").textContent = "Couldn’t load receipt";
      $("status").textContent = loaded ? "Couldn’t refresh receipt" : "";
      $("retryReceipt").hidden = false;
    });
  }
  $("retryReceipt").onclick = refresh;
  refresh();
