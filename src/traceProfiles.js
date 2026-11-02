/**
 * Pinned, explicit OTLP normalization examples. These are application contracts,
 * not claims that every emitter implements the same GenAI conventions.
 * Schema URLs are retained as evidence; this module never fetches them.
 */
import { importTraces } from './domain.js';

const VERSION = '1.0.0';
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value
  : typeof value === 'string' && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) && Number.isFinite(Number(value)) ? Number(value) : null;
const nonblank = value => typeof value === 'string' && value.trim().length > 0;
const clone = value => structuredClone(value);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const root = (target, attribute, extra = {}) => ({ target, source: 'root', attribute, format: 'text', ...extra });
const resource = (target, attribute) => ({ target, source: 'resource', attribute, format: 'text' });
const judgment = (key, source, prefix, selector = {}) => [
  { target: `evaluatorScores.${key}.value`, source, attribute: `${prefix}.value`, format: 'score', unit: 'score', transform: 'Accept a numeric 0–1 value only with the mapped provenance', ...selector },
  { target: `evaluatorScores.${key}.provenance`, source, attribute: `${prefix}.provenance`, format: 'text', ...selector },
  { target: `evaluatorScores.${key}.reason`, source, attribute: `${prefix}.reason`, format: 'text', optional: true, ...selector },
];

export const TRACE_PROFILES = freeze([
  {
    id: 'support-genai-v1', version: VERSION, name: 'Support · GenAI-style messages', team: 'Customer support',
    description: 'Read the single root’s GenAI-style message arrays and explicit support policy judgments. Message arrays may be JSON strings or typed OTLP arrays; only text parts[].content are joined. No child response fallback is used.',
    fields: [
      resource('service', 'service.name'), resource('environment', 'deployment.environment.name'),
      root('input', 'gen_ai.input.messages', { format: 'message-parts', transform: 'Parse a message array and join text parts[].content' }),
      root('output', 'gen_ai.output.messages', { format: 'message-parts', transform: 'Parse a message array and join text parts[].content' }),
      root('context', 'support.policy_context'), root('model', 'gen_ai.response.model'),
      root('costUsd', 'eval.total_cost_usd', { format: 'number', unit: 'usd', transform: 'Keep explicit USD; require a finite nonnegative number' }),
      ...judgment('policy_compliance', 'root', 'eval.policy_compliance'),
    ],
  },
  {
    id: 'checkout-shop-v1', version: VERSION, name: 'Checkout · custom shop attributes', team: 'Commerce engineering',
    description: 'Map exact shop.* root attributes and the legacy environment resource key. Recorded cents are divided by 100; an absent cost stays unscored. Tool outcomes use explicit OTLP status codes, including unknown UNSET outcomes.',
    fields: [
      resource('service', 'service.name'), resource('environment', 'deployment.environment'),
      root('input', 'shop.request', { format: 'json', transform: 'Parse or preserve structured JSON' }),
      root('output', 'shop.result', { format: 'json', transform: 'Parse or preserve structured JSON' }),
      root('model', 'shop.agent_model'),
      root('costUsd', 'shop.total_cost_cents', { format: 'number', unit: 'cents', transform: 'Divide cents by 100 to USD' }),
      root('attributes.checkout.payment_attempts', 'shop.payment.attempts', { format: 'number', unit: 'number', transform: 'Copy a finite nonnegative number to the exact trace attribute key' }),
    ],
  },
  {
    id: 'document-events-v1', version: VERSION, name: 'Documents · final-answer event', team: 'Document review',
    description: 'Select the final response and citation judgment only from review.completed on the unique document.review.finalize child span. Retrieve context only from review.retrieve_evidence. Unrelated retrieval output is never treated as the final answer.',
    fields: [
      resource('service', 'service.name'), resource('environment', 'deployment.environment.name'),
      root('input', 'review.question'), root('model', 'review.model'),
      { target: 'context', source: 'span', spanName: 'review.retrieve_evidence', attribute: 'review.context', format: 'text' },
      { target: 'output', source: 'event', spanName: 'document.review.finalize', eventName: 'review.completed', attribute: 'review.answer', format: 'text' },
      root('costUsd', 'review.cost_usd', { format: 'number', unit: 'usd', transform: 'Keep explicit USD; require a finite nonnegative number' }),
      ...judgment('citation_accuracy', 'event', 'review.citation', { spanName: 'document.review.finalize', eventName: 'review.completed' }),
    ],
  },
  {
    id: 'handoff-services-v1', version: VERSION, name: 'Handoff · specialist service', team: 'Service desk',
    description: 'Read the coordinator request and explicit total cost from the single root. Select the response, received context, and supplied handoff judgment only from agent.respond emitted by access-specialist. Identically named spans in other services do not qualify.',
    fields: [
      resource('service', 'service.name'), resource('environment', 'deployment.environment.name'),
      root('input', 'desk.request'), root('model', 'desk.coordinator.model'),
      root('costUsd', 'desk.total_cost_usd', { format: 'number', unit: 'usd', transform: 'Keep explicit USD; require a finite nonnegative number' }),
      root('attributes.handoff.count', 'desk.handoff_count', { format: 'number', unit: 'number', transform: 'Copy a finite nonnegative number to the exact trace attribute key' }),
      { target: 'output', source: 'span', spanName: 'agent.respond', serviceName: 'access-specialist', attribute: 'desk.answer', format: 'text' },
      { target: 'context', source: 'span', spanName: 'agent.respond', serviceName: 'access-specialist', attribute: 'desk.context_received', format: 'text' },
      ...judgment('handoff_completeness', 'span', 'desk.handoff_quality', { spanName: 'agent.respond', serviceName: 'access-specialist' }),
    ],
  },
  {
    id: 'retrieval-resources-v1', version: VERSION, name: 'Retrieval · resource-qualified evidence', team: 'Knowledge platform',
    description: 'Read the final answer and supplied groundedness judgment from the root. Select context and recorded source age only from retrieval.search emitted by knowledge-index; a same-name stale-cache span is excluded by its resource service.',
    fields: [
      resource('service', 'service.name'), resource('environment', 'deployment.environment.name'),
      root('input', 'rag.question'), root('output', 'rag.answer'), root('model', 'rag.model'),
      root('costUsd', 'rag.total_cost_usd', { format: 'number', unit: 'usd', transform: 'Keep explicit USD; require a finite nonnegative number' }),
      ...judgment('groundedness', 'root', 'rag.groundedness'),
      { target: 'context', source: 'span', spanName: 'retrieval.search', serviceName: 'knowledge-index', attribute: 'rag.context', format: 'text' },
      { target: 'attributes.retrieval.source_age_hours', source: 'span', spanName: 'retrieval.search', serviceName: 'knowledge-index', attribute: 'rag.source_age_hours', format: 'number', unit: 'number', transform: 'Copy explicit nonnegative source age in hours; do not infer it from timestamps' },
    ],
  },
  {
    id: 'streaming-final-v1', version: VERSION, name: 'Streaming · explicit completion event', team: 'Conversation platform',
    description: 'Read the request, context, model, and explicit cost from the root. On the unique chat.stream span from stream-gateway, read recorded time to first token and the stream.completed final-answer receipt. Repeated stream.chunk events are retained as evidence but never concatenated into a final answer.',
    fields: [
      resource('service', 'service.name'), resource('environment', 'deployment.environment.name'),
      root('input', 'stream.request'), root('context', 'stream.context'), root('model', 'stream.model'),
      root('costUsd', 'stream.cost_usd', { format: 'number', unit: 'usd', transform: 'Keep explicit USD; require a finite nonnegative number' }),
      { target: 'attributes.stream.ttft_ms', source: 'span', spanName: 'chat.stream', serviceName: 'stream-gateway', attribute: 'stream.ttft_ms', format: 'number', unit: 'ms', transform: 'Copy explicit nonnegative time to first token in milliseconds' },
      { target: 'output', source: 'event', spanName: 'chat.stream', serviceName: 'stream-gateway', eventName: 'stream.completed', attribute: 'stream.final_text', format: 'text' },
      { target: 'attributes.stream.completion_receipt', source: 'event', spanName: 'chat.stream', serviceName: 'stream-gateway', eventName: 'stream.completed', attribute: 'stream.completion_count', format: 'number', unit: 'number', transform: 'Copy the explicit nonnegative completion receipt count; do not count chunk events' },
    ],
  },
]);

function decode(value) {
  if (!plain(value)) return undefined;
  const keys = ['stringValue', 'boolValue', 'intValue', 'doubleValue', 'arrayValue', 'kvlistValue', 'bytesValue'].filter(key => Object.hasOwn(value, key));
  if (keys.length !== 1) return undefined;
  switch (keys[0]) {
    case 'stringValue': return typeof value.stringValue === 'string' ? value.stringValue : undefined;
    case 'boolValue': return typeof value.boolValue === 'boolean' ? value.boolValue : undefined;
    case 'intValue': { const number = numeric(value.intValue); return Number.isSafeInteger(number) ? number : undefined; }
    case 'doubleValue': return typeof value.doubleValue === 'number' && Number.isFinite(value.doubleValue) ? value.doubleValue : undefined;
    case 'bytesValue': return typeof value.bytesValue === 'string' ? value.bytesValue : undefined;
    case 'arrayValue': return Array.isArray(value.arrayValue?.values) ? value.arrayValue.values.map(decode) : undefined;
    case 'kvlistValue': { const attrs = readAttributes(value.kvlistValue?.values); return attrs.duplicates.size ? undefined : attrs.values; }
    default: return undefined;
  }
}

function readAttributes(raw) {
  const values = Object.create(null), duplicates = new Set();
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (!nonblank(entry?.key) || ['__proto__', 'constructor', 'prototype'].includes(entry.key)) continue;
    if (Object.hasOwn(values, entry.key)) duplicates.add(entry.key);
    values[entry.key] = decode(entry.value);
  }
  return { values, duplicates };
}

function parseOTLP(raw) {
  let parsed = raw;
  if (typeof parsed === 'string') {
    if (parsed.length > 20 * 1024 * 1024) throw new Error('This prototype accepts trace files up to 20 MB.');
    try { parsed = JSON.parse(parsed); }
    catch {
      try { parsed = parsed.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line)); }
      catch { throw new Error('The file is not valid JSON or newline-delimited JSON.'); }
    }
  }
  const requests = Array.isArray(parsed?.resourceSpans) ? [parsed]
    : Array.isArray(parsed) && parsed.length && parsed.every(item => Array.isArray(item?.resourceSpans)) ? parsed : null;
  if (!requests) throw new Error('Explicit normalization profiles require OTLP JSON with resourceSpans. Use Auto for already-normalized trace arrays.');
  return { parsed, requests };
}

function groupSpans(requests) {
  const groups = new Map();
  for (const request of requests) for (const batch of request.resourceSpans) {
    for (const scope of batch.scopeSpans ?? batch.instrumentationLibrarySpans ?? []) for (const span of scope.spans ?? []) {
      if (!/^[a-f\d]{32}$/i.test(span?.traceId ?? '') || /^0+$/.test(span.traceId) || !/^[a-f\d]{16}$/i.test(span.spanId ?? '') || /^0+$/.test(span.spanId)) continue;
      const traceId = span.traceId.toLowerCase();
      if (!groups.has(traceId)) groups.set(traceId, []);
      groups.get(traceId).push({ span, id: span.spanId.toLowerCase(), attrs: readAttributes(span.attributes), resource: readAttributes(batch.resource?.attributes), resourceSchemaUrl: batch.schemaUrl, scopeSchemaUrl: scope.schemaUrl, scope: scope.scope ?? scope.instrumentationLibrary ?? {} });
    }
  }
  return groups;
}

function rootSelection(entries) {
  const roots = entries.filter(({ span }) => !span.parentSpanId || /^0+$/.test(span.parentSpanId));
  return roots.length === 1 ? { status: 'resolved', entry: roots[0] }
    : { status: roots.length ? 'ambiguous' : 'missing', detail: roots.length ? `Expected one root span, found ${roots.length}.` : 'No explicit root span was supplied.' };
}

function descendant(entry, rootEntry, entries) {
  const visited = new Set([entry.id]);
  let parent = entry.span.parentSpanId?.toLowerCase();
  while (parent && !visited.has(parent)) {
    if (parent === rootEntry.id) return true;
    visited.add(parent);
    const matches = entries.filter(candidate => candidate.id === parent);
    if (matches.length !== 1) return false;
    parent = matches[0].span.parentSpanId?.toLowerCase();
  }
  return false;
}

function serviceEvidence(entry) {
  if (entry.resource.duplicates.has('service.name')) return { status: 'ambiguous', detail: 'duplicate resource service.name attributes' };
  if (!Object.hasOwn(entry.resource.values, 'service.name')) return { status: 'missing', detail: 'missing resource service.name' };
  const serviceName = entry.resource.values['service.name'];
  return nonblank(serviceName) ? { status: 'resolved', serviceName } : { status: 'invalid', detail: 'invalid resource service.name' };
}

function selectNamedSpan(field, entries, rootEntry) {
  const named = entries.filter(candidate => candidate.span.name === field.spanName && descendant(candidate, rootEntry, entries));
  let matches = named;
  if (field.serviceName !== undefined) {
    const classified = named.map(entry => ({ entry, evidence: serviceEvidence(entry) }));
    const unresolved = classified.filter(item => item.evidence.status !== 'resolved');
    matches = classified.filter(item => item.evidence.status === 'resolved' && item.evidence.serviceName === field.serviceName).map(item => item.entry);
    // Unknown service evidence could belong to the requested service. Do not
    // discard it and pick an otherwise valid candidate as an apparent success.
    if (unresolved.length) {
      const status = unresolved.some(item => item.evidence.status === 'ambiguous') || matches.length ? 'ambiguous'
        : unresolved.some(item => item.evidence.status === 'invalid') ? 'invalid' : 'missing';
      return { status, detail: `Cannot uniquely select “${field.spanName}” from service “${field.serviceName}”: ${unresolved.length} named candidate ${unresolved.length === 1 ? 'has' : 'spans have'} ${[...new Set(unresolved.map(item => item.evidence.detail))].join(' or ')}.` };
    }
  }
  const qualifier = field.serviceName !== undefined ? ` from service “${field.serviceName}”` : '';
  if (matches.length !== 1) return { status: matches.length ? 'ambiguous' : 'missing', detail: `Expected one descendant span named “${field.spanName}”${qualifier}, found ${matches.length}.` };
  return { status: 'resolved', entry: matches[0] };
}

function selectAttribute(field, entries, selectedRoot) {
  if (selectedRoot.status !== 'resolved') return selectedRoot;
  let entry = selectedRoot.entry, attrs;
  if (field.source === 'root') attrs = entry.attrs;
  else if (field.source === 'resource') attrs = entry.resource;
  else {
    const selected = selectNamedSpan(field, entries, selectedRoot.entry);
    if (selected.status !== 'resolved') return selected;
    entry = selected.entry;
    if (field.source === 'span') attrs = entry.attrs;
    else {
      const events = (entry.span.events ?? []).filter(event => event.name === field.eventName);
      if (events.length !== 1) return { status: events.length ? 'ambiguous' : 'missing', entry, detail: `Expected one event named “${field.eventName}” on “${field.spanName}”, found ${events.length}.` };
      attrs = readAttributes(events[0].attributes);
    }
  }
  if (entries.filter(candidate => candidate.id === entry.id).length !== 1) return { status: 'ambiguous', entry, detail: `Span ID ${entry.id} occurs more than once.` };
  if (attrs.duplicates.has(field.attribute)) return { status: 'ambiguous', entry, detail: `Attribute “${field.attribute}” occurs more than once.` };
  if (!Object.hasOwn(attrs.values, field.attribute)) return { status: 'missing', entry, detail: `Attribute “${field.attribute}” is absent.` };
  if (attrs.values[field.attribute] === undefined) return { status: 'invalid', entry, detail: `Attribute “${field.attribute}” has an unsupported or invalid OTLP value.` };
  return { status: 'resolved', entry, value: attrs.values[field.attribute] };
}

function transform(value, field) {
  if (field.format === 'number') {
    const number = numeric(value);
    if (number === null || number < 0) throw new Error('A finite nonnegative numeric value is required.');
    return field.target === 'costUsd' && field.unit === 'cents' ? number / 100 : number;
  }
  if (field.format === 'score') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new Error('A numeric score from 0 to 1 is required; a numeric string is not a recorded judgment.');
    return value;
  }
  if (field.format === 'message-parts') {
    let messages = value;
    if (typeof messages === 'string') { try { messages = JSON.parse(messages); } catch { throw new Error('Expected a JSON message array.'); } }
    if (!Array.isArray(messages)) throw new Error('Expected a message array.');
    const texts = messages.flatMap(message => Array.isArray(message?.parts) ? message.parts.filter(part => part?.type === 'text' && nonblank(part.content)).map(part => part.content) : []);
    if (!texts.length) throw new Error('No text parts[].content were supplied in the message array.');
    return texts.join('\n');
  }
  if (field.format === 'json') {
    let data = value;
    if (typeof data === 'string') { try { data = JSON.parse(data); } catch { throw new Error('Expected valid structured JSON.'); } }
    if ((!plain(data) && !Array.isArray(data)) || !Object.keys(data).length) throw new Error('Expected a nonempty JSON object or array.');
    return JSON.stringify(data, null, 2);
  }
  if (!nonblank(value)) throw new Error('A nonblank text value is required.');
  return value;
}

/** Use exact, versioned mapping evidence. Auto retains the legacy generic importer. */
export function normalizeTraceInput(raw, { profileId = 'auto', profileVersion } = {}) {
  if (profileId === 'auto') {
    if (profileVersion !== undefined) throw new Error('Auto normalization has no pinned profile version. Choose an explicit profile to pin its version.');
    return importTraces(raw);
  }
  const profile = TRACE_PROFILES.find(item => item.id === profileId);
  if (!profile) throw new Error(`Unknown normalization profile: ${profileId}. Choose a supported profile or Auto.`);
  if (profileVersion !== undefined && profileVersion !== profile.version) throw new Error(`Normalization profile ${profileId} has version ${profile.version}, not ${profileVersion}. Exact version pins are required.`);
  const { parsed, requests } = parseOTLP(raw);
  const imported = importTraces(parsed);
  const groups = groupSpans(requests);
  // The explicit profile replaces generic content selection, including its warnings.
  const warnings = imported.warnings.filter(message => !message.includes('mapped from a child span') && !message.includes('traces are missing input or output content'));
  const traces = imported.traces.map(base => {
    const entries = groups.get(base.traceId) ?? [], selectedRoot = rootSelection(entries);
    const evidenceWarnings = imported.warnings.filter(message => message.includes(base.traceId) && !message.includes('mapped from a child span'));
    if (selectedRoot.status !== 'resolved') evidenceWarnings.push(selectedRoot.detail);
    const trace = {
      ...base, input: '', output: '', context: '', expectedOutput: '', model: 'Unknown model',
      service: 'unknown-service', environment: 'unknown', costUsd: null,
      durationMs: selectedRoot.status === 'resolved' ? base.durationMs : null,
      attributes: selectedRoot.entry ? { ...selectedRoot.entry.resource.values, ...selectedRoot.entry.attrs.values } : {},
      name: selectedRoot.entry?.span.name || (selectedRoot.status === 'ambiguous' ? 'Ambiguous imported trace' : 'Imported trace without root'),
      status: base.spans.some(span => span.status === 'error') ? 'error' : selectedRoot.entry?.span.status?.code === 1 ? 'ok' : 'unknown',
    };
    delete trace.evaluatorScores;
    const mappings = [], judgments = Object.create(null);
    for (const field of profile.fields) {
      if (field.target.startsWith('attributes.')) delete trace.attributes[field.target.slice('attributes.'.length)];
      const selected = selectAttribute(field, entries, selectedRoot);
      const selectedService = selected.entry ? serviceEvidence(selected.entry) : null;
      const mapping = { field: field.target, source: field.source, attribute: field.attribute, status: selected.status,
        ...(selected.entry ? { spanId: selected.entry.id } : {}), ...(selectedService?.status === 'resolved' ? { serviceName: selectedService.serviceName } : {}), ...(field.serviceName ? { serviceSelector: field.serviceName } : {}), ...(field.spanName ? { spanName: field.spanName } : {}), ...(field.eventName ? { eventName: field.eventName } : {}), ...(field.transform ? { transform: field.transform } : {}), ...(field.unit ? { unit: field.unit } : {}) };
      if (selected.status === 'resolved') {
        try {
          const value = transform(selected.value, field);
          if (field.target.startsWith('attributes.')) trace.attributes[field.target.slice('attributes.'.length)] = value;
          else if (field.target.startsWith('evaluatorScores.')) {
            const [, key, property] = field.target.split('.');
            judgments[key] ??= Object.create(null);
            judgments[key][property] = value;
          } else trace[field.target] = value;
        } catch (error) { mapping.status = 'invalid'; mapping.detail = error.message; }
      } else mapping.detail = selected.detail;
      if (mapping.status !== 'resolved' && !field.optional) evidenceWarnings.push(`${field.target}: ${mapping.detail}`);
      mappings.push(mapping);
    }
    const admitted = Object.create(null);
    for (const [key, judgmentValue] of Object.entries(judgments)) {
      if (typeof judgmentValue.value === 'number' && nonblank(judgmentValue.provenance)) admitted[key] = { ...judgmentValue, reason: judgmentValue.reason ?? '' };
      else evidenceWarnings.push(`evaluatorScores.${key}: no judgment admitted; both a numeric 0–1 value and nonblank provenance are required.`);
    }
    if (Object.keys(admitted).length) trace.evaluatorScores = admitted;
    if (trace.attributes['tracegrade.synthetic'] === true) trace.tags = [...new Set([...trace.tags, 'synthetic'])];
    const instrumentationScopes = [...new Map(entries.map(entry => {
      const scope = { name: typeof entry.scope.name === 'string' ? entry.scope.name : '', version: typeof entry.scope.version === 'string' ? entry.scope.version : '', ...(nonblank(entry.scopeSchemaUrl) ? { schemaUrl: entry.scopeSchemaUrl } : {}) };
      return [JSON.stringify(scope), scope];
    })).values()];
    trace.normalization = {
      profileId: profile.id, profileVersion: profile.version, mappings,
      warnings: [...new Set(evidenceWarnings)],
      resourceSchemaUrls: [...new Set(entries.map(entry => entry.resourceSchemaUrl).filter(nonblank))],
      instrumentationScopes,
    };
    warnings.push(...trace.normalization.warnings.map(message => `Trace ${trace.traceId}: ${message}`));
    return trace;
  });
  return { traces, warnings: [...new Set(warnings)], profile: clone(profile) };
}
