# Verification record — Tracegrade 0.3

Recorded on 2 November 2026. Current checks cover the six-example workspace, cross-service trace mappings, recorded stream events, and the shared evaluation engine. The v0.2 and earlier records are retained in explicitly labeled sections below; their browser and CLI checks are not presented as newly reexecuted checks.

This record does not claim a live provider connection, model execution, organizational authentication, or unattended scheduling.

## Current automated checks

The full `npm test` command passed **123 tests** on Node 24.22.1. It runs `node --test --test-isolation=none src/*.test.js`.

| Suite | Result | Coverage |
|---|---|---|
| Domain engine | 39 passed | Dataset validation, deterministic and recorded scoring, missing evidence, immutable snapshots, gates/reviews, exact normalization provenance, isolated synthetic cohorts, and retained span/event evidence |
| Scorer catalog | 17 passed | Scopes, editable drafts, immutable exact releases, adoption, collision/deprecation rules, observed numeric discovery, and catalog import/merge contracts |
| YAML compiler | 27 passed | Strict diagnostics, catalog/profile/version pins, scenario filters, round trips, date and size limits, and public-schema parity |
| Canonical workspace state | 8 passed | YAML authority, comments, form regeneration, migration, explicit empty catalogs, and preserved historical snapshots |
| Trace profiles | 20 passed | Root/span/event/service selection, conflicting or missing resource identity, structured content, cost units, recorded judgments, timing safety, and normalization lineage |
| Team scenarios | 12 passed | Six deterministic isolated scenarios, original outcomes, new handoff/retrieval/streaming cases, portable exports, and complete catalog dependencies |
| Total | **123 passed** | Complete current automated suite |

`npm run build` passed: Vite transformed **1,691 modules** and produced **991.80 kB of JavaScript** and **103.58 kB of CSS** before compression. The single-bundle size advisory is expected for the portable HTML packaging approach.

All six exported evaluation configurations compile against the supplied **16-entry catalog**. During regeneration, the original nine fixture/configuration/profile export files were checked and remained byte-for-byte unchanged.

## Current v0.3 browser checks

These checks used the managed local preview at **1363 × 936** on desktop.

| Scenario and starting perspective | Observed route and result |
|---|---|
| Service desk handoff — Product owner | Opened the report: failed gate, 66.7% trace pass rate, one critical failure, and one pending review |
| Retrieval freshness — Annotator | Opened the review queue with two cases; knowledge-index supplied the selected evidence, one age was missing, and one source was 72 hours old |
| Streaming completion — Engineering | Opened Dataset with three selected traces isolated from nine imported traces; the subsequent report remained blocked at 33.3%, with one unscored case and two pending reviews |

### Mapping, recorded events, and annotation persistence

- Handoff: Mapping selected **access-specialist** for the final response. The inspector exposed the expanded span attributes and instrumentation scope.
- Retrieval: the selected source was **knowledge-index**; the missing age remained unscored and the stale measurement was **72 hours**. Saving a rejection with rationale reduced pending review from **2 to 1**, while the release stayed blocked. Reopening the example preserved that annotation on `RUN-007`.
- Interrupted streaming: the final output displayed **Not recorded**. The `stream-gateway` span had **Unknown** status, an explicit **510 ms** first-token measurement, and **two `stream.chunk` events** with exact nanosecond timestamps.
- Completed streaming: another trace retained two chunk events plus `stream.completed`, with its final text and completion receipt of **1**.
- Stable reload: after reloading at **15:27:43 UTC**, the streaming report still showed a blocked gate, **33.3%** trace pass rate, **one unscored case**, and **two pending reviews**.

### Search, perspective controls, and desktop layout

- Search, the global persona selector, per-card role overrides, and clearing an empty search result were exercised successfully. A per-card Engineering override survived the no-results search and Clear search flow.
- A single filtered card used the corrected **full-width, two-column desktop layout** and was visually checked.
- After the stable reload, the console contained only Chrome extension metadata errors; **no application errors were observed** in that stable session.
- Agent-created QA data was reset through the workspace UI after the checks.

No mobile checks were performed for v0.3. The earlier restriction on opening portable HTML through a `file:` URL was not retried.

## Current v0.3 packaged CLI checks

The three new packaged configurations were executed with their raw OTLP fixtures and supplied `scorers.yml`. Each generated `report.html`, `results.csv`, and `run.json` under `/tmp/tracegrade-v03-cli`.

| Example | Traces | Gate | Trace pass rate | Critical / unscored | Pending review | Exit |
|---|---|---|---|---|---|---|
| Service desk handoff | 3 | Failed | 66.7% | 1 / 0 | 1 | 1 |
| Retrieval freshness | 3 | Blocked | 33.3% | 0 / 1 | 2 | 1 |
| Streaming completion | 3 | Blocked | 33.3% | 0 / 1 | 2 | 1 |

The diagnostic weighted scores were **77.8**, **91.7**, and **89.7**, respectively. These remain separate from the trace pass rates used for the release gate. Exit 1 is intentional for these failing or incomplete examples.

All three runs retained `synthetic: true`, `demo: false`, the exact scenario filter, the selected profile at `1.0.0`, frozen scorer pins, and field-level mapping lineage. Handoff selected **access-specialist**, retrieval selected **knowledge-index**, and streaming selected **stream-gateway**. The interrupted stream retained its two chunk events and blank final output, with no fabricated completion event or receipt. HTML reports included the synthetic notice and escaped normalization evidence.

No additional negative-path CLI checks were run in this pass. The original three examples' packaged CLI results remain recorded in the prior v0.2 section below.

## Prior v0.2 automated checks

At v0.2, the full `npm test` command passed **109 tests** using the same Node version and command. This earlier result is retained for regression history.

| Suite | Result | Coverage |
|---|---|---|
| Domain engine | 36 passed | Dataset validation, deterministic and recorded scoring, missing evidence, frozen snapshots, release gates, annotations, OTLP import, exact normalization provenance, and synthetic cohort filters |
| Scorer catalog | 17 passed | Scope applicability, editable drafts, immutable exact versions, forks/collisions, deprecation, numeric discovery, custom judgments, manifest round trips, and merge conflicts |
| YAML compiler | 27 passed | Strict schema and source diagnostics, catalog references, profile/version pins, scenario filters, inline compatibility, round trips, dates, size limits, and public-schema parity |
| Canonical workspace state | 8 passed | Saved YAML authority, comment preservation, form regeneration, conservative migration, explicit empty catalogs, and unchanged historical snapshots |
| Trace profiles | 13 passed | Exact root/span/event selection, structured messages, duplicate/ambiguous sources, cost units, judgment provenance, unknown tool outcomes, safe timing, and instrumentation lineage |
| Team scenarios | 8 passed | Deterministic synthetic fixtures, isolated cohorts, expected gates/review queues, final-answer event selection, catalog additions, and report lineage |
| Total | **109 passed** | Complete v0.2 automated suite |

The v0.2 production build passed with **1,691 modules**, approximately **962 kB of JavaScript**, and **99 kB of CSS** before compression, with the expected bundle-size advisory.

## Prior v0.2 browser interaction checks

These checks used the managed local preview and exercised the v0.2 interface before the three additional scenarios were added.

### Catalog and explicit version adoption

- Fresh seed: the selected evaluation context was `customer-support` / `support-agent`. The Agent scope with availability filtering showed one available scorer.
- Discovery: five numeric attributes were shown for the actual 40-trace selected cohort.
- Builder: created `agent/support-agent/output-token-budget` from `gen_ai.usage.output_tokens`, using a threshold of 180; saved the draft, published `1.0.0`, and adopted it into the evaluation.
- Versioning: published `1.1.0` with a default threshold of 160. The evaluation YAML retained its explicit `1.0.0` pin and threshold of 180.
- Draft execution: evaluated 40 traces with six metrics. The custom metric's observed mean was **146.60**, its target remained **180**, and the actual trace pass rate was **57.5%**. The mean and pass rate were displayed as separate quantities.

### Examples, mapping evidence, and review

All three examples loaded through the expected routes with calculated results:

| Example | Selected traces | Initial release gate | Initial pending review |
|---|---|---|---|
| Support release with a policy gap | 4 | Failed | 1 |
| Checkout flow with incomplete telemetry | 4 | Blocked | 3 |
| Document answer that needs evidence | 3 | Blocked | 2 |

- Checkout evidence: the trace inspector showed the cents-to-USD conversion, an **Unknown** tool-outcome badge, and expandable attributes.
- Document evidence: Mapping showed the exact final-answer event and its source span, preserving the distinction from intermediate retrieval output.
- Review persistence: rejected the unsupported-citation case and accepted the missing-judgment case, each with a rationale. Pending review fell from **2 to 0**. The release remained **blocked**, with one critical failure and one unscored judgment still visible.
- Reopening: opening the same document example retained the annotations and the installed run, `RUN-008`.
- Focus: scenario navigation moved focus to the main content region.
- Cleanup: reset the agent-created QA data through the workspace UI. A final desktop screenshot recorded the fresh Examples screen.

Desktop captures were inspected and appeared clean and readable. The final console check found no application errors after the stable reload at **15:06 UTC**. Older HMR/import-boundary errors from development, including entries around 14:xx and 15:04, and browser-extension metadata errors remain in the log; they are not described as a clean historical console.

## Prior v0.2 packaged CLI verification

The three v0.2 packaged examples were executed from fresh canonical evaluation YAML, raw OTLP fixtures, and the supplied `scorers.yml`. All three produced `report.html`, `results.csv`, and `run.json`.

| Example | Traces | Gate | Trace pass rate | Critical / unscored | Pending review | Exit |
|---|---|---|---|---|---|---|
| Support release | 4 | Failed | 75% | 1 / 0 | 1 | 1 |
| Checkout reliability | 4 | Blocked | 25% | 0 / 2 | 3 | 1 |
| Document review | 3 | Blocked | 33.3% | 1 / 1 | 2 | 1 |

Exit 1 is the intended result for these failing or incomplete examples. Each run recorded `synthetic: true` and `demo: false`, its exact scenario filter, its mapping profile at `1.0.0`, frozen scorer pins, and per-field mapping metadata. HTML reports included the synthetic-evidence notice and escaped normalization lineage.

The checkout output preserved the explicit conversions **1 cent → $0.01** and **2 cents → $0.02**; absent cost and the UNSET tool outcome remained null/unscored. Document output came from the named final-answer event and did not borrow intermediate retrieval output. No additional negative-path CLI tests were run in this final pass; earlier smoke checks are listed separately below. The CLI performs one explicit evaluation, and trigger configuration does not start a scheduler.

## Earlier base-workflow browser regression evidence

The following checks were completed for the earlier YAML/base workflow. They are historical evidence; v0.3 browser reexecution of every item is not claimed.

- Saved evaluation: ran 40 sample traces and inspected the scorecard, report, and trace evidence. Weighted scorer pass score was 93.8/100; trace pass rate was 80%; the release gate failed.
- Annotation: saved an accepted verdict with rationale. Pending review decreased from 12 to 11 without overriding the automatic failure.
- Versioning: saved form edits as a new specification version; an earlier run continued to display its earlier version.
- Import: used the file chooser to add two normalized JSON fixture traces as imported evidence.
- YAML execution: reproduced the saved 40-trace support result in the playground without appending to saved history.
- Syntax failure: an unterminated YAML sequence produced a line 2, column 1 diagnostic; Run draft and Save were disabled, and previous results were marked stale.
- Changed configuration: an eight-trace, latency-only configuration with a four-trace minimum, ten-second threshold, and no review sampling produced a passed gate with 100% trace pass rate.
- Canonical saving: saved that draft and reloaded. The new version and source comment survived, and Dataset showed the configured sample size, minimum, and required evidence.
- Draft isolation: persistent run count stayed at six after draft evaluation: five seeded runs and the earlier saved-run check.
- Cleanup: workspace reset removed the test edits and restored the initial seed used for subsequent catalog checks.

Earlier browser download instrumentation timed out after a report download click. HTML/CSV/JSON contents were verified through tests and CLI execution; browser file-arrival confirmation is not claimed. YAML import/export, schema export, and editor shortcuts are implemented, but not every browser/file-system combination was exercised.

## Earlier base-workflow CLI regression evidence

| Configuration and evidence | Previously observed outcome | Exit status |
|---|---|---|
| Included support evaluation.yml with demo traces | 40 traces, score 93.8, pass rate 80%, failed gate, 12 reviews | 1 |
| Imported two-trace fixture with latency-only config | Two traces, 100% pass rate, passed gate | 0 |
| Same imported fixture with minimum of three | Blocked by insufficient evidence | 1 |
| Invalid YAML sequence | Line/column syntax diagnostic | 2 |

Those executed evaluations produced all three report formats and retained their exact YAML source. They are prior smoke checks, separate from the current full automated suite.

## Visual and responsive coverage

The current examples, trace inspector, and review workflow received desktop visual inspection at 1363 × 936, including the corrected single-result layout. The catalog's earlier desktop review is recorded under v0.2. **No v0.3 mobile inspection was performed; the catalog and examples screens do not have claimed mobile browser coverage.**

The earlier playground review compared a rendered 1363 × 936 desktop capture with the 1536 × 1024 concept. It verified the white/teal palette, shell, monospaced editor, 59/41 split, fixed editor footer, and independently scrolling panels. That comparison used different viewport sizes and was not a pixel-level match.

The earlier base workflow was also viewed in a 390px frame: editor/results stacked, and document width and scroll width both measured 375px, indicating no page horizontal overflow for that checked screen. This does not establish mobile coverage for the subsequently added catalog or examples.

## Delivery and integration boundaries

The portable build is designed to embed one module script and one stylesheet without external script/style dependencies. An earlier attempt to open the downloaded HTML was blocked because the cloud browser disallows `file:` navigation. That check was not retried for v0.3; recorded application interactions used the managed local preview.

Live provider APIs, model-judge services, backend REST orchestration, collaboration/authentication, and scheduled workers remain outside this prototype. Hosting is a separate action and has not been deployed.

The requested source repository is `rahult/annotation-pipeline`, created by the owner as a private repository. This record covers the local implementation and verification; the remote branch and commit are checked separately when the source is uploaded. Publishing source to GitHub does not deploy the application or connect a production trace provider.
