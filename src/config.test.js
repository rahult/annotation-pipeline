import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stringify } from 'yaml';
import { createInitialState, evaluateRun, filterTraces } from './domain.js';
import { compileYaml, configSchema, specToConfig, specToYaml } from './config.js';
import { createScorerCatalog, metricFromCatalog } from './catalog.js';
import { TRACE_PROFILES } from './traceProfiles.js';

const state = createInitialState();
const base = state.specs[0];
const copy = (value) => structuredClone(value);
const compileConfig = (config, spec = base) => compileYaml(stringify(config), spec);

test('all seeded specifications round-trip without losing runtime evaluation behavior', () => {
  for (const spec of state.specs) {
    const result = compileYaml(specToYaml(spec), spec);
    assert.equal(result.valid, true, JSON.stringify(result.errors));
    assert.deepEqual(result.spec, spec);
    assert.deepEqual(result.config, specToConfig(spec));
    assert.deepEqual(evaluateRun(state.traces, result.spec).summary, evaluateRun(state.traces, spec).summary);
  }
});

test('full custom configuration round-trips attributes, phrase, dates, review, execution and report settings', () => {
  const spec = copy(base);
  spec.dataset = { ...spec.dataset, source: 'import', service: 'another-agent', environment: 'staging', selection: 'errors_first', startDate: '2026-11-02T09:00:00.000Z', endDate: '2026-11-03T09:00:00.000Z', requireContext: false };
  spec.metrics.push({ id: 'attribute_safety-v2', name: 'Policy compliance', description: 'Recorded platform score', kind: 'attribute', attributeKey: 'eval.safety_score', unit: 'score', threshold: 0.9, operator: 'gte', weight: 12, enabled: true, critical: true });
  spec.metrics.push({ id: 'contains', name: 'Escalation phrase', description: 'Literal phrase', kind: 'deterministic', keyword: 'billing team', unit: 'score', threshold: 1, operator: 'gte', weight: 3, enabled: false, critical: false });
  spec.review = { failures: false, sampleRate: 12.5 };
  spec.automation = { trigger: 'scheduled', schedule: 'weekly', reportFormat: 'csv' };
  spec.passThreshold = 92.5;
  const result = compileYaml(specToYaml(spec), spec);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.deepEqual(result.spec, spec);
  assert.match(result.warnings.join(' '), /schedule is configuration only/);
});

test('explicit built-in trace mappings round-trip without reinterpreting loaded traces, blocking mismatched provenance', () => {
  const originalTraces = copy(state.traces);
  for (const profile of TRACE_PROFILES) {
    const spec = copy(base);
    spec.dataset.normalization = { profile: profile.id, version: profile.version };
    const result = compileYaml(specToYaml(spec), spec);
    assert.equal(result.valid, true, JSON.stringify(result.errors));
    assert.deepEqual(result.spec.dataset, spec.dataset);
    assert.deepEqual(result.config.dataset.normalization, spec.dataset.normalization);
    assert.deepEqual(filterTraces(state.traces, result.spec), filterTraces(state.traces, base), 'The mapping choice must not silently filter or remap the cohort.');
    const run = evaluateRun(state.traces, result.spec);
    assert.equal(run.status, 'blocked');
    assert.match(run.validation.errors.join(' '), /Re-import the original OTLP data/);
    assert.deepEqual(state.traces, originalTraces, 'Loaded evidence must remain unchanged.');
  }
});

test('synthetic scenario cohort filters round-trip only when explicitly declared and never inherit stale selection', () => {
  const spec = copy(base);
  spec.dataset.scenarioId = 'support-release';
  const result = compileYaml(specToYaml(spec), spec);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.config.dataset.filters.scenario, 'support-release');
  assert.equal(result.spec.dataset.scenarioId, 'support-release');
  assert.deepEqual(result.spec.dataset, spec.dataset);
  const ordinary = compileYaml(specToYaml(base), spec);
  assert.equal(ordinary.valid, true);
  assert.equal(Object.hasOwn(ordinary.spec.dataset, 'scenarioId'), false);
  assert.equal(Object.hasOwn(ordinary.config.dataset.filters, 'scenario'), false);
});

test('synthetic scenario filters require a bounded lowercase slug with precise YAML diagnostics', () => {
  for (const scenario of ['', 'Support-Release', 'support_release', '../support', 'support release', 'a'.repeat(121), null, 3]) {
    const config = specToConfig(base);
    config.dataset.filters.scenario = scenario;
    const result = compileConfig(config);
    assert.equal(result.valid, false);
    const error = result.errors.find(item => item.path === 'dataset.filters.scenario');
    assert.ok(error, JSON.stringify(result.errors));
    assert.ok(error.line > 0 && error.column > 0);
  }
});

test('trace mappings reject unknown profiles, absent versions, ranges, unsupported versions and extra fields at their source path', () => {
  for (const [normalization, path] of [
    [{ profile: 'unknown-team-v1', version: '1.0.0' }, 'dataset.normalization.profile'],
    [{ profile: 'support-genai-v1' }, 'dataset.normalization.version'],
    [{ profile: 'support-genai-v1', version: 'latest' }, 'dataset.normalization.version'],
    [{ profile: 'support-genai-v1', version: '2.0.0' }, 'dataset.normalization.version'],
    [{ profile: 'auto', version: '1.0.0' }, 'dataset.normalization.profile'],
    [{ profile: 'support-genai-v1', version: '1.0.0', fallback: true }, 'dataset.normalization.fallback'],
  ]) {
    const config = specToConfig(base);
    config.dataset.normalization = normalization;
    const result = compileConfig(config);
    assert.equal(result.valid, false);
    const error = result.errors.find(item => item.path === path);
    assert.ok(error, JSON.stringify(result.errors));
    assert.ok(error.line > 0 && error.column > 0);
  }
});

test('omitting trace normalization keeps legacy auto behavior and never inherits an obsolete base mapping', () => {
  const withMapping = copy(base);
  withMapping.dataset.normalization = { profile: 'support-genai-v1', version: '1.0.0' };
  const result = compileYaml(specToYaml(base), withMapping);
  assert.equal(result.valid, true);
  assert.equal(Object.hasOwn(result.spec.dataset, 'normalization'), false);
  assert.equal(Object.hasOwn(result.config.dataset, 'normalization'), false);
});

test('compilation preserves workspace identity but never leaks stale saved YAML into its runtime projection', () => {
  const original = { ...base, id: 'spec-current', version: 42, updatedAt: '2026-11-01T00:00:00Z', configYaml: 'outdated: true', extraRuntimeField: 'not configuration' };
  const config = specToConfig(base);
  config.metadata.name = 'Edited in YAML';
  const result = compileConfig(config, original);
  assert.equal(result.valid, true);
  assert.equal(result.spec.id, original.id);
  assert.equal(result.spec.version, original.version);
  assert.equal(result.spec.updatedAt, original.updatedAt);
  assert.equal(result.spec.name, 'Edited in YAML');
  assert.equal(result.spec.configYaml, undefined);
  assert.equal(result.spec.extraRuntimeField, undefined);
});

test('compilation is independent of dataset availability and can create a new runtime identity', () => {
  const config = specToConfig(base);
  config.dataset.source = 'import';
  config.dataset.filters.service = 'not-imported-yet';
  const result = compileYaml(stringify(config));
  assert.equal(result.valid, true);
  assert.match(result.spec.id, /^spec_/);
  assert.equal(result.spec.version, 1);
  assert.equal(evaluateRun([], result.spec).status, 'blocked');
});

test('unknown root and nested fields are rejected with an exact path and source position', () => {
  for (const [path, mutate] of [
    ['pipelines', (config) => { config.pipelines = []; }],
    ['dataset.filters.sevice', (config) => { config.dataset.filters.sevice = 'typo'; }],
    ['scorers[0].prompt', (config) => { config.scorers[0].prompt = 'Unsupported live judge prompt'; }],
    ['metadata.version', (config) => { config.metadata.version = 99; }],
  ]) {
    const config = specToConfig(base);
    mutate(config);
    const result = compileConfig(config);
    assert.equal(result.valid, false);
    const error = result.errors.find((entry) => entry.path === path);
    assert.ok(error, JSON.stringify(result.errors));
    assert.ok(error.line > 0 && error.column > 0);
    assert.equal(result.spec, null);
    assert.equal(result.config, null);
  }
});

test('syntax failures, duplicate YAML keys, scalar roots and multiple documents fail clearly', () => {
  const malformed = compileYaml('metadata:\n  name: [unfinished\n');
  assert.equal(malformed.valid, false);
  assert.ok(malformed.errors[0].line >= 2);
  assert.equal(compileYaml('kind: Evaluation\nkind: Other\n').valid, false);
  assert.equal(compileYaml('just a string').valid, false);
  assert.equal(compileYaml('[]').valid, false);
  assert.equal(compileYaml('null').valid, false);
  assert.equal(compileYaml('').valid, false);
  assert.equal(compileYaml(`${specToYaml(base)}\n---\nkind: Evaluation`).valid, false);
});

test('duplicate scorer and guideline IDs cannot silently merge, including disabled scorers', () => {
  const config = specToConfig(base);
  config.scorers.push({ ...copy(config.scorers[0]), enabled: false });
  config.guidelines.push(copy(config.guidelines[0]));
  const result = compileConfig(config);
  assert.equal(result.valid, false);
  assert.match(result.errors.map((error) => error.message).join(' '), /Duplicate scorer ID/);
  assert.match(result.errors.map((error) => error.message).join(' '), /Duplicate guideline ID/);
});

test('API version, kind, scorer types, metric IDs and units are explicit contracts', () => {
  for (const mutate of [
    (config) => { config.apiVersion = 'tracegrade.dev/v2'; },
    (config) => { config.kind = 'Workflow'; },
    (config) => { config.scorers[0].type = 'javascript'; },
    (config) => { config.scorers[0].id = 'hallucination'; },
    (config) => { config.scorers[2].unit = 'score'; },
    (config) => { config.scorers[0].attribute = 'unrelated'; },
  ]) {
    const config = specToConfig(base);
    mutate(config);
    assert.equal(compileConfig(config).valid, false, JSON.stringify(config));
  }
});

test('invalid thresholds, numeric strings, weights, booleans and sample sizes are rejected', () => {
  for (const mutate of [
    (config) => { config.scorers[0].threshold.value = 1.1; },
    (config) => { config.scorers[3].threshold.value = 101; },
    (config) => { config.scorers[0].threshold.value = '0.85'; },
    (config) => { config.scorers[0].weight = 0; },
    (config) => { config.scorers[0].weight = Infinity; },
    (config) => { config.scorers[0].enabled = 'true'; },
    (config) => { config.dataset.sample.minimum = config.dataset.sample.size + 1; },
    (config) => { config.dataset.sample.size = 1.5; },
    (config) => { config.dataset.sample.size = 5001; },
    (config) => { config.release.minimum_pass_rate = 101; },
    (config) => { config.review.sample_percent = -1; },
    (config) => { config.scorers.forEach((scorer) => { scorer.enabled = false; }); },
  ]) {
    const config = specToConfig(base);
    mutate(config);
    assert.equal(compileConfig(config).valid, false, JSON.stringify(config));
  }
});

test('aliases, recursive expansion and unsupported tags are rejected before conversion', () => {
  for (const source of [
    'a: &data [1, 2, 3]\nb: *data\n',
    'a: &recursive [*recursive]\n',
    'metadata: !custom { name: test }\n',
    '%YAML 1.1\n---\nkind: Evaluation\n',
  ]) {
    const result = compileYaml(source);
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].line >= 1 && result.errors[0].column >= 1);
  }
});

test('the compiler itself enforces the 256 KiB UTF-8 limit for browser and CLI callers', () => {
  const oversized = `# ${'é'.repeat(140 * 1024)}\n${specToYaml(base)}`;
  assert.ok(oversized.length < 256 * 1024, 'The fixture distinguishes UTF-8 bytes from string length.');
  const result = compileYaml(oversized, base);
  assert.equal(result.valid, false);
  assert.match(result.errors[0].message, /256 KiB/);
});

test('dates require a real timezone-qualified instant, normalize to UTC, and reject reversed ranges', () => {
  const config = specToConfig(base);
  config.dataset.filters.start = '2026-11-02T20:00:00+11:00';
  config.dataset.filters.end = '2026-11-02T21:00:00+11:00';
  const result = compileConfig(config);
  assert.equal(result.valid, true);
  assert.equal(result.spec.dataset.startDate, '2026-11-02T09:00:00.000Z');
  assert.equal(result.config.dataset.filters.end, '2026-11-02T10:00:00.000Z');
  for (const date of ['2026-11-02T20:00', '2026-02-30T00:00:00Z', 'yesterday', '2026-11-02T24:00:00Z']) {
    config.dataset.filters.start = date;
    assert.equal(compileConfig(config).valid, false, date);
  }
  config.dataset.filters.start = '2026-11-03T00:00:00Z';
  assert.equal(compileConfig(config).valid, false);
});

test('optional descriptions, empty runtime dates and manual schedule defaults preserve intended behavior', () => {
  const spec = { ...copy(base), dataset: { ...base.dataset, startDate: '', endDate: '' } };
  const config = specToConfig(spec);
  assert.equal(Object.hasOwn(config.dataset.filters, 'start'), false);
  assert.equal(Object.hasOwn(config.dataset.filters, 'end'), false);
  delete config.metadata.description;
  delete config.guidelines[0].description;
  delete config.scorers[0].description;
  delete config.execution.schedule;
  const result = compileConfig(config);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.spec.description, '');
  assert.equal(result.spec.guidelines[0].description, '');
  assert.equal(result.spec.metrics[0].description, '');
  assert.equal(result.spec.automation.schedule, 'daily');
  config.execution.trigger = 'scheduled';
  assert.equal(compileConfig(config).valid, false);
});

test('the downloadable schema exactly matches the schema used by the compiler', () => {
  const schema = JSON.parse(readFileSync(new URL('../public/evaluation.schema.json', import.meta.url), 'utf8'));
  assert.deepEqual(schema, configSchema);
});

test('catalog references resolve an exact release and export explicit per-evaluation overrides', () => {
  const catalog = createScorerCatalog();
  const config = specToConfig(base);
  config.metadata.domain = 'customer-support';
  config.metadata.agent = 'support-agent';
  config.scorers = [{ ref: 'global/response-latency', version: '1.0.0' }];
  const resolved = compileYaml(stringify(config), base, catalog);
  assert.equal(resolved.valid, true, JSON.stringify(resolved.errors));
  assert.deepEqual(resolved.spec.context, { domain: 'customer-support', agent: 'support-agent' });
  const metric = resolved.spec.metrics[0];
  assert.deepEqual(metric.catalogRef, { ref: 'global/response-latency', version: '1.0.0' });
  assert.deepEqual(resolved.config.scorers[0], { ref: 'global/response-latency', version: '1.0.0', threshold: { operator: metric.operator, value: metric.threshold }, weight: metric.weight, enabled: metric.enabled, critical: metric.critical });
  assert.equal(Object.hasOwn(resolved.config.scorers[0], 'id'), false);
  assert.deepEqual(compileYaml(specToYaml(resolved.spec), base, catalog).spec, resolved.spec);
  config.scorers[0] = { ...config.scorers[0], threshold: { operator: 'lte', value: 900 }, weight: 23, enabled: true, critical: true };
  const overridden = compileYaml(stringify(config), base, catalog);
  assert.equal(overridden.valid, true, JSON.stringify(overridden.errors));
  assert.equal(overridden.spec.metrics[0].threshold, 900);
  assert.equal(overridden.spec.metrics[0].weight, 23);
  assert.equal(overridden.spec.metrics[0].critical, true);
});

test('catalog references require explicit versions, supported overrides, and known releases', () => {
  const catalog = createScorerCatalog();
  for (const reference of [
    { ref: 'global/response-latency' },
    { ref: 'global/response-latency', version: 'latest' },
    { ref: 'global/response-latency', version: '^1.0.0' },
    { ref: 'global/response-latency', version: '999.0.0' },
    { ref: 'global/nonexistent-scorer', version: '1.0.0' },
    { ref: 'global/response-latency', version: '1.0.0', unit: 'score' },
    { ref: 'global/groundedness', version: '1.0.0', threshold: { operator: 'gte', value: 2 } },
  ]) {
    const config = specToConfig(base);
    config.scorers = [reference];
    const result = compileYaml(stringify(config), base, catalog);
    assert.equal(result.valid, false, JSON.stringify(reference));
    assert.ok(result.errors.some(error => error.path.startsWith('scorers[0]') && error.line > 0 && error.column > 0), JSON.stringify(result.errors));
  }
});

test('domain and agent catalog scopes are enforced against declared evaluation context', () => {
  const catalog = createScorerCatalog();
  for (const scope of ['domain', 'agent']) {
    const entry = catalog.find(item => item.scope === scope);
    assert.ok(entry, `Seed contains a ${scope} scorer`);
    const config = specToConfig(base);
    config.metadata[scope] = entry.target;
    config.scorers = [{ ref: entry.id, version: entry.versions[0].version }];
    assert.equal(compileYaml(stringify(config), base, catalog).valid, true, entry.id);
    config.metadata[scope] = 'unrelated-context';
    const wrongScope = compileYaml(stringify(config), base, catalog);
    assert.equal(wrongScope.valid, false);
    assert.ok(wrongScope.errors.some(error => error.path === 'scorers[0].ref'));
    delete config.metadata[scope];
    assert.equal(compileYaml(stringify(config), base, catalog).valid, false);
  }
});

test('resolved scorer identities stay unique across inline and referenced definitions', () => {
  const config = specToConfig(base);
  const inlineLatency = config.scorers.find(scorer => scorer.id === 'latency');
  config.scorers = [{ ref: 'global/response-latency', version: '1.0.0' }, inlineLatency];
  const duplicate = compileConfig(config);
  assert.equal(duplicate.valid, false);
  assert.match(duplicate.errors.map(error => error.message).join(' '), /Duplicate scorer ID: latency/);
  config.scorers = [{ ref: 'global/response-latency', version: '1.0.0', enabled: false }];
  assert.match(compileConfig(config).errors.map(error => error.message).join(' '), /Enable at least one/);
});

test('custom recorded judgments preserve their key, rubric, context and missing-evidence behavior', () => {
  const spec = copy(base);
  spec.context = { domain: 'customer-support', agent: 'support-agent' };
  spec.metrics.push({ id: 'judgment_resolution_quality', name: 'Resolution quality', description: 'A supplied policy judgment', kind: 'recorded_judgment', judgmentKey: 'resolution_quality', rubric: 'The response resolves the request within the stated support policy.', threshold: 0.9, operator: 'gte', unit: 'score', weight: 8, enabled: true, critical: true });
  const result = compileYaml(specToYaml(spec), spec);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.deepEqual(result.spec, spec);
  assert.match(result.warnings.join(' '), /no model is called/);
  assert.equal(evaluateRun(state.traces, result.spec).summary.gate, 'blocked');
  const malformed = specToConfig(spec);
  delete malformed.scorers.at(-1).rubric;
  assert.equal(compileConfig(malformed).valid, true, 'A copied rubric is optional for a recorded judgment.');
  delete malformed.scorers.at(-1).judgment_key;
  assert.equal(compileConfig(malformed).valid, false);
  malformed.scorers.at(-1).judgment_key = '__proto__';
  assert.equal(compileConfig(malformed).valid, false);
});

test('generic numeric attribute metrics retain units without imposing a score scale', () => {
  const spec = copy(base);
  spec.metrics.push({ id: 'attribute_total_tokens', name: 'Total tokens', description: 'Explicit token count', kind: 'attribute', attributeKey: 'gen_ai.usage.total_tokens', threshold: 5000, operator: 'lte', unit: 'number', weight: 2, enabled: true, critical: false });
  const result = compileYaml(specToYaml(spec), spec);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.deepEqual(result.spec.metrics.at(-1), spec.metrics.at(-1));
});

test('removing context from YAML cannot inherit stale scoped permissions from the runtime projection', () => {
  const catalog = createScorerCatalog();
  const scoped = catalog.find(item => item.scope === 'agent');
  const config = specToConfig(base);
  config.scorers = [{ ref: scoped.id, version: scoped.versions[0].version }];
  const staleProjection = { ...base, context: { domain: 'customer-support', agent: scoped.target } };
  const result = compileYaml(stringify(config), staleProjection, catalog);
  assert.equal(result.valid, false);
});

test('a run freezes resolved scorer definitions and later catalog releases never upgrade a pin', () => {
  const catalog = createScorerCatalog();
  const config = specToConfig(base);
  config.scorers = [{ ref: 'global/response-latency', version: '1.0.0' }];
  const yaml = stringify(config);
  const compiled = compileYaml(yaml, base, catalog);
  assert.equal(compiled.valid, true);
  const run = evaluateRun(state.traces, { ...compiled.spec, configYaml: yaml });
  const snapshot = copy(run.specSnapshot);
  const newerCatalog = copy(catalog);
  const entry = newerCatalog.find(item => item.id === 'global/response-latency');
  entry.versions.push({ ...copy(entry.versions[0]), version: '2.0.0', changeNote: 'A later release must be adopted explicitly.' });
  const stillPinned = compileYaml(yaml, base, newerCatalog);
  assert.equal(stillPinned.valid, true, JSON.stringify(stillPinned.errors));
  assert.deepEqual(stillPinned.spec.metrics[0], compiled.spec.metrics[0]);
  assert.deepEqual(run.specSnapshot, snapshot);
  assert.deepEqual(metricFromCatalog(newerCatalog, 'global/response-latency', '1.0.0', {}).catalogRef, { ref: 'global/response-latency', version: '1.0.0' });
});
