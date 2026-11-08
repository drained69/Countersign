# Security Policy

Tripwire sits in front of real payments, so security reports are welcome and taken seriously.

## Reporting a vulnerability

Please **do not open a public issue** for a vulnerability. Use GitHub's
[private vulnerability reporting](https://github.com/drained69/Tripwire/security/advisories/new)
for this repository instead. Include:

- what an attacker can do (for example, get a payment approved that should have been blocked, or read another agent's receipts);
- the steps or a request that reproduces it;
- the mode it affects (demo `KITE_MODE=mock` or live `KITE_MODE=kpass`) and the commit you tested.

You should get a reply within a few days. Fixes are released on `main` with a regression test.

## Scope

In scope: anything that lets a payment skip a check, pay more than once or more than approved, overspend the
allowance, leak keys or tokens, bypass owner sign-in or agent keys, or reach internal addresses through the price check.

Out of scope: findings that need the owner's token or the host machine, the deliberately open local demo
(no owner token, loopback only), and the limitations listed in the README's
[Limitations and roadmap](README.md#limitations-and-roadmap) section.

## Design

The threat model and the protections in place are described in the README under
[Security model](README.md#security-model) and [What protects the money](README.md#what-protects-the-money-in-live-mode).
