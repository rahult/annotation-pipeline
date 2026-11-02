import test from 'node:test';
import assert from 'node:assert/strict';
import { stringify } from 'yaml';
import { createInitialState, evaluateRun, importTraces } from './domain.js';
import { createScorerCatalog, validateScorerDraft, saveScorerDraft, publishScorerVersion, metricFromCatalog, scopeAvailability, discoverScorerCandidates, catalogToYaml, parseCatalogYaml, mergeCatalog } from './catalog.js';

const clone = value => structuredClone(value);
const catalog = createScorerCatalog();
const initial = createInitialState();
const draft = overrides => ({ scope: 'agent', target: 'support-agent', slug: 'input-budget', name: 'Input token budget', description: 'Bound the explicitly recorded input token count.', owner: 'Support team', tags: ['tokens', 'cost'], type: 'attribute', unit: 'number', attributeKey: 'gen_ai.usage.input_tokens', threshold: 2000, operator: 'lte', weight: 10, critical: false, ...overrides });
const record = overrides => ({ traceId: 'example-trace', name: 'Support request', service: 'support-agent', environment: 'production', startedAt: '2026-11-02T09:00:00Z', input: 'Please help with billing.', output: 'Our support team can review the billing request.', context: 'Route billing requests to the support team.', durationMs: 1500, costUsd: 0.01, status: 'ok', attributes: {}, ...overrides });
function evaluation(metrics) {
  return { ...clone(initial.specs[0]), metrics, dataset: { ...initial.specs[0].dataset, source: 'import', service: 'all', environment: 'all', minSamples: 1, sampleSize: 10 }, review: { failures: false, sampleRate: 0 }, passThreshold: 100 };
}

test('sample catalog is deterministic, covers all scopes and retains the five builtin metric identities', () => {
  assert.deepEqual(createScorerCatalog(), createScorerCatalog());
  assert.equal(catalog.length, 10);
  assert.deepEqual([...new Set(catalog.map(entry => entry.scope))].sort(), ['agent', 'domain', 'global']);
  assert.equal(catalog.filter(entry => entry.versions.length === 0).length, 1);
  const builtinIds = catalog.filter(entry => entry.scope === 'global').map(entry => metricFromCatalog(catalog, entry.id, '1.0.0').id).sort();
  assert.deepEqual(builtinIds, ['cost', 'groundedness', 'latency', 'relevance', 'tool_success']);
  const resolved = catalog.filter(entry => entry.scope === 'global').map(entry => metricFromCatalog(catalog, entry.id, '1.0.0'));
  const run = evaluateRun(initial.traces, { ...initial.specs[0], metrics: resolved });
  assert.equal(run.summary.score, 93.8);
  assert.equal(run.summary.passRate, 80);
});

test('draft saves copy inputs, leave existing catalog untouched, and do not create executable releases', () => {
  const input = draft();
  const saved = saveScorerDraft(catalog, input);
  assert.equal(catalog.length, 10);
  assert.equal(saved.catalog.length, 11);
  assert.equal(saved.entry.id, 'agent/support-agent/input-budget');
  input.threshold = 1;
  assert.equal(saved.entry.draft.threshold, 2000);
  assert.equal(scopeAvailability(saved.entry, { agent: 'support-agent' }).available, false);
  assert.throws(() => metricFromCatalog(saved.catalog, saved.entry.id, '1.0.0', { agent: 'support-agent' }), /no published version/);
});

test('new-create or fork collisions cannot overwrite an existing draft without explicit edit identity', () => {
  const first = saveScorerDraft(catalog, draft());
  assert.throws(() => saveScorerDraft(first.catalog, draft({ threshold: 1000 })), /already exists/);
  assert.equal(first.entry.draft.threshold, 2000);
  const edited = saveScorerDraft(first.catalog, draft({ threshold: 1000 }), first.entry.id);
  assert.equal(edited.entry.draft.threshold, 1000);
  assert.equal(first.entry.draft.threshold, 2000);
  assert.equal(validateScorerDraft(draft({ slug: 'input_budget' })).valid, false, 'Underscores cannot collide with encoded hyphens.');
  const firstScope = draft({ scope: 'domain', target: 'a-b', slug: 'c' });
  const secondScope = draft({ scope: 'domain', target: 'a', slug: 'b-c' });
  const one = saveScorerDraft(catalog, firstScope);
  const oneRelease = publishScorerVersion(one.catalog, one.entry.id, { version: '1.0.0', changeNote: 'First scoped attribute.' });
  const two = saveScorerDraft(oneRelease.catalog, secondScope);
  const twoRelease = publishScorerVersion(two.catalog, two.entry.id, { version: '1.0.0', changeNote: 'Second scoped attribute.' });
  assert.notEqual(metricFromCatalog(twoRelease.catalog, one.entry.id, '1.0.0', { domain: 'a-b' }).id, metricFromCatalog(twoRelease.catalog, two.entry.id, '1.0.0', { domain: 'a' }).id);
});

test('published definitions and version lists are immutable and updates require a greater exact version', () => {
  const saved = saveScorerDraft(catalog, draft());
  const published = publishScorerVersion(saved.catalog, saved.entry.id, { version: '1.0.0', changeNote: 'First measured token budget.' });
  assert.equal(published.entry.draft, null);
  assert.equal(saved.entry.versions.length, 0);
  assert.throws(() => { published.release.definition.threshold = 1; }, TypeError);
  assert.throws(() => published.entry.versions.push(published.release), TypeError);
  const nextDraft = saveScorerDraft(published.catalog, draft({ threshold: 1200 }), saved.entry.id);
  assert.throws(() => publishScorerVersion(nextDraft.catalog, saved.entry.id, { version: '1.0.0', changeNote: 'Overwrite attempt.' }), /cannot be overwritten/);
  assert.throws(() => publishScorerVersion(nextDraft.catalog, saved.entry.id, { version: '0.9.0', changeNote: 'Rollback identity.' }), /greater than/);
  for (const version of ['latest', '^1.0.0', '1.0', '01.0.0', '1.1.0-beta']) assert.throws(() => publishScorerVersion(nextDraft.catalog, saved.entry.id, { version, changeNote: 'Invalid version.' }), /exact numeric/);
  const later = publishScorerVersion(nextDraft.catalog, saved.entry.id, { version: '1.1.0', changeNote: 'Tighter token budget.' });
  assert.equal(metricFromCatalog(later.catalog, saved.entry.id, '1.0.0', { agent: 'support-agent' }).threshold, 2000);
  assert.equal(metricFromCatalog(later.catalog, saved.entry.id, '1.1.0', { agent: 'support-agent' }).threshold, 1200);
  assert.equal(published.entry.versions.length, 1);
});

test('scope targets match exactly with no agent/domain fallback or wildcard adoption', () => {
  const domain = catalog.find(entry => entry.id === 'domain/customer-support/policy-compliance');
  const agent = catalog.find(entry => entry.id === 'agent/support-agent/tool-outcome-validity');
  assert.equal(scopeAvailability(domain, { domain: 'customer-support' }).available, true);
  assert.equal(scopeAvailability(domain, { domain: 'Customer-Support' }).available, false);
  assert.equal(scopeAvailability(domain, { agent: 'customer-support' }).available, false);
  assert.equal(scopeAvailability(agent, { domain: 'support-agent' }).available, false);
  assert.throws(() => metricFromCatalog(catalog, domain.id, '1.0.0', { domain: 'document-review' }), /Requires domain/);
  assert.throws(() => metricFromCatalog(catalog, agent.id, '1.0.0', { agent: '*' }), /Requires agent/);
  assert.equal(metricFromCatalog(catalog, 'global/response-latency', '1.0.0').id, 'latency');
});

test('deprecation blocks new adoption while exact historical pins remain executable', () => {
  const changed = clone(catalog);
  const entry = changed.find(item => item.id === 'global/response-latency');
  entry.deprecated = true;
  assert.equal(scopeAvailability(entry).available, false);
  assert.equal(metricFromCatalog(changed, entry.id, '1.0.0').threshold, 4000);
  assert.throws(() => metricFromCatalog(changed, entry.id, '1.0.0', { adoption: true }), /cannot be adopted/);
  assert.throws(() => saveScorerDraft(changed, entry.versions[0].definition, entry.id), /deprecated/);
});

test('resolution rejects absent refs/versions and unsafe or out-of-scale overrides', () => {
  assert.throws(() => metricFromCatalog(catalog, 'global/absent', '1.0.0'), /not found/);
  assert.throws(() => metricFromCatalog(catalog, 'global/groundedness', '2.0.0'), /no published version/);
  assert.throws(() => metricFromCatalog(catalog, 'global/groundedness', 'latest'), /exact published/);
  for (const overrides of [{ threshold: 2 }, { threshold: '0.9' }, { weight: 0 }, { enabled: 'true' }, { critical: 1 }, { script: 'run()' }, { unit: 'number' }]) assert.throws(() => metricFromCatalog(catalog, 'global/groundedness', '1.0.0', {}, overrides));
  const metric = metricFromCatalog(catalog, 'global/groundedness', '1.0.0', {}, { threshold: 0.9, weight: 5, enabled: false, critical: false });
  assert.equal(metric.threshold, 0.9);
  assert.equal(metric.enabled, false);
  assert.deepEqual(metric.catalogRef, { ref: 'global/groundedness', version: '1.0.0' });
  assert.equal(catalog[0].versions[0].definition.threshold, 0.85);
});

test('draft validation rejects executable types, wrong units, reserved keys and identity changes', () => {
  assert.equal(validateScorerDraft(draft()).valid, true);
  for (const change of [{ type: 'javascript' }, { attributeKey: '' }, { unit: 'score', threshold: 20 }, { target: 'any/agent' }, { slug: 'Not a slug' }, { weight: -1 }, { owner: '' }, { script: 'alert(1)' }]) assert.equal(validateScorerDraft(draft(change)).valid, false);
  const saved = saveScorerDraft(catalog, draft());
  assert.throws(() => saveScorerDraft(saved.catalog, draft({ target: 'other-agent' }), saved.entry.id), /immutable/);
  const judgment = { ...draft(), type: 'recorded_judgment', unit: 'score', threshold: 0.8, judgmentKey: 'constructor' };
  delete judgment.attributeKey;
  assert.equal(validateScorerDraft(judgment).valid, false);
});

test('discovery derives numeric coverage from own trace attributes and labels demo evidence', () => {
  const inherited = Object.assign(Object.create({ hidden: 4 }), { measured: '0.8', 'token.count': 1200, nested: { score: 1 }, blank: '', flag: true });
  const traces = [{ id: 'a', source: 'demo', attributes: inherited }, { id: 'b', source: 'demo', attributes: { measured: 0.6, 'token.count': 1500, invalid: [] } }, { id: 'c', source: 'demo', attributes: { measured: 'invalid', negative: -1 }, spans: [{ attributes: { 'only.in.span': 9 } }] }];
  const discovered = discoverScorerCandidates(traces, catalog);
  assert.equal(discovered.some(item => ['hidden', 'nested', 'blank', 'flag', 'invalid', 'only.in.span'].includes(item.key)), false);
  const measurement = discovered.find(item => item.key === 'measured');
  assert.equal(measurement.count, 2);
  assert.equal(measurement.total, 3);
  assert.equal(measurement.coverage, 66.7);
  assert.equal(measurement.min, 0.6);
  assert.equal(measurement.max, 0.8);
  assert.equal(measurement.source, 'demo');
  assert.equal(discovered.find(item => item.key === 'token.count').suggestedUnit, 'number');
  assert.equal(discovered.find(item => item.key === 'negative').nonnegative, false);
  assert.deepEqual(discoverScorerCandidates([{ attributes: { text: 'none' } }], catalog), []);
});

test('fresh sample attributes are actual mirrored demo measurements with an uncataloged candidate', () => {
  const discovered = discoverScorerCandidates(initial.traces, catalog);
  const tokens = discovered.find(item => item.key === 'gen_ai.usage.input_tokens');
  assert.equal(tokens.count, 60);
  assert.equal(tokens.source, 'demo');
  assert.equal(tokens.existingRefs.length, 0);
  for (const trace of initial.traces) {
    assert.equal(trace.attributes['response.duration_ms'], trace.durationMs);
    assert.equal(trace.attributes['gen_ai.usage.input_tokens'], trace.spans.find(span => span.type === 'llm').attributes['gen_ai.usage.input_tokens']);
  }
});

test('catalog YAML round-trips every definition, draft and immutable release', () => {
  const parsed = parseCatalogYaml(catalogToYaml(catalog));
  assert.equal(parsed.valid, true, JSON.stringify(parsed.errors));
  assert.deepEqual(parsed.catalog, catalog);
  assert.ok(Object.isFrozen(parsed.catalog[0].versions[0].definition));
});

test('strict catalog import rejects unknown fields, conflicting identities and duplicate versions', () => {
  for (const mutate of [
    data => { data.unrecognized = true; },
    data => { data.scorers[0].network = { url: 'not-executable' }; },
    data => { data.scorers[0].versions[0].definition.script = 'not-executable'; },
    data => { data.scorers[0].versions.push(clone(data.scorers[0].versions[0])); },
    data => { data.scorers[0].versions[0].definition.scope = 'agent'; },
    data => { data.scorers.push(clone(data.scorers[0])); },
  ]) {
    const manifest = { apiVersion: 'tracegrade.dev/v1', kind: 'ScorerCatalog', scorers: clone(catalog) };
    mutate(manifest);
    const result = parseCatalogYaml(stringify(manifest));
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].line > 0);
    assert.equal(result.catalog, null);
  }
  assert.equal(parseCatalogYaml('a: &x [1]\nb: *x').valid, false);
  assert.equal(parseCatalogYaml('kind: ScorerCatalog\nkind: ScorerCatalog').valid, false);
  assert.equal(parseCatalogYaml('scorers: [unfinished').valid, false);
});

test('merging is idempotent and never overwrites a published release', () => {
  const same = mergeCatalog(catalog, createScorerCatalog());
  assert.equal(same.added, 0);
  assert.equal(same.updated, 0);
  const changed = clone(catalog);
  changed[0].versions[0].definition.threshold = 0.2;
  assert.throws(() => mergeCatalog(catalog, changed), /Published versions cannot be overwritten/);
  assert.equal(catalog[0].versions[0].definition.threshold, 0.85);
  const saved = saveScorerDraft(catalog, draft());
  const published = publishScorerVersion(saved.catalog, saved.entry.id, { version: '1.0.0', changeNote: 'New scorer.' });
  const merged = mergeCatalog(catalog, published.catalog);
  assert.equal(merged.added, 1);
  assert.equal(catalog.length, 10);
});

test('merging newer releases preserves old pins and refuses to discard a different local draft', () => {
  const ref = 'global/response-latency';
  const entry = catalog.find(item => item.id === ref);
  const edited = { ...clone(entry.versions[0].definition), threshold: 3500 };
  const saved = saveScorerDraft(catalog, edited, ref);
  const released = publishScorerVersion(saved.catalog, ref, { version: '1.1.0', changeNote: 'Tighter response budget.' });
  const merged = mergeCatalog(catalog, released.catalog);
  assert.equal(merged.updated, 1);
  assert.equal(metricFromCatalog(merged.catalog, ref, '1.0.0').threshold, 4000);
  assert.equal(metricFromCatalog(merged.catalog, ref, '1.1.0').threshold, 3500);
  const conflicting = saveScorerDraft(catalog, { ...edited, threshold: 3000 }, ref);
  assert.throws(() => mergeCatalog(saved.catalog, conflicting.catalog), /different local draft/);
});

test('custom recorded judgments execute only when the exact imported key has real provenance', () => {
  const metric = metricFromCatalog(catalog, 'domain/customer-support/policy-compliance', '1.0.0', { domain: 'customer-support' });
  assert.equal(metric.kind, 'recorded_judgment');
  assert.equal(metric.judgmentKey, 'policy_compliance');
  const spec = evaluation([metric]);
  const imported = importTraces([record({ evaluatorScores: { policy_compliance: { value: 0.95, provenance: 'policy-judge / rubric-3 / run-1', reason: 'Within policy.' } } })]);
  assert.equal(evaluateRun(imported.traces, spec).status, 'passed');
  const absent = importTraces([record({ demoScores: { policy_compliance: 1 } })]);
  assert.equal(evaluateRun(absent.traces, spec).status, 'blocked');
});

test('multiple catalog phrase checks get distinct runtime identities and evaluate independently', () => {
  const first = metricFromCatalog(catalog, 'domain/customer-support/escalation-language', '1.0.0', { domain: 'customer-support' });
  const phrase = { ...clone(catalog.find(item => item.id === 'domain/customer-support/escalation-language').versions[0].definition), slug: 'billing-language', name: 'Billing language', keyword: 'billing' };
  const saved = saveScorerDraft(catalog, phrase);
  const published = publishScorerVersion(saved.catalog, saved.entry.id, { version: '1.0.0', changeNote: 'Another phrase requirement.' });
  const second = metricFromCatalog(published.catalog, saved.entry.id, '1.0.0', { domain: 'customer-support' });
  assert.notEqual(first.id, second.id);
  assert.match(first.id, /^contains_/);
  const traces = importTraces([record()]).traces;
  assert.equal(evaluateRun(traces, evaluation([first, second])).status, 'passed');
});

test('published number-unit attributes score actual unbounded token measurements', () => {
  const saved = saveScorerDraft(catalog, draft());
  const published = publishScorerVersion(saved.catalog, saved.entry.id, { version: '1.0.0', changeNote: 'Input-token budget.' });
  const metric = metricFromCatalog(published.catalog, saved.entry.id, '1.0.0', { agent: 'support-agent' });
  const traces = importTraces([record({ attributes: { 'gen_ai.usage.input_tokens': '1400' } })]).traces;
  const run = evaluateRun(traces, evaluation([metric]));
  assert.equal(run.status, 'passed');
  assert.equal(run.results[0].scores[0].value, 1400);
});
