import test from 'node:test';
import assert from 'node:assert/strict';
import { importTraces, evaluateRun } from './domain.js';
import { TRACE_PROFILES, normalizeTraceInput } from './traceProfiles.js';
import { getScenarioFixture, prepareScenario } from './scenarios.js';

const spans = fixture => fixture.resourceSpans[0].scopeSpans[0].spans;
const root = fixture => spans(fixture).find(span => !span.parentSpanId);
const firstTrace = (fixture, profileId) => normalizeTraceInput(fixture, { profileId }).traces[0];
const mapping = (trace, field) => trace.normalization.mappings.find(item => item.field === field);
function setAttr(target, key, value) {
  target.attributes = target.attributes.filter(item => item.key !== key);
  if (value !== undefined) target.attributes.push({ key, value });
}
function oneTraceSpec(id) {
  const spec = prepareScenario(id).spec;
  spec.dataset = { ...spec.dataset, sampleSize: 1, minSamples: 1 };
  return spec;
}

test('Auto delegates the canonical importer and explicit versions never silently fall back', () => {
  const canonical = [{ id: 'canonical', input: 'Question', output: 'Answer', durationMs: 5 }];
  assert.deepEqual(normalizeTraceInput(canonical), importTraces(canonical));
  assert.throws(() => normalizeTraceInput(canonical, { profileId: 'support-genai-v1' }), /require OTLP/);
  assert.throws(() => normalizeTraceInput({}, { profileId: 'unknown' }), /Unknown normalization profile/);
  assert.throws(() => normalizeTraceInput(getScenarioFixture('support-release'), { profileId: 'support-genai-v1', profileVersion: '2.0.0' }), /Exact version pins/);
  assert.throws(() => normalizeTraceInput(canonical, { profileId: 'auto', profileVersion: '1.0.0' }), /no pinned profile/);
  assert.ok(TRACE_PROFILES.every(profile => profile.version === '1.0.0' && Object.isFrozen(profile)));
});

test('support profile decodes JSON-string and typed structured messages with explicit provenance', () => {
  const raw = getScenarioFixture('support-release');
  const before = JSON.stringify(raw);
  const result = normalizeTraceInput(raw, { profileId: 'support-genai-v1', profileVersion: '1.0.0' });
  assert.equal(result.warnings.length, 0);
  assert.equal(result.traces[0].input, 'Can I get a refund for the duplicate charge?');
  assert.match(result.traces[1].output, /verification step/);
  assert.equal(result.traces[0].evaluatorScores.policy_compliance.value, 0.98);
  assert.match(result.traces[0].evaluatorScores.policy_compliance.provenance, /synthetic-fixture/);
  assert.equal(mapping(result.traces[0], 'output').source, 'root');
  assert.equal(JSON.stringify(raw), before);
});

test('wrong explicit profile leaves required IO unresolved despite generic aliases in children', () => {
  const raw = getScenarioFixture('document-review');
  assert.match(importTraces(raw).traces[0].output, /INTERMEDIATE/);
  const trace = firstTrace(raw, 'support-genai-v1');
  assert.equal(trace.input, '');
  assert.equal(trace.output, '');
  assert.equal(trace.costUsd, null);
  assert.equal(mapping(trace, 'output').status, 'missing');
  const spec = oneTraceSpec('document-review');
  spec.dataset.normalization = { profile: 'support-genai-v1', version: '1.0.0' };
  const run = evaluateRun([trace], spec);
  assert.equal(run.status, 'blocked');
  assert.match(run.validation.errors.join(' '), /missing required output/);
});

test('document output and evidence resolve only from exact named child and event selectors', () => {
  const raw = getScenarioFixture('document-review');
  const trace = firstTrace(raw, 'document-events-v1');
  assert.equal(trace.output, 'The sample service requires 30 days of written notice [§4].');
  assert.match(trace.context, /30 days of written notice/);
  assert.doesNotMatch(trace.output, /INTERMEDIATE|WRONG SPAN/);
  assert.equal(mapping(trace, 'output').spanName, 'document.review.finalize');
  assert.equal(mapping(trace, 'output').eventName, 'review.completed');
  assert.equal(mapping(trace, 'context').source, 'span');
  assert.ok(!trace.normalization.warnings.some(message => message.includes('mapped from a child span')));
  const final = spans(raw).find(span => span.name === 'document.review.finalize');
  final.events = [];
  const missing = firstTrace(raw, 'document-events-v1');
  assert.equal(missing.output, '');
  assert.equal(mapping(missing, 'output').status, 'missing');
});

test('ambiguous finalization spans or repeated final-answer events remain unresolved', () => {
  for (const mode of ['span', 'event']) {
    const raw = getScenarioFixture('document-review');
    const final = spans(raw).find(span => span.name === 'document.review.finalize');
    if (mode === 'span') spans(raw).push({ ...structuredClone(final), spanId: '00000000000abcde' });
    else final.events.push(structuredClone(final.events[0]));
    const trace = firstTrace(raw, 'document-events-v1');
    assert.equal(trace.output, '', mode);
    assert.equal(mapping(trace, 'output').status, 'ambiguous', mode);
    assert.equal(trace.evaluatorScores, undefined, mode);
    assert.match(trace.normalization.warnings.join(' '), /found 2/, mode);
  }
});

test('multiple roots, rootless groups, and duplicate root span IDs are never first-match sources', () => {
  for (const mode of ['multiple', 'rootless', 'duplicate']) {
    const raw = getScenarioFixture('support-release');
    const original = root(raw);
    if (mode === 'rootless') original.parentSpanId = '00000000000abcdf';
    else spans(raw).push({ ...structuredClone(original), ...(mode === 'multiple' ? { spanId: '00000000000abcde' } : {}) });
    const trace = firstTrace(raw, 'support-genai-v1');
    assert.equal(trace.input, '', mode);
    assert.equal(trace.output, '', mode);
    assert.equal(trace.status, 'unknown', mode);
    assert.equal(trace.durationMs, null, mode);
    assert.equal(mapping(trace, 'input').status, mode === 'rootless' ? 'missing' : 'ambiguous');
    assert.ok(trace.normalization.warnings.length > 0);
  }
});

test('ambiguous explicit roots cannot produce a latency-only pass when content is optional', () => {
  const fixture = getScenarioFixture('support-release');
  spans(fixture).push({ ...structuredClone(root(fixture)), spanId: '00000000000abcde' });
  const trace = firstTrace(fixture, 'support-genai-v1');
  const spec = oneTraceSpec('support-release');
  spec.dataset = { ...spec.dataset, service: 'all', environment: 'all', requireInput: false, requireOutput: false, requireContext: false };
  delete spec.dataset.scenarioId;
  spec.metrics = spec.metrics.filter(metric => metric.id === 'latency');
  const run = evaluateRun([trace], spec);
  assert.equal(run.status, 'blocked');
  assert.equal(run.results[0].scores[0].value, null);
});

test('duplicate attribute keys and orphan named spans are explicit mapping failures', () => {
  const support = getScenarioFixture('support-release');
  const input = root(support).attributes.find(attribute => attribute.key === 'gen_ai.input.messages');
  root(support).attributes.push(structuredClone(input));
  const duplicate = firstTrace(support, 'support-genai-v1');
  assert.equal(duplicate.input, '');
  assert.equal(mapping(duplicate, 'input').status, 'ambiguous');
  const document = getScenarioFixture('document-review');
  spans(document).find(span => span.name === 'document.review.finalize').parentSpanId = '00000000000abcdf';
  const orphan = firstTrace(document, 'document-events-v1');
  assert.equal(orphan.output, '');
  assert.equal(mapping(orphan, 'output').status, 'missing');
});

test('cost uses declared cents or USD units, and missing or invalid cost never becomes zero', () => {
  const checkout = normalizeTraceInput(getScenarioFixture('checkout-reliability'), { profileId: 'checkout-shop-v1' });
  assert.deepEqual(checkout.traces.map(trace => trace.costUsd), [0.01, 0.02, null, 0.01]);
  assert.match(mapping(checkout.traces[0], 'costUsd').transform, /cents by 100 to USD/);
  assert.equal(checkout.traces[0].attributes['checkout.payment_attempts'], 1);
  assert.equal(firstTrace(getScenarioFixture('support-release'), 'support-genai-v1').costUsd, 0.011);
  for (const value of [{ intValue: '-1' }, { stringValue: '   ' }, { arrayValue: { values: [] } }]) {
    const raw = getScenarioFixture('checkout-reliability');
    setAttr(root(raw), 'shop.total_cost_cents', value);
    const trace = firstTrace(raw, 'checkout-shop-v1');
    assert.equal(trace.costUsd, null);
    assert.equal(mapping(trace, 'costUsd').status, 'invalid');
  }
});

test('recorded judgment admission requires a numeric bounded value and nonblank mapped provenance', () => {
  const variants = [
    ['eval.policy_compliance.provenance', undefined],
    ['eval.policy_compliance.provenance', { stringValue: '   ' }],
    ['eval.policy_compliance.value', { stringValue: '0.98' }],
    ['eval.policy_compliance.value', { doubleValue: 1.2 }],
    ['eval.policy_compliance.value', { doubleValue: -0.1 }],
  ];
  for (const [key, value] of variants) {
    const raw = getScenarioFixture('support-release');
    setAttr(root(raw), key, value);
    const trace = firstTrace(raw, 'support-genai-v1');
    assert.equal(trace.evaluatorScores, undefined);
    const run = evaluateRun([trace], oneTraceSpec('support-release'));
    assert.equal(run.status, 'blocked');
    assert.equal(run.results[0].scores.find(score => score.kind === 'recorded_judgment').value, null);
  }
});

test('UNSET tool status stays unknown and the tool scorer remains unscored', () => {
  const prepared = prepareScenario('checkout-reliability');
  const unknown = prepared.traces.find(trace => trace.name.includes('Unknown payment'));
  assert.equal(unknown.spans.find(span => span.type === 'tool').status, 'unknown');
  const run = evaluateRun([unknown], oneTraceSpec('checkout-reliability'));
  assert.equal(run.results[0].scores.find(score => score.metricId === 'tool_success').value, null);
  assert.equal(run.status, 'blocked');
});

test('profile mapping preserves importer timestamp safety and schema/scope lineage', () => {
  const raw = getScenarioFixture('support-release');
  const child = spans(raw)[1];
  child.endTimeUnixNano = String(BigInt(child.startTimeUnixNano) - 1n);
  raw.resourceSpans[0].schemaUrl = 'https://example.invalid/resource-schema/1';
  raw.resourceSpans[0].scopeSpans[0].schemaUrl = 'https://example.invalid/scope-schema/2';
  const trace = firstTrace(raw, 'support-genai-v1');
  assert.equal(trace.durationMs, null);
  assert.match(trace.normalization.warnings.join(' '), /unsafe timestamps/);
  assert.deepEqual(trace.normalization.resourceSchemaUrls, ['https://example.invalid/resource-schema/1']);
  assert.deepEqual(trace.normalization.instrumentationScopes, [{ name: 'synthetic.support.instrumentation', version: '1.0.0', schemaUrl: 'https://example.invalid/scope-schema/2' }]);
  assert.equal(evaluateRun([trace], oneTraceSpec('support-release')).status, 'blocked');
});

test('OTLP request arrays and newline-delimited requests retain the same explicit mapping', () => {
  const fixture = getScenarioFixture('support-release');
  const object = normalizeTraceInput(fixture, { profileId: 'support-genai-v1' });
  const array = normalizeTraceInput([fixture], { profileId: 'support-genai-v1' });
  const ndjson = normalizeTraceInput(`${JSON.stringify(fixture)}\n`, { profileId: 'support-genai-v1' });
  assert.deepEqual(array, object);
  assert.deepEqual(ndjson, object);
});

function distributedFixture(profileId) {
  const toAttributes = object => Object.entries(object).map(([key, value]) => ({ key, value: typeof value === 'number' ? { doubleValue: value } : { stringValue: value } }));
  const traceId = '88888888888888888888888888888888', rootId = '1111111111111111';
  const startTime = BigInt(Date.parse('2026-11-01T10:05:00.000Z')) * 1000000n;
  const modes = {
    'handoff-services-v1': {
      rootAttributes: { 'desk.request': 'Restore access after verification.', 'desk.coordinator.model': 'fixture-coordinator', 'desk.total_cost_usd': 0.02, 'desk.handoff_count': 1 },
      name: 'agent.respond', service: 'access-specialist', otherService: 'generalist',
      childAttributes: { 'desk.answer': 'The verified request was passed to the access team.', 'desk.context_received': 'Identity verification completed; do not reset credentials without approval.', 'desk.handoff_quality.value': 0.97, 'desk.handoff_quality.provenance': 'synthetic-test/handoff-v1', 'desk.handoff_quality.reason': 'Required context is present.' },
      otherAttributes: { 'desk.answer': 'WRONG SERVICE answer', 'desk.context_received': 'WRONG SERVICE context' },
    },
    'retrieval-resources-v1': {
      rootAttributes: { 'rag.question': 'What is the current access policy?', 'rag.answer': 'Verification and approval are required.', 'rag.model': 'fixture-rag-model', 'rag.total_cost_usd': 0.01, 'rag.groundedness.value': 0.96, 'rag.groundedness.provenance': 'synthetic-test/grounding-v1', 'rag.groundedness.reason': 'The answer agrees with current evidence.' },
      name: 'retrieval.search', service: 'knowledge-index', otherService: 'stale-cache',
      childAttributes: { 'rag.context': 'CURRENT POLICY: verification and approval are required.', 'rag.source_age_hours': 2 },
      otherAttributes: { 'rag.context': 'STALE POLICY: automatic access grants.', 'rag.source_age_hours': 720 },
    },
    'streaming-final-v1': {
      rootAttributes: { 'stream.request': 'Summarize the access policy.', 'stream.context': 'Verification and approval are required.', 'stream.model': 'fixture-stream-model', 'stream.cost_usd': 0.012, 'output.value': 'ROOT HEURISTIC FALLBACK MUST NOT BE USED' },
      name: 'chat.stream', service: 'stream-gateway', otherService: 'preview-gateway',
      childAttributes: { 'stream.ttft_ms': 120 }, otherAttributes: { 'stream.ttft_ms': 5 },
      events: [
        { name: 'stream.chunk', timeUnixNano: String(startTime + 120000000n), attributes: toAttributes({ 'stream.delta': 'Verification', 'stream.final_text': 'CHUNK IS NOT FINAL' }) },
        { name: 'stream.chunk', timeUnixNano: String(startTime + 250000000n), attributes: toAttributes({ 'stream.delta': ' and approval are required.' }) },
        { name: 'stream.completed', timeUnixNano: String(startTime + 900000000n), attributes: toAttributes({ 'stream.final_text': 'Verification and approval are required.', 'stream.completion_count': 1 }) },
      ],
      otherEvents: [{ name: 'stream.completed', attributes: toAttributes({ 'stream.final_text': 'WRONG SERVICE FINAL', 'stream.completion_count': 1 }) }],
    },
  };
  const mode = modes[profileId];
  const makeSpan = (id, name, values, events = []) => ({ traceId, spanId: id, ...(id === rootId ? {} : { parentSpanId: rootId }), name, startTimeUnixNano: String(startTime), endTimeUnixNano: String(startTime + 1000000000n), attributes: toAttributes(values), events, status: { code: 1 } });
  const makeResource = (service, span) => ({ resource: { attributes: toAttributes({ 'service.name': service, 'deployment.environment.name': 'production' }) }, schemaUrl: `https://example.invalid/resource/${service}`, scopeSpans: [{ scope: { name: `instrumentation.${service}`, version: '2.1.0' }, schemaUrl: `https://example.invalid/scope/${service}`, spans: [span] }] });
  return { resourceSpans: [
    makeResource('coordinator', makeSpan(rootId, 'coordinator.run', mode.rootAttributes)),
    makeResource(mode.service, makeSpan('2222222222222222', mode.name, mode.childAttributes, mode.events)),
    makeResource(mode.otherService, makeSpan('3333333333333333', mode.name, mode.otherAttributes, mode.otherEvents)),
  ] };
}

test('service-qualified handoff maps only the access specialist and admits its provenance-backed judgment', () => {
  const trace = firstTrace(distributedFixture('handoff-services-v1'), 'handoff-services-v1');
  assert.equal(trace.input, 'Restore access after verification.');
  assert.equal(trace.output, 'The verified request was passed to the access team.');
  assert.match(trace.context, /Identity verification completed/);
  assert.equal(trace.attributes['handoff.count'], 1);
  assert.equal(trace.evaluatorScores.handoff_completeness.value, 0.97);
  assert.equal(mapping(trace, 'output').serviceName, 'access-specialist');
  assert.equal(mapping(trace, 'output').serviceSelector, 'access-specialist');
  assert.equal(trace.spans.find(span => span.id === '2222222222222222').service, 'access-specialist');
  assert.equal(trace.spans.find(span => span.id === '2222222222222222').instrumentationScope.name, 'instrumentation.access-specialist');
});

test('same-name retrieval spans in different resources resolve by exact service and retain both sources for inspection', () => {
  const trace = firstTrace(distributedFixture('retrieval-resources-v1'), 'retrieval-resources-v1');
  assert.match(trace.context, /^CURRENT POLICY/);
  assert.equal(trace.attributes['retrieval.source_age_hours'], 2);
  assert.equal(trace.evaluatorScores.groundedness.value, 0.96);
  assert.equal(mapping(trace, 'context').serviceName, 'knowledge-index');
  assert.equal(mapping(trace, 'context').spanId, '2222222222222222');
  assert.deepEqual(trace.spans.filter(span => span.name === 'retrieval.search').map(span => span.service), ['knowledge-index', 'stale-cache']);
  assert.equal(trace.spans.find(span => span.service === 'stale-cache').attributes['rag.source_age_hours'], 720);
});

test('wrong or duplicate target services cannot qualify a named descendant by first match', () => {
  for (const mode of ['wrong-service', 'duplicate-service-attribute', 'duplicate-target-span']) {
    const fixture = distributedFixture('retrieval-resources-v1');
    const target = fixture.resourceSpans[1];
    if (mode === 'wrong-service') target.resource.attributes.find(attribute => attribute.key === 'service.name').value = { stringValue: 'Knowledge-Index' };
    if (mode === 'duplicate-service-attribute') target.resource.attributes.push({ key: 'service.name', value: { stringValue: 'knowledge-index' } });
    if (mode === 'duplicate-target-span') {
      const duplicate = structuredClone(target);
      duplicate.scopeSpans[0].spans[0].spanId = '4444444444444444';
      fixture.resourceSpans.push(duplicate);
    }
    const trace = firstTrace(fixture, 'retrieval-resources-v1');
    assert.equal(trace.context, '', mode);
    assert.equal(trace.attributes['retrieval.source_age_hours'], undefined, mode);
    assert.notEqual(mapping(trace, 'context').status, 'resolved', mode);
    assert.equal(mapping(trace, 'context').serviceSelector, 'knowledge-index');
    assert.equal(mapping(trace, 'context').serviceName, undefined, mode);
  }
});

test('unknown service evidence on another named candidate prevents a false unique-service match', () => {
  for (const mode of ['missing', 'invalid', 'duplicate']) {
    const fixture = distributedFixture('handoff-services-v1');
    const other = fixture.resourceSpans[2].resource;
    if (mode === 'missing') other.attributes = other.attributes.filter(attribute => attribute.key !== 'service.name');
    if (mode === 'invalid') other.attributes.find(attribute => attribute.key === 'service.name').value = { boolValue: true };
    if (mode === 'duplicate') other.attributes.push({ key: 'service.name', value: { stringValue: 'access-specialist' } });
    const trace = firstTrace(fixture, 'handoff-services-v1');
    assert.equal(trace.output, '', mode);
    assert.equal(trace.evaluatorScores, undefined, mode);
    assert.equal(mapping(trace, 'output').status, 'ambiguous', mode);
    assert.match(mapping(trace, 'output').detail, /resource service\.name/, mode);
  }
});

test('streaming selects only the explicit completion event from the specified service', () => {
  const trace = firstTrace(distributedFixture('streaming-final-v1'), 'streaming-final-v1');
  assert.equal(trace.output, 'Verification and approval are required.');
  assert.equal(trace.attributes['stream.ttft_ms'], 120);
  assert.equal(trace.attributes['stream.completion_receipt'], 1);
  assert.equal(mapping(trace, 'output').serviceName, 'stream-gateway');
  assert.equal(mapping(trace, 'output').eventName, 'stream.completed');
  const span = trace.spans.find(item => item.service === 'stream-gateway');
  assert.deepEqual(span.events.map(event => event.name), ['stream.chunk', 'stream.chunk', 'stream.completed']);
  assert.equal(span.events[0].attributes['stream.delta'], 'Verification');
  assert.equal(span.events[0].timestamp, '2026-11-01T10:05:00.120Z');
  assert.ok(span.events[0].timeUnixNano.endsWith('120000000'));
});

test('chunk-only streaming and duplicate completion events leave the final answer and receipt unresolved', () => {
  for (const mode of ['chunks-only', 'duplicate-completion']) {
    const fixture = distributedFixture('streaming-final-v1');
    const stream = fixture.resourceSpans[1].scopeSpans[0].spans[0];
    if (mode === 'chunks-only') stream.events = stream.events.filter(event => event.name === 'stream.chunk');
    else stream.events.push(structuredClone(stream.events.find(event => event.name === 'stream.completed')));
    const trace = firstTrace(fixture, 'streaming-final-v1');
    assert.equal(trace.output, '', mode);
    assert.equal(trace.attributes['stream.completion_receipt'], undefined, mode);
    assert.equal(mapping(trace, 'output').status, mode === 'chunks-only' ? 'missing' : 'ambiguous');
    assert.equal(trace.spans.find(span => span.service === 'stream-gateway').events.filter(event => event.name === 'stream.chunk').length, 2);
    const spec = oneTraceSpec('support-release');
    spec.dataset = { ...spec.dataset, service: 'all', environment: 'all', normalization: { profile: 'streaming-final-v1', version: '1.0.0' } };
    delete spec.dataset.scenarioId;
    spec.metrics = spec.metrics.filter(metric => metric.id === 'latency');
    assert.match(evaluateRun([trace], spec).validation.errors.join(' '), /missing required output/);
    spec.dataset.requireOutput = false;
    spec.metrics.push({ id: 'attribute_stream_completion', kind: 'attribute', name: 'Completion receipt', attributeKey: 'stream.completion_receipt', unit: 'number', operator: 'gte', threshold: 1, weight: 10, enabled: true, critical: true });
    const run = evaluateRun([trace], spec);
    assert.equal(run.status, 'blocked');
    assert.equal(run.results[0].scores.find(score => score.metricId === 'attribute_stream_completion').value, null);
  }
});

test('new numeric mappings reject negative values and do not infer measurements from events or timestamps', () => {
  for (const [profileId, location, source, target] of [
    ['handoff-services-v1', 0, 'desk.handoff_count', 'handoff.count'],
    ['retrieval-resources-v1', 1, 'rag.source_age_hours', 'retrieval.source_age_hours'],
    ['streaming-final-v1', 1, 'stream.ttft_ms', 'stream.ttft_ms'],
  ]) {
    const fixture = distributedFixture(profileId);
    const sourceSpan = fixture.resourceSpans[location].scopeSpans[0].spans[0];
    setAttr(sourceSpan, source, { doubleValue: -1 });
    const trace = firstTrace(fixture, profileId);
    assert.equal(trace.attributes[target], undefined);
    assert.equal(mapping(trace, `attributes.${target}`).status, 'invalid');
  }
});
