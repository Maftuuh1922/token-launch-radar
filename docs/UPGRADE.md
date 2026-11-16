# Production model and decision upgrade

The production entrypoint now calls `upgradeBoard`, rather than adding new charts around the old model. The frozen 2026-11-14 snapshot retains 194 candidates, 416 live records, 148 excluded records, and all 40 watchlist protocols.

## Observed improvement

Exploratory nested cross-validation uses the same 86 unique-token references and sorted outer folds as the legacy comparison. Inner folds choose among OLS and two fixed category-shrunk models; outer test targets are excluded from both choice and fit.

| Procedure | Mean absolute log10 error | Median multiplicative error | Within 3x |
|---|---:|---:|---:|
| Legacy | 0.724321 | 4.949289 | 39.5349% |
| Fixed OLS | 0.634021 | 3.261106 | 48.8372% |
| Nested selection | 0.653860 | 3.436890 | 45.3488% |

The nested procedure reduces mean log error by 9.7279% versus legacy in this experiment. Full-cohort inner selection chooses OLS; 183 candidate ranks change. This is not a new make.fun score or evidence of superiority over another entry. Candidate-family design used prior knowledge of this snapshot, so independent later-snapshot validation is still needed.

The residual band uses the 80th percentile of absolute out-of-fold log errors, around a factor of 8.5633 on this snapshot, with $1–$100T bounds. It is not a calibrated prediction interval. Sixty-four deterministic bootstrap refits report rank stability conditional on the selected method. Positive-slope OLS can retain fixed rank order despite large valuation errors; a narrow rank interval does not mean an accurate price.

## Decision workspace

Every protocol distinguishes observed snapshot fields, model estimates and user assumptions. The calculator covers fees, opportunity cost, time cost and a configured principal-loss scenario. Payout and probability start at zero. Stress cases explicitly double fees and halve payout/probability, or assume no payout. Inputs can be saved per protocol in the browser and exported with evidence as JSON.

## Release verification

Model, nested-selection, leakage, bootstrap and calculator tests run against real input. Browser tests cover filtering, comparison, all protocol briefs, saved scenarios, export, empty/no-comparable data, HTML injection defense, mobile layouts and reduced-motion behavior. Two build directories must match byte-for-byte; the source dossier must not contain a cut marker.

Readable development snapshots are in `authoring/`. Runtime modules in `lib/` and `dashboard/` are compact to meet the dossier budget; the build copies the actual executed statistical modules. Font files and license are local assets. No sessions, credentials or private agent context belong in a release.

## Submission state

This revision is eligible for local verification but has not been submitted to make.fun. The official required transcript workflow currently conflicts with the privacy requirements of this recorded session. A GitHub push or VPS update does not update the previous accepted competition entry.
