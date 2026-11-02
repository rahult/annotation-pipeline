# Architecture and production increment

## System boundary

Tracegrade 0.3 evaluates agent evidence stored by an existing observability platform. The implemented system is a static React application, a local scorer catalog, a strict YAML compiler, a pure JavaScript evaluation engine, and a one-shot Node CLI. It has no shared registry service, application API server, live model integration, background scheduler, or shared database. The production design below is a proposed extension.

## Source of truth and module ownership

| Module | Responsibility |
|---|---|
| `src/catalog.js` | Draft validation, exact-version resolution, scope applicability, publication, observed-input discovery, catalog YAML parsing/export/merge |
| `src/config.js` | Evaluation YAML shape, JSON Schema, source diagnostics, reference resolution, inline compatibility, normalized runtime projection |
| `src/configurationState.js` | Canonical saved-source boundary and conservative legacy-workspace migration |
| `src/pages/ScorerCatalog.jsx`, `src/components/ScorerBuilder.jsx` | Catalog browsing, context, discovery, drafting, inspection, fork/publication/adoption flows |
| `src/components/YamlEditor.jsx` | CodeMirror YAML editing, history, folding, line navigation, keyboard commands |
| `src/pages/Playground.jsx` | Draft text, live compilation, derived preview, isolated evaluation, schema/configuration exports |
| `src/App.jsx`, `src/store.jsx` | Workspace/catalog persistence, saved specification versions, runs, import triggers, annotation appends |
| `src/domain.js` | Trace normalization, cohort selection, evidence validation, scoring, aggregation, report exports |
| `src/traceProfiles.js` | Pinned OTLP mapping profiles, exact source selection, field transformations, and normalization provenance |
| `src/scenarios.js` | Synthetic team examples, isolated cohorts, required scorer definitions, and editable example specifications |
| `src/pages/Connections.jsx` | File import, bounded browser GET, source configuration, staged provider contracts |
| `src/components/TraceProfileSelector.jsx` | Shared exact-profile selector and source mapping guide for file/endpoint imports |
| `src/pages/Guidelines.jsx`, `Dataset.jsx`, `Pipeline.jsx` | Structured editing of the same specification and its derived pipeline |
| `src/pages/Annotations.jsx`, `Reports.jsx` | Human review, immutable run evidence, HTML/CSV/JSON reports |
| `scripts/evaluate.mjs` | Load evaluation and optional catalog YAML, then run the shared engine once |

There are two canonical configuration artifacts. **Evaluation YAML**, stored as `spec.configYaml`, owns the guidelines, context, dataset selection, exact scorer pins or inline definitions, overrides, review rules, and release intent. **Catalog YAML**, `kind: ScorerCatalog`, owns reusable scorer identities, immutable published definitions, drafts, and lifecycle metadata. The browser representation is `workspace.scorerCatalog`. Referenced definitions are not duplicated as editable inline definitions in evaluation YAML.

Normalized runtime fields are a compiled projection of evaluation YAML plus its exact catalog dependencies. The workspace owns `id`, `version`, and `updatedAt`, which are not user-controlled YAML metadata. Playground saves retain raw YAML comments; form saves serialize and recompile changes. A run freezes the exact YAML and the expanded resolved definitions and pins alongside its trace snapshot. Historical snapshots are not regenerated from a newer specification or re-resolved against a newer catalog.

`specToConfig` and `specToYaml` serialize evaluation intent. Metrics with `catalogRef` serialize as compact `{ref, version, threshold, weight, enabled, critical}` references. `compileYaml(text, baseSpec?, catalog?)` returns `{valid, errors, warnings, spec, config}`; invalid input yields null `spec` and `config`. It preserves only base identity/version/timestamp, never stale YAML or context. Reference resolution checks exact release, applicability, allowed overrides, and duplicate resolved metric IDs. Compilation does not require trace records; dataset sufficiency is a separate execution preflight.

The v1 contract covers metadata, guidelines, dataset filters/sample/required fields, scorers, review, release, execution, and report preferences. Legacy inline definitions remain compatible alongside references. Unknown fields are rejected to prevent silent intent loss. The compiler rejects aliases, duplicate mapping keys and resolved IDs, invalid types/ranges, unsupported scorers, unknown or unpublished catalog dependencies, version ranges, impossible sample requirements, and invalid or reversed date bounds. It enforces 256 KiB of UTF-8 text. `public/evaluation.schema.json` is generated from the compiler's schema; parity is tested.

## Scorer identity, applicability, and lifecycle

A catalog identity is `global/<slug>`, `domain/<target>/<slug>`, or `agent/<target>/<slug>`. Scope, target, and slug cannot change for an existing identity. Owner and tags document responsibility and support browsing; the local prototype does not verify organizational identities or implement a permission model.

Global scorers apply everywhere. Domain and agent scorers require an exact match against `metadata.domain` or `metadata.agent`. Browsing is separate from adoption. Changing a context does not change `dataset.filters.service`, and missing YAML context does not inherit stale runtime labels. These are applicability rules, not authorization: they do not control who can read trace data or publish into a shared organization.

Each entry can have an editable draft and published releases. Releases use strictly increasing numeric `X.Y.Z` versions, with publication time and a change note. Published definitions are immutable. Changing executable input mapping, rule type, phrase, judgment key, or rubric requires a new release; a draft cannot execute through a reference. Forking creates a new identity from a selected starting definition and leaves the original untouched.

Defaults specify threshold, comparison operator, weight, and critical status. Evaluations can override these and enable/disable scorers; serialized references include those overrides explicitly. Publishing a release does not upgrade any evaluation. Adoption and upgrades select an exact version, never `latest` or a range. Historical runs retain their expanded definitions even if the current catalog changes.

Deprecated entries remain visible, and existing exact pins remain executable. New catalog-UI adoption and further publication are blocked. The resolver has an explicit adoption check separate from historical resolution. A user who controls local storage or manifests can edit them; production policy enforcement requires an authenticated registry service.

The five initial global references are `global/groundedness`, `global/answer-relevance`, `global/response-latency`, `global/tool-success`, and `global/cost-per-response`, each at `1.0.0`. Scoped examples include `domain/customer-support/policy-compliance`, `domain/customer-support/escalation-language`, `domain/document-review/citation-accuracy`, and `agent/support-agent/tool-outcome-validity`. The retrieval-confidence entry starts as an unpublished draft.

## Discovery and catalog portability

Discovery inspects the selected trace cohort's own numeric attributes. It reports exact keys, numeric coverage, observed range, example values, and existing catalog usage. Finite numeric strings count as observed numeric evidence. Suggested units are hints derived from keys and ranges; the user supplies the rule and acceptance threshold.

Coverage applies only to this cohort. It does not establish measurement quality, product relevance, or production representativeness. Discovery does not search remote catalogs, query an unconnected tracing platform, guess missing scores, or synthesize a semantic evaluator. A discovered candidate still becomes an explicit draft before publication.

`catalogToYaml` exports the standalone `ScorerCatalog` manifest. `parseCatalogYaml` validates it before use. `mergeCatalog` clones the current state and rejects changed content for an already published reference/version or an incompatible local draft. Compatible additions and releases merge without updating evaluation pins, and deprecation is retained. Import is not an executable plugin mechanism.

The browser catalog-file surface caps imports at 256 KiB; the shared parser caps them at 1 MiB. The catalog allows up to 200 entries and 100 releases per entry. Export all releases needed by portable evaluation pins. The supplied `scorers.yml` contains the ten seed entries plus six scenario-specific published definitions, covering all six portable evaluations without remote dependencies.

`canonicalSpecification(spec, yamlSource?, catalog?)` applies the same compiler boundary as the playground. `canonicalWorkspace` seeds a catalog only when absent, preserving an explicitly empty catalog. Existing authored YAML remains byte-for-byte authoritative. Fresh/legacy projections without YAML gain known service context and matching global `1.0.0` pins while retaining their cohorts and overrides. Unknown services do not acquire an invented domain, and service names that are not valid scope identities are not silently normalized. Historical runs are never upgraded or re-resolved during migration.

## Drafts, saved runs, and CLI execution

The CodeMirror playground derives its five-stage preview from compiled YAML. Draft evaluation uses that projection and current selected trace evidence without changing saved run history or annotation queues. Draft text is retained locally against the base specification version; result objects remain component state. Editing the source marks previous results stale. Save and run from Evaluations to create persistent history and review work.

Saved runs clone their specification and selected dataset before scoring. The engine freezes those snapshots in memory; serialization preserves their content, but local storage is not a tamper-evident audit log. Workspace exports and reports contain trace evidence. No multi-user authorization model is implemented.

The CLI accepts the original three positional arguments and an optional catalog flag:

```bash
node scripts/evaluate.mjs evaluation.yml traces.json ./evaluation-output --catalog scorers.yml
```

Use `-` for traces when the configuration selects demo evidence. Without the flag, the bundled seed catalog is used. An explicitly supplied catalog is used as supplied, with no silent merge or remote lookup. Missing custom references or versions fail clearly. The runner executes once and writes HTML, CSV, and JSON regardless of report preference. Exit codes are 0 for passed, 1 for failed/review/blocked, and 2 for configuration/input/I/O errors. It neither executes schedules nor imports browser review decisions. The exact YAML and expanded pinned definitions are included in its run snapshot.

Optional `dataset.normalization: {profile: document-events-v1, version: 1.0.0}` selects the same exact trace importer in the browser and CLI. The compiler validates known profile identities and supported exact versions, round-trips the field, and leaves absent normalization as Auto. The CLI normalizes the raw input before evaluation; a saved mapping never reinterprets traces already present in a browser cohort.

## Team examples and versioned trace mappings

The application opens the Examples page. Six examples are loaded separately from the initial workspace; each installs synthetic OTLP fixtures, required catalog entries, a new specification, and a calculated run. Support and service-desk handoff start with a product owner's decision, checkout and streaming with an engineer's investigation, and document review and retrieval freshness with an annotator's evidence check. Each contains all three role goals and three steps per role. Global or per-card perspective choices change the walkthrough only; they do not alter scoring.

The cohort services are `support-copilot`, `checkout-orchestrator`, `document-reviewer`, `service-desk-coordinator`, `knowledge-assistant`, and `streaming-assistant`. Installation records let the UI reopen an existing example without replacing user edits or annotations. These fixtures use the import path to exercise real normalization; their synthetic origin remains explicit. The first three fixture/configuration/profile exports remain unchanged when the additional examples are installed.

Isolation is explicit in the evaluation contract: optional YAML `dataset.filters.scenario` maps to runtime `dataset.scenarioId`. When present, matching requires both the exact scenario marker and boolean `trace.attributes['tracegrade.synthetic'] === true`, as well as the ordinary source, service, environment, and time predicates. The field accepts a lowercase hyphenated slug up to 120 characters. The compiler never infers it from an identity or carries it forward when omitted from YAML. Dataset shows the restriction as a read-only notice; an ordinary evaluation without this filter retains its existing cohort behavior. Installing a scenario rejects conflicting existing trace identities rather than overwriting unrelated evidence.

`TRACE_PROFILES` contains six built-in mapping contracts rather than a universal mapping builder. Each immutable descriptor includes `id`, `version`, `name`, `team`, `description`, and fields with an exact target, source type, attribute key, optional span/event/service selectors, and transformation. Current versions are `1.0.0`:

| Profile | Selection contract |
|---|---|
| `support-genai-v1` | Root GenAI-style message arrays; join text `parts[].content`. Map explicit support context, model, USD cost, and recorded policy judgment fields. No child-response fallback. |
| `checkout-shop-v1` | Root `shop.*` JSON and numeric fields; legacy environment resource key; explicit cents divided by 100; payment attempts copied to `checkout.payment_attempts`. |
| `document-events-v1` | Root question/model/cost; context only from `review.retrieve_evidence`; final answer/citation judgment only from `review.completed` on `document.review.finalize`. |
| `handoff-services-v1` | Root coordinator request/model/cost/handoff count; final response, received context, and handoff judgment from `agent.respond` qualified by resource service `access-specialist`. |
| `retrieval-resources-v1` | Root question/answer/model/cost/groundedness; context and source age from `retrieval.search` qualified by resource service `knowledge-index`. |
| `streaming-final-v1` | Root request/context/model/cost; first-token timing on `chat.stream` from `stream-gateway`; final answer and receipt only from its unique `stream.completed` event. |

`normalizeTraceInput(raw, {profileId, profileVersion})` returns `{traces, warnings, profile?}`. Auto delegates to the legacy importer. An explicit profile requires OTLP `resourceSpans`, a known identity, and the supported version when supplied; the YAML contract always requires a version. It starts from structural trace normalization, replaces generic content selection, and never falls back to an unrelated field when a declared source is absent.

Explicit selection requires one root. A named child must be a unique descendant of that root; a named event must occur exactly once on the selected child. An optional exact `serviceName` selector compares the candidate span's resource `service.name`. Same-name spans from known other services are excluded. A named candidate with missing, invalid, or duplicate service evidence leaves selection unresolved, even if another candidate appears to match, because its identity cannot be established. No first-match fallback is used.

Missing roots/fields, ambiguous spans/events, duplicate attributes, or invalid values produce missing evidence and actionable warnings. Numeric transformations preserve explicit units; semantic judgments require a numeric 0–1 value plus mapped provenance. UNSET tool outcomes stay unknown. An unresolved explicit root cannot produce a canonical latency grade.

Every explicitly normalized trace records its profile ID/version, per-field mapping status, selected source service/span/event, required service selector, transformations, and warnings in `trace.normalization`. Normalized spans retain their resource service, instrumentation-scope identity, and recorded event names, attributes, and timestamps. HTML reports escape these details when rendering the evidence. Resource schema URLs and instrumentation-scope name/version/schema URLs are retained as evidence and are never fetched. Snapshots preserve that provenance with the selected traces. A later selector change cannot relabel earlier imported records or run snapshots.

The new scenarios exercise distinct evidence rules. Service-desk handoff evaluates a supplied completeness judgment and a count of at most two handoffs. Retrieval freshness evaluates explicit source age in hours separately from groundedness; a missing age is never inferred from trace timestamps or a competing cache resource. Streaming distinguishes end-to-end latency from recorded first-token latency and an explicit completion receipt. Repeated `stream.chunk` events remain inspectable evidence and never become final output or a receipt.

Streaming intentionally sets `requireOutput: false` while retaining a critical completion-receipt scorer. This allows an interrupted trace into execution so the absent measurement is recorded as unscored and blocks release, rather than dropping the case before scorer results exist. The supplied raw fixtures, evaluation YAML, and complete catalog reproduce these outcomes through the same CLI. Profile YAML exports are documentation of the built-in contracts, not executable imported profile definitions.

Connections persists `profileId`/`profileVersion` in its source settings and applies the captured choice to both file and HTTP imports. Dataset keeps the choice in its editable `dataset.normalization`; Auto removes that field, while explicit choices carry the exact version. Imports use the current draft mapping, and saving the dataset is a separate action. A pinned dataset blocks if any selected trace lacks matching `trace.normalization.profileId` and `profileVersion`, instructing the user to reimport raw evidence. This prevents a saved profile edit from silently reusing differently normalized records. Normalized JSON snapshots use Auto, because an explicit profile must inspect the raw OTLP fields it declares.

## Evaluation semantics

1. Match exact source/service/environment filters and optional inclusive time bounds; select recent or errors-first records up to the sample cap.
2. Block an empty or undersized cohort, duplicate IDs, missing required input/output/context, or invalid scorer settings.
3. Evaluate each enabled scorer, recording value, pass comparison, kind, and reason; missing evidence is unscored.
4. Queue configured failures/missing evidence and a deterministic hash-based quality sample.
5. Combine automatic results with independent annotations and generate the scorecard/report.

A trace's diagnostic score is `100 × passing observed weight / total observed weight`; the run score averages trace scores. Missing checks are excluded from that grade's denominator but independently block release. Trace pass rate is `100 × traces passing every enabled check / total evaluated traces`. `release.minimum_pass_rate` gates this rate. Critical failures fail the automatic gate. Missing enabled metrics block it. Otherwise pending review yields `review`, rejection yields `failed`, and accepted completed review yields `passed`.

Annotations append verdicts and rationale separately. The latest run/trace judgment determines review state; `accepted`/`rejected` resolve work and `needs_work` remains pending. An acceptance never changes automatic values or erases a failure. Scorecard means can pass while individual traces fail. These threshold checks do not estimate statistical confidence or causal release impact.

Custom `attribute` scorers read exact own flat keys in trace attributes. They accept finite numeric evidence within the declared scale, including generic nonnegative `number` values, with no expression evaluation or inference. Phrase scorers perform literal case-insensitive matching and can use independent namespaced IDs. Recorded judgments consume `evaluatorScores[judgmentKey]` with a 0–1 value and nonblank provenance. Custom `judgment_*` scorers preserve an optional rubric and never borrow demo fixtures. Groundedness/relevance retain explicitly labeled demo fixtures and supplied external scores for imported data. Publishing a rubric does not execute a model, and guideline edits do not rejudge recorded scores.

## Existing-trace integration and importer limits

Canonical imports accept arrays or `{traces: [...]}`. OTLP imports accept `resourceSpans` requests and newline-delimited batches. Records are grouped/deduplicated by correlation IDs; `traceId` wins when both canonical identity fields exist. Current imported duplicates replace dataset records, while earlier run snapshots remain unchanged. Preview text/status filters do not change the evaluation cohort.

In Auto mode, OTLP root selection prefers a parentless span, otherwise the first exported span. Explicit profiles use the stricter selection contract above. Timestamp arithmetic uses nanoseconds without unsafe epoch-number conversion; missing, unsafe, or reversed timing leaves duration unscored. Explicit OK/ERROR statuses are known outcomes; UNSET is unknown and cannot prove tool success.

Auto input/output lookup tries known root attributes, then child attributes in export order. This fallback may select an intermediate model/tool interaction and emits an import warning. The explicit profiles demonstrate alternative team contracts; production normalization must still define the evaluation unit and actual root input/final output mapping for the selected backend. Cost uses explicit supported root attributes, profile conversions, or canonical `costUsd`, not inferred pricing or potentially overlapping child totals. Standalone OTLP logs are not independently correlated into cases.

Imported semantic judgments require 0–1 values and provenance text; that provenance is not a cryptographic attestation. Missing evidence blocks rather than fabricates results. No live judge or automatic rubric synthesis is implemented. The [OTLP specification](https://opentelemetry.io/docs/specs/otlp/) defines transport, not a universal backend read API.

## Proposed production increment

Keep the existing tracing backend and implement one concrete integration first:

1. **Read connector:** use its query/export API with server-managed credentials, bounded filters, pagination, a cursor/watermark, and source trace links.
2. **Normalization:** version explicit mappings for root input, final output, context, tool outcomes, reference answers, model/version, timing, and cost; apply required redaction.
3. **Registry service:** authenticated publication/adoption, ownership policies, immutable release storage, content digests or signatures, and authorization independent of applicability labels.
4. **Immutable evidence:** snapshot source IDs, query/window, sampling, exclusions, content digest, evaluation YAML, and exact resolved scorer artifacts.
5. **Durable scoring:** create idempotent work per run/trace/scorer version; record evaluator settings, rubric/model version, raw judgments, reasons, costs, execution errors, and retries. Distinguish execution errors from quality failures.
6. **Independent review:** assign tasks with reviewer identity, verdict history, calibration, and disagreement handling.
7. **Aggregation/reporting:** compute coverage, segment outcomes, distributions, and explicit gates; produce versioned reports. Import events or a real scheduler can initiate this same pipeline.

One backend application and worker can own the first increment, with relational metadata/results and immutable evidence/definition/report objects. These are responsibilities, not a required service per stage. No production REST endpoints are defined or implemented by the prototype. YAML export, local catalog publication, and `execution.trigger: scheduled` do not create a worker, registry service, or native schedule.

The next decision is the backend product, its actual read/export interface, and a representative export that establishes the evidence mapping. Verify that path end to end before adding more providers or unattended operation. Current checks and remaining UI verification are tracked in [verification.md](verification.md).
