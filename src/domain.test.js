import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, filterTraces, validateDataset, evaluateRun, importTraces, aggregateRun, exportReport, exportCSV, exportSpec } from './domain.js';

const copy = (value) => structuredClone(value);
function specification(overrides = {}) {
  const spec = copy(createInitialState().specs[0]);
  spec.dataset = { source: 'import', service: 'all', environment: 'all', sampleSize: 10, minSamples: 1, requireInput: true, requireOutput: true, requireContext: false, selection: 'recent' };
  spec.metrics = spec.metrics.filter((metric) => ['latency', 'cost', 'tool_success'].includes(metric.id));
  spec.review = { failures: true, sampleRate: 0 };
  spec.passThreshold = 100;
  return { ...spec, ...overrides };
}
function trace(overrides = {}) {
  return { id: 'trace-1', traceId: 'trace-1', source: 'import', name: 'Refund question', service: 'support-agent', environment: 'production', startedAt: '2026-11-02T08:30:00.000Z', durationMs: 2200, costUsd: 0.012, status: 'ok', input: 'Can I get a refund?', output: 'Billing will review the refund request.', context: 'Refunds require billing approval.', spans: [{ id: 'span-1', type: 'tool', name: 'lookup', status: 'ok', durationMs: 120, startMs: 10, attributes: {} }], ...overrides };
}

test('seeded state is coherent and all seed runs are explicitly demo snapshots', () => {
  const state = createInitialState();
  assert.equal(state.traces.length, 60);
  assert.equal(state.specs.length, 3);
  assert.equal(state.runs.length, 5);
  assert.equal(new Set(state.traces.map((item) => item.id)).size, 60);
  assert.ok(state.runs.every((run) => run.demo && run.label.startsWith('RUN-')));
  assert.ok(state.runs.some((run) => run.status === 'passed'));
  assert.ok(state.runs.some((run) => run.status === 'failed'));
  for (const run of state.runs) {
    assert.ok(run.summary.score >= 0 && run.summary.score <= 100);
    assert.ok(run.summary.passRate >= 0 && run.summary.passRate <= 100);
  }
});

test('zero matched records hard-block evaluation', () => {
  const run = evaluateRun([], specification());
  assert.equal(run.status, 'blocked');
  assert.equal(run.summary.score, null);
  assert.equal(run.results.length, 0);
  assert.match(run.validation.errors.join(' '), /No traces/);
});

test('required content missing in the selected cohort blocks instead of being silently excluded', () => {
  const run = evaluateRun([trace(), trace({ id: 'trace-2', output: '' })], specification());
  assert.equal(run.status, 'blocked');
  assert.equal(run.validation.eligibleCount, 1);
  assert.match(run.validation.errors.join(' '), /missing required output/);
});

test('minimum cohort size is a hard gate', () => {
  const spec = specification();
  spec.dataset.minSamples = 2;
  const run = evaluateRun([trace()], spec);
  assert.equal(run.status, 'blocked');
  assert.match(run.validation.errors.join(' '), /at least 2/);
});

test('a pinned normalization profile blocks stale or missing field-mapping evidence', () => {
  const spec = specification();
  spec.dataset.normalization = { profile: 'support-genai-v1', version: '1.0.0' };
  const normalized = trace({ normalization: { profileId: 'support-genai-v1', profileVersion: '1.0.0', mappings: [], warnings: [] } });
  assert.equal(evaluateRun([normalized], spec).status, 'passed');
  for (const normalization of [undefined, { profileId: 'checkout-shop-v1', profileVersion: '1.0.0' }, { profileId: 'support-genai-v1', profileVersion: '2.0.0' }]) {
    const run = evaluateRun([trace({ normalization })], spec);
    assert.equal(run.status, 'blocked');
    assert.equal(run.results.length, 0);
    assert.match(run.validation.errors.join(' '), /Re-import the original OTLP data/);
  }
  spec.dataset.normalization = { profile: '', version: '' };
  assert.match(validateDataset([normalized], spec).errors.join(' '), /exact profile ID and version/);
});

test('source/service/environment/date filters are exact, inclusive, and do not mutate input', () => {
  const spec = specification();
  spec.dataset = { ...spec.dataset, service: 'support-agent', environment: 'production', sampleSize: 2, startDate: '2026-11-02T08:30:00Z', endDate: '2026-11-02T08:31:00Z' };
  const rows = [trace(), trace({ id: 'trace-2', startedAt: '2026-11-02T08:31:00Z' }), trace({ id: 'wrong-source', source: 'demo' }), trace({ id: 'wrong-env', environment: 'staging' }), trace({ id: 'wrong-service', service: 'other' }), trace({ id: 'missing-time', startedAt: '' })];
  const before = JSON.stringify(rows);
  assert.deepEqual(filterTraces(rows, spec).map((item) => item.id), ['trace-2', 'trace-1']);
  assert.equal(JSON.stringify(rows), before);
});

test('invalid or reversed date bounds block', () => {
  const spec = specification();
  spec.dataset.startDate = 'not-a-date';
  assert.match(validateDataset([trace()], spec).errors.join(' '), /valid timestamp/);
  spec.dataset.startDate = '2026-11-03T00:00:00Z';
  spec.dataset.endDate = '2026-11-01T00:00:00Z';
  assert.match(validateDataset([trace()], spec).errors.join(' '), /on or before/);
});

test('errors-first sampling selects error traces before newer successes', () => {
  const spec = specification();
  spec.dataset.selection = 'errors_first';
  spec.dataset.sampleSize = 1;
  const rows = [trace(), trace({ id: 'error', startedAt: '2026-11-01T00:00:00Z', status: 'error' })];
  assert.equal(filterTraces(rows, spec)[0].id, 'error');
});

test('non-finite thresholds, impossible score ranges, zero weights and disabled metrics block', () => {
  const spec = specification();
  spec.metrics[0].threshold = Infinity;
  spec.metrics[1].weight = 0;
  assert.equal(validateDataset([trace()], spec).valid, false);
  spec.metrics = [{ id: 'groundedness', name: 'Groundedness', unit: 'score', kind: 'demo_judge', threshold: 85, operator: 'gte', weight: 10, enabled: true }];
  assert.match(validateDataset([trace()], spec).errors.join(' '), /outside its supported range/);
  spec.metrics = [];
  assert.match(validateDataset([trace()], spec).errors.join(' '), /Enable at least/);
});

test('deterministic scorers evaluate actual duration, explicit cost, and tool evidence', () => {
  const run = evaluateRun([trace()], specification());
  assert.equal(run.status, 'passed');
  assert.equal(run.summary.score, 100);
  assert.equal(run.summary.passRate, 100);
  assert.deepEqual(run.results[0].scores.map((score) => score.value), [2200, 100, 0.012]);
});

test('missing cost and tool evidence remain unscored rather than becoming zero-cost successes', () => {
  const run = evaluateRun([trace({ costUsd: null, spans: [] })], specification());
  assert.equal(run.status, 'blocked');
  assert.equal(run.summary.unscored, 1);
  assert.equal(run.results[0].scores.find((score) => score.metricId === 'cost').value, null);
  assert.equal(run.results[0].scores.find((score) => score.metricId === 'tool_success').pass, null);
});

test('canonical import strips semantic demo scores and imported semantics stay unscored', () => {
  const imported = importTraces([trace({ source: 'demo', demoScores: { groundedness: 1, relevance: 1 } })]);
  assert.equal(imported.traces[0].source, 'import');
  assert.equal(imported.traces[0].demoScores, undefined);
  const spec = specification();
  spec.metrics = [copy(createInitialState().specs[0].metrics[0])];
  const run = evaluateRun(imported.traces, spec);
  assert.equal(run.status, 'blocked');
  assert.equal(run.results[0].scores[0].value, null);
});

test('supplied semantic evaluator scores require valid values and provenance', () => {
  const spec = specification();
  spec.metrics = [copy(createInitialState().specs[0].metrics[0])];
  const imported = importTraces([trace({ evaluatorScores: { groundedness: { value: 0.94, provenance: 'external judge / rubric-v3', reason: 'All claims are supported.' } } })]);
  const run = evaluateRun(imported.traces, spec);
  assert.equal(run.status, 'passed');
  assert.equal(run.results[0].scores[0].kind, 'external_judge');
  assert.equal(run.results[0].scores[0].value, 0.94);
  const noProvenance = importTraces([trace({ evaluatorScores: { groundedness: { value: 1 } } })]);
  assert.equal(evaluateRun(noProvenance.traces, spec).status, 'blocked');
});

test('annotation completion does not convert an automatic failure to a pass', () => {
  const run = evaluateRun([trace({ durationMs: 8000 })], specification(), [], { id: 'run-review' });
  assert.equal(run.status, 'failed');
  assert.equal(run.summary.pendingReview, 1);
  const summary = aggregateRun(run, [{ id: 'annotation-1', runId: run.id, traceId: 'trace-1', verdict: 'accepted', note: 'Reviewed.', reviewer: 'Reviewer', createdAt: '2026-11-02T12:00:00Z' }]);
  assert.equal(summary.gate, 'failed');
  assert.equal(summary.pendingReview, 0);
  assert.equal(summary.automaticGate, 'failed');
});

test('human rejection fails an otherwise passing gate; needs_work remains pending', () => {
  const spec = specification();
  spec.review.sampleRate = 100;
  const run = evaluateRun([trace()], spec, [], { id: 'run-human' });
  assert.equal(run.status, 'review');
  const annotation = { id: 'a1', runId: run.id, traceId: 'trace-1', verdict: 'needs_work', createdAt: '2026-11-02T12:00:00Z' };
  assert.equal(aggregateRun(run, [annotation]).pendingReview, 1);
  assert.equal(aggregateRun(run, [{ ...annotation, verdict: 'rejected' }]).gate, 'failed');
  assert.equal(aggregateRun(run, [{ ...annotation, verdict: 'accepted' }]).gate, 'passed');
});

test('critical failure cannot be hidden by a low required pass rate', () => {
  const spec = specification({ passThreshold: 0 });
  spec.metrics[0].critical = true;
  const run = evaluateRun([trace({ durationMs: 8000 })], spec);
  assert.equal(run.summary.criticalFailures, 1);
  assert.equal(run.status, 'failed');
});

test('run snapshots survive subsequent source and specification mutations', () => {
  const spec = specification();
  const source = [trace()];
  const run = evaluateRun(source, spec);
  spec.name = 'Changed';
  spec.metrics[0].threshold = 1;
  source[0].output = 'Changed evidence';
  assert.notEqual(run.specSnapshot.name, spec.name);
  assert.equal(run.specSnapshot.metrics[0].threshold, 4000);
  assert.equal(run.datasetSnapshot[0].output, 'Billing will review the refund request.');
  assert.ok(Object.isFrozen(run.datasetSnapshot[0]));
});

function otlp() {
  return { resourceSpans: [{ resource: { attributes: [{ key: 'service.name', value: { stringValue: 'support-agent' } }, { key: 'deployment.environment.name', value: { stringValue: 'production' } }] }, scopeSpans: [{ spans: [{ traceId: '0123456789abcdef0123456789abcdef', spanId: '0123456789abcdef', name: 'support.resolve', startTimeUnixNano: '1700000000000000001', endTimeUnixNano: '1700000000002500001', status: { code: 1 }, attributes: [{ key: 'input.value', value: { stringValue: 'Question' } }, { key: 'output.value', value: { stringValue: 'Answer' } }, { key: 'gen_ai.operation.name', value: { stringValue: 'execute_tool' } }, { key: 'trace.cost_usd', value: { doubleValue: 0.01 } }] }] }] }] };
}

test('OTLP nanoseconds normalize precisely without converting epoch nanoseconds to an unsafe Number', () => {
  const result = importTraces(otlp());
  assert.equal(result.traces.length, 1);
  assert.equal(result.traces[0].durationMs, 2.5);
  assert.equal(result.traces[0].spans[0].durationMs, 2.5);
  assert.equal(result.traces[0].startedAt, '2023-11-14T22:13:20.000Z');
  assert.equal(result.traces[0].service, 'support-agent');
  assert.equal(result.traces[0].environment, 'production');
  assert.equal(result.traces[0].input, 'Question');
  assert.equal(result.traces[0].costUsd, 0.01);
});

test('unsafe numeric OTLP nanosecond timestamps produce missing duration, not fabricated precision', () => {
  const data = otlp();
  data.resourceSpans[0].scopeSpans[0].spans[0].startTimeUnixNano = 1700000000000000001;
  const result = importTraces(data);
  assert.equal(result.traces[0].durationMs, null);
  assert.match(result.warnings.join(' '), /unsafe timestamps/);
});

test('OTLP unset outcomes do not fabricate successful tool calls', () => {
  const data = otlp();
  data.resourceSpans[0].scopeSpans[0].spans[0].status = { code: 0 };
  const imported = importTraces(data);
  assert.equal(imported.traces[0].spans[0].status, 'unknown');
  const run = evaluateRun(imported.traces, specification());
  assert.equal(run.results[0].scores.find((score) => score.metricId === 'tool_success').value, null);
  assert.equal(run.status, 'blocked');
});

test('reversed span timestamps block trace duration even when aggregate bounds appear valid', () => {
  const data = otlp();
  const root = data.resourceSpans[0].scopeSpans[0].spans[0];
  data.resourceSpans[0].scopeSpans[0].spans.push({ ...copy(root), spanId: '1123456789abcdef', parentSpanId: root.spanId, startTimeUnixNano: root.endTimeUnixNano, endTimeUnixNano: root.startTimeUnixNano });
  const imported = importTraces(data);
  assert.equal(imported.traces[0].durationMs, null);
  assert.match(imported.warnings.join(' '), /reversed/);
});

test('OTLP child-content fallback is explicitly disclosed', () => {
  const data = otlp();
  const root = data.resourceSpans[0].scopeSpans[0].spans[0];
  const child = { ...copy(root), spanId: '1123456789abcdef', parentSpanId: root.spanId };
  root.attributes = [];
  data.resourceSpans[0].scopeSpans[0].spans.push(child);
  const imported = importTraces(data);
  assert.equal(imported.traces[0].output, 'Answer');
  assert.match(imported.warnings.join(' '), /mapped from a child span/);
});

test('OTLP nested typed attributes and newline-delimited export batches import', () => {
  const first = otlp();
  const second = otlp();
  second.resourceSpans[0].scopeSpans[0].spans[0].traceId = '1123456789abcdef0123456789abcdef';
  first.resourceSpans[0].scopeSpans[0].spans[0].attributes.push({ key: 'retrieval.documents', value: { arrayValue: { values: [{ stringValue: 'Policy A' }, { stringValue: 'Policy B' }] } } });
  const result = importTraces(`${JSON.stringify(first)}\n${JSON.stringify(second)}`);
  assert.equal(result.traces.length, 2);
  assert.equal(result.traces[0].context, '["Policy A","Policy B"]');
});

test('OTLP spans retain service, instrumentation scope, and decoded repeated events with precise valid timestamps', () => {
  const fixture = otlp();
  const resource = fixture.resourceSpans[0], scope = resource.scopeSpans[0];
  resource.schemaUrl = 'https://example.invalid/resource/1';
  scope.scope = { name: 'stream-instrumentation', version: '2.3.4' };
  scope.schemaUrl = 'https://example.invalid/scope/2';
  scope.spans[0].events = [
    { name: 'stream.chunk', timeUnixNano: '1700000000001000001', attributes: [{ key: 'stream.delta', value: { stringValue: 'First' } }, { key: 'stream.sequence', value: { intValue: '1' } }] },
    { name: 'stream.chunk', timeUnixNano: '1700000000002000001', attributes: [{ key: 'stream.delta', value: { stringValue: ' second' } }] },
    { name: 'stream.completed', timeUnixNano: '1700000000002500001', attributes: [{ key: 'stream.final_text', value: { stringValue: 'First second' } }, { key: 'stream.flags', value: { arrayValue: { values: [{ boolValue: true }, { intValue: '2' }] } } }] },
    { name: 'without-time', attributes: [] },
    { name: 'unsafe-time', timeUnixNano: 1700000000002500001, attributes: [] },
  ];
  const imported = importTraces(fixture).traces[0];
  const span = imported.spans[0];
  assert.equal(span.service, 'support-agent');
  assert.equal(span.resourceSchemaUrl, resource.schemaUrl);
  assert.deepEqual(span.instrumentationScope, { name: 'stream-instrumentation', version: '2.3.4', schemaUrl: scope.schemaUrl });
  assert.deepEqual(span.events.map(event => event.name), ['stream.chunk', 'stream.chunk', 'stream.completed', 'without-time', 'unsafe-time']);
  assert.equal(span.events[0].timeUnixNano, '1700000000001000001');
  assert.equal(span.events[0].timestamp, '2023-11-14T22:13:20.001Z');
  assert.equal(span.events[0].attributes['stream.sequence'], 1);
  assert.deepEqual(span.events[2].attributes['stream.flags'], [true, 2]);
  assert.equal(span.events[3].timestamp, null);
  assert.equal(span.events[4].timestamp, null);
  assert.equal(span.events[4].timeUnixNano, null);
  const reimported = importTraces([imported]).traces[0].spans[0];
  assert.deepEqual(reimported.events, span.events);
  assert.deepEqual(reimported.instrumentationScope, span.instrumentationScope);
  assert.equal(reimported.service, span.service);
});

test('duplicate or malformed resource service attributes do not create a confident span service', () => {
  for (const kind of ['duplicate', 'missing', 'invalid']) {
    const fixture = otlp(), resource = fixture.resourceSpans[0].resource;
    if (kind === 'duplicate') resource.attributes.push({ key: 'service.name', value: { stringValue: 'other-agent' } });
    if (kind === 'missing') resource.attributes = resource.attributes.filter(attribute => attribute.key !== 'service.name');
    if (kind === 'invalid') resource.attributes.find(attribute => attribute.key === 'service.name').value = { intValue: '42' };
    assert.equal(importTraces(fixture).traces[0].spans[0].service, 'unknown-service', kind);
  }
});

test('HTML report preserves service, scope and stream events as escaped collapsed evidence', () => {
  const row = trace({ spans: [{ id: 'stream', name: 'chat.stream', type: 'tool', status: 'ok', service: 'stream-gateway', instrumentationScope: { name: '<script>alert(1)</script>', version: '1.0.0' }, events: [{ name: 'stream.chunk', attributes: { 'stream.delta': '<img src=x onerror=alert(1)>' }, timestamp: '2026-11-02T08:30:00.100Z', timeUnixNano: null }, { name: 'stream.completed', attributes: { 'stream.final_text': 'A final answer' }, timestamp: null, timeUnixNano: null }] }] });
  const run = evaluateRun(importTraces([row]).traces, specification());
  const html = exportReport(run);
  assert.match(html, /<summary>Span and event evidence<\/summary>/);
  assert.match(html, /stream-gateway/);
  assert.match(html, /stream\.chunk/);
  assert.match(html, /stream\.completed/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<script>|<img src=x/);
});

test('malformed imports, empty arrays and invalid OTLP correlation IDs are rejected', () => {
  assert.throws(() => importTraces('not JSON'), /not valid JSON/);
  assert.throws(() => importTraces([]), /No valid traces/);
  assert.throws(() => importTraces([{}]), /needs an id/);
  const data = otlp();
  data.resourceSpans[0].scopeSpans[0].spans[0].traceId = 'bad';
  assert.throws(() => importTraces(data), /No valid traces/);
});

test('canonical duplicate IDs deterministically retain last evidence', () => {
  const result = importTraces([trace(), trace({ output: 'Last record' })]);
  assert.equal(result.traces.length, 1);
  assert.equal(result.traces[0].output, 'Last record');
  assert.match(result.warnings.join(' '), /duplicate trace IDs/);
});

test('canonical import does not coerce empty arrays, objects, or whitespace into numeric successes', () => {
  const imported = importTraces([trace({ durationMs: [], costUsd: '   ', input: [], output: {} })]);
  assert.equal(imported.traces[0].durationMs, null);
  assert.equal(imported.traces[0].costUsd, null);
  assert.equal(imported.traces[0].input, '');
  assert.equal(imported.traces[0].output, '');
  assert.equal(evaluateRun(imported.traces, specification()).status, 'blocked');
  const validStructured = importTraces([trace({ input: [{ role: 'user', content: 'Question' }], output: { message: 'Answer' }, costUsd: '0.012' })]);
  assert.match(validStructured.traces[0].input, /Question/);
  assert.equal(validStructured.traces[0].costUsd, 0.012);
});

test('contains checks a literal case-insensitive phrase without executing a regular expression', () => {
  const spec = specification();
  spec.metrics = [{ id: 'contains', name: 'Escalation phrase', kind: 'deterministic', threshold: 1, operator: 'gte', unit: 'score', weight: 1, enabled: true, critical: false, keyword: 'BILLING WILL' }];
  assert.equal(evaluateRun([trace()], spec).status, 'passed');
  spec.metrics[0].keyword = '.*';
  assert.equal(evaluateRun([trace()], spec).status, 'failed');
});

function attributeMetric(overrides = {}) {
  return { id: 'attribute_safety', name: 'Safety score', description: 'Recorded safety assessment from the tracing platform.', kind: 'attribute', attributeKey: 'eval.safety_score', unit: 'score', operator: 'gte', threshold: 0.9, weight: 10, enabled: true, critical: true, ...overrides };
}

test('custom attribute scorers use exact numeric evidence and participate in release gates', () => {
  const spec = specification({ metrics: [attributeMetric()] });
  const imported = importTraces([trace({ attributes: { 'eval.safety_score': '0.96' } })]);
  const passing = evaluateRun(imported.traces, spec);
  assert.equal(passing.status, 'passed');
  assert.equal(passing.results[0].scores[0].value, 0.96);
  assert.equal(passing.results[0].scores[0].kind, 'attribute');
  assert.match(passing.results[0].scores[0].reason, /eval\.safety_score.*0\.96/);
  const failing = evaluateRun([trace({ attributes: { 'eval.safety_score': 0.5 } })], { ...spec, passThreshold: 0 });
  assert.equal(failing.status, 'failed');
  assert.equal(failing.summary.criticalFailures, 1);
  assert.equal(failing.summary.metricResults[0].value, 0.5);
});

test('missing, malformed, out-of-scale and non-attribute evidence stays unscored for custom metrics', () => {
  const spec = specification({ metrics: [attributeMetric()] });
  for (const value of [undefined, null, NaN, Infinity, '', '   ', [], [0.95], {}, true, -0.1, 1.01, '0x1']) {
    const run = evaluateRun([trace({ attributes: { 'eval.safety_score': value }, demoScores: { safety: 1 } })], spec);
    assert.equal(run.status, 'blocked', `Invalid evidence must block: ${String(value)}`);
    assert.equal(run.results[0].scores[0].value, null);
    assert.match(run.results[0].scores[0].reason, /eval\.safety_score.*observed:/);
  }
  const nested = evaluateRun([trace({ attributes: { eval: { safety_score: 0.95 } }, demoScores: { groundedness: 1, safety: 1 } })], spec);
  assert.equal(nested.status, 'blocked', 'A dotted key does not traverse a nested object or use demoScores.');
  for (const [unit, value] of [['percent', 101], ['ms', -1], ['usd', -0.01]]) {
    const unitSpec = specification({ metrics: [attributeMetric({ unit, threshold: 0 })] });
    assert.equal(evaluateRun([trace({ attributes: { 'eval.safety_score': value } })], unitSpec).status, 'blocked');
  }
  const percent = specification({ metrics: [attributeMetric({ unit: 'percent', threshold: 95 })] });
  assert.equal(evaluateRun([trace({ attributes: { 'eval.safety_score': '100' } })], percent).status, 'passed');
});

test('custom scorer validation requires an explicit attribute kind, unique ID, key and supported unit', () => {
  for (const overrides of [{ kind: 'javascript' }, { id: 'arbitrary_id' }, { id: 'attribute_' }, { attributeKey: '   ' }, { attributeKey: null }, { unit: 'arbitrary' }]) {
    const spec = specification({ metrics: [attributeMetric(overrides)] });
    assert.equal(validateDataset([trace()], spec).valid, false, JSON.stringify(overrides));
  }
  assert.equal(validateDataset([trace()], specification({ metrics: [attributeMetric(), attributeMetric()] })).valid, false);
});

test('generic number attributes and distinct phrase metrics are supported without changing legacy scorers', () => {
  const count = attributeMetric({ id: 'attribute_token_count', unit: 'number', attributeKey: 'tokens', operator: 'lte', threshold: 2000 });
  const phrases = ['billing', 'review'].map(keyword => ({ id: `contains_${keyword}`, name: keyword, kind: 'deterministic', keyword, unit: 'score', operator: 'gte', threshold: 1, weight: 1, enabled: true, critical: false }));
  const run = evaluateRun([trace({ attributes: { tokens: 1500 } })], specification({ metrics: [count, ...phrases] }));
  assert.equal(run.status, 'passed');
  assert.equal(run.results[0].scores[0].value, 1500);
  phrases[0].keyword = '';
  assert.equal(validateDataset([trace()], specification({ metrics: phrases })).valid, false);
});

test('arbitrary recorded judgments require their own supplied finite numeric value and text provenance', () => {
  const metric = { id: 'judgment_policy', name: 'Policy compliance', kind: 'recorded_judgment', judgmentKey: 'policy.compliance', rubric: 'Use the policy evidence.', unit: 'score', operator: 'gte', threshold: 0.9, weight: 10, enabled: true, critical: true };
  const spec = specification({ metrics: [metric] });
  const imported = importTraces([trace({ evaluatorScores: { 'policy.compliance': { value: 0.95, provenance: 'policy evaluator v1', reason: 'Grounded in the policy.' } } })]);
  assert.equal(evaluateRun(imported.traces, spec).status, 'passed');
  for (const score of [{ value: '0.95', provenance: 'judge' }, { value: 0.95 }, { value: 0.95, provenance: {} }, { value: Infinity, provenance: 'judge' }]) {
    const invalid = importTraces([trace({ evaluatorScores: { 'policy.compliance': score }, demoScores: { 'policy.compliance': 1 } })]);
    assert.equal(evaluateRun(invalid.traces, spec).status, 'blocked');
  }
});

test('reserved or inherited evaluator keys cannot enter or satisfy recorded judgments', () => {
  const raw = JSON.parse(JSON.stringify(trace()));
  raw.evaluatorScores = JSON.parse('{"__proto__":{"value":1,"provenance":"fake"},"constructor":{"value":1,"provenance":"fake"},"prototype":{"value":1,"provenance":"fake"},"allowed":{"value":0.95,"provenance":"real"}}');
  const imported = importTraces([raw]);
  assert.deepEqual(Object.keys(imported.traces[0].evaluatorScores), ['allowed']);
  assert.equal(Object.hasOwn(imported.traces[0].evaluatorScores, '__proto__'), false);
  const metric = { id: 'judgment_allowed', name: 'Allowed judgment', kind: 'recorded_judgment', judgmentKey: 'allowed', unit: 'score', operator: 'gte', threshold: 0.9, weight: 1, enabled: true, critical: false };
  const inherited = trace({ evaluatorScores: Object.create({ allowed: { value: 1, provenance: 'inherited' } }) });
  assert.equal(evaluateRun([inherited], specification({ metrics: [metric] })).status, 'blocked');
  metric.judgmentKey = 'constructor';
  assert.equal(validateDataset([trace()], specification({ metrics: [metric] })).valid, false);
});

test('HTML report escapes trace evidence, names, and annotation content', () => {
  const run = evaluateRun([trace({ name: '<script>alert(1)</script>', output: '<img src=x onerror=alert(1)>' })], specification(), [], { id: 'run-html' });
  const report = exportReport(run, [{ id: 'a1', runId: run.id, traceId: 'trace-1', verdict: 'accepted', reviewer: '<script>x</script>', note: '<iframe src=x>', createdAt: '2026-11-02T12:00:00Z' }]);
  assert.equal(report.includes('<script>'), false);
  assert.equal(report.includes('<img src=x'), false);
  assert.ok(report.includes('&lt;script&gt;'));
  assert.ok(report.includes('&lt;iframe src=x&gt;'));
  assert.ok(report.includes('Content-Security-Policy'));
});

test('CSV quotes multiline values and mitigates spreadsheet formula injection', () => {
  const run = evaluateRun([trace({ name: '=HYPERLINK("evil", "click")\nsecond line' })], specification());
  const csv = exportCSV(run);
  assert.ok(csv.includes('"\'=HYPERLINK(""evil"", ""click"")\nsecond line"'));
  assert.equal(csv.split('\r\n').length, 2);
});

test('exported specification round-trips with a schema version', () => {
  const spec = specification();
  const exported = JSON.parse(exportSpec(spec));
  assert.equal(exported.schemaVersion, 1);
  assert.equal(exported.kind, 'TracegradeEvaluationSpec');
  assert.deepEqual(exported.metrics, spec.metrics);
});
