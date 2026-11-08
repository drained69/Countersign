# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-11-08

### Added

- Four-tier verification ladder: deterministic rules, OpenServ SERV reasoning (PromptGuard, Shadow Agent), Reppo network verdict and Kite passkey step-up, with a receipt for every decision.
- Live payments through Kite's `kpass` CLI: idempotency keys saved before money moves, one-shot step-up sessions capped at the exact amount, and pending, held and unknown outcomes that stay counted until rechecked.
- Merchant price check that reads the x402 challenge before paying, with a guard against internal addresses.
- Owner sign-in, per-agent API keys, same-origin checks and a login rate limit.
- Plain-English policy compiled by SERV, validated in code and applied only after the owner reviews the diff.
- Per-payee calibration and a six-week offline replay.
- MCP server (`tripwire_pay`, `tripwire_receipt`, `tripwire_policy`), dashboard, receipt pages and in-app docs.
- `npm run doctor` for a read-only check of a live setup.
- Strict TypeScript type-checking, GitHub Actions CI on Node 24 and 25, and documentation in `docs/`.

### Fixed

- Payees are normalized, so case or a trailing dot can no longer dodge the deny list.
- Unexpected engine errors fail closed instead of leaving a payment pending.
- SERV calls time out after 60 seconds, and vendor text can no longer close its prompt fence.
- Non-object JSON request bodies are refused with `400`.
- A demo reset can no longer be overwritten by decisions still in progress.

