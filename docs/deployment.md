# Deployment and configuration

Running Tripwire with real Kite payments, what protects the money, and every configuration variable.

[← Back to the README](../README.md)

## Contents

- [Going live with real payments](#going-live-with-real-payments)
- [Deploying to Railway](#deploying-to-railway)
- [Configuration](#configuration)

## Going live with real payments

The demo needs nothing. Real payments need a few things only you can do (signing in to Kite, funding a wallet), and Tripwire refuses to start in live mode until the safety settings are in place.

**1. Install Kite's CLIs and sign in** (Kite's official installer; needs kpass 6.8.9 or later):

```bash
curl -fsSL https://cli.gokite.ai/install.sh | bash
```

```bash
kpass login init --email you@example.com
```

```bash
kpass login verify --login-id <id> --code <code from your email>
```

New to Kite? Use `kpass signup init --email …` instead. Then, in the Kite Passport dashboard, fund your wallet and set an **account allowance** (a weekly or monthly limit approved once with your passkey). Tripwire pays from it with `--use-allowance`. To pay from one separate session instead, set `KITE_PAY_FROM=session` and `KITE_SESSION_ID`.

**2. Write your policy.** Copy [`policy.example.json`](../policy.example.json) and list the services your agents pay. Keep Tripwire's allowance at or below Kite's: Kite enforces its own limit too. (`policy.json` is git-ignored.)

```bash
cp policy.example.json policy.json
```

**3. Set secrets in `.env`.** Generate the owner token and one key per agent:

```bash
openssl rand -hex 24
```

```bash
KITE_MODE=kpass
POLICY_FILE=policy.json
TRIPWIRE_OWNER_TOKEN=<48 hex chars>                  # dashboard sign-in
TRIPWIRE_AGENT_KEYS=ops-agent:<key>,research-agent:<key>
SERV_API_KEY=<key>                                   # without it, tier 1 hands payments to you
REPPO_API_KEY=<key from eval.reppo.xyz>              # or REPPO_CREDIT_TOKEN=x402ck_…; without one, tier 2 hands payments to you
NOTIFY_WEBHOOK_URL=https://hooks.slack.com/…         # optional: step-up alerts
PUBLIC_URL=https://tripwire.yourdomain.com           # optional: links in alerts
```

**4. Check everything.** `npm run doctor` is read-only: it never pays.

```bash
npm run doctor
```

**5. Start it, then send a $0.01 test payment** from one agent before trusting it with more.

```bash
npm start
```

To reach it from other machines, set `HOST=0.0.0.0` and put it behind HTTPS (Caddy, nginx or a tunnel). The sign-in cookie is marked `Secure` automatically when `PUBLIC_URL` is https or the proxy sends `X-Forwarded-Proto: https`.

**Give agents Tripwire, not Kite.** Tripwire only protects payments that go through it. Run kpass under the account Tripwire uses, and don't give agents their own Kite login or session. Agents call Tripwire with their API key (over MCP or HTTP).

### What protects the money in live mode

| Risk | What Tripwire does |
|---|---|
| Agent claims $1 for a call the merchant prices at $50 | Before paying, Tripwire sends the same request unpaid and reads the merchant's x402 price. A higher price is **blocked**. If the price can't be read, the payment goes to your passkey, through a session Kite caps at the requested amount. |
| Payment URL points somewhere other than the payee | The URL's host must be the payee's domain or a subdomain, or the payment is blocked. |
| Price check used to reach internal machines | Only public https addresses: every resolved IP is checked when connecting, redirects aren't followed, and responses are size- and time-limited. |
| Network blip or crash mid-payment | Each payment gets an idempotency key, saved to disk **before** money moves. Kite never charges twice for the same key. |
| Kite can't confirm the outcome (pending, held, bridge failure, timeout) | The payment shows as **Check payment** and keeps counting against the allowance. **Ask Kite again** re-sends with the same key (never a second charge) or fetches the merchant's final result; you can also mark it paid or not paid after checking Kite's Activity page. Nothing is ever retried with a new key. |
| An unexpected error inside Tripwire | Before payment, the payment is blocked. During payment, it becomes **Check payment** and stays counted, because money may have moved. |
| Agent retries a purchase | Send a `requestKey` (e.g. the invoice number). The same agent and key return the first decision. |
| SERV or Reppo not set up | In live mode an unconfigured check never falls back to a stand-in: it hands the payment to you. |
| Someone else reaches the dashboard | Owner sign-in (token, rate-limited), per-agent API keys (an agent sees only its own receipts and limits), same-site cookies, cross-site writes refused, strict Content-Security-Policy. |
| Demo data mixed with real payments | Live mode keeps its own state file (`data/live-state.json`); the scripted demo and reset are off. |

## Deploying to Railway

The repo ships a `Dockerfile` and `railway.json` (health check on `/api/health`). Run two services from the same code: a public demo anyone can open, and your private live instance. Give each a volume mounted at `/data`.

**Public demo** (no real money; anyone can use it):

| Variable | Value |
|---|---|
| `PUBLIC_DEMO` | `true` |
| `STATE_FILE` | `/data/state.json` |
| `SERV_API_KEY`, `REPPO_API_KEY` | your keys, for live verdicts |
| `REPPO_DAILY_LIMIT` | e.g. `15` (after that, the labelled stand-in) |
| `PUBLIC_RATE_LIMIT` | e.g. `40` checked payments per visitor per hour |

**Live** (real Kite payments; owner login):

| Variable | Value |
|---|---|
| `KITE_MODE` | `kpass` |
| `STATE_FILE` | `/data/live-state.json` |
| `POLICY_FILE` | `deploy/live-policy.json` (first start only; the saved policy wins after) |
| `TRIPWIRE_OWNER_TOKEN`, `TRIPWIRE_AGENT_KEYS` | as in `.env` |
| `SERV_API_KEY`, `REPPO_API_KEY` | your keys |
| `PUBLIC_URL` | the service's https URL |

The image installs `kpass` and keeps its login on the volume (`HOME=/data/home`). Log in once from a shell in the container, with the code Kite emails you:

```bash
railway ssh
kpass login init --email you@example.com
kpass login verify --login-id <id from init> --code 123456
```

Then `npm run doctor` in the same shell should end with "Ready.".

## Configuration

In the demo, every integration is optional: a tier without credentials runs an offline stand-in, and every receipt step is labelled `live` or `mock`. In live mode (`KITE_MODE=kpass`), a tier without credentials hands the payment to the owner instead.

```bash
cp .env.example .env
```

| Variable | Default | Purpose |
|---|---|---|
| `SERV_API_KEY` | — | Enables live tier 1 and the live policy compiler. |
| `SERV_MODEL` | `gpt-5.4-mini` | Base model for task matching and the policy compiler. |
| `SERV_FEATURES` | `kronos-multipath` | SERV Reasoning graph features appended to the model ID. Set it empty for plain SERV. |
| `SERV_REASONING_EFFORT` | `low` | `reasoning_effort` sent to SERV: `low`, `medium` or `high`. |
| `SERV_BASE_URL` | `https://inference-api.openserv.ai` | SERV endpoint. |
| `SERV_PRICE_IN` / `SERV_PRICE_OUT` | `0.75` / `4.5` | USD per million tokens, for receipt costs. |
| `REPPO_API_KEY` | — | API key from eval.reppo.xyz (sign in, **API Key**, **Generate**). New accounts get free credits; 440 per evaluation. Takes precedence over a credit token. |
| `REPPO_CREDIT_TOKEN` | — | Credit token (`x402ck_…`) from buying credits with USDC on Base over x402 (minimum $1; 2,000 credits per USDC). |
| `REPPO_BASE_URL` | `https://eval.reppo.xyz` | Reppo endpoint. |
| `KITE_MODE` | `mock` | `kpass` for real payments and passkey step-ups. Requires kpass 6.8.9+, installed and logged in. See [Going live](#going-live-with-real-payments). |
| `KITE_PAY_FROM` / `KITE_SESSION_ID` | `allowance` / — | Pay from the Kite account allowance, or from one named session (`session` + its id). |
| `TRIPWIRE_OWNER_TOKEN` | — | Turns on the dashboard sign-in (24+ characters). **Required** in live mode or when `HOST` isn't loopback. |
| `TRIPWIRE_AGENT_KEYS` | — | `agentId:key,agentId:key` (24+ characters each). **Required** in live mode. |
| `POLICY_FILE` | — | Your starting policy (see `policy.example.json`). **Required** for the first live start; after that, rules applied on the dashboard are saved and win. Ignored by the scripted demo, which always uses the demo policy. |
| `NOTIFY_WEBHOOK_URL` | — | POSTs `{ text, receiptUrl, approvalUrl, … }` when a payment needs you (works with Slack incoming webhooks). |
| `PUBLIC_URL` | `http://HOST:PORT` | Base URL for links in notifications. |
| `COOKIE_SECURE` | auto | Force the `Secure` cookie flag (on automatically for https). |
| `PORT` / `HOST` | `8787` / `127.0.0.1` | Where the server listens. |
| `STATE_FILE` | `data/state.json`, live: `data/live-state.json` | Where receipts, calibration and applied rules are saved (atomic writes, mode 600). |
| `PUBLIC_DEMO` | — | `true` opens the demo dashboard to anyone (refused with `KITE_MODE=kpass`). Calls that spend SERV or Reppo credit are rate-limited per visitor. |
| `PUBLIC_RATE_LIMIT` | `40` | Public demo: checked payments and policy compiles per visitor address per hour. |
| `TRUST_PROXY` | — | `true` behind a proxy (Railway sets it in the image): rate limits use `X-Real-IP` / `X-Forwarded-For`. |
| `REPPO_DAILY_LIMIT` | — | Most live Reppo evaluations per UTC day. Over it, the demo uses the labelled stand-in and live mode hands the payment to you. |
| `TRIPWIRE_URL` / `TRIPWIRE_AGENT_KEY` | `http://127.0.0.1:8787` / — | For the MCP server: which Tripwire server to forward to, and as which agent. |

`.env` is git-ignored, and real environment variables take precedence over it. It accepts `KEY=value`, `export KEY=value`, quoted values and trailing `# comments`.

The demo policy is in `src/config.ts`: a $100 allowance, a $75 per-payment cap, $1 and $20 thresholds, a 60-minute duplicate window, four known payees and one deny-listed payee. A policy can also set `resetPeriod` (`never`, `weekly` or `monthly`, UTC) so the allowance starts over like Kite's.
