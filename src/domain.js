/**
 * Tracegrade's browser-local evaluation engine.
 *
 * Deterministic checks execute against trace evidence. Semantic sample scores are
 * explicitly fixtures, never an inference made by this application. Every run
 * snapshots its specification and selected traces before evaluation.
 *
 * OTLP JSON reference: https://opentelemetry.io/docs/specs/otlp/
 * The import boundary accepts canonical trace arrays, OTLP ExportTraceServiceRequest
 * objects, and newline-delimited OTLP JSON. It is not a tracing-backend query API.
 */

const SCHEMA_VERSION = 1;
const MAX_IMPORT_TRACES = 5000;
const KNOWN_METRICS = new Set(['groundedness', 'relevance', 'latency', 'cost', 'tool_success', 'contains']);
const ATTRIBUTE_UNITS = new Set(['score', 'ms', 'usd', 'percent', 'number']);
const isAttributeMetric = (metric) => metric.kind === 'attribute' && /^attribute_[a-z\d_-]+$/i.test(metric.id);
const isRecordedMetric = (metric) => metric.kind === 'recorded_judgment' && /^judgment_[a-z\d_-]+$/i.test(metric.id);
const isContainsMetric = (metric) => metric.id === 'contains' || (metric.kind === 'deterministic' && /^contains_[a-z\d_-]+$/i.test(metric.id));
const validJudgmentKey = (key) => typeof key === 'string' && /^[a-z\d][a-z\d_.:/-]{0,159}$/i.test(key) && !['__proto__', 'constructor', 'prototype'].includes(key);
const clone = (value) => typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const round = (value, places = 2) => isNumber(value) ? Number(value.toFixed(places)) : null;
const average = (values) => values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
const hasStructuredContent = (value) => value != null && (typeof value === 'string' ? value.trim().length > 0 : Array.isArray(value) ? value.some(hasStructuredContent) : typeof value === 'object' ? Object.values(value).some(hasStructuredContent) : typeof value === 'number' ? Number.isFinite(value) : typeof value === 'boolean');
const content = (value) => !hasStructuredContent(value) ? '' : typeof value === 'string' ? value : JSON.stringify(value);
const hasContent = (value) => content(value).trim().length > 0;
const safeNumber = (value) => typeof value === 'number' ? (Number.isFinite(value) ? value : null) : typeof value === 'string' && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) && Number.isFinite(Number(value)) ? Number(value) : null;

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
}

let idCounter = 0;
export function makeId(prefix = 'id') {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${(++idCounter).toString(36)}`;
  return `${prefix}_${suffix}`;
}

function matchedTraces(traces, spec) {
  const dataset = spec?.dataset ?? {};
  return (Array.isArray(traces) ? traces : []).filter((trace) => {
    if (dataset.source && dataset.source !== 'all' && trace.source !== dataset.source) return false;
    if (dataset.service && dataset.service !== 'all' && trace.service !== dataset.service) return false;
    if (dataset.environment && dataset.environment !== 'all' && trace.environment !== dataset.environment) return false;
    if (dataset.scenarioId !== undefined && (trace.attributes?.['tracegrade.synthetic'] !== true || trace.attributes?.['tracegrade.scenario'] !== dataset.scenarioId)) return false;
    const timestamp = Date.parse(trace.startedAt);
    if ((dataset.startDate || dataset.endDate) && !Number.isFinite(timestamp)) return false;
    if (dataset.startDate && timestamp < Date.parse(dataset.startDate)) return false;
    if (dataset.endDate && timestamp > Date.parse(dataset.endDate)) return false;
    return true;
  });
}

export function filterTraces(traces, spec) {
  const rows = matchedTraces(traces, spec).slice();
  const errorsFirst = spec?.dataset?.selection === 'errors_first';
  rows.sort((a, b) => {
    if (errorsFirst && a.status !== b.status) return a.status === 'error' ? -1 : 1;
    const difference = (Date.parse(b.startedAt) || 0) - (Date.parse(a.startedAt) || 0);
    return difference || String(a.id).localeCompare(String(b.id));
  });
  const size = Number(spec?.dataset?.sampleSize);
  return rows.slice(0, Number.isInteger(size) && size > 0 ? size : rows.length);
}

function missingRequired(trace, dataset) {
  return [
    dataset.requireInput && !hasContent(trace.input) ? 'input' : null,
    dataset.requireOutput && !hasContent(trace.output) ? 'output' : null,
    dataset.requireContext && !hasContent(trace.context) ? 'context' : null,
  ].filter(Boolean);
}

export function validateDataset(traces, spec) {
  const errors = [];
  const warnings = [];
  const dataset = spec?.dataset ?? {};
  const matched = matchedTraces(traces, spec);
  const selected = filterTraces(traces, spec);
  const eligible = selected.filter((trace) => !missingRequired(trace, dataset).length);
  if (!hasContent(spec?.name)) errors.push('Give this evaluation a name.');
  if (dataset.scenarioId !== undefined && (typeof dataset.scenarioId !== 'string' || dataset.scenarioId.length > 120 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(dataset.scenarioId))) errors.push('Dataset scenario ID must be a nonempty lowercase slug of at most 120 characters.');
  if (dataset.startDate && !Number.isFinite(Date.parse(dataset.startDate))) errors.push('Dataset start date must be a valid timestamp.');
  if (dataset.endDate && !Number.isFinite(Date.parse(dataset.endDate))) errors.push('Dataset end date must be a valid timestamp.');
  if (dataset.startDate && dataset.endDate && Date.parse(dataset.startDate) > Date.parse(dataset.endDate)) errors.push('Dataset start date must be on or before its end date.');
  if (!Number.isInteger(dataset.sampleSize) || dataset.sampleSize < 1 || dataset.sampleSize > MAX_IMPORT_TRACES) errors.push(`Sample size must be an integer between 1 and ${MAX_IMPORT_TRACES}.`);
  if (!Number.isInteger(dataset.minSamples) || dataset.minSamples < 1) errors.push('Minimum sample count must be a positive integer.');
  if (dataset.minSamples > dataset.sampleSize) errors.push('Minimum sample count cannot exceed the requested sample size.');
  if (!selected.length) errors.push('No traces match the dataset requirements.');
  if (selected.length && selected.length < dataset.minSamples) errors.push(`This dataset has ${selected.length} traces; at least ${dataset.minSamples} are required.`);
  for (const field of ['input', 'output', 'context']) {
    const count = selected.filter((trace) => missingRequired(trace, dataset).includes(field)).length;
    if (count) errors.push(`${count} selected ${count === 1 ? 'trace is' : 'traces are'} missing required ${field}.`);
  }
  if (new Set(selected.map((trace) => trace.id)).size !== selected.length) errors.push('Selected traces contain duplicate IDs. Re-import a deduplicated dataset.');
  if (dataset.normalization !== undefined) {
    const normalization = dataset.normalization;
    if (!normalization || typeof normalization !== 'object' || typeof normalization.profile !== 'string' || !normalization.profile.trim() || typeof normalization.version !== 'string' || !normalization.version.trim()) errors.push('Dataset normalization requires an exact profile ID and version.');
    else {
      const mismatch = selected.filter(trace => trace.normalization?.profileId !== normalization.profile || trace.normalization?.profileVersion !== normalization.version).length;
      if (mismatch) errors.push(`${mismatch} selected ${mismatch === 1 ? 'trace was' : 'traces were'} not normalized with ${normalization.profile}@${normalization.version}. Re-import the original OTLP data with this exact profile and version before evaluation.`);
    }
  }
  if (!isNumber(spec?.passThreshold) || spec.passThreshold < 0 || spec.passThreshold > 100) errors.push('Release pass rate must be a number from 0 to 100.');
  if (!isNumber(spec?.review?.sampleRate) || spec.review.sampleRate < 0 || spec.review.sampleRate > 100) errors.push('Human-review sample rate must be a number from 0 to 100.');
  const enabled = (spec?.metrics ?? []).filter((metric) => metric.enabled);
  if (!enabled.length) errors.push('Enable at least one scorer.');
  if (new Set(enabled.map((metric) => metric.id)).size !== enabled.length) errors.push('Each enabled scorer must have a unique metric ID.');
  for (const metric of enabled) {
    if (!KNOWN_METRICS.has(metric.id) && !isAttributeMetric(metric) && !isRecordedMetric(metric) && !isContainsMetric(metric)) errors.push(`Unsupported scorer: ${metric.name || metric.id}.`);
    if (metric.kind === 'attribute') {
      if (!isAttributeMetric(metric)) errors.push(`${metric.name}: attribute scorers need a unique ID beginning with attribute_.`);
      if (typeof metric.attributeKey !== 'string' || !metric.attributeKey.trim()) errors.push(`${metric.name}: enter the exact trace attribute key.`);
      if (!ATTRIBUTE_UNITS.has(metric.unit)) errors.push(`${metric.name}: attribute unit must be score, ms, usd, percent, or number.`);
    }
    if (metric.kind === 'recorded_judgment') {
      if (!isRecordedMetric(metric)) errors.push(`${metric.name}: recorded judgments need a unique ID beginning with judgment_.`);
      if (!validJudgmentKey(metric.judgmentKey)) errors.push(`${metric.name}: enter a valid, non-reserved evaluator score key.`);
      if (metric.unit !== 'score') errors.push(`${metric.name}: recorded judgments use the 0–1 score unit.`);
      if (metric.rubric !== undefined && typeof metric.rubric !== 'string') errors.push(`${metric.name}: rubric must be text.`);
    }
    if (!['gte', 'lte'].includes(metric.operator)) errors.push(`${metric.name}: select a valid comparison operator.`);
    if (!isNumber(metric.threshold)) errors.push(`${metric.name}: threshold must be a finite number.`);
    else if (metric.threshold < 0 || (metric.unit === 'score' && metric.threshold > 1) || (metric.unit === 'percent' && metric.threshold > 100)) errors.push(`${metric.name}: threshold is outside its supported range.`);
    if (!isNumber(metric.weight) || metric.weight <= 0) errors.push(`${metric.name}: weight must be a positive number.`);
    if (isContainsMetric(metric) && !hasContent(metric.keyword)) errors.push('The text-contains scorer needs a phrase to match.');
  }
  const semantic = enabled.filter((metric) => ['groundedness', 'relevance'].includes(metric.id) || isRecordedMetric(metric));
  if (semantic.some((metric) => !isRecordedMetric(metric)) && selected.some((trace) => trace.source === 'demo')) warnings.push('Semantic scores for sample traces are recorded demo fixtures, not live LLM judgments.');
  if (semantic.some((metric) => selected.some((trace) => (trace.source !== 'demo' || isRecordedMetric(metric)) && !externalJudgment(trace, isRecordedMetric(metric) ? metric.judgmentKey : metric.id)))) warnings.push('Traces without the required evaluator scores and provenance will remain unscored for semantic metrics.');
  if (selected.length < dataset.sampleSize && selected.length >= dataset.minSamples) warnings.push(`Only ${selected.length} of the requested ${dataset.sampleSize} traces are available; the minimum sample requirement is met.`);
  if (dataset.selection === 'errors_first') warnings.push('Errors-first selection is a diagnostic sample and is not an unbiased estimate of production quality.');
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    matchedCount: matched.length,
    selectedCount: selected.length,
    eligibleCount: eligible.length,
    excludedCount: matched.length - eligible.length,
  };
}

function externalJudgment(trace, metricId) {
  const judgment = validJudgmentKey(metricId) && Object.hasOwn(trace.evaluatorScores ?? {}, metricId) ? trace.evaluatorScores[metricId] : null;
  return judgment && isNumber(judgment.value) && judgment.value >= 0 && judgment.value <= 1 && typeof judgment.provenance === 'string' && judgment.provenance.trim() ? judgment : null;
}

function scoreMetric(trace, metric) {
  let value = null;
  let reason = '';
  let kind = metric.kind;
  if (isAttributeMetric(metric)) {
    const raw = Object.hasOwn(trace.attributes ?? {}, metric.attributeKey) ? trace.attributes[metric.attributeKey] : undefined;
    const numeric = safeNumber(raw);
    const upper = metric.unit === 'score' ? 1 : metric.unit === 'percent' ? 100 : Infinity;
    value = numeric !== null && numeric >= 0 && numeric <= upper ? numeric : null;
    const observed = raw === undefined ? 'missing' : String(typeof raw === 'object' ? JSON.stringify(raw) : raw).slice(0, 160);
    reason = value === null
      ? `Unscored: trace attribute “${metric.attributeKey}” is missing or invalid (observed: ${observed}). Expected a finite ${upper === Infinity ? 'nonnegative number' : `number from 0 to ${upper}`}.`
      : `Observed trace attribute “${metric.attributeKey}”: ${value}.`;
  } else if (metric.id === 'groundedness' || metric.id === 'relevance' || isRecordedMetric(metric)) {
    const supplied = externalJudgment(trace, isRecordedMetric(metric) ? metric.judgmentKey : metric.id);
    if (!isRecordedMetric(metric) && trace.source === 'demo' && isNumber(trace.demoScores?.[metric.id])) {
      value = trace.demoScores[metric.id];
      reason = metric.id === 'groundedness'
        ? (value >= metric.threshold ? 'Demo fixture: response is supported by the retrieved policy.' : 'Demo fixture: response includes a claim absent from the retrieved policy.')
        : (value >= metric.threshold ? 'Demo fixture: response addresses the customer request.' : 'Demo fixture: response does not fully address the request.');
      kind = 'demo_judge';
    } else if (supplied) {
      value = supplied.value;
      reason = `Supplied evaluator result (${supplied.provenance}). ${supplied.reason ?? ''}`.trim();
      kind = 'external_judge';
    } else {
      reason = 'Unscored: a live semantic evaluator or a supplied score with provenance is required.';
    }
  } else if (metric.id === 'latency') {
    value = isNumber(trace.durationMs) && trace.durationMs >= 0 ? trace.durationMs : null;
    reason = value === null ? 'Unscored: duration is missing or invalid.' : `Observed end-to-end duration: ${round(value, 0)} ms.`;
  } else if (metric.id === 'cost') {
    value = isNumber(trace.costUsd) && trace.costUsd >= 0 ? trace.costUsd : null;
    reason = value === null ? 'Unscored: no explicit cost was included in the trace.' : `Recorded trace cost: $${value.toFixed(4)} USD. No price inference is applied.`;
  } else if (metric.id === 'tool_success') {
    const tools = (trace.spans ?? []).filter((span) => span.type === 'tool' || span.attributes?.['gen_ai.operation.name'] === 'execute_tool');
    const known = tools.filter((span) => span.status === 'ok' || span.status === 'error');
    value = tools.length && known.length === tools.length ? known.filter((span) => span.status === 'ok').length / tools.length * 100 : null;
    reason = value === null ? 'Unscored: tool spans or their outcomes are missing.' : `${known.filter((span) => span.status === 'ok').length} of ${tools.length} recorded tool calls succeeded.`;
  } else if (isContainsMetric(metric)) {
    value = hasContent(trace.output) ? Number(trace.output.toLocaleLowerCase().includes(String(metric.keyword).toLocaleLowerCase())) : null;
    reason = value === null ? 'Unscored: response text is missing.' : `Case-insensitive response match for “${metric.keyword}”: ${value ? 'found' : 'not found'}.`;
  }
  if (!isNumber(value)) value = null;
  const pass = value === null ? null : metric.operator === 'lte' ? value <= metric.threshold : value >= metric.threshold;
  return { metricId: metric.id, name: metric.name, value: round(value, 5), pass, reason, kind, weight: metric.weight, critical: !!metric.critical, threshold: metric.threshold, operator: metric.operator, unit: metric.unit };
}

function hash(value) {
  let total = 2166136261;
  for (const character of String(value)) total = Math.imul(total ^ character.charCodeAt(0), 16777619) >>> 0;
  return total;
}

export function evaluateRun(traces, spec, annotations = [], options = {}) {
  const specSnapshot = freeze(clone(spec));
  const datasetSnapshot = freeze(clone(filterTraces(traces, spec)));
  const validation = validateDataset(traces, spec);
  const enabled = (spec.metrics ?? []).filter((metric) => metric.enabled);
  const results = validation.valid ? datasetSnapshot.map((trace) => {
    const scores = enabled.map((metric) => scoreMetric(trace, metric));
    const observed = scores.filter((score) => score.pass !== null);
    const weight = observed.reduce((total, score) => total + score.weight, 0);
    const score = weight ? observed.reduce((total, item) => total + (item.pass ? item.weight : 0), 0) / weight * 100 : null;
    const passed = scores.length > 0 && scores.every((item) => item.pass === true);
    const failed = scores.some((item) => item.pass === false);
    const unscored = scores.some((item) => item.pass === null);
    const sampled = hash(trace.id) % 100 < (spec.review?.sampleRate ?? 0);
    return {
      traceId: trace.id,
      traceName: trace.name,
      scores,
      score: round(score, 1),
      passed,
      failed,
      unscored,
      needsReview: (!!spec.review?.failures && (failed || unscored)) || sampled,
      reviewReason: failed || unscored ? 'Scorer failure or missing evidence' : sampled ? 'Quality-assurance sample' : '',
    };
  }) : [];
  const startedAt = options.startedAt ?? new Date().toISOString();
  const run = {
    id: options.id ?? makeId('run'),
    specId: spec.id,
    specName: spec.name,
    specVersion: spec.version,
    startedAt,
    completedAt: options.completedAt ?? startedAt,
    status: 'blocked',
    datasetSnapshot,
    specSnapshot,
    validation,
    results,
    summary: {},
    demo: datasetSnapshot.length > 0 && datasetSnapshot.every((trace) => trace.source === 'demo'),
    synthetic: datasetSnapshot.length > 0 && datasetSnapshot.every((trace) => trace.attributes?.['tracegrade.synthetic'] === true),
    name: options.name ?? `${spec.name} · v${spec.version}`,
  };
  run.summary = aggregateRun(run, annotations);
  run.status = run.summary.gate;
  return run;
}

/** Annotations resolve review work, never overwrite the automatic scorer results. */
export function aggregateRun(run, annotations = []) {
  const results = run.results ?? [];
  const enabled = (run.specSnapshot?.metrics ?? []).filter((metric) => metric.enabled);
  const latestAnnotations = new Map();
  for (const annotation of annotations) {
    if (annotation.runId !== run.id) continue;
    const existing = latestAnnotations.get(annotation.traceId);
    if (!existing || Date.parse(annotation.createdAt || 0) >= Date.parse(existing.createdAt || 0)) latestAnnotations.set(annotation.traceId, annotation);
  }
  const passed = results.filter((result) => result.passed).length;
  const failed = results.filter((result) => result.scores.some((score) => score.pass === false)).length;
  const unscored = results.filter((result) => result.scores.some((score) => score.pass === null)).length;
  const criticalFailures = results.filter((result) => result.scores.some((score) => score.critical && score.pass === false)).length;
  const reviewResults = results.filter((result) => result.needsReview);
  const pendingReview = reviewResults.filter((result) => !['accepted', 'rejected'].includes(latestAnnotations.get(result.traceId)?.verdict)).length;
  const rejected = results.filter((result) => latestAnnotations.get(result.traceId)?.verdict === 'rejected').length;
  const metrics = enabled.map((metric) => {
    const observations = results.flatMap((result) => result.scores.filter((score) => score.metricId === metric.id && score.value !== null));
    const value = average(observations.map((score) => score.value));
    return {
      id: metric.id,
      name: metric.name,
      value: round(value, metric.unit === 'usd' ? 5 : metric.unit === 'score' ? 3 : 1),
      passRate: observations.length ? round(observations.filter((score) => score.pass).length / observations.length * 100, 1) : null,
      scoredCount: observations.length,
      total: results.length,
      threshold: metric.threshold,
      unit: metric.unit,
      operator: metric.operator,
      passed: value === null ? null : metric.operator === 'lte' ? value <= metric.threshold : value >= metric.threshold,
      critical: !!metric.critical,
      aggregation: 'mean',
      kind: metric.kind,
    };
  });
  const passRate = results.length ? passed / results.length * 100 : null;
  const score = average(results.map((result) => result.score).filter(isNumber));
  const validationBlocked = run.validation?.valid === false || !results.length;
  let automaticGate = validationBlocked || unscored ? 'blocked' : criticalFailures || passRate < run.specSnapshot.passThreshold ? 'failed' : 'passed';
  const gate = automaticGate === 'passed' ? rejected ? 'failed' : pendingReview ? 'review' : 'passed' : automaticGate;
  return {
    score: round(score, 1),
    passRate: round(passRate, 1),
    total: results.length,
    selectedCount: run.datasetSnapshot?.length ?? 0,
    passed,
    failed,
    unscored,
    pendingReview,
    reviewTotal: reviewResults.length,
    reviewed: reviewResults.length - pendingReview,
    rejected,
    criticalFailures,
    metricResults: metrics,
    gate,
    automaticGate,
    reviewStatus: pendingReview ? 'pending' : rejected ? 'rejected' : reviewResults.length ? 'complete' : 'not_required',
    gateReasons: [
      ...(run.validation?.errors ?? []),
      ...(unscored ? [`${unscored} traces have unscored required metrics.`] : []),
      ...(criticalFailures ? [`${criticalFailures} traces failed a critical scorer.`] : []),
      ...(passRate !== null && passRate < run.specSnapshot.passThreshold ? [`Trace pass rate ${round(passRate, 1)}% is below the ${run.specSnapshot.passThreshold}% release requirement.`] : []),
      ...(rejected ? [`${rejected} traces were rejected during human review.`] : []),
      ...(pendingReview ? [`${pendingReview} traces are waiting for human review.`] : []),
    ],
  };
}

function decodeAnyValue(value) {
  if (value == null || typeof value !== 'object') return value;
  if ('stringValue' in value) return value.stringValue;
  if ('boolValue' in value) return value.boolValue;
  if ('intValue' in value) return safeNumber(value.intValue);
  if ('doubleValue' in value) return safeNumber(value.doubleValue);
  if ('bytesValue' in value) return value.bytesValue;
  if (value.arrayValue) return (value.arrayValue.values ?? []).map(decodeAnyValue);
  if (value.kvlistValue) return attributes(value.kvlistValue.values);
  return value;
}

function attributes(values) {
  if (!Array.isArray(values)) return values && typeof values === 'object' ? clone(values) : {};
  return Object.fromEntries(values.filter((entry) => typeof entry?.key === 'string').map((entry) => [entry.key, decodeAnyValue(entry.value)]));
}

function firstAttribute(records, keys) {
  for (const record of records) for (const key of keys) if (record[key] !== undefined && record[key] !== null) return record[key];
  return undefined;
}

function nanos(value) {
  try {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) return null;
    if (!/^[0-9]+$/.test(String(value))) return null;
    return BigInt(value);
  } catch { return null; }
}

function timestampFromNanos(value) {
  const time = nanos(value);
  if (time === null) return '';
  const milliseconds = Number(time / 1000000n);
  return Number.isFinite(milliseconds) && milliseconds <= 8640000000000000 ? new Date(milliseconds).toISOString() : '';
}

function durationFromNanos(start, end) {
  const startTime = nanos(start);
  const endTime = nanos(end);
  return startTime !== null && endTime !== null && endTime >= startTime ? Number(endTime - startTime) / 1e6 : null;
}

function spanType(span, attrs) {
  const operation = attrs['gen_ai.operation.name'];
  if (operation === 'execute_tool' || attrs['gen_ai.tool.name'] || attrs['tool.name']) return 'tool';
  if (operation === 'retrieve' || attrs['retrieval.documents'] || /retriev|search/i.test(span.name ?? '')) return 'retrieval';
  if (attrs['gen_ai.request.model'] || attrs['gen_ai.response.model'] || /chat|completion|generate/i.test(operation ?? '')) return 'llm';
  if (/invoke_agent|create_agent/.test(operation ?? '')) return 'agent';
  return 'span';
}

function scopeMetadata(scope, schemaUrl) {
  return {
    name: typeof scope?.name === 'string' ? scope.name : '',
    version: typeof scope?.version === 'string' ? scope.version : '',
    ...(typeof schemaUrl === 'string' && schemaUrl.trim() ? { schemaUrl } : {}),
  };
}

function resourceServiceName(resourceAttributes) {
  if (Array.isArray(resourceAttributes)) {
    const candidates = resourceAttributes.filter(attribute => attribute?.key === 'service.name');
    if (candidates.length !== 1) return 'unknown-service';
    const value = decodeAnyValue(candidates[0].value);
    return typeof value === 'string' && value.trim() ? value : 'unknown-service';
  }
  const value = resourceAttributes && Object.hasOwn(resourceAttributes, 'service.name') ? resourceAttributes['service.name'] : null;
  return typeof value === 'string' && value.trim() ? value : 'unknown-service';
}

function normalizedEvents(events, otlp = false) {
  return (Array.isArray(events) ? events : []).filter(event => event && typeof event === 'object' && !Array.isArray(event)).map(event => {
    const exactTime = nanos(event.timeUnixNano);
    let timestamp = exactTime === null ? '' : timestampFromNanos(exactTime);
    if (!otlp && event.timeUnixNano == null && typeof event.timestamp === 'string' && Number.isFinite(Date.parse(event.timestamp))) timestamp = new Date(event.timestamp).toISOString();
    return {
      name: content(event.name) || 'Unnamed event',
      attributes: attributes(event.attributes),
      timestamp: timestamp || null,
      timeUnixNano: exactTime !== null && timestamp ? String(exactTime) : null,
    };
  });
}

function importOTLP(requests, warnings) {
  const groups = new Map();
  for (const request of requests) for (const resourceSpan of request.resourceSpans ?? []) {
    const resource = attributes(resourceSpan.resource?.attributes);
    for (const scope of resourceSpan.scopeSpans ?? resourceSpan.instrumentationLibrarySpans ?? []) {
      for (const span of scope.spans ?? []) {
        if (!/^[a-f\d]{32}$/i.test(span.traceId ?? '') || /^0+$/.test(span.traceId)) {
          warnings.push('A span with a missing or invalid 32-character hexadecimal traceId was skipped.');
          continue;
        }
        if (!/^[a-f\d]{16}$/i.test(span.spanId ?? '') || /^0+$/.test(span.spanId)) {
          warnings.push(`A span in trace ${span.traceId} has an invalid spanId and was skipped.`);
          continue;
        }
        const traceId = span.traceId.toLowerCase();
        if (!groups.has(traceId)) groups.set(traceId, []);
        groups.get(traceId).push({ span, resource, attrs: attributes(span.attributes), service: resourceServiceName(resourceSpan.resource?.attributes), instrumentationScope: scopeMetadata(scope.scope ?? scope.instrumentationLibrary, scope.schemaUrl), resourceSchemaUrl: resourceSpan.schemaUrl });
      }
    }
  }
  return [...groups.entries()].map(([traceId, entries]) => {
    const uniqueEntries = [...new Map(entries.map((entry) => [entry.span.spanId.toLowerCase(), entry])).values()];
    if (uniqueEntries.length !== entries.length) warnings.push(`Duplicate spans in trace ${traceId} were deduplicated by spanId.`);
    const root = uniqueEntries.find(({ span }) => !span.parentSpanId || /^0+$/.test(span.parentSpanId)) ?? uniqueEntries[0];
    const attrRecords = [root.attrs, ...uniqueEntries.filter((entry) => entry !== root).map((entry) => entry.attrs), root.resource];
    const startValues = uniqueEntries.map(({ span }) => nanos(span.startTimeUnixNano)).filter((value) => value !== null);
    const endValues = uniqueEntries.map(({ span }) => nanos(span.endTimeUnixNano)).filter((value) => value !== null);
    const start = startValues.reduce((smallest, value) => smallest === null || value < smallest ? value : smallest, null);
    const end = endValues.reduce((largest, value) => largest === null || value > largest ? value : largest, null);
    const timingComplete = uniqueEntries.every(({ span }) => durationFromNanos(span.startTimeUnixNano, span.endTimeUnixNano) !== null);
    if (!timingComplete) warnings.push(`Trace ${traceId} contains missing, reversed, or unsafe timestamps; incomplete durations remain unscored.`);
    const inputKeys = ['input.value', 'gen_ai.input.messages', 'gen_ai.prompt', 'llm.input', 'input'];
    const outputKeys = ['output.value', 'gen_ai.output.messages', 'gen_ai.completion', 'llm.output', 'output'];
    const input = content(firstAttribute(attrRecords, inputKeys));
    const output = content(firstAttribute(attrRecords, outputKeys));
    const contentFallbacks = [input && firstAttribute([root.attrs], inputKeys) === undefined ? 'input' : null, output && firstAttribute([root.attrs], outputKeys) === undefined ? 'output' : null].filter(Boolean);
    if (contentFallbacks.length) warnings.push(`Trace ${traceId}: ${contentFallbacks.join(' and ')} mapped from a child span because the root has no content. Verify that it represents the evaluated agent interaction, not an intermediate tool or model call.`);
    const context = content(firstAttribute(attrRecords, ['retrieval.context', 'retrieval.documents', 'retrieved_context', 'context']));
    // Cost attributes are provider-specific. Never infer cost from token counts.
    const cost = safeNumber(firstAttribute([root.attrs], ['trace.cost_usd', 'cost_usd', 'gen_ai.usage.cost', 'llm.cost.total']));
    const spans = uniqueEntries.map(({ span, attrs, service, instrumentationScope, resourceSchemaUrl }) => ({
      id: span.spanId.toLowerCase(),
      parentId: span.parentSpanId || null,
      name: span.name || 'Unnamed span',
      type: spanType(span, attrs),
      durationMs: durationFromNanos(span.startTimeUnixNano, span.endTimeUnixNano),
      startMs: start !== null && nanos(span.startTimeUnixNano) !== null ? Number(nanos(span.startTimeUnixNano) - start) / 1e6 : null,
      status: span.status?.code === 2 ? 'error' : span.status?.code === 1 ? 'ok' : 'unknown',
      attributes: attrs,
      service,
      instrumentationScope,
      ...(typeof resourceSchemaUrl === 'string' && resourceSchemaUrl.trim() ? { resourceSchemaUrl } : {}),
      events: normalizedEvents(span.events, true),
    }));
    return {
      id: traceId,
      traceId,
      name: root.span.name || 'Imported trace',
      source: 'import',
      service: content(root.resource['service.name']) || 'unknown-service',
      environment: content(root.resource['deployment.environment.name'] ?? root.resource['deployment.environment']) || 'unknown',
      startedAt: start === null ? '' : timestampFromNanos(start),
      durationMs: timingComplete && start !== null && end !== null ? durationFromNanos(start, end) : null,
      costUsd: cost !== null && cost >= 0 ? cost : null,
      status: spans.some((span) => span.status === 'error') ? 'error' : root.span.status?.code === 1 ? 'ok' : 'unknown',
      input,
      output,
      context,
      expectedOutput: content(firstAttribute(attrRecords, ['expected_output', 'reference.output'])),
      model: content(firstAttribute(attrRecords, ['gen_ai.response.model', 'gen_ai.request.model', 'llm.model_name'])) || 'Unknown model',
      tags: ['imported', 'otlp'],
      spans,
      attributes: { ...root.resource, ...root.attrs },
    };
  });
}

function normalizeTrace(raw, index, warnings) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Trace ${index + 1} must be an object.`);
  const traceId = content(raw.traceId ?? raw.id).trim();
  if (!traceId) throw new Error(`Trace ${index + 1} needs an id or traceId.`);
  const durationMs = safeNumber(raw.durationMs);
  const costUsd = safeNumber(raw.costUsd);
  if (raw.source === 'demo' || raw.demoScores) warnings.push(`Trace ${traceId}: imported demo labels were removed; semantic fixtures are not trusted across the import boundary.`);
  const evaluatorScores = Object.create(null);
  const suppliedScores = raw.evaluatorScores && typeof raw.evaluatorScores === 'object' && !Array.isArray(raw.evaluatorScores) ? Object.entries(raw.evaluatorScores) : [];
  for (const [metricId, supplied] of suppliedScores) {
    if (!validJudgmentKey(metricId)) { warnings.push(`Trace ${traceId}: an invalid or reserved evaluator score key was ignored.`); continue; }
    if (supplied && isNumber(supplied.value) && supplied.value >= 0 && supplied.value <= 1 && typeof supplied.provenance === 'string' && supplied.provenance.trim()) evaluatorScores[metricId] = { value: supplied.value, provenance: supplied.provenance, reason: content(supplied.reason) };
    else warnings.push(`Trace ${traceId}: ${metricId} score was ignored because a numeric 0–1 value and text provenance are required.`);
  }
  const spans = (Array.isArray(raw.spans) ? raw.spans : []).map((span, spanIndex) => ({
    id: content(span.id ?? span.spanId) || `${traceId}_span_${spanIndex + 1}`,
    parentId: span.parentId ?? span.parentSpanId ?? null,
    name: content(span.name) || 'Unnamed span',
    type: content(span.type) || spanType(span, attributes(span.attributes)),
    durationMs: safeNumber(span.durationMs),
    startMs: safeNumber(span.startMs),
    status: span.status === 'error' || span.status?.code === 2 ? 'error' : span.status === 'ok' || span.status?.code === 1 ? 'ok' : 'unknown',
    attributes: attributes(span.attributes),
    service: typeof span.service === 'string' && span.service.trim() ? span.service : 'unknown-service',
    instrumentationScope: scopeMetadata(span.instrumentationScope, span.instrumentationScope?.schemaUrl),
    ...(typeof span.resourceSchemaUrl === 'string' && span.resourceSchemaUrl.trim() ? { resourceSchemaUrl: span.resourceSchemaUrl } : {}),
    events: normalizedEvents(span.events),
  }));
  return {
    id: traceId,
    traceId,
    name: content(raw.name) || `Imported trace ${index + 1}`,
    source: 'import',
    service: content(raw.service) || 'unknown-service',
    environment: content(raw.environment) || 'unknown',
    startedAt: raw.startedAt && Number.isFinite(Date.parse(raw.startedAt)) ? new Date(raw.startedAt).toISOString() : '',
    durationMs: durationMs !== null && durationMs >= 0 ? durationMs : null,
    costUsd: costUsd !== null && costUsd >= 0 ? costUsd : null,
    status: raw.status === 'error' || spans.some((span) => span.status === 'error') ? 'error' : raw.status === 'ok' ? 'ok' : 'unknown',
    input: content(raw.input),
    output: content(raw.output),
    context: content(raw.context),
    expectedOutput: content(raw.expectedOutput),
    model: content(raw.model) || 'Unknown model',
    tags: Array.isArray(raw.tags) ? raw.tags.map(content) : ['imported'],
    spans,
    attributes: attributes(raw.attributes),
    ...(Object.keys(evaluatorScores).length ? { evaluatorScores } : {}),
  };
}

export function importTraces(jsonOrObject) {
  const warnings = [];
  let parsed = jsonOrObject;
  if (typeof parsed === 'string') {
    if (parsed.length > 20 * 1024 * 1024) throw new Error('This prototype accepts trace files up to 20 MB.');
    try { parsed = JSON.parse(parsed); }
    catch {
      try { parsed = parsed.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line)); }
      catch { throw new Error('The file is not valid JSON or newline-delimited JSON.'); }
    }
  }
  let traces;
  if (Array.isArray(parsed?.resourceSpans)) traces = importOTLP([parsed], warnings);
  else if (Array.isArray(parsed) && parsed.length && parsed.every((entry) => Array.isArray(entry?.resourceSpans))) traces = importOTLP(parsed, warnings);
  else if (Array.isArray(parsed)) traces = parsed.map((trace, index) => normalizeTrace(trace, index, warnings));
  else if (Array.isArray(parsed?.traces)) traces = parsed.traces.map((trace, index) => normalizeTrace(trace, index, warnings));
  else throw new Error('Expected an OTLP object with resourceSpans, a trace array, or an object with a traces array.');
  if (!traces.length) throw new Error('No valid traces were found in this file.');
  if (traces.length > MAX_IMPORT_TRACES) throw new Error(`Import at most ${MAX_IMPORT_TRACES} traces at a time in this prototype.`);
  const unique = [...new Map(traces.map((trace) => [trace.id, trace])).values()];
  if (unique.length !== traces.length) warnings.push(`${traces.length - unique.length} duplicate trace IDs were replaced with their last occurrence.`);
  const missing = unique.filter((trace) => !hasContent(trace.input) || !hasContent(trace.output)).length;
  if (missing) warnings.push(`${missing} traces are missing input or output content. Your dataset requirements may block evaluation.`);
  return { traces: unique, warnings: [...new Set(warnings)] };
}

function escapeHTML(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function formatValue(value, unit) {
  if (value === null || value === undefined) return 'Unscored';
  if (unit === 'usd') return `$${Number(value).toFixed(4)}`;
  if (unit === 'ms') return `${round(value, 0)} ms`;
  if (unit === 'percent') return `${round(value, 1)}%`;
  return String(round(value, 3));
}

export function exportReport(run, annotations = []) {
  const summary = aggregateRun(run, annotations);
  const h = escapeHTML;
  const evidenceNotice = run.synthetic ? 'SYNTHETIC SCENARIO. Traces and supplied judgments are illustrative fixtures; no production agent was measured.' : run.demo ? 'SAMPLE DATA. Semantic scores are recorded demo fixtures; deterministic checks execute against the sample evidence.' : 'Imported trace evidence. Missing scores remain unscored. Semantic results are included only when supplied with provenance.';
  const annotationRows = annotations.filter((annotation) => annotation.runId === run.id);
  const traceMap = new Map((run.datasetSnapshot ?? []).map((trace) => [trace.id, trace]));
  const metricRows = summary.metricResults.map((metric) => `<tr><td>${h(metric.name)}</td><td>${h(formatValue(metric.value, metric.unit))}</td><td>${metric.operator === 'gte' ? '≥' : '≤'} ${h(formatValue(metric.threshold, metric.unit))}</td><td>${metric.passRate === null ? '—' : h(metric.passRate) + '%'}</td><td>${metric.scoredCount}/${metric.total}</td></tr>`).join('');
  const resultRows = run.results.map((result) => {
    const trace = traceMap.get(result.traceId);
    const lineage = trace?.normalization ? `<h4>Normalization profile and field lineage</h4><pre>${h(JSON.stringify(trace.normalization, null, 2))}</pre>` : '';
    const spanEvidence = trace?.spans?.length ? `<details><summary>Span and event evidence</summary><pre>${h(JSON.stringify(trace.spans, null, 2))}</pre></details>` : '';
    return `<tr><td><strong>${h(result.traceName)}</strong><br><code>${h(result.traceId)}</code></td><td>${result.unscored ? 'Unscored' : result.passed ? 'Pass' : 'Fail'}</td><td>${result.score === null ? '—' : h(result.score) + '%'}</td><td>${result.scores.map((score) => `<div><strong>${h(score.name)}:</strong> ${h(formatValue(score.value, score.unit))} (${score.pass === null ? 'unscored' : score.pass ? 'pass' : 'fail'})<br><small>${h(score.reason)}</small></div>`).join('')}</td></tr><tr><td colspan="4"><details><summary>Trace evidence</summary><h4>Input</h4><pre>${h(trace?.input)}</pre><h4>Response</h4><pre>${h(trace?.output)}</pre><h4>Retrieved context</h4><pre>${h(trace?.context)}</pre>${lineage}${spanEvidence}</details></td></tr>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${h(run.specName)} · evaluation report</title><style>body{margin:0;background:#f8faf9;color:#18312e;font:14px/1.6 system-ui,sans-serif}main{max-width:1100px;margin:40px auto;padding:40px;background:white;border:1px solid #dce5e0;border-radius:12px}h1{font-size:30px;line-height:1.2;margin:8px 0 16px}h2{font-size:20px;margin-top:36px}small,.muted{color:#63736e}table{border-collapse:collapse;width:100%;margin:16px 0}th,td{text-align:left;padding:12px;border-bottom:1px solid #e5ebe8;vertical-align:top}th{font-size:11px;letter-spacing:.06em;text-transform:uppercase;background:#f4f7f5}td div+div{margin-top:12px}pre{white-space:pre-wrap;word-break:break-word;font:12px/1.6 ui-monospace,monospace;background:#f5f8f6;padding:12px}code{font-size:11px;word-break:break-all}.metrics{display:flex;gap:32px;flex-wrap:wrap;padding:20px 0;border-block:1px solid #e5ebe8}.metrics strong{display:block;font-size:28px}.notice{padding:16px;background:#f3f7f4;border-left:3px solid #447965}summary{cursor:pointer}footer{margin-top:40px;color:#63736e}@media(max-width:700px){main{margin:0;padding:20px;border:0}table{font-size:11px}th,td{padding:8px}}@media print{body{background:white}main{border:0;margin:0;padding:0}details{break-inside:avoid}tr{break-inside:avoid}}</style></head><body><main><p class="muted">TRACEGRADE / EVALUATION REPORT</p><h1>${h(run.specName)}</h1><p>Specification v${h(run.specVersion)} · Run <code>${h(run.id)}</code> · ${h(run.startedAt)}</p><div class="metrics"><div><span>Release decision</span><strong>${h(summary.gate.toUpperCase())}</strong></div><div><span>Weighted scorer pass score</span><strong>${summary.score === null ? '—' : h(summary.score) + '%'}</strong></div><div><span>Trace pass rate</span><strong>${summary.passRate === null ? '—' : h(summary.passRate) + '%'}</strong></div><div><span>Traces evaluated</span><strong>${summary.total}</strong></div></div><p class="notice">${h(evidenceNotice)} This report records evaluation results, not a production deployment approval.</p><h2>Release gate</h2><p>Required trace pass rate: ${h(run.specSnapshot.passThreshold)}%. Critical failures: ${summary.criticalFailures}. Unscored traces: ${summary.unscored}. Human reviews pending: ${summary.pendingReview}.</p>${summary.gateReasons.length ? `<ul>${summary.gateReasons.map((reason) => `<li>${h(reason)}</li>`).join('')}</ul>` : '<p>All automatic checks and required reviews passed.</p>'}<h2>Scorecard</h2><p class="muted">Values are means. Each trace is tested separately against its threshold; the release gate uses the trace pass rate and critical failures.</p><table><thead><tr><th>Metric</th><th>Mean value</th><th>Threshold</th><th>Pass rate</th><th>Coverage</th></tr></thead><tbody>${metricRows}</tbody></table><h2>Guidelines</h2>${(run.specSnapshot.guidelines ?? []).map((guideline) => `<h3>${h(guideline.title)}</h3><p>${h(guideline.description)}</p>`).join('')}<h2>Human annotations</h2><p class="muted">Annotations are separate judgments and never overwrite automatic metric results.</p>${annotationRows.length ? `<table><thead><tr><th>Trace</th><th>Verdict</th><th>Reviewer</th><th>Note</th></tr></thead><tbody>${annotationRows.map((annotation) => `<tr><td><code>${h(annotation.traceId)}</code></td><td>${h(annotation.verdict)}</td><td>${h(annotation.reviewer)}<br><small>${h(annotation.createdAt)}</small></td><td>${h(annotation.note)}</td></tr>`).join('')}</tbody></table>` : '<p>No human annotations have been recorded.</p>'}<h2>Trace results and evidence</h2><table><thead><tr><th>Trace</th><th>Result</th><th>Score</th><th>Scorer evidence</th></tr></thead><tbody>${resultRows || '<tr><td colspan="4">Run blocked before scoring. See release-gate validation errors.</td></tr>'}</tbody></table><h2>Reproducibility</h2><p>The run contains a frozen specification and dataset snapshot. This report includes the specification, metric definitions, trace evidence, and annotation history.</p><details><summary>Specification snapshot</summary><pre>${h(JSON.stringify(run.specSnapshot, null, 2))}</pre></details><footer>Generated by Tracegrade · browser-local prototype · ${h(new Date().toISOString())}</footer></main></body></html>`;
}

function csvCell(value) {
  let text = String(value ?? '');
  // Prevent spreadsheet formula execution when evidence is opened as CSV.
  if (typeof value === 'string' && /^(\s*[=+@\-]|[\t\r])/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function exportCSV(run) {
  const metrics = (run.specSnapshot?.metrics ?? []).filter((metric) => metric.enabled);
  const columns = ['run_id', 'spec_version', 'trace_id', 'trace_name', 'result', 'weighted_pass_score', ...metrics.flatMap((metric) => [metric.id, `${metric.id}_pass`, `${metric.id}_reason`])];
  const rows = run.results.map((result) => [run.id, run.specVersion, result.traceId, result.traceName, result.unscored ? 'unscored' : result.passed ? 'passed' : 'failed', result.score, ...metrics.flatMap((metric) => {
    const score = result.scores.find((item) => item.metricId === metric.id);
    return [score?.value ?? '', score?.pass === null ? 'unscored' : String(score?.pass ?? ''), score?.reason ?? ''];
  })]);
  return [columns, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export function exportSpec(spec) {
  return JSON.stringify({ schemaVersion: SCHEMA_VERSION, kind: 'TracegradeEvaluationSpec', ...clone(spec) }, null, 2);
}

const CASES = [
  { name: 'Refund eligibility', input: 'I bought the annual plan 12 days ago. Can I get a refund?', context: 'Billing policy §4.2: annual plans are refundable within 14 days of purchase when usage is below 100 conversations. Refunds require billing-team approval.', output: 'Your purchase is within the 14-day refund window. I can check your usage and send a refund request to our billing team for approval.', badOutput: 'I have refunded your entire annual plan. All purchases qualify for a full refund within 30 days.', tool: 'billing.get_subscription', tag: 'billing' },
  { name: 'Account access recovery', input: 'I lost my authenticator and cannot sign in. How do I recover my account?', context: 'Security policy §2.1: verify ownership through the registered recovery email. Agents must not disable MFA directly. Escalate accounts without a recovery email to security support.', output: 'Use the recovery link sent to your registered email. If you cannot access that address, I can connect you with security support to verify ownership.', badOutput: 'I can disable MFA for you immediately. Please send me your password to confirm the account.', tool: 'identity.send_recovery_link', tag: 'account' },
  { name: 'Order delivery status', input: 'Where is order #A1042? The delivery date has passed.', context: 'Order A1042: shipped; carrier scan at Melbourne depot; delivery estimate tomorrow. Escalate if no scan for 72 hours. Do not promise a guaranteed delivery date.', output: 'Your order was last scanned at the Melbourne depot. The carrier estimates delivery tomorrow, though that is not guaranteed. I can help escalate if tracking stops updating for 72 hours.', badOutput: 'Your order is guaranteed to arrive by 9 am tomorrow. I have added a $50 credit.', tool: 'orders.track_shipment', tag: 'orders' },
  { name: 'Plan downgrade request', input: 'Please downgrade our team from Pro to Starter at renewal.', context: 'Plan changes apply at the next renewal. Starter supports five seats. Account has eight seats. Confirm seat reduction and obtain billing-admin approval before scheduling.', output: 'Starter allows five seats, and your team currently has eight. Please confirm which three seats to remove and have a billing admin approve the downgrade for your renewal.', badOutput: 'Done — the downgrade is live now and all eight users can keep their access.', tool: 'billing.preview_plan_change', tag: 'billing' },
  { name: 'Knowledge-base answer', input: 'How do I set business hours for our support team?', context: 'Admin Center > Objects and rules > Business rules > Schedules. Create a schedule, select the timezone, choose hours, and add holidays. Schedule availability depends on subscription.', output: 'In Admin Center, open Objects and rules → Business rules → Schedules. Create a schedule, select your timezone, set working hours, and add holidays. Availability depends on your subscription.', badOutput: 'Business hours are automatically inferred from your team activity; there is nothing to configure.', tool: 'knowledge.search', tag: 'knowledge' },
  { name: 'Data export request', input: 'Can you export all customer conversations from last month?', context: 'Data export policy: only account admins can request conversation exports. Verify date range, redact sensitive fields by default, and deliver via an expiring secure link.', output: 'An account admin can request that export. Please confirm the date range; sensitive fields will be redacted by default, and the export will be delivered through an expiring secure link.', badOutput: 'Sure. I will send the unredacted customer conversation archive as an email attachment.', tool: 'exports.check_permissions', tag: 'privacy' },
  { name: 'Invoice discrepancy', input: 'Our latest invoice has two charges for the same add-on.', context: 'Invoice INV-8031: line 2 is a prorated charge for the previous billing period; line 3 is the next full billing period. Credits require billing review.', output: 'The two entries cover different periods: one is a prorated charge for the previous period, and the other is the next full period. I can route the invoice to billing if you would like it reviewed.', badOutput: 'This is definitely a duplicate charge. I have removed both items from your bill.', tool: 'billing.get_invoice', tag: 'billing' },
  { name: 'Webhook delivery failure', input: 'Our webhook returned a 500. Will the event be retried?', context: 'Webhook retry guide: HTTP 500 responses are retried with exponential backoff for up to 24 hours. Delivery history is available in Admin Center. Preserve event IDs for deduplication.', output: 'Yes. A 500 response triggers retries with exponential backoff for up to 24 hours. Check delivery history in Admin Center, and use the event ID to deduplicate retries.', badOutput: 'Every webhook retries forever until it succeeds. No deduplication is necessary.', tool: 'webhooks.get_deliveries', tag: 'technical' },
  { name: 'Agent handoff request', input: 'I need to speak with a person about a complaint.', context: 'Escalation policy: honor requests for a human agent. Summarize the issue, attach the conversation, and inform the customer of the next response window. Do not invent availability.', output: 'I can pass this to a support specialist with the conversation attached so you do not need to repeat yourself. Please share a short description of the complaint for the handoff.', badOutput: 'You do not need a human agent. I can resolve every kind of complaint myself.', tool: 'tickets.create_handoff', tag: 'escalation' },
  { name: 'API rate-limit guidance', input: 'Our integration gets 429 errors. What should we do?', context: 'API guide: respect the Retry-After header, apply exponential backoff with jitter, and reduce concurrent requests. Quotas vary by plan; do not promise a universal numeric quota.', output: 'Respect the Retry-After header, then retry with exponential backoff and jitter. Reduce concurrency while you check the quota for your plan.', badOutput: 'Ignore the Retry-After header and retry immediately. Every account supports 10,000 requests per second.', tool: 'knowledge.search', tag: 'technical' },
  { name: 'Subscription cancellation', input: 'Can you cancel auto-renewal but keep our access until the term ends?', context: 'Cancellation policy: billing admins can disable auto-renewal. Access continues to the paid-through date. Confirm the change with an admin; deletion is a separate operation.', output: 'Yes. A billing admin can disable auto-renewal while keeping access until your paid-through date. This does not delete your account or data.', badOutput: 'Cancellation immediately deletes your account and all historical conversations.', tool: 'billing.get_subscription', tag: 'billing' },
  { name: 'Team permission check', input: 'Why can our light agent view tickets but not reply publicly?', context: 'Light-agent role: view eligible tickets and add private comments; public replies require a paid agent seat. Only an admin can change roles.', output: 'Light agents can add private comments but cannot send public replies. An admin can upgrade the user to a paid agent seat if public replies are needed.', badOutput: 'Light agents can send public replies if they use the mobile app.', tool: 'identity.get_roles', tag: 'account' },
];

function seedTraces(anchor) {
  return Array.from({ length: 60 }, (_, index) => {
    const template = CASES[index % CASES.length];
    const poorGrounding = index % 17 === 3;
    const poorRelevance = index % 29 === 8;
    const toolError = index % 23 === 6;
    const slow = index % 13 === 7;
    const expensive = index % 19 === 10;
    const durationMs = slow ? 5840 + index * 12 : 1280 + (index * 137) % 2380;
    const id = `4f8a${(index + 1).toString(16).padStart(28, '0')}`;
    const rootId = (0xa100 + index).toString(16).padStart(16, '0');
    const retrievalId = (0xb100 + index).toString(16).padStart(16, '0');
    const toolId = (0xc100 + index).toString(16).padStart(16, '0');
    const llmId = (0xd100 + index).toString(16).padStart(16, '0');
    return {
      id,
      traceId: id,
      name: template.name,
      source: 'demo',
      service: index % 11 === 10 ? 'knowledge-agent' : 'support-agent',
      environment: index % 15 === 14 ? 'staging' : 'production',
      startedAt: new Date(anchor - index * 16 * 60 * 1000).toISOString(),
      durationMs,
      costUsd: round(expensive ? 0.045 + index / 10000 : 0.009 + (index % 13) * 0.0009, 4),
      status: toolError ? 'error' : 'ok',
      input: template.input,
      output: poorGrounding ? template.badOutput : poorRelevance ? 'Thanks for getting in touch. You can find more information in our help center.' : toolError ? `I could not complete the lookup just now. I can hand this to a support specialist. ${template.output}` : template.output,
      context: template.context,
      expectedOutput: template.output,
      model: index % 5 === 0 ? 'support-model-v2' : 'support-model-v3',
      tags: [template.tag, index % 3 === 0 ? 'enterprise' : 'self-service', ...(poorGrounding ? ['policy-risk'] : [])],
      spans: [
        { id: rootId, parentId: null, name: 'support.resolve', type: 'agent', durationMs, startMs: 0, status: toolError ? 'error' : 'ok', attributes: { 'gen_ai.operation.name': 'invoke_agent', 'gen_ai.agent.name': 'Support agent' } },
        { id: retrievalId, parentId: rootId, name: 'knowledge.retrieve', type: 'retrieval', durationMs: 180 + index * 3, startMs: 45, status: 'ok', attributes: { 'retrieval.documents': 3, 'retrieval.collection': 'support-policies' } },
        { id: toolId, parentId: rootId, name: template.tool, type: 'tool', durationMs: slow ? 2760 : 240 + index * 7, startMs: 310, status: toolError ? 'error' : 'ok', attributes: { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': template.tool, ...(toolError ? { 'error.type': 'UpstreamTimeout' } : {}) } },
        { id: llmId, parentId: rootId, name: 'response.generate', type: 'llm', durationMs: Math.max(400, durationMs - (slow ? 3120 : 700)), startMs: slow ? 3120 : 700, status: 'ok', attributes: { 'gen_ai.request.model': index % 5 === 0 ? 'support-model-v2' : 'support-model-v3', 'gen_ai.usage.input_tokens': 780 + index * 17, 'gen_ai.usage.output_tokens': 80 + index * 3 } },
      ],
      attributes: { 'service.name': index % 11 === 10 ? 'knowledge-agent' : 'support-agent', 'deployment.environment.name': index % 15 === 14 ? 'staging' : 'production', 'app.version': '3.4.0', 'customer.segment': index % 3 === 0 ? 'enterprise' : 'self-service', 'session.id': `session_${String(index + 1).padStart(4, '0')}`, 'tracegrade.measurement_source': 'synthetic-demo', 'agent.tool_calls': 1, 'agent.tool_success_percent': toolError ? 0 : 100, 'gen_ai.usage.input_tokens': 780 + index * 17, 'gen_ai.usage.output_tokens': 80 + index * 3, 'response.duration_ms': durationMs },
      demoScores: { groundedness: poorGrounding ? 0.52 + (index % 3) * 0.04 : round(0.9 + (index % 9) * 0.01, 2), relevance: poorRelevance ? 0.61 : round(0.88 + (index % 7) * 0.015, 3) },
    };
  });
}

function seedSpecs(anchor) {
  const metrics = [
    { id: 'groundedness', name: 'Groundedness', description: 'Is each material claim supported by the retrieved context? Demo fixtures until a judge is connected.', kind: 'demo_judge', threshold: 0.85, operator: 'gte', unit: 'score', weight: 35, enabled: true, critical: true },
    { id: 'relevance', name: 'Answer relevance', description: 'Does the response directly address the customer request? Demo fixtures until a judge is connected.', kind: 'demo_judge', threshold: 0.8, operator: 'gte', unit: 'score', weight: 25, enabled: true, critical: false },
    { id: 'latency', name: 'Response latency', description: 'End-to-end trace duration in milliseconds, tested independently for every trace.', kind: 'deterministic', threshold: 4000, operator: 'lte', unit: 'ms', weight: 20, enabled: true, critical: false },
    { id: 'tool_success', name: 'Tool success', description: 'Percentage of recorded tool calls with successful outcomes.', kind: 'deterministic', threshold: 100, operator: 'gte', unit: 'percent', weight: 15, enabled: true, critical: false },
    { id: 'cost', name: 'Cost per response', description: 'Explicitly recorded cost per trace in USD; never inferred from model names.', kind: 'deterministic', threshold: 0.03, operator: 'lte', unit: 'usd', weight: 5, enabled: true, critical: false },
  ];
  const base = {
    id: 'spec_support', name: 'Support agent quality', description: 'Evaluate helpful, grounded, and reliable customer support responses before release.', version: 3, updatedAt: new Date(anchor).toISOString(),
    guidelines: [
      { id: 'guide_ground', title: 'Ground answers in approved knowledge', description: 'Every policy, eligibility, and product claim must be supported by retrieved context. Acknowledge uncertainty when evidence is missing.' },
      { id: 'guide_action', title: 'Keep actions within authority', description: 'Verify permissions before changing an account. Escalate refunds, security exceptions, and unresolved tool errors to the appropriate team.' },
      { id: 'guide_help', title: 'Resolve the customer’s actual request', description: 'Address the question directly, explain the next step, and honor requests for a human. Never invent a completed action.' },
    ],
    dataset: { source: 'demo', service: 'support-agent', environment: 'production', sampleSize: 40, minSamples: 20, requireInput: true, requireOutput: true, requireContext: true, selection: 'recent' },
    metrics,
    review: { failures: true, sampleRate: 10 },
    automation: { trigger: 'manual', schedule: 'daily', reportFormat: 'html' },
    passThreshold: 85,
  };
  const retrieval = clone(base);
  Object.assign(retrieval, { id: 'spec_retrieval', name: 'Knowledge retrieval', description: 'Measure whether retrieved knowledge leads to grounded, relevant answers.', version: 2 });
  retrieval.metrics = retrieval.metrics.map((metric) => ({ ...metric, enabled: ['groundedness', 'relevance'].includes(metric.id), critical: false }));
  const efficiency = clone(base);
  Object.assign(efficiency, { id: 'spec_efficiency', name: 'Resolution efficiency', description: 'Keep response time, tool reliability, and per-conversation cost within budget.', version: 1, passThreshold: 80 });
  efficiency.metrics = efficiency.metrics.map((metric) => ({ ...metric, enabled: ['latency', 'tool_success', 'cost'].includes(metric.id), critical: false }));
  efficiency.dataset.requireContext = false;
  return [base, retrieval, efficiency];
}

export function createInitialState() {
  const anchor = Date.now() - 30 * 60 * 1000;
  const traces = seedTraces(anchor - 30 * 60 * 1000);
  const specs = seedSpecs(anchor - 15 * 60 * 1000);
  const runs = Array.from({ length: 5 }, (_, index) => {
    const spec = clone(specs[0]);
    const isOlder = index >= 3;
    if (isOlder) { spec.version = index === 4 ? 1 : 2; spec.review.sampleRate = 0; spec.review.failures = false; }
    const historicalTraces = clone(traces);
    historicalTraces.forEach((trace) => {
      trace.startedAt = new Date(Date.parse(trace.startedAt) - index * 24 * 60 * 60 * 1000).toISOString();
      if (index === 4 || index === 2) {
        const factor = index === 4 ? 1.3 : 1.1;
        trace.durationMs = round(trace.durationMs * factor, 0);
        trace.attributes['response.duration_ms'] = trace.durationMs;
        trace.spans.forEach((span) => {
          span.durationMs = round(span.durationMs * factor, 0);
          span.startMs = round(span.startMs * factor, 0);
        });
      }
    });
    if (index === 3) {
      // A previous candidate was stable; the latest seeded candidate regressed.
      historicalTraces.forEach((trace) => {
        trace.demoScores.groundedness = Math.max(trace.demoScores.groundedness, 0.89);
        trace.demoScores.relevance = Math.max(trace.demoScores.relevance, 0.87);
        const durationRatio = Math.min(trace.durationMs, 3600) / trace.durationMs;
        trace.durationMs = Math.min(trace.durationMs, 3600);
        trace.attributes['response.duration_ms'] = trace.durationMs;
        trace.costUsd = Math.min(trace.costUsd, 0.024);
        trace.status = 'ok';
        trace.attributes['agent.tool_success_percent'] = 100;
        trace.spans.forEach((span) => {
          span.status = 'ok';
          span.durationMs = round(span.durationMs * durationRatio, 0);
          span.startMs = round(span.startMs * durationRatio, 0);
        });
        trace.output = trace.expectedOutput;
        trace.model = 'support-model-v2-stable';
      });
    }
    const startedAt = new Date(anchor - index * 24 * 60 * 60 * 1000).toISOString();
    spec.updatedAt = new Date(Date.parse(startedAt) - 15 * 60 * 1000).toISOString();
    const run = evaluateRun(historicalTraces, spec, [], { id: `run_demo_${105 - index}`, startedAt, completedAt: new Date(Date.parse(startedAt) + 24000 + index * 3200).toISOString() });
    run.label = `RUN-${String(5 - index).padStart(3, '0')}`;
    return run;
  });
  return { schemaVersion: SCHEMA_VERSION, specs, traces, runs, annotations: [], connector: { provider: 'Demo workspace', endpoint: '', service: 'support-agent', status: 'demo' }, activeSpecId: 'spec_support' };
}
