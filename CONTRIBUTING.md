# Contributing to Tripwire

Thanks for your interest in improving Tripwire. This guide covers the development setup and what a pull request needs.

## Development setup

1. Install [Node.js](https://nodejs.org) 23.6 or newer (`nvm use` picks the version in `.nvmrc`).
2. Clone the repository and install the development tools:

   ```bash
   git clone https://github.com/drained69/Tripwire.git
   cd Tripwire
   npm install
   ```

3. Start the dashboard with `npm start` and open http://127.0.0.1:8787.

No `.env` is needed for development: every sponsor integration falls back to a labelled offline stand-in. If you do have a `.env` with real keys, the tests ignore them.

## Project conventions

- **No runtime dependencies.** Use Node's built-in modules. Development tools go in `devDependencies`.
- **TypeScript that Node can run directly.** Node strips types at runtime, so use erasable syntax only (no `enum`, `namespace` or parameter properties) and import local files with the `.ts` extension. `tsconfig.json` enforces this.
- **Fail closed.** Any new check must escalate or block on errors, timeouts and unexpected input. It must never approve by default.
- **Never trust agent or vendor input.** Validate it, normalize it (see `normalizePayee` in `src/validate.ts`) and treat vendor text as data, never as instructions.
- **Label every external call.** A step that used a stand-in must say `mock` on the receipt, and live mode must never fall back to a stand-in.
- **Keep secrets out of public evaluations and logs.**

## Before opening a pull request

```bash
npm run check   # strict type-check, then all tests
```

- Add or update tests for behaviour you change. Tests must not call the network; use local stubs like the existing ones in `test/`.
- Update the relevant page in `docs/` and the README if you change behaviour, configuration or the API.
- Add a line to `CHANGELOG.md` under **Unreleased**.
- Keep pull requests focused on one change, and describe what changed and why.

## Reporting bugs and security issues

Open a GitHub issue for bugs, with steps to reproduce and the mode you ran in (`KITE_MODE=mock` or `kpass`).
Report security vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
