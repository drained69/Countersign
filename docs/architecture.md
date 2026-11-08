# Architecture and security

Components, the life of a payment, design choices, the security model, sponsor integrations and the source layout.

[← Back to the README](../README.md)

## Contents

- [Architecture](#architecture)
- [Security model](#security-model)
- [Sponsor technology](#sponsor-technology)
- [Integration status](#integration-status)
- [Project layout](#project-layout)

## Architecture

```mermaid
flowchart TB
    subgraph Agents
        AG1[Agent via MCP<br/>src/mcp.ts]
        AG2[Agent via HTTP]
    end
    subgraph Tripwire server ["Tripwire server (src/server.ts)"]
        AUTH[Auth<br/>owner token · agent keys<br/>auth.ts]
        VAL[Intent validation<br/>validate.ts]
        ENG[Engine: the ladder<br/>engine.ts]
        T0[Tier 0 rules<br/>tiers/tier0.ts]
        T1[Tier 1 SERV<br/>tiers/tier1Serv.ts]
        T2[Tier 2 Reppo<br/>tiers/tier2Reppo.ts]
        CAL[Calibration<br/>calibration.ts]
        POL[Policy compiler<br/>policyCompiler.ts]
        STATE[(State file<br/>receipts · calibration · policy)]
    end
    subgraph External
        SERV[OpenServ SERV]
        REPPO[Reppo Eval API]
        KITE[Kite Passport<br/>kpass · ksearch]
        MERCH[x402 merchant]
    end
    DASH[Dashboard · receipts · docs<br/>public/]

    AG1 --> AUTH
    AG2 --> AUTH
    DASH <-->|API + server-sent events| AUTH
    AUTH --> VAL --> ENG
    ENG --> T0 & T1 & T2
    ENG <--> CAL
    ENG --> STATE
    POL --> SERV
    T1 --> SERV
    T2 --> REPPO
    ENG -->|directory, step-up, payment| KITE
    ENG -->|unpaid price check| MERCH
    KITE -->|x402 payment| MERCH
```

**One payment, end to end** (live mode, a $60 invoice that needs the owner):

```mermaid
sequenceDiagram
    autonumber
    participant A as Agent
    participant T as Tripwire
    participant M as Merchant (x402)
    participant S as SERV
    participant R as Reppo
    participant K as Kite (kpass)
    participant O as Owner
    A->>T: tripwire_pay {payee, amount, purpose, url}
    T-->>A: 202 Accepted (receipt id)
    par Tier 0 inputs
        T->>K: ksearch service search (new payees only)
        T->>M: same request, unpaid → read x402 price
    end
    T->>T: Tier 0 rules → plan tier 2
    T->>S: Tier 1 task match (PromptGuard, Shadow Agent)
    S-->>T: escalate
    T->>R: Tier 2 lite eval
    R-->>T: revise
    T->>K: session create (one payment, exact amount, 15 min)
    K-->>O: passkey approval link (dashboard + webhook)
    O->>K: approve with passkey
    T->>K: session status --wait → session id
    T->>T: save idempotency key to disk
    T->>K: session execute --session-id … --idempotency-key …
    K->>M: x402 payment
    K-->>T: paid
    T-->>A: APPROVED + receipt
```

Design choices worth noting:

- **The engine is pure and testable.** Every external system sits behind an adapter with an offline stand-in, so the full ladder runs in tests, the replay and the demo without network access. Live mode never uses a stand-in: an unconfigured check hands the payment to the owner.
- **Concurrency is handled before the first `await`.** A payment is registered as in flight synchronously, so two payments arriving together see each other (duplicates, splits, reserved allowance), and a retried `requestKey` finds the first one.
- **State is a single JSON file**, written atomically (temp file and rename, mode 600). The idempotency key is written *before* money moves.
- **No framework, no runtime dependencies.** Node's `http`, `https`, `child_process` and `crypto` cover everything; `kpass` runs through `execFile` with no shell.

## Security model

- **Fail closed.** Errors escalate. The only paths to payment are a pass at the planned tier or an explicit owner approval. An unexpected internal error blocks a payment that hasn't been paid, and marks one mid-payment as unconfirmed (still counted).
- **Untrusted vendor text.** It is pattern-screened at tier 0, fenced and labelled for SERV (with fence tags stripped), and judged as a criterion by Reppo. It is never executed or followed.
- **Validated model output.** SERV's answer must match the schema exactly, or the check fails and escalates. Every SERV call has a timeout.
- **Canonical payees.** Payees are compared in one normalized form everywhere (intents, policy files, compiled rules), so case or a trailing dot can't dodge a deny list or impersonate a known payee.
- **Least-privilege step-up.** An approval opens a session that can pay this amount, once, within 15 minutes, and the payment executes through exactly that session.
- **Price and payee verified before paying (live).** The merchant's own x402 price must not exceed the requested amount, and the URL must belong to the payee. See [What protects the money](deployment.md#what-protects-the-money-in-live-mode).
- **Never pays twice.** Idempotency keys are written to disk before money moves; unconfirmed outcomes stay counted and are only rechecked with the same key.
- **No splitting around review.** Payments still being checked count against the allowance, and an agent's recent payments to a payee are added up before choosing the tier.
- **Policy changes are reviewed.** SERV only proposes rules; code validates them, and nothing applies until the owner approves the exact diff. No sentence can be dropped silently.
- **No secrets in public evaluations.** Reppo payloads carry only payment facts.
- **Signed-in owner, keyed agents.** With an owner token, the dashboard requires sign-in and each agent has its own key; agents can submit payments and read only their own receipts and limits. The server won't start in live mode, or on a non-loopback `HOST`, without an owner token, and the open demo only answers requests addressed to localhost (so a website can't reach it through DNS rebinding). Cookies are HttpOnly and SameSite=Strict, cross-site writes are refused, pages carry a strict Content-Security-Policy, and sign-in attempts are rate-limited. Secrets are compared in constant time.
- **Durable, separate state.** State is written atomically (temp file + rename, mode 600). Live mode uses its own file and refuses to start on an unreadable one rather than silently starting empty. Receipts left waiting at shutdown are recorded as blocked; a payment interrupted mid-flight is marked unconfirmed, never forgotten. `kpass` runs through `execFile` with no shell.
- **Replays never spend.** `runReplay` forces offline adapters whatever the configuration.

To report a vulnerability, see [SECURITY.md](../SECURITY.md).

## Sponsor technology

| Sponsor | Feature | Where Tripwire uses it | Status |
|---|---|---|---|
| **OpenServ SERV** | Reasoning API, strict `json_schema` | Tier 1 task check; compiling plain-English rules into policy | ✅ live |
| | **PromptGuard** (`serv_prompt_guard`) | Every tier-1 call and the policy compiler: stops vendor text that tries to override the checker | ✅ live, seen firing |
| | **Shadow Agent** (`serv_shadow_agent`) | Every tier-1 call: validates the verdict against a hint and makes the model revise | ✅ enabled |
| **Reppo** | Eval API, lite evals (proceed / re-evaluate / block) | Tier 2 network verdict, incl. `confidence` and `action.route` | ✅ live in sandbox |
| **Kite** | Agent Passport: account allowance, spending sessions, idempotent x402 execute | Payments via `kpass session execute` with an idempotency key; a passkey-approved session capped at exactly one payment for every step-up; held and pending outcomes handled without paying twice | 🟡 built to Kite's published CLI reference (kpass ≥ 6.8.9), tested against a simulated kpass; not yet run with a real account |
| | Service directory (`ksearch service search`) | Unlisted new payees get network review | 🟡 same |
| | Agent integration (Passport skills, MCP) | Tripwire ships as an MCP server: any agent pays through `tripwire_pay` | ✅ tested with an MCP client |

See [Integration status](#integration-status) for the evidence behind each line.

## Integration status

| Sponsor | Status | Evidence |
|---|---|---|
| **SERV Reasoning** | ✅ **Verified live** | `gpt-5.4-mini` with a strict `json_schema`, PromptGuard and Shadow Agent. It passed purchases matching the task, escalated vendor text trying to change payment details, and blocked an off-task gift-card purchase. PromptGuard fired live on the demo's injected invoice. The policy compiler also runs live. About $0.0008 and 6–18 s per check. |
| **Reppo** | ✅ **Verified live in sandbox** | `POST /api/v1/x402/evals/lite` with `Sandbox: true`. The full stage demo runs against it (`REPPO_SANDBOX=true npm run demo`), at about 4 s per evaluation. The response shape (`result.verdict`, `verdicts[]`, `action.route`) is parsed and tested. Paid verdicts need a credit token. |
| **Kite** | 🟡 **Built to Kite's published reference, not yet run with a real account** | Follows the command reference in Kite's official [passport-skills](https://github.com/gokite-ai/passport-skills) (kpass 6.8.9+): `session execute` with `--idempotency-key` and `--use-allowance` / `--session-id`; `session create --separate` + `session status --wait` for step-ups; `session updates` for held payments; `ksearch service search` for the directory. The JSON envelopes and exit codes (success, `human_action_required`, exit 3 rejected/expired, exit 6 policy, exit 7 pending/held, exit 1 bridge failures) are handled and tested against a simulated kpass, and the full live server flow runs end to end against it. What still needs a real account: one $0.01 payment, to confirm the live replies match the reference. |

## Project layout

```text
tripwire/
├── src/
│   ├── server.ts            HTTP API, server-sent events, static pages, startup safety checks
│   ├── engine.ts            the ladder: routing, escalation, step-up, payment, fail-closed errors
│   ├── tiers/
│   │   ├── tier0.ts         deterministic rules
│   │   ├── tier1Serv.ts     SERV task-match check (PromptGuard, Shadow Agent)
│   │   └── tier2Reppo.ts    Reppo verdict
│   ├── adapters/
│   │   ├── kite.ts          kpass payments, passkey step-up session, outcome handling, ksearch directory
│   │   └── x402.ts          merchant price check (x402 challenge) with private-address guard
│   ├── auth.ts              owner sign-in, agent API keys, same-origin checks, login rate limit
│   ├── policyCompiler.ts    plain-English rules → validated policy (SERV)
│   ├── calibration.ts       per-payee threshold learning
│   ├── mcp.ts               MCP server: tripwire_pay / _receipt / _policy
│   ├── replay.ts            synthetic multi-week replay (always offline)
│   ├── scenarios.ts         demo agents, stage script, synthetic traffic
│   ├── config.ts            .env loading, demo policy, policy-file validation, integration modes
│   ├── validate.ts          intent validation and payee normalization
│   └── types.ts             domain types
├── public/                  dashboard, receipt and docs pages (plain HTML/CSS/JS, no framework)
├── scripts/                 demo.ts, replay.ts, doctor.ts (read-only live setup check)
├── test/
│   ├── tripwire.test.ts     tiers, routing, calibration, adapters, live engine, auth, concurrency
│   └── hardening.test.ts    normalization, fail-closed errors, config parsing, HTTP server end to end
├── docs/                    how it works, architecture, API, deployment, development
├── .github/workflows/ci.yml type-check, tests, demo and replay on Node 24 and 25
├── policy.example.json      starting policy for live mode
├── tsconfig.json            strict type-checking (Node strips types at runtime)
├── CONTRIBUTING.md          development setup and pull request checklist
├── CHANGELOG.md             release notes
├── SECURITY.md              how to report a vulnerability
└── LICENSE                  MIT
```
