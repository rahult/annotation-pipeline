import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { createScorerCatalog, mergeCatalog, metricFromCatalog, parseCatalogYaml } from './catalog.js';
import { compileYaml } from './config.js';
import { evaluateRun, aggregateRun, exportReport, filterTraces } from './domain.js';
import { SCENARIOS, getScenarioFixture, prepareScenario } from './scenarios.js';
import { normalizeTraceInput } from './traceProfiles.js';

test('scenario fixtures are deterministic, isolated, explicitly synthetic, and profile-pinned', () => {
  assert.equal(SCENARIOS.length, 6);
  const traceIds = new Set();
  for (const scenario of SCENARIOS) {
    assert.equal(scenario.personas.length, 3);
    assert.deepEqual(scenario.personas.map(persona => persona.role), ['Product owner', 'Engineering', 'Annotator']);
    assert.ok(scenario.personas.every(persona => persona.goal.trim() && persona.steps.length === 3 && persona.steps.every(step => step.trim())));
    const prepared = prepareScenario(scenario.id);
    assert.ok(prepared.traces.length >= 3 && prepared.traces.length <= 4);
    assert.ok(prepared.traces.every(trace => trace.source === 'import' && trace.attributes['tracegrade.synthetic'] === true && trace.tags.includes('synthetic')));
    assert.deepEqual(prepared.spec.dataset.normalization, { profile: prepared.profile.id, version: prepared.profile.version });
    assert.equal(prepared.spec.dataset.scenarioId, scenario.id);
    assert.ok(prepared.spec.metrics.every(metric => metric.catalogRef.version === '1.0.0'));
    assert.deepEqual(getScenarioFixture(scenario.id), getScenarioFixture(scenario.id));
    const fixture = getScenarioFixture(scenario.id);
    fixture.resourceSpans.length = 0;
    assert.ok(getScenarioFixture(scenario.id).resourceSpans.length > 0);
    const run = evaluateRun(prepared.traces, prepared.spec);
    assert.equal(run.demo, false);
    assert.equal(run.synthetic, true);
    assert.equal(run.validation.valid, true);
    assert.ok(Object.isFrozen(run.datasetSnapshot[0].normalization));
    assert.equal(run.specSnapshot.dataset.normalization.version, '1.0.0');
    for (const trace of prepared.traces) {
      assert.equal(traceIds.has(trace.traceId), false, 'Scenario cohorts must not share trace identities.');
      traceIds.add(trace.traceId);
    }
  }
  assert.throws(() => prepareScenario('unknown'), /Unknown synthetic scenario/);
  assert.throws(() => getScenarioFixture('constructor'), /Unknown synthetic scenario/);
});

test('scenario reruns exclude unrelated imported traces even when service, environment, dates and profile match', () => {
  const { spec, traces } = prepareScenario('support-release');
  const unrelatedMarkers = [
    { 'tracegrade.synthetic': false, 'tracegrade.scenario': 'support-release' },
    { 'tracegrade.synthetic': true, 'tracegrade.scenario': 'another-example' },
    { 'tracegrade.synthetic': true, 'tracegrade.scenario': undefined },
    { 'tracegrade.synthetic': 'true', 'tracegrade.scenario': 'support-release' },
  ];
  const unrelated = unrelatedMarkers.map((markers, index) => ({
    ...structuredClone(traces[0]), id: `unrelated-${index}`, traceId: `unrelated-${index}`,
    startedAt: '2026-11-01T10:49:00.000Z', attributes: { ...traces[0].attributes, ...markers }, tags: ['synthetic'],
  }));
  const combined = [...traces, ...unrelated];
  assert.deepEqual(new Set(filterTraces(combined, spec).map(trace => trace.id)), new Set(traces.map(trace => trace.id)));
  const run = evaluateRun(combined, spec);
  assert.equal(run.validation.matchedCount, 4);
  assert.equal(run.summary.total, 4);
  assert.equal(run.summary.passRate, 75);
  assert.equal(run.synthetic, true);
  assert.ok(run.datasetSnapshot.every(trace => !trace.id.startsWith('unrelated-')));
  const unrestricted = structuredClone(spec);
  delete unrestricted.dataset.scenarioId;
  assert.ok(filterTraces(combined, unrestricted).some(trace => trace.id.startsWith('unrelated-')));
});

test('support release fails a critical policy case even when the mean policy score passes', () => {
  const prepared = prepareScenario('support-release');
  const run = evaluateRun(prepared.traces, prepared.spec);
  assert.equal(run.status, 'failed');
  assert.equal(run.summary.passRate, 75);
  assert.equal(run.summary.criticalFailures, 1);
  assert.equal(run.summary.pendingReview, 1);
  const policy = run.summary.metricResults.find(metric => metric.id.startsWith('judgment_'));
  assert.equal(policy.passed, true);
  assert.equal(policy.passRate, 75);
  const failed = run.results.find(result => result.failed);
  const annotation = { id: 'review', runId: run.id, traceId: failed.traceId, verdict: 'accepted', note: 'Reviewed the synthetic policy gap.', reviewer: 'Example reviewer', createdAt: '2026-11-02T10:00:00Z' };
  const reviewed = aggregateRun(run, [annotation]);
  assert.equal(reviewed.pendingReview, 0);
  assert.equal(reviewed.gate, 'failed');
});

test('checkout exposes missing cost and unknown tool outcome separately from retry failures', () => {
  const prepared = prepareScenario('checkout-reliability');
  const run = evaluateRun(prepared.traces, prepared.spec);
  assert.equal(run.status, 'blocked');
  assert.equal(run.summary.unscored, 2);
  assert.equal(run.summary.failed, 1);
  assert.equal(run.summary.pendingReview, 3);
  assert.equal(run.summary.passRate, 25);
  assert.equal(run.summary.metricResults.find(metric => metric.id === 'cost').scoredCount, 3);
  assert.equal(run.summary.metricResults.find(metric => metric.id === 'tool_success').scoredCount, 3);
  const retry = run.results.find(result => result.traceName.includes('Slow payment retries'));
  assert.deepEqual(retry.scores.filter(score => score.pass === false).map(score => score.metricId), ['latency', 'attribute_agent__checkout_orchestrator__payment_attempt_budget']);
});

test('document review scores the final event and queues the missing and low citation judgments', () => {
  const prepared = prepareScenario('document-review');
  const run = evaluateRun(prepared.traces, prepared.spec);
  assert.equal(run.status, 'blocked');
  assert.equal(run.summary.unscored, 1);
  assert.equal(run.summary.criticalFailures, 1);
  assert.equal(run.summary.pendingReview, 2);
  assert.ok(prepared.traces.every(trace => !/INTERMEDIATE|WRONG SPAN/.test(trace.output)));
  const citation = run.summary.metricResults.find(metric => metric.id.startsWith('judgment_'));
  assert.equal(citation.scoredCount, 2);
  assert.equal(citation.passRate, 50);
});

test('service desk handoff chooses the final specialist service and exposes the critical context loss', () => {
  const prepared = prepareScenario('service-desk-handoff');
  const run = evaluateRun(prepared.traces, prepared.spec);
  assert.equal(run.validation.valid, true);
  assert.equal(run.summary.total, 3);
  assert.equal(run.status, 'failed');
  assert.equal(run.summary.passRate, 66.7);
  assert.equal(run.summary.criticalFailures, 1);
  assert.equal(run.summary.unscored, 0);
  assert.equal(run.summary.pendingReview, 1);
  for (const trace of prepared.traces) {
    assert.deepEqual(new Set(trace.spans.map(span => span.service)), new Set(['service-desk-coordinator', 'identity-specialist', 'access-specialist']));
    assert.equal(trace.spans.filter(span => span.name === 'agent.respond').length, 2);
    assert.doesNotMatch(trace.output, /INTERMEDIATE|WRONG SERVICE/);
    for (const field of ['output', 'context', 'evaluatorScores.handoff_completeness.value']) {
      const mapping = trace.normalization.mappings.find(item => item.field === field);
      assert.equal(mapping.status, 'resolved');
      assert.equal(mapping.serviceName, 'access-specialist');
      assert.equal(mapping.serviceSelector, 'access-specialist');
    }
  }
  const failed = run.results.find(result => result.failed);
  assert.match(failed.traceName, /Approval context lost/);
  assert.deepEqual(failed.scores.filter(score => score.pass === false).map(score => score.metricId), ['judgment_domain__it_operations__handoff_completeness', 'attribute_agent__service_desk_coordinator__handoff_budget']);
});

test('retrieval freshness distinguishes stale or missing age while ignoring same-name cache evidence', () => {
  const prepared = prepareScenario('retrieval-freshness');
  const run = evaluateRun(prepared.traces, prepared.spec);
  assert.equal(run.validation.valid, true);
  assert.equal(run.summary.total, 3);
  assert.equal(run.status, 'blocked');
  assert.equal(run.summary.passRate, 33.3);
  assert.equal(run.summary.unscored, 1);
  assert.equal(run.summary.criticalFailures, 0);
  assert.equal(run.summary.pendingReview, 2);
  assert.ok(prepared.traces.every(trace => !trace.context.includes('MISLEADING CACHE')));
  assert.ok(prepared.traces.every(trace => trace.normalization.mappings.find(item => item.field === 'context').serviceName === 'knowledge-index'));
  const stale = prepared.traces.find(trace => trace.name.includes('Stale knowledge source'));
  const missing = prepared.traces.find(trace => trace.name.includes('Source age missing'));
  assert.equal(stale.attributes['retrieval.source_age_hours'], 72);
  assert.equal(Object.hasOwn(missing.attributes, 'retrieval.source_age_hours'), false);
  const groundedness = run.summary.metricResults.find(metric => metric.id === 'groundedness');
  assert.equal(groundedness.scoredCount, 3);
  assert.equal(groundedness.passRate, 100);
  const freshness = run.summary.metricResults.find(metric => metric.id.endsWith('source_freshness'));
  assert.equal(freshness.scoredCount, 2);
  assert.equal(freshness.passRate, 50);
  assert.equal(missing.normalization.mappings.find(item => item.field === 'attributes.retrieval.source_age_hours').status, 'missing');
});

test('streaming keeps interrupted chunks as evidence without inventing a final answer or receipt', () => {
  const prepared = prepareScenario('streaming-completion');
  const run = evaluateRun(prepared.traces, prepared.spec);
  assert.equal(prepared.spec.dataset.requireOutput, false);
  assert.equal(run.validation.valid, true);
  assert.equal(run.summary.total, 3);
  assert.equal(run.status, 'blocked');
  assert.equal(run.summary.passRate, 33.3);
  assert.equal(run.summary.unscored, 1);
  assert.equal(run.summary.pendingReview, 2);
  const interrupted = prepared.traces.find(trace => trace.name.includes('Interrupted stream'));
  assert.equal(interrupted.output, '');
  assert.equal(Object.hasOwn(interrupted.attributes, 'stream.completion_receipt'), false);
  const stream = interrupted.spans.find(span => span.name === 'chat.stream');
  assert.equal(stream.service, 'stream-gateway');
  assert.equal(stream.events.filter(event => event.name === 'stream.chunk').length, 2);
  assert.equal(stream.events.some(event => event.name === 'stream.completed'), false);
  const incompleteResult = run.results.find(result => result.traceId === interrupted.traceId);
  assert.equal(incompleteResult.scores.find(score => score.metricId.endsWith('completion_receipt')).value, null);
  const late = run.results.find(result => result.traceName.includes('Late first token'));
  const ttft = late.scores.find(score => score.metricId.endsWith('first_token_latency'));
  assert.equal(ttft.value, 1250);
  assert.equal(ttft.pass, false);
  assert.ok(prepared.spec.metrics.find(metric => metric.id.endsWith('completion_receipt')).critical);
});

test('all six portable examples compile with the supplied complete catalog and preserve exact evidence mappings', () => {
  const manifest = parseCatalogYaml(readFileSync(new URL('../scorers.yml', import.meta.url), 'utf8'));
  assert.equal(manifest.valid, true, JSON.stringify(manifest.errors));
  for (const scenario of SCENARIOS) {
    const prepared = prepareScenario(scenario.id);
    const yaml = readFileSync(new URL(`../examples/${scenario.id}.yml`, import.meta.url), 'utf8');
    const compiled = compileYaml(yaml, prepared.spec, manifest.catalog);
    assert.equal(compiled.valid, true, JSON.stringify(compiled.errors));
    assert.deepEqual(compiled.spec.dataset, prepared.spec.dataset);
    assert.deepEqual(compiled.spec.metrics, prepared.spec.metrics);
    const fixture = JSON.parse(readFileSync(new URL(`../public/examples/${scenario.id}-otel-fixture.json`, import.meta.url), 'utf8'));
    assert.deepEqual(fixture, getScenarioFixture(scenario.id));
    const mapping = parse(readFileSync(new URL(`../public/examples/${scenario.profileId}-profile.yml`, import.meta.url), 'utf8'));
    assert.equal(mapping.kind, 'NormalizationProfile');
    assert.deepEqual(mapping.fields, prepared.profile.fields);
  }
});

test('checkout additions merge deterministically without mutating the shared seed catalog', () => {
  const catalog = createScorerCatalog(), before = JSON.stringify(catalog);
  const first = prepareScenario('checkout-reliability'), second = prepareScenario('checkout-reliability');
  assert.deepEqual(first.catalogAdditions, second.catalogAdditions);
  assert.equal(first.catalogAdditions.length, 1);
  const merged = mergeCatalog(catalog, first.catalogAdditions);
  assert.equal(merged.added, 1);
  assert.equal(JSON.stringify(catalog), before);
  const metric = metricFromCatalog(merged.catalog, first.catalogAdditions[0].id, '1.0.0', first.spec.context);
  assert.equal(metric.attributeKey, 'checkout.payment_attempts');
  assert.throws(() => metricFromCatalog(merged.catalog, first.catalogAdditions[0].id, '1.0.0', { agent: 'support-copilot' }), /Requires agent/);
  assert.equal(mergeCatalog(merged.catalog, second.catalogAdditions).added, 0);
  assert.ok(!createScorerCatalog().some(entry => entry.id === first.catalogAdditions[0].id));
});

test('synthetic report labels and escaped mapping lineage survive a report export', () => {
  const prepared = prepareScenario('document-review');
  prepared.traces[0].normalization.warnings.push('<img src=x onerror=alert(1)>');
  const run = evaluateRun(prepared.traces, prepared.spec);
  const html = exportReport(run);
  assert.match(html, /SYNTHETIC SCENARIO/);
  assert.match(html, /no production agent was measured/);
  assert.match(html, /Normalization profile and field lineage/);
  assert.match(html, /document-events-v1/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.equal(run.results.find(result => result.unscored).scores.find(score => score.kind === 'recorded_judgment').value, null);
});

test('synthetic labels never grant demo semantic scores trust through the import boundary', () => {
  const prepared = prepareScenario('support-release');
  const trace = structuredClone(prepared.traces[0]);
  delete trace.evaluatorScores;
  trace.demoScores = { groundedness: 1, relevance: 1, policy_compliance: 1 };
  const imported = normalizeTraceInput([trace]);
  assert.equal(imported.traces[0].demoScores, undefined);
  const spec = structuredClone(prepared.spec);
  spec.dataset.sampleSize = 1; spec.dataset.minSamples = 1;
  delete spec.dataset.normalization;
  const run = evaluateRun(imported.traces, spec);
  assert.equal(run.synthetic, true);
  assert.equal(run.status, 'blocked');
  assert.equal(run.results[0].scores.find(score => score.kind === 'recorded_judgment').value, null);
});
