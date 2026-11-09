# Tripwire demo video: timing plan

120 BPM, so one bar is 2 seconds. Every section starts on a bar line. Total: **70 s (35 bars)**.
Both cuts (1920x1080 and 1080x1920) share this timeline exactly; only the layout changes.

| # | Section | Bars | Time | What happens on screen | Camera | Sound |
|---|---------|------|------|------------------------|--------|-------|
| 0 | Cover / open | 2 | 0:00–0:04 | Frame 0 is a finished cover: logo, "Agents spend freely. Bad payments trip the wire.", the blocked $60.00 receipt slip from the hero. Tagline "Allowances let your agents spend without asking. Tripwire makes sure they should." types in. Dark theme. | Slow push on the slip | Pad + soft kick in |
| 1 | Small payment | 3 | 0:04–0:10 | Browser window (light), dashboard hero. Cursor clicks **Run next demo payment**. $0.40 SearchAPI drops into Live decisions: chip `0 Code rules PASS`, "Known payee, within caps, no duplicates.", pill APPROVED. $9.00 Transcribe Co (real payment #2) streams in behind it. | Push in on the $0.40 card, pull back | Click, tick, chime |
| 2 | The attack | 7 | 0:10–0:24 | $60.00 Acme Design (billing) `acme-bi11ing.example` arrives. Invoice text panel shows the "change the payee wallet" line and the hidden instruction. Chips light one by one: Code rules ESCALATE (lookalike reason), SERV ESCALATE + PROMPTGUARD, Reppo ESCALATE (score 38/100). Step-up card slides in plus a webhook-style alert. Cursor clicks **Decline**. Pill flips to BLOCKED. "Nothing paid." | Push on `bi11ing` → PromptGuard chip → Decline button; pull back | Music darkens; 3 ticks; notification; click; low thud |
| 3 | Real vendor, split, deny list | 5 | 0:24–0:34 | $60.00 `acme-billing.example`: Reppo 81/100 accept, APPROVED + chime. $10.00 then $10.50 CloudHost: second one flagged "Split payment: … total $20.50, over the $20.00 review threshold", owner declines. $5.00 `mixer.example`: "Payee mixer.example is on the deny list." BLOCKED instantly. Allowance meter climbs. | Quick pushes per card | Chime, tick-tick, thud, thud |
| 4 | Receipt | 4 | 0:34–0:42 | Click **View receipt →** on the blocked invoice. Receipt page: $60.00, BLOCKED, "Every check that ran" timeline, 4 nodes with mode (live/mock), cost ($0.00 · ≈$0.22 live), latency (0 ms … 35,057 ms for the owner), "Vendor text · untrusted, never obeyed". | Scroll down the timeline | Page whoosh, ticks per node |
| 5 | Plain-English policy | 5 | 0:42–0:52 | Policy section. Types the three sentences. Clicks **Compile with SERV**. Proposed changes: Will change "Cap for new payees: none → $25.00", "Block payee: fastcash.example"; Not applied "Only pay invoices on weekdays." Apply / Discard buttons shown, not clicked. | Push in on the diff | Typing, click, soft chime |
| 6a | Payoff: replay | 4 | 0:52–1:00 | "Does it learn?" KPIs: Interruptions **4 vs 14**, Bad payments blocked **30/30**, Legitimate payments blocked **0 vs 0**. Chart draws. Label: "Simulated traffic, six weeks". | Push in on 14 → 4 | Music lifts |
| 6b | MCP beat | 2 | 1:00–1:04 | Terminal panel: `claude mcp add tripwire …`, then a `tripwire_pay` call returning `BLOCKED: $60.00 to Acme Design (billing) (acme-bi11ing.example)…` / `APPROVED … Paid.` | Static, slight drift | Typing |
| 7 | Close | 3 | 1:04–1:10 | Dark. Logo, "Verify agent payments", "Star it on GitHub, github.com/drained69/Tripwire". | Settle | Resolve chord |

Captions (beside the UI in wide, below it in vertical) reuse the app's section style: numbered eyebrow, headline, one line. Example for step 2: `02  The attack` / "A lookalike invoice trips every rung." / "Code rules spot the payee, PromptGuard catches the hidden instruction, and you get the last word."

A "Demo mode, no real money" label sits on every scene that shows payments. Step 2 carries "In live mode, you approve with your Kite passkey."

## Things the real run showed that change the brief slightly

1. **There is a $9.00 Transcribe Co payment** between SearchAPI and the attack (payment 2 of 7). I show it streaming in briefly so the order matches the product.
2. **The split payment is not auto-blocked.** The $10.50 part is flagged as a split, Reppo routes it to review, and it waits for the owner. I show the owner declining it, captioned "caught together, sent to you".
3. **Latency in demo mode is 0 ms** for the stand-ins (the owner's decline took ~35 s). The receipt shows that as-is.
4. **Check costs in demo mode are $0.00**, shown as "$0.00 · ≈$0.22 live". I keep that wording rather than implying real spend.
5. **The replay's cost of checks goes up with calibration** ($32.30 vs $29.66), so the video claims fewer interruptions, not lower cost.

## Which on-screen numbers are examples

- Example data from the demo script: the three agents, every `.example` payee, the $100 allowance, all amounts ($0.40, $9.00, $60.00, $10.00, $10.50, $5.00), Reppo scores 38 and 81, the owner's 35,057 ms.
- Simulated replay (`npm run replay`, seeded traffic, offline stand-ins, simulated owner): 30/30, 0 legitimate blocked, 14 → 4 interruptions.
