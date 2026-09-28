# CopySight × Soneium

Proof of Creation & IP Validation, recorded on-chain via Soneium's built-in Ethereum Attestation Service (EAS). CopySight analyzes a file for copyright/IP matches; this module writes a permanent, independently-verifiable record of that analysis — a hash of the asset, a hash of the analysis, a copy score, and a hash of the model version — signed by an authorized attester and enforced by a purpose-built resolver contract.

Currently targets Soneium's public testnet (Minato); Mainnet config exists but nothing is wired to touch it automatically.

## Docs

- **[docs/SETUP.md](docs/SETUP.md)** — the living status log: what's built, what's tested, what's blocked, and why. Start here for the full picture.
- **[docs/project-brief.md](docs/project-brief.md)** — the original engagement brief this was scoped from.
- `docs/client-answers.md`, `docs/*.pdf` — planning material and client Q&A from earlier in the engagement.
- `docs/api-reference.html`, `docs/copysight-api-docs.html` — CopySight's own API docs, for reference by the demo harness.

## Setup

```
npm install
cp .env.example .env   # fill in the values you have
```

## Scripts

| Command | What it does |
|---|---|
| `npm run verify:setup` | Sanity-checks the Minato connection — chain ID, contract bytecode present, config completeness. |
| `npm run deploy:resolver` | One-time: deploys `CopySightResolver.sol`. Needs a funded wallet. |
| `npm run register:schema` | One-time: registers the CopySight schema, wired to the deployed resolver. Irreversible — needs a funded wallet. |
| `npm run manage:attester` | Authorize/deauthorize a signer address on the deployed resolver. |
| `npm run migrate:db` | Applies the Postgres schema for `PostgresBlockchainProofStore`. |
| `npm run demo:flow` | Runs real sample media through CopySight's live API and builds the on-chain payload — stops short of submitting it. |
| `npm test` | Fast unit/functional suite — no external dependencies. |
| `npm run test:devnet` | Real, unmocked integration test against a disposable local blockchain (needs `anvil`/`forge`). |
| `npm run test:postgres` | Real, unmocked integration test against a disposable local Postgres (needs a `docker` daemon). |

## Layout

```
contracts/    CopySightResolver.sol + its Foundry tests
src/          the production module — core logic, blockchain adapter, services
scripts/      operational CLI tools (deploy, register, rotate keys, migrate)
demo/         real-API demo harness — not part of the production module
test/         unit/functional tests, plus real-infrastructure integration tests
docs/         planning docs, status log, API references
```

## Status, in brief

Code-complete and proven against a live-equivalent environment; the one remaining step to go live on Minato is a funded wallet. See `docs/SETUP.md` for the full story, current test counts, and open items.
