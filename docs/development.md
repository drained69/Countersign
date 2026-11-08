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

The 38 tests cover:

- lookalike and injection detection;
- tier-0 blocks, duplicates and routing thresholds;
- calibration rules;
- SERV output validation, the fence around vendor text, and a PromptGuard refusal escalating (against a local stub that also checks PromptGuard and Shadow Agent are sent);
- the Reppo response shape (including the real sandbox payload) and the verdict-to-outcome mapping;
- fail-closed behaviour when sponsor APIs are unreachable, and when Tripwire itself hits an unexpected error before or during payment;
- the scripted demo outcomes and the replay invariant: calibration reduces interruptions without missing a bad payment;
- intent validation: x402 headers and body, non-object bodies, absurd amounts, and payee normalization against the deny list;
- split payments and allowance reserved by payments still being checked;
- the Kite directory check, including whole-name host matching;
- the policy compiler: valid proposals, out-of-bounds values rejected, unsupported sentences surfaced, no sentence dropped silently, and rules enforced at tier 0;
- the Kite adapter: exact commands and flags, the capped step-up session, payment from the allowance or a session, and every outcome (paid, pending, held, policy refusal, bridge failure, provider outage, timeout, garbage output), rechecks that reuse the idempotency key, and a declined step-up;
- the live engine: unconfirmed price forcing the passkey, unknown outcomes staying counted until resolved, no payment recorded without a URL, unconfigured checks handing payments to the owner;
- the price check: x402 v1/v2 challenges, private and loopback addresses refused, URL-to-payee matching, overpriced merchants blocked;
- sign-in and agent keys, cross-site writes, DNS rebinding against the open demo, the login rate limit, and weekly/monthly allowance periods;
- payments arriving at the same moment: each sees the other, so simultaneous retries can't both pay;
- `.env` parsing (quotes, `export`, comments);
- the real HTTP server, started on a spare port with its own state file: health, bad bodies refused with `400`, a deny-listed payee blocked over HTTP, an approved payment and its idempotent retry, Content-Security-Policy headers, path traversal refused, and demo reset.

## Limitations and roadmap

- **Kite with a real account.** The adapter follows Kite's published CLI reference and is tested against a simulator, but hasn't moved real money yet. Do a $0.01 payment first (see [Going live](deployment.md#going-live-with-real-payments)); `npm run doctor` checks the setup without paying.
- **Merchant price formats.** x402 challenges are parsed from the standard `accepts` list and common price fields. A merchant that hides its price another way gets the passkey step-up, never a blind payment.
- **Latency.** SERV adds 6–18 s per check. Next: cache verdicts for repeat (payee, purpose) pairs and pre-check recurring payments.
- **Reppo sandbox** always answers "revise", so in sandbox every tier-2 payment reaches the owner. Paid credits give real verdicts.
- **One owner per deployment.** Each Tripwire server protects one Kite account and one policy, with state in a JSON file. Teams run one per account. Next: multiple owners, roles and a database.
- **Agents must not hold Kite credentials.** Tripwire can't stop an agent that also has its own kpass login; give agents only their Tripwire key.
- **Heuristics.** Lookalike and injection detection are a first filter, with SERV and Reppo as the backstop.
- **PromptGuard is inconsistent** (about a third of identical attempts), and the Shadow Agent reports no result in the response, so neither is relied on alone.
- **Directory matching** is by the payee's domain; a vendor listed under another domain looks unlisted, which means extra review, never less.
- **Agent purchase rules** match keywords. A rule that's too narrow sends legitimate purchases to review; it never lets one through.
