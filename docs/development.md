# Development

Local development, type-checking, CI, test coverage, and known limitations.

[← Back to the README](../README.md)

## Contents

- [Development and testing](#development-and-testing)
- [Limitations and roadmap](#limitations-and-roadmap)

## Development and testing

```bash
npm install          # dev-only: TypeScript and Node type definitions
npm run check        # strict type-check, then all tests
```

- **Runtime:** Node runs `.ts` files directly through type stripping, so sources use erasable syntax only (enforced by `erasableSyntaxOnly` in `tsconfig.json`) and import each other with `.ts` extensions.
- **Type safety:** `tsc` runs in `strict` mode with `noEmit`; it checks `src/`, `scripts/` and `test/`.
- **CI:** [GitHub Actions](../.github/workflows/ci.yml) runs the type-check, the tests, the stage demo and the replay on Node 24 and 25 for every push and pull request.
- **No network in tests:** sponsor APIs are replaced by local stubs, and the Kite adapter runs against a simulated `kpass`/`ksearch` that answers with Kite's documented JSON and exit codes.

The 41 tests cover:

- lookalike and injection detection;
- tier-0 blocks, duplicates and routing thresholds;
- calibration rules, and the feedback loop: a reported payment makes the owner approve that payee and tightens the agent, Reppo's track record is updated, and learning fades after 30 days;
- SERV output validation, the fence around vendor text, and a PromptGuard refusal escalating (against a local stub that also checks PromptGuard, Shadow Agent, the Multipath + Kronos model ID and reasoning effort are sent, and that SERV's request id is kept);
- Reppo's current API against a local stub: an `action` evaluation submitted, polled to `COMPLETED`, routes mapped to proceed / owner / block, the API-key and credit-token routes, and `FAILED` or out-of-credit results going to the owner uncharged;
- fail-closed behaviour when sponsor APIs are unreachable, and when Tripwire itself hits an unexpected error before or during payment;
- the scripted demo outcomes and the replay invariant: calibration reduces interruptions without missing a bad payment;
- intent validation: x402 headers and body, non-object bodies, absurd amounts, and payee normalization against the deny list;
- split payments and allowance reserved by payments still being checked;
- the Kite directory check, including whole-name host matching;
- the policy compiler: valid proposals, out-of-bounds values rejected, unsupported sentences surfaced, no sentence dropped silently, and rules enforced at tier 0;
- the Kite adapter: exact commands and flags, the capped step-up session, payment from the allowance or a session, every outcome (paid, pending, held, policy refusal, bridge failure, provider outage, timeout, garbage output), transaction hashes and rechecks read from Kite's activity log, rechecks that reuse the idempotency key, and a declined step-up;
- the live engine: unconfirmed price forcing the passkey, unknown outcomes staying counted until resolved, no payment recorded without a URL, unconfigured checks handing payments to the owner;
- the price check: x402 v1/v2 challenges (pricing only the chains Kite can pay on, as a real merchant listing 17 options showed was needed), private and loopback addresses refused, URL-to-payee matching, overpriced merchants blocked;
- sign-in and agent keys, cross-site writes, DNS rebinding against the open demo, the login rate limit, and weekly/monthly allowance periods;
- payments arriving at the same moment: each sees the other, so simultaneous retries can't both pay;
- `.env` parsing (quotes, `export`, comments);
- the real HTTP server, started on a spare port with its own state file: health, bad bodies refused with `400`, a deny-listed payee blocked over HTTP, an approved payment and its idempotent retry, Content-Security-Policy headers, path traversal refused, and demo reset.

## Limitations and roadmap

- **Kite step-up with a real passkey.** A real payment has gone through Kite ($0.001 on Base, tx `0xdba0dc85…`), but the passkey step-up has only run against a simulated kpass. kpass 6.13.1 lacks the `session updates` command Kite's docs describe, so held payments are rechecked from `kpass activity`.
- **Merchant price formats.** x402 challenges are parsed from the standard `accepts` list and common price fields. A merchant that hides its price another way gets the passkey step-up, never a blind payment.
- **Latency.** SERV adds 6–18 s per check. Next: cache verdicts for repeat (payee, purpose) pairs and pre-check recurring payments.
- **Reppo needs a key or credits.** The sandbox and the instant endpoint were retired; panel evaluations take 30–90 s. A free API key covers the first evaluations.
- **One owner per deployment.** Each Tripwire server protects one Kite account and one policy, with state in a JSON file. Teams run one per account. Next: multiple owners, roles and a database.
- **Agents must not hold Kite credentials.** Tripwire can't stop an agent that also has its own kpass login; give agents only their Tripwire key.
- **Heuristics.** Lookalike and injection detection are a first filter, with SERV and Reppo as the backstop.
- **PromptGuard is inconsistent**: in the live benchmark it raised false alarms on 2–3 of 10 harmless payments per setting, and the Shadow Agent reports no result in the response, so neither is relied on alone. A false alarm costs an owner interruption, never money.
- **Directory matching** is by the payee's domain; a vendor listed under another domain looks unlisted, which means extra review, never less.
- **Agent purchase rules** match keywords. A rule that's too narrow sends legitimate purchases to review; it never lets one through.
