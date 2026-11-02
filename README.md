# Tracegrade 0.3

A working evaluation platform prototype with a YAML playground and a reusable scorer catalog. Define product guidelines, trace-dataset requirements, exact scorer versions, review rules, and release gates; preview the resulting pipeline, test it against evidence, and export reports.

Tracegrade evaluates exported trace evidence from an existing observability backend. It does not replace your tracing platform. The browser app and command-line runner share the same YAML compiler, catalog resolver, and evaluation engine. There are two canonical portable artifacts: **`evaluation.yml` describes an evaluation**, and **`scorers.yml` contains reusable scorer definitions and their published versions**. See [architecture](docs/architecture.md) and [verification status](docs/verification.md) for implementation boundaries and checks.

## Start the application

Use Node.js and npm; development was verified with Node 24.22.1.

```bash
git clone https://github.com/rahult/annotation-pipeline.git
cd annotation-pipeline
npm ci
npm run dev
```

Open the Vite URL printed in the terminal. `npm run build` creates the static production bundle; `npm run preview` serves that bundle locally. No database, API key, or environment file is needed for the sample workflow.

The separately delivered `Tracegrade.html` embeds the compiled app and its dependencies in one file. Download it and open it in a modern browser. `npm run portable` rebuilds that file from this project. State is local to the browser; export evaluation YAML, catalog YAML, and evidence to retain portable copies. The supplied `evaluation.yml` is a complete sample specification, `scorers.yml` is the standalone scorer catalog manifest, and `public/evaluation.schema.json` is the evaluation schema.

## Explore six team examples

The application opens **Examples**, with six scenarios and three role perspectives on the same evaluation workflow. Each example includes synthetic OTLP evidence, an explicit versioned field mapping, the required scorer definitions, an editable evaluation, and a calculated initial run. These are separate cohorts with distinct service names; they demonstrate how teams can use different telemetry conventions without treating one team's attributes as a universal contract.

| Example | Starting persona | Evaluation question | Evidence convention |
|---|---|---|---|
| A support release with a policy gap | Product owner | Does the response stay within the approved policy and action authority? | GenAI-style root message arrays; recorded policy judgments with provenance |
| A checkout flow with incomplete telemetry | Engineering | Is checkout within its budgets, with complete cost and tool-outcome evidence? | Custom `shop.*` root JSON and numeric fields; explicit cents-to-USD conversion |
| A document answer that needs evidence | Annotator | Does the final answer agree with the cited passage, and is the judgment present? | Context from a named retrieval span; final answer and citation judgment from a named completion event |
| A service desk handoff that loses context | Product owner | Did the final specialist receive the approval requirement within the handoff budget? | Several resources in one trace; identical span names selected by exact service |
| A grounded answer from an aging source | Annotator | Is the selected knowledge source recent, and is its age actually recorded? | Same-name retrieval spans from competing services; explicit source age in hours |
| A streamed answer without completion | Engineering | Was the first token timely, and did the response explicitly complete? | Repeated chunk events alongside a separate final-answer/receipt event |

Every example offers product-owner, engineering, and annotator goals and steps, so the same trace evidence can be examined from each role. Use the global perspective selector or override an individual card's role; search the titles, teams, evidence variations, and role goals. The selected role changes the walkthrough, not the underlying scores or release policy.

Loading an example adds its fixtures, required catalog entries, specification, and run to the local workspace. It preserves the original demo data. Reopening an installed example opens its existing specification without overwriting edits or annotations. The evidence remains labeled synthetic; loading an example does not connect to a real team's tracing backend.

Example YAML also pins `dataset.filters.scenario`, such as `support-release`. This includes only traces with the boolean attribute `tracegrade.synthetic: true` and that exact `tracegrade.scenario` value, in addition to the service, environment, and time filters. Ordinary imported traffic cannot enter the example merely by sharing its service name. Dataset displays this read-only fixture restriction. Ordinary evaluations do not acquire it automatically; omit the scenario field when defining a non-example cohort.

## Browse, discover, and build scorers

Open **Scorers**. This catalog is a registry in the local browser workspace. Owner labels and scopes describe responsibility and applicability; they do not implement organizational authentication, permissions, or a shared remote registry.

### Applicability and exact versions

Set the evaluation's **Domain** and **Agent** context, then search or filter by name, owner, tags, scope, lifecycle, or availability. Inspect a scorer's required input, defaults, release impact, rubric, and versions before adding it.

| Scope | Example reference | Applicable to |
|---|---|---|
| Global | `global/response-latency` | Any evaluation |
| Domain | `domain/customer-support/policy-compliance` | Exact `metadata.domain: customer-support` |
| Agent | `agent/support-agent/tool-outcome-validity` | Exact `metadata.agent: support-agent` |

**Add to evaluation** pins the selected exact published version. Scope mismatches fail compilation. Draft-only or deprecated scorers cannot be newly adopted through the catalog UI. Applicability does not guarantee that the dataset contains a scorer's required evidence.

The initial browser catalog includes:

| Reference | Input / behavior | Initial state |
|---|---|---|
| `global/groundedness` | Recorded groundedness judgment; demo fixtures are labeled | `1.0.0` |
| `global/answer-relevance` | Recorded relevance judgment | `1.0.0` |
| `global/response-latency` | Recorded end-to-end duration | `1.0.0` |
| `global/tool-success` | Explicit tool-span outcomes | `1.0.0` |
| `global/cost-per-response` | Explicit recorded cost | `1.0.0` |
| `domain/customer-support/escalation-language` | Literal response phrase check | `1.0.0` |
| `domain/customer-support/policy-compliance` | Supplied `policy_compliance` judgment with provenance | `1.0.0` |
| `domain/document-review/citation-accuracy` | Supplied `citation_accuracy` judgment with provenance | `1.0.0` |
| `agent/support-agent/tool-outcome-validity` | Numeric `agent.tool_success_percent` trace attribute | `1.0.0` |
| `agent/support-agent/retrieval-confidence` | Proposed `retrieval.confidence` attribute rule | Draft only |

The complete portable `scorers.yml` also includes these scenario-specific `1.0.0` releases. Loading an example adds its required definitions to the browser catalog without changing existing pins:

| Reference | Input and default rule |
|---|---|
| `agent/checkout-orchestrator/payment-attempt-budget` | Recorded `checkout.payment_attempts` ≤ 2 |
| `domain/it-operations/handoff-completeness` | Supplied `handoff_completeness` judgment ≥ 0.90; critical |
| `agent/service-desk-coordinator/handoff-budget` | Recorded `handoff.count` ≤ 2 |
| `domain/enterprise-search/source-freshness` | **Source age (hours):** recorded `retrieval.source_age_hours` ≤ 24 |
| `agent/streaming-assistant/first-token-latency` | Recorded `stream.ttft_ms` ≤ 800 ms |
| `agent/streaming-assistant/completion-receipt` | Explicit `stream.completion_receipt` ≥ 1; critical |

### Discover inputs from actual traces

**Discover traces** examines numeric attributes in the selected evaluation cohort. It shows exact keys, observed ranges, coverage, and existing catalog use. Coverage is the number of selected traces with numeric evidence divided by the cohort size; it does not describe all production traffic.

Choose **Build scorer** for an observed candidate, then confirm the scope, unit, threshold, and release impact. Suggested units are hints from keys and observed ranges. Discovery does not query an unconnected platform, browse an external marketplace, invent missing measurements, or decide the product's acceptance criteria.

### Draft, publish, fork, and adopt

1. **Build scorer**, or fork an existing definition. Choose its scope, target, immutable slug identity, owner, tags, execution type, required input, and defaults.
2. **Save draft**. Drafts remain editable and cannot execute through a catalog reference.
3. **Publish** an exact numeric semantic version such as `1.0.0`, with a change note. Published definitions cannot be overwritten; subsequent releases must have a greater version.
4. Add a published version to an evaluation. Its threshold, operator, weight, enabled state, and critical flag can be overridden for that evaluation. Exported references make all those overrides explicit.
5. To change reusable behavior, create a new draft and publish another version. Adopt the new version explicitly in each evaluation that should use it. Existing pins and historical snapshots stay unchanged.

**Fork scorer** starts a draft under a new identity without changing the original. Deprecated entries remain inspectable and existing pinned releases remain executable, while new UI adoption and further publication are blocked. These are application lifecycle rules, not an authorization boundary against a person editing browser storage or files.

**Export YAML** in Scorers exports a standalone `kind: ScorerCatalog` manifest. Import validates and merges compatible entries; it rejects conflicting content for an already published reference/version and conflicting local drafts instead of silently replacing them. Keep every version referenced by portable evaluations in the exported catalog. The supplied `scorers.yml` is a complete manifest.

## Build an evaluation in the playground

1. Open **Playground** and select an evaluation. The workspace starts with 60 synthetic traces, three specifications, and five historical runs; the team examples are loaded separately from **Examples**.
2. Edit `evaluation.yml` in the CodeMirror editor. It provides YAML highlighting, line numbers, folding, undo/redo, indentation, and diagnostic navigation.
3. **Validate**. Syntax, schema, reference, version, and scope errors report their line, column, and path; select an error to move to it. The preview derives the five stages from the configuration.
4. **Run draft** against the selected trace cohort. Inspect metric results, gate reasons, trace evidence, and draft reports. Draft runs do not enter saved history or create a persistent review queue.
5. **Save specification** to create a new version. Editor saves retain the entered YAML, including comments. Structured-form edits regenerate canonical YAML, so its formatting and comments may change.
6. Run the saved specification from **Evaluations**, then complete **Annotations** and export the HTML report, CSV results, or JSON evidence from **Reports**.
7. **Export YAML** downloads the current draft as `.yml`; this can include an invalid work in progress, so validate before using it. The **Schema** tab exports JSON Schema and, when valid, compiled JSON.

Shortcuts: **Cmd/Ctrl+Enter** runs a draft, **Cmd/Ctrl+Shift+Enter** validates, **Cmd/Ctrl+S** saves. **Escape, then Tab** moves focus out of the editor. Unsaved YAML text is retained locally per evaluation/version; draft results remain transient. Editing YAML marks older draft results as stale.

## A complete minimal configuration

Save this as `evaluation.yml`, or export a specification from the playground:

```yaml
apiVersion: tracegrade.dev/v1
kind: Evaluation
metadata:
  name: Support response latency
  description: Check the response-time budget using recorded trace evidence.
  domain: customer-support
  agent: support-agent
guidelines:
  - id: response_budget
    title: Keep support interactions responsive
    description: Evaluate each interaction against the four-second budget.
dataset:
  source: demo
  filters: {service: support-agent, environment: production}
  sample: {strategy: recent, size: 40, minimum: 20}
  required: [input, output]
scorers:
  - ref: global/response-latency
    version: 1.0.0
    threshold: {operator: lte, value: 4000}
    weight: 1
    enabled: true
    critical: false
review: {on_failure: false, sample_percent: 0}
release: {minimum_pass_rate: 85}
execution: {trigger: manual, schedule: daily}
report: {format: html}
```

The final configuration declares intent; the pipeline is derived from it. Evaluation YAML is canonical for its guidelines, dataset, pins, and overrides. Reusable definitions remain canonical in the separate catalog, and expanded resolved definitions are frozen into run snapshots. Workspace identity and evaluation version are managed separately.

`metadata.domain` and `metadata.agent` express applicability independently of dataset service/environment filters. Changing context does not change the selected cohort. References require exact published versions: `latest`, ranges, unknown references/versions, and unpublished drafts are rejected. Legacy inline definitions remain supported; mixed configurations cannot resolve to duplicate metric IDs.

Unknown fields, duplicate keys, unsupported types, invalid ranges, and YAML aliases are rejected. Evaluation configurations are limited to 256 KiB of UTF-8 text. Optional `dataset.filters.start` and `end` use timezone-qualified ISO instants and normalize to UTC. The schema is available at `public/evaluation.schema.json`.

## Run the same YAML from the command line

```bash
# A portable bundle with evaluation YAML, catalog YAML, and demo evidence
node scripts/evaluate.mjs evaluation.yml - ./evaluation-output --catalog scorers.yml

# A configuration with dataset.source: import
node scripts/evaluate.mjs imported-evaluation.yml traces.json ./evaluation-output --catalog scorers.yml

# Only bundled scorer definitions are needed: the catalog argument is optional
node scripts/evaluate.mjs evaluation.yml - ./evaluation-output
```

Without `--catalog`, only the bundled catalog is available. Locally created custom references require their exported catalog. An explicitly supplied catalog is used as supplied, with no silent merge, remote lookup, or version substitution. Missing dependencies produce configuration errors.

The runner writes `report.html`, `results.csv`, and `run.json`, and prints a machine-readable summary. All three formats are written regardless of the preferred `report.format`. Exit **0** means the release gate passed; **1** means failed, blocked, or awaiting review; **2** means a configuration, input, or file error. A valid but incomplete dataset produces blocked-run evidence rather than a fabricated pass.

The CLI performs one explicit run. It does not activate the configured trigger or schedule, import browser annotations, or update browser history. A configuration requiring human review can therefore finish in `review` with exit 1. For demo runs, omit the trace argument or use `-`; imported configurations require a trace file. Supplying imported records to a demo-source specification does not change its source filter.

### Run the included team scenarios

The six team configurations under `examples/` pin their exact normalization profile, synthetic scenario cohort, and scorer versions. Their raw OTLP fixtures live under `public/examples/`. The supplied `scorers.yml` contains 16 entries: the ten seeded entries plus all six scenario-specific releases listed above.

Run each command from the project root:

```bash
node scripts/evaluate.mjs examples/support-release.yml public/examples/support-release-otel-fixture.json ./evaluation-output/support-release --catalog scorers.yml

node scripts/evaluate.mjs examples/checkout-reliability.yml public/examples/checkout-reliability-otel-fixture.json ./evaluation-output/checkout-reliability --catalog scorers.yml

node scripts/evaluate.mjs examples/document-review.yml public/examples/document-review-otel-fixture.json ./evaluation-output/document-review --catalog scorers.yml

node scripts/evaluate.mjs examples/service-desk-handoff.yml public/examples/service-desk-handoff-otel-fixture.json ./evaluation-output/service-desk-handoff --catalog scorers.yml

node scripts/evaluate.mjs examples/retrieval-freshness.yml public/examples/retrieval-freshness-otel-fixture.json ./evaluation-output/retrieval-freshness --catalog scorers.yml

node scripts/evaluate.mjs examples/streaming-completion.yml public/examples/streaming-completion-otel-fixture.json ./evaluation-output/streaming-completion --catalog scorers.yml
```

These fixtures intentionally demonstrate failures and incomplete evidence, so all six commands produce reports and exit with status **1**:

| Configuration | Traces | Gate | Pending reviews | Evidence to inspect |
|---|---:|---|---:|---|
| `examples/support-release.yml` | 4 | Failed | 1 | One critical policy failure; 75% of traces pass even though the mean policy score passes its threshold. |
| `examples/checkout-reliability.yml` | 4 | Blocked | 3 | One missing cost, one UNSET tool outcome, and a separate latency/retry failure. A recorded cost of 1 cent maps to $0.01 USD. |
| `examples/document-review.yml` | 3 | Blocked | 2 | One absent citation judgment and one critical citation failure. The final answer is selected from the named completion event. |
| `examples/service-desk-handoff.yml` | 3 | Failed | 1 | One critical handoff-completeness failure and a count of four handoffs on the same case; 66.7% pass. Final evidence comes from access-specialist. |
| `examples/retrieval-freshness.yml` | 3 | Blocked | 2 | A 72-hour source fails the 24-hour limit; another source age is absent. Groundedness passes for all three, but only 33.3% pass every check. |
| `examples/streaming-completion.yml` | 3 | Blocked | 2 | A 1,250 ms first token fails the 800 ms limit; an interrupted stream has chunks but no final receipt. Only 33.3% pass every check. |

Each output directory contains `report.html`, `results.csv`, and `run.json`. HTML reports label the evidence as synthetic and include the normalization profile and field lineage; JSON retains the exact scenario filter, profile/version, resolved scorer definitions, and trace snapshot. No production agent is measured by these commands.

The streaming example deliberately omits output from the dataset's required preflight fields. This keeps an interrupted stream in the evaluated cohort so its missing completion receipt is shown as unscored and blocks release. Repeated chunks are never concatenated into a fabricated final answer or counted as completion receipts.

## Bring your own trace evidence

Use **Connections → Import a trace export** or **Dataset → Import traces**. Supported formats are OTLP JSON `resourceSpans`, canonical trace arrays, `{ "traces": [...] }`, and newline-delimited OTLP batches. UI files and endpoint responses are limited to 8 MiB; the engine permits at most 5,000 records per import. The dataset form caps sample size at 1,000; YAML supports the engine's 5,000-row bound, subject to browser capacity.

### Choose an explicit mapping when teams emit different fields

The **Trace mapping profile** selector is available in Connections and Dataset. **Auto** retains the existing generic importer: it accepts normalized records and uses known root/child attribute fallbacks for OTLP, reporting fallback notes. The six explicit profiles accept OTLP `resourceSpans` only and use their declared selectors. An absent or ambiguous selected field stays missing; a missing tool outcome never becomes a successful one.

| Profile, pinned at `1.0.0` | Exact sources and transformations |
|---|---|
| `support-genai-v1` | Root `gen_ai.input.messages` and `gen_ai.output.messages`, joining text `parts[].content`; root `support.policy_context`, `gen_ai.response.model`, and `eval.total_cost_usd`; recorded `eval.policy_compliance.*` fields |
| `checkout-shop-v1` | Root `shop.request` and `shop.result` as structured JSON; `shop.agent_model`; `shop.total_cost_cents` divided by 100; `shop.payment.attempts` mapped to numeric `checkout.payment_attempts`; legacy resource `deployment.environment` |
| `document-events-v1` | Root `review.question`, `review.model`, and `review.cost_usd`; `review.context` on the unique `review.retrieve_evidence` descendant; `review.answer` and `review.citation.*` on `review.completed` within the unique `document.review.finalize` descendant |
| `handoff-services-v1` | Root `desk.request`, coordinator model, total USD cost, and handoff count; final answer, received context, and `desk.handoff_quality.*` only from `agent.respond` in resource service `access-specialist` |
| `retrieval-resources-v1` | Root `rag.question`, answer, model, USD cost, and `rag.groundedness.*`; context and source age only from `retrieval.search` in `knowledge-index`, excluding the `stale-cache` lookalike |
| `streaming-final-v1` | Root request/context/model/USD cost; explicit `stream.ttft_ms` on `chat.stream` from `stream-gateway`; final text and completion count only from its unique `stream.completed` event |

All six read `service.name` from the selected root's resource. Checkout uses the legacy resource `deployment.environment`; the other five use `deployment.environment.name`. Explicit profiles require one unambiguous root, and child/event selectors must resolve uniquely. When a profile declares `serviceName`, the matching descendant must also have that exact resource service. A named candidate with missing, invalid, or duplicate service evidence leaves selection unresolved instead of silently choosing a plausible alternative.

The profile descriptions and source-field guide are shown beside the selector. Trace evidence retains the applied profile/version, field-level status, selected service/span/event, required service selector, transformations, and warnings. Spans retain their own resource service, instrumentation scope, and recorded event names, timestamps, and attributes for inspection and report export. Resource schema URLs are evidence; the app never fetches them to guess a mapping. The profile YAML downloads document built-in contracts and cannot be imported as executable custom mappings.

Connections saves the selection with its connector settings and applies it to both file and endpoint imports. Dataset imports use the current draft selection; **Save dataset** adds it to evaluation YAML. Choosing a different profile does not remap loaded traces. If a dataset pins a profile, every selected trace must carry that exact profile/version in its normalization provenance; mismatches block evaluation with a reimport instruction. Reimport the original OTLP export if the mapping needs to change, and save the dataset choice separately.

For example, this dataset section pins the document mapping:

```yaml
dataset:
  source: import
  normalization:
    profile: document-events-v1
    version: 1.0.0
  filters: {service: document-reviewer, environment: production}
  sample: {strategy: recent, size: 20, minimum: 1}
  required: [input, output, context]
```

Omit `dataset.normalization` for Auto. Unknown profiles, missing versions, and unsupported versions are configuration errors. The CLI uses this same YAML setting when reading the raw trace file; no extra mapping flag is needed. Already normalized trace arrays should use Auto. A profile specifies evidence extraction, while scorer references specify the rules applied to that evidence.

A minimal canonical record looks like this:

```json
{
  "traceId": "0af7651916cd43dd8448eb211c80319c",
  "name": "Refund eligibility",
  "service": "support-agent",
  "environment": "production",
  "startedAt": "2026-11-02T09:00:00Z",
  "durationMs": 1850,
  "costUsd": 0.012,
  "status": "ok",
  "input": "Can I request a refund?",
  "output": "Billing can review your request.",
  "context": "Refunds require billing-team approval.",
  "attributes": {"eval.safety_score": 0.96},
  "spans": [{"id": "tool-1", "type": "tool", "name": "lookup_policy", "status": "ok", "durationMs": 180, "startMs": 40}]
}
```

Wrap records in an array. Select `dataset.source: import`, set the intended cohort and minimum count, and save. One example record cannot satisfy the default 20-row minimum. Missing measurements remain unscored; there is no inference of cost or successful tool outcomes from absent data.

**Custom JSON endpoint** performs a browser-side HTTPS GET of a compatible export/query URL. It requires CORS and network access, omits cookies, rejects redirects, and times out after 15 seconds. The optional bearer token stays in component memory. Provider selections for Grafana Tempo, Jaeger, Arize Phoenix, and Langfuse are staged adapter contracts, not live integrations. Use a backend read/export API, not an OTLP ingestion endpoint.

### Custom metrics and semantic judgments

An attribute scorer reads a measurement you already record. Create one through the catalog, or use a legacy inline definition with `type: attribute`, a unique ID such as `attribute_safety`, `attribute: eval.safety_score`, and the normal unit, threshold, weight, enabled, and critical fields. It reads the exact own property `trace.attributes[attribute]`; dotted names are literal keys, not nested paths. Finite numbers and numeric strings are accepted. Score units require 0–1, percent requires 0–100, and milliseconds/USD/generic `number` require nonnegative values. Missing or invalid values block release as unscored; no arbitrary code runs. Phrase scorers perform case-insensitive literal matching; multiple namespaced phrase rules can coexist.

Recorded judgments consume `evaluatorScores[judgmentKey]` with a 0–1 value and nonblank provenance. For example, `"evaluatorScores": {"policy_compliance": {"value": 0.94, "provenance": "judge/rubric-v3/run-123", "reason": "The response stays within policy."}}` supplies the domain policy scorer. Custom inline judgments use `type: recorded_judgment`, an ID beginning `judgment_`, `judgment_key`, and an optional `rubric`. Existing groundedness/relevance definitions remain compatible and have explicitly labeled sample fixtures.

Supply every enabled semantic result or disable those scorers for a deterministic-only trial. Imported `demoScores` are discarded. Publishing a rubric does not create or execute an LLM judge, and editing guideline prose does not rejudge recorded scores.

## Gates, automation, and persistence

The **weighted scorer pass score** is a diagnostic 0–100 grade. The **trace pass rate** is the percentage passing every enabled scorer; YAML `release.minimum_pass_rate` gates that percentage. Critical failures fail release regardless of averages. Missing enabled metric evidence blocks release. Pending required review prevents a passed gate, and accepting a trace cannot erase an automatic failure. Metric scorecard values are means, not p95. Errors-first selection is diagnostic, not an unbiased production estimate.

Manual and after-import evaluations run locally. After-import automation re-evaluates the matching imported cohort while the app is open. Scheduled execution is configuration only: there is no background scheduler, worker, continuous sync, application server, or REST API. Exporting YAML or publishing a scorer locally does not deploy server infrastructure.

The workspace, including its scorer catalog, is stored under `tracegrade.workspace.v1` in browser local storage; YAML drafts use `tracegrade.yamlDraft.v1.<evaluation-id>`. Settings can export the complete workspace. Storage failures show a warning; export before closing if changes are in memory only. Browser data removal or resetting the demo removes local workspace state. Existing run snapshots remain unchanged when current traces, specifications, or catalog releases change. Published-version immutability is an application invariant, not tamper-evident storage.

## Checks and next integration

```bash
npm test
npm run build
```

`npm test` runs all `src/*.test.js` suites: evaluation semantics, catalog lifecycle/conflict handling, YAML compilation, canonical workspace migration, trace profiles, and portable scenario fixtures. Current counts and completed browser checks are recorded in [verification status](docs/verification.md).

The next integration input is concrete: **which tracing backend is running, how can a representative cohort be exported or queried, and which fields contain root input, final output, context, tool outcomes, explicit cost, and model version?** Implement that one explicit mapping before unattended execution or additional providers. Format reference: [OpenTelemetry OTLP specification](https://opentelemetry.io/docs/specs/otlp/).

## Imported-data example

The two synthetic normalized traces in `examples/traces.json` demonstrate the import contract. Run the checked latency-only example with:

```bash
npm run evaluate -- examples/imported-evaluation.yml examples/traces.json ./evaluation-output
```

This example passes and exits with status 0. It is example evidence, not data from a production agent.
