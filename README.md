# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Maftuuh1922/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Maftuuh1922/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

LANTERN is an offline token launch radar that ranks all safe pre-token records with a train-selected market-cap-equivalent model, auditable farm plans and separate live-token benchmarks.

## Run it

Requires Node 22 or newer. No runtime dependencies or network access.

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

Open `out/dashboard/index.html` in a browser. Keep the adjacent `data.js` and `assets/` directory together with the dashboard. The prepared offline release includes its snapshot-derived data.

## Research workspace

- Interactive valuation atlas: filter protocols, then inspect a `+` marker or a row. Traded-token anchors use recorded market caps; candidates use model equivalents.
- ASCII comparisons and bear/base/bull scenarios, with finite reveal animations and reduced-motion support.
- Production ranking now uses a model selected by inner cross-validation. The audit compares the entire selection procedure against the legacy model using outer held-out folds. Seeded refits expose conditional rank stability; empirical residual bands expose valuation error.
- Decision lab: editable fees, time, opportunity cost, hypothetical payout/probability, principal-loss stress and cash budget. Save a scenario per protocol or export its evidence. Rewards default to zero; assumptions are separate from snapshot facts.
- Search, chain/sector/coverage filters, shortlist comparison, pagination and complete protocol briefs remain offline.

## Verification

```sh
RADAR_TEST_INPUT=/path/to/snapshot.json node --test tests/model.test.js tests/validation.test.js tests/advanced.test.js tests/decision.test.js
node tests/verify.ts /path/to/first-output /path/to/second-output
```

The audit is exploratory nested cross-validation on a previously inspected snapshot, not an untouched holdout, temporal forecast or payout proof. Final inner CV selects OLS for this snapshot. Conditional OLS refits can keep ranks fixed despite large value errors; narrow rank ranges do not mean accurate prices. See `docs/REFERENCE.md` for the public reference scope and asset provenance.

This research-interface revision has not been submitted to make.fun. The badges above can describe an earlier accepted entry, not the local revision.

---

<sub>Entered on [make.fun](https://make.fun/?ref=4h9r2yk2&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
