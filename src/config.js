import { LineCounter, isAlias, parseDocument, stringify, visit } from 'yaml';
import { makeId } from './domain.js';
import { createScorerCatalog, metricFromCatalog } from './catalog.js';
import { TRACE_PROFILES } from './traceProfiles.js';

const API_VERSION = 'tracegrade.dev/v1';
const MAX_CONFIG_LENGTH = 256 * 1024;
const SCORER_TYPES = ['recorded_judgment', 'latency', 'cost', 'tool_success', 'contains', 'attribute'];
const UNITS = ['score', 'ms', 'usd', 'percent', 'number'];
const REF_PATTERN = '^(?:global/[a-z0-9][a-z0-9_-]*|(?:domain|agent)/[a-z0-9][a-z0-9_-]*/[a-z0-9][a-z0-9_-]*)$';
const VERSION_PATTERN = '^[0-9]+\\.[0-9]+\\.[0-9]+$';
const PROFILE_IDS = [...new Set(TRACE_PROFILES.map(profile => profile.id))];
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required });
const text = (maxLength = 10000, nonempty = false) => ({ type: 'string', maxLength, ...(nonempty ? { minLength: 1, pattern: '\\S' } : {}) });
const bounded = (minimum, maximum) => ({ type: 'number', minimum, ...(maximum === undefined ? {} : { maximum }) });
const choice = (values) => ({ type: 'string', enum: values });
const judgmentKeySchema = { ...text(160, true), pattern: '^(?!constructor$|prototype$)[A-Za-z0-9][A-Za-z0-9_.:/-]{0,159}$' };
const scorerCase = (type, id, unit, extras = {}) => ({
  if: { properties: { type: { const: type } }, required: ['type'] },
  then: { properties: { id: typeof id === 'string' ? { const: id } : id, ...(unit ? { unit: { const: unit } } : {}), attribute: false, phrase: false, judgment_key: false, rubric: false, ...extras.properties }, ...(extras.required ? { required: extras.required } : {}) },
});

/** JSON Schema for editor completions and independent configuration tooling. */
export const configSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:tracegrade:evaluation:v1',
  title: 'Tracegrade evaluation specification',
  description: 'Declarative evaluation configuration. This schema does not create a backend connection, model judge, or scheduled worker. Dataset availability is checked separately at execution.',
  ...object({
    apiVersion: { const: API_VERSION, type: 'string' },
    kind: { const: 'Evaluation', type: 'string' },
    metadata: { $ref: '#/$defs/metadata' },
    guidelines: { type: 'array', minItems: 1, maxItems: 100, items: { $ref: '#/$defs/guideline' } },
    dataset: { $ref: '#/$defs/dataset' },
    scorers: { type: 'array', minItems: 1, maxItems: 128, items: { $ref: '#/$defs/scorer' }, description: 'Inline scorer definitions or exact catalog references. At least one resolved scorer must be enabled.' },
    review: object({ on_failure: { type: 'boolean' }, sample_percent: bounded(0, 100) }),
    release: object({ minimum_pass_rate: bounded(0, 100) }),
    execution: { ...object({ trigger: choice(['manual', 'on_import', 'scheduled']), schedule: choice(['hourly', 'daily', 'weekly']) }, ['trigger']), allOf: [{ if: { properties: { trigger: { const: 'scheduled' } }, required: ['trigger'] }, then: { required: ['schedule'] } }] },
    report: object({ format: choice(['html', 'csv', 'json']) }),
  }),
  $defs: {
    metadata: object({ name: text(160, true), description: text(10000), domain: { ...text(120, true), pattern: '^[a-z0-9][a-z0-9_-]*$' }, agent: { ...text(120, true), pattern: '^[a-z0-9][a-z0-9_-]*$' } }, ['name']),
    guideline: object({ id: { ...text(160, true), pattern: '^[a-zA-Z0-9_-]+$' }, title: text(240, true), description: text(20000) }, ['id', 'title']),
    dataset: object({
      source: choice(['demo', 'import']),
      filters: object({ service: text(250, true), environment: text(250, true), start: { ...text(40), format: 'date-time' }, end: { ...text(40), format: 'date-time' }, scenario: { ...text(120, true), pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$', description: 'Explicit synthetic fixture cohort. Requires tracegrade.synthetic=true and the exact tracegrade.scenario attribute. Omit for ordinary evaluations.' } }, ['service', 'environment']),
      sample: object({ strategy: choice(['recent', 'errors_first']), size: { type: 'integer', minimum: 1, maximum: 5000 }, minimum: { type: 'integer', minimum: 1, maximum: 5000, description: 'Must not exceed sample.size.' } }),
      required: { type: 'array', maxItems: 3, uniqueItems: true, items: choice(['input', 'output', 'context']) },
      normalization: { $ref: '#/$defs/normalization' },
    }, ['source', 'filters', 'sample', 'required']),
    normalization: {
      ...object({
        profile: choice(PROFILE_IDS),
        version: { ...text(40, true), pattern: VERSION_PATTERN, description: 'The exact built-in trace mapping version. Omit dataset.normalization for legacy automatic mapping.' },
      }),
      allOf: PROFILE_IDS.map(id => ({
        if: { properties: { profile: { const: id } }, required: ['profile'] },
        then: { properties: { version: choice(TRACE_PROFILES.filter(profile => profile.id === id).map(profile => profile.version)) } },
      })),
    },
    scorer: {
      if: { type: 'object', required: ['ref'] },
      then: { $ref: '#/$defs/scorerReference' },
      else: { $ref: '#/$defs/inlineScorer' },
    },
    scorerReference: object({
      ref: { ...text(400, true), pattern: REF_PATTERN },
      version: { ...text(40, true), pattern: VERSION_PATTERN, description: 'An exact immutable catalog release. latest and version ranges are not supported.' },
      threshold: object({ operator: choice(['gte', 'lte']), value: bounded(0) }),
      weight: { type: 'number', exclusiveMinimum: 0, maximum: 1000000 },
      enabled: { type: 'boolean' },
      critical: { type: 'boolean' },
    }, ['ref', 'version']),
    inlineScorer: {
      ...object({
        id: { ...text(160, true), pattern: '^[a-zA-Z0-9_-]+$' },
        name: text(160, true),
        description: text(10000),
        type: choice(SCORER_TYPES),
        threshold: object({ operator: choice(['gte', 'lte']), value: bounded(0) }),
        weight: { type: 'number', exclusiveMinimum: 0, maximum: 1000000 },
        enabled: { type: 'boolean' },
        critical: { type: 'boolean' },
        unit: choice(UNITS),
        attribute: text(250, true),
        phrase: text(2000, true),
        judgment_key: judgmentKeySchema,
        rubric: text(20000),
      }, ['id', 'name', 'type', 'threshold', 'weight', 'enabled', 'critical', 'unit']),
      allOf: [
        scorerCase('recorded_judgment', { pattern: '^(?:groundedness|relevance|judgment_[a-zA-Z0-9_-]+)$' }, 'score', { properties: { judgment_key: judgmentKeySchema, rubric: text(20000) } }),
        scorerCase('latency', 'latency', 'ms'),
        scorerCase('cost', 'cost', 'usd'),
        scorerCase('tool_success', 'tool_success', 'percent'),
        scorerCase('contains', { pattern: '^contains(?:_[a-zA-Z0-9_-]+)?$' }, 'score', { properties: { phrase: text(2000, true) }, required: ['phrase'] }),
        scorerCase('attribute', { pattern: '^attribute_[a-zA-Z0-9_-]+$' }, null, { properties: { attribute: text(250, true) }, required: ['attribute'] }),
        { if: { properties: { type: { const: 'recorded_judgment' }, id: { pattern: '^judgment_' } }, required: ['type', 'id'] }, then: { required: ['judgment_key'] } },
        { if: { properties: { id: { enum: ['groundedness', 'relevance'] } }, required: ['id'] }, then: { properties: { judgment_key: false, rubric: false } } },
        { if: { properties: { unit: { const: 'score' } }, required: ['unit'] }, then: { properties: { threshold: { properties: { value: { maximum: 1 } } } } } },
        { if: { properties: { unit: { const: 'percent' } }, required: ['unit'] }, then: { properties: { threshold: { properties: { value: { maximum: 100 } } } } } },
      ],
    },
  },
};

function dateForConfig(value) {
  if (!value) return undefined;
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  return value;
}

function scorerType(metric) {
  if (metric.kind === 'attribute') return 'attribute';
  if (metric.kind === 'recorded_judgment') return 'recorded_judgment';
  if (metric.id === 'contains' || metric.id.startsWith('contains_')) return 'contains';
  if (metric.id === 'groundedness' || metric.id === 'relevance') return 'recorded_judgment';
  return metric.id;
}

/** Convert form/runtime state to the public, portable configuration shape. */
export function specToConfig(spec) {
  const start = dateForConfig(spec.dataset?.startDate);
  const end = dateForConfig(spec.dataset?.endDate);
  return {
    apiVersion: API_VERSION,
    kind: 'Evaluation',
    metadata: { name: spec.name, description: spec.description ?? '', ...(spec.context?.domain ? { domain: spec.context.domain } : {}), ...(spec.context?.agent ? { agent: spec.context.agent } : {}) },
    guidelines: (spec.guidelines ?? []).map(({ id, title, description }) => ({ id, title, description: description ?? '' })),
    dataset: {
      source: spec.dataset?.source,
      filters: { service: spec.dataset?.service ?? 'all', environment: spec.dataset?.environment ?? 'all', ...(start !== undefined ? { start } : {}), ...(end !== undefined ? { end } : {}), ...(spec.dataset?.scenarioId !== undefined ? { scenario: spec.dataset.scenarioId } : {}) },
      sample: { strategy: spec.dataset?.selection ?? 'recent', size: spec.dataset?.sampleSize, minimum: spec.dataset?.minSamples },
      required: ['input', 'output', 'context'].filter((field) => spec.dataset?.[`require${field[0].toUpperCase()}${field.slice(1)}`] === true),
      ...(spec.dataset?.normalization !== undefined ? { normalization: spec.dataset.normalization === null ? null : { ...spec.dataset.normalization } } : {}),
    },
    scorers: (spec.metrics ?? []).map((metric) => metric.catalogRef ? ({
      ref: metric.catalogRef.ref,
      version: metric.catalogRef.version,
      threshold: { operator: metric.operator, value: metric.threshold },
      weight: metric.weight,
      enabled: metric.enabled,
      critical: metric.critical ?? false,
    }) : ({
      id: metric.id,
      name: metric.name,
      description: metric.description ?? '',
      type: scorerType(metric),
      threshold: { operator: metric.operator, value: metric.threshold },
      weight: metric.weight,
      enabled: metric.enabled,
      critical: metric.critical ?? false,
      unit: metric.unit,
      ...(metric.kind === 'attribute' ? { attribute: metric.attributeKey } : {}),
      ...(scorerType(metric) === 'contains' ? { phrase: metric.keyword } : {}),
      ...(metric.kind === 'recorded_judgment' ? { judgment_key: metric.judgmentKey, ...(metric.rubric !== undefined ? { rubric: metric.rubric } : {}) } : {}),
    })),
    review: { on_failure: spec.review?.failures ?? false, sample_percent: spec.review?.sampleRate ?? 0 },
    release: { minimum_pass_rate: spec.passThreshold },
    execution: { trigger: spec.automation?.trigger ?? 'manual', schedule: spec.automation?.schedule || 'daily' },
    report: { format: spec.automation?.reportFormat || 'html' },
  };
}

export function specToYaml(spec) {
  return '# Tracegrade evaluation configuration\n# YAML is the portable source; run identity and version are managed by the workspace.\n' + stringify(specToConfig(spec), { indent: 2, lineWidth: 100, aliasDuplicateObjects: false });
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const pathText = (path) => path.reduce((result, segment) => typeof segment === 'number' ? `${result}[${segment}]` : result ? `${result}.${segment}` : segment, '') || '$';
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function isAbsoluteTimestamp(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, year, month, day, hour, minute, second] = match.map((part, index) => index > 0 && index < 7 ? Number(part) : part);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= monthDays[month - 1] && hour < 24 && minute < 60 && second < 60;
}

function schemaMatches(value, schema) {
  let valid = true;
  validateSchema(value, schema, [], () => { valid = false; });
  return valid;
}

/** A deliberately small validator for the schema keywords this public schema uses. */
function validateSchema(value, inputSchema, path, add) {
  if (inputSchema === false) { add('This field is not allowed for the selected scorer type.', path); return; }
  const schema = inputSchema.$ref ? configSchema.$defs[inputSchema.$ref.split('/').at(-1)] : inputSchema;
  if (schema.type) {
    const valid = schema.type === 'object' ? isObject(value)
      : schema.type === 'array' ? Array.isArray(value)
        : schema.type === 'number' ? typeof value === 'number' && Number.isFinite(value)
          : schema.type === 'integer' ? Number.isSafeInteger(value)
            : typeof value === schema.type;
    if (!valid) { add(`Expected ${schema.type === 'number' ? 'a finite number' : schema.type === 'integer' ? 'a whole number' : `a ${schema.type}`}.`, path); return; }
  }
  if ('const' in schema && !equal(value, schema.const)) add(`Expected ${JSON.stringify(schema.const)}.`, path);
  if (schema.enum && !schema.enum.some((entry) => equal(value, entry))) add(`Choose one of: ${schema.enum.join(', ')}.`, path);
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) add('This field cannot be empty.', path);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) add(`Use at most ${schema.maxLength} characters.`, path);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) add(schema.pattern === '\\S' ? 'Enter a nonblank value.' : `Value must match ${schema.pattern}.`, path);
    if (schema.format === 'date-time' && !isAbsoluteTimestamp(value)) add('Use a valid absolute ISO timestamp with timezone, for example 2026-11-02T09:00:00Z.', path);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) add('Use a finite number.', path);
    if (schema.minimum !== undefined && value < schema.minimum) add(`Value must be at least ${schema.minimum}.`, path);
    if (schema.maximum !== undefined && value > schema.maximum) add(`Value must be at most ${schema.maximum}.`, path);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) add(`Value must be greater than ${schema.exclusiveMinimum}.`, path);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) add(`Provide at least ${schema.minItems} item${schema.minItems === 1 ? '' : 's'}.`, path);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) add(`Provide at most ${schema.maxItems} items.`, path);
    if (schema.uniqueItems && new Set(value.map((entry) => JSON.stringify(entry))).size !== value.length) add('List entries must be unique.', path);
    if (schema.items) value.forEach((entry, index) => validateSchema(entry, schema.items, [...path, index], add));
    if (schema.contains && value.filter((entry) => schemaMatches(entry, schema.contains)).length < (schema.minContains ?? 1)) add('Enable at least one scorer.', path);
  }
  if (isObject(value)) {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) add(`Missing required field: ${key}.`, [...path, key]);
    for (const [key, entry] of Object.entries(value)) {
      if (Object.hasOwn(schema.properties ?? {}, key)) validateSchema(entry, schema.properties[key], [...path, key], add);
      else if (schema.additionalProperties === false) add(`Unknown field: ${key}. Remove it or use a supported field; it will not be silently ignored.`, [...path, key]);
    }
  }
  for (const part of schema.allOf ?? []) validateSchema(value, part, path, add);
  if (schema.if) {
    const branch = schemaMatches(value, schema.if) ? schema.then : schema.else;
    if (branch) validateSchema(value, branch, path, add);
  }
}

function inlineMetric(scorer) {
  return {
    id: scorer.id,
    name: scorer.name,
    description: scorer.description ?? '',
    kind: scorer.type === 'recorded_judgment' ? scorer.id.startsWith('judgment_') ? 'recorded_judgment' : 'demo_judge' : scorer.type === 'attribute' ? 'attribute' : 'deterministic',
    threshold: scorer.threshold.value,
    operator: scorer.threshold.operator,
    unit: scorer.unit,
    weight: scorer.weight,
    enabled: scorer.enabled,
    critical: scorer.critical,
    ...(scorer.type === 'attribute' ? { attributeKey: scorer.attribute } : {}),
    ...(scorer.type === 'contains' ? { keyword: scorer.phrase } : {}),
    ...(scorer.id.startsWith('judgment_') ? { judgmentKey: scorer.judgment_key, ...(scorer.rubric !== undefined ? { rubric: scorer.rubric } : {}) } : {}),
  };
}

function evaluationContext(config) {
  return { domain: config.metadata.domain ?? '', agent: config.metadata.agent ?? '' };
}

function resolveMetrics(config, catalog, add) {
  const context = evaluationContext(config);
  return config.scorers.flatMap((scorer, index) => {
    if (!Object.hasOwn(scorer, 'ref')) return [inlineMetric(scorer)];
    const overrides = {
      ...(scorer.threshold ? { threshold: scorer.threshold.value, operator: scorer.threshold.operator } : {}),
      ...Object.fromEntries(['weight', 'enabled', 'critical'].filter(key => Object.hasOwn(scorer, key)).map(key => [key, scorer[key]])),
    };
    try {
      const metric = metricFromCatalog(catalog, scorer.ref, scorer.version, context, overrides);
      if (!Number.isFinite(metric.threshold) || metric.threshold < 0 || (metric.unit === 'score' && metric.threshold > 1) || (metric.unit === 'percent' && metric.threshold > 100)) {
        add(`The resolved ${metric.unit} scorer threshold is outside its supported range.`, ['scorers', index, 'threshold', 'value']);
        return [];
      }
      return [metric];
    } catch (error) {
      const message = error.message || 'The catalog scorer could not be resolved.';
      const field = /threshold/i.test(message) && scorer.threshold ? ['threshold', 'value']
        : /weight/i.test(message) && Object.hasOwn(scorer, 'weight') ? ['weight']
          : /scope|context|domain|agent/i.test(message) ? ['ref']
            : /version|release/i.test(message) ? ['version'] : ['ref'];
      add(message, ['scorers', index, ...field]);
      return [];
    }
  });
}

function runtimeSpec(config, baseSpec, metrics) {
  const required = new Set(config.dataset.required);
  return {
    id: baseSpec?.id ?? makeId('spec'),
    version: baseSpec?.version ?? 1,
    updatedAt: baseSpec?.updatedAt ?? new Date().toISOString(),
    name: config.metadata.name,
    description: config.metadata.description ?? '',
    ...(config.metadata.domain !== undefined || config.metadata.agent !== undefined ? { context: evaluationContext(config) } : {}),
    guidelines: config.guidelines.map(({ id, title, description }) => ({ id, title, description: description ?? '' })),
    dataset: {
      source: config.dataset.source,
      service: config.dataset.filters.service,
      environment: config.dataset.filters.environment,
      ...(config.dataset.filters.scenario !== undefined ? { scenarioId: config.dataset.filters.scenario } : {}),
      sampleSize: config.dataset.sample.size,
      minSamples: config.dataset.sample.minimum,
      requireInput: required.has('input'),
      requireOutput: required.has('output'),
      requireContext: required.has('context'),
      selection: config.dataset.sample.strategy,
      ...(config.dataset.normalization ? { normalization: { ...config.dataset.normalization } } : {}),
      ...(config.dataset.filters.start ? { startDate: new Date(config.dataset.filters.start).toISOString() } : {}),
      ...(config.dataset.filters.end ? { endDate: new Date(config.dataset.filters.end).toISOString() } : {}),
    },
    metrics,
    review: { failures: config.review.on_failure, sampleRate: config.review.sample_percent },
    automation: { trigger: config.execution.trigger, schedule: config.execution.schedule ?? 'daily', reportFormat: config.report.format },
    passThreshold: config.release.minimum_pass_rate,
  };
}

/**
 * Parse, validate and compile declarative YAML without reading the current dataset.
 * No fields are evaluated as code. Aliases, duplicate keys, unknown fields, tags
 * requiring fallback resolution, and unsupported scorer types are rejected.
 */
export function compileYaml(source, baseSpec, catalog = createScorerCatalog()) {
  const errors = [];
  const warnings = [];
  const invalid = () => ({ valid: false, errors, warnings, spec: null, config: null });
  if (typeof source !== 'string' || !source.trim()) {
    errors.push({ message: 'Enter a YAML evaluation configuration.', line: 1, column: 1, path: '$' });
    return invalid();
  }
  if (source.length > MAX_CONFIG_LENGTH || new TextEncoder().encode(source).byteLength > MAX_CONFIG_LENGTH) {
    errors.push({ message: 'Keep the evaluation configuration below 256 KiB.', line: 1, column: 1, path: '$' });
    return invalid();
  }
  const lineCounter = new LineCounter();
  let document;
  const location = (offset = 0) => {
    const { line, col } = lineCounter.linePos(offset);
    return { line: line || 1, column: col || 1 };
  };
  const add = (message, path = [], offset) => {
    let node;
    if (offset === undefined && document) {
      for (let length = path.length; length >= 0 && !node?.range; length--) {
        try { node = document.getIn(path.slice(0, length), true); } catch { /* Locate the nearest valid parent. */ }
      }
    }
    errors.push({ message, ...location(offset ?? node?.range?.[0] ?? 0), path: pathText(path) });
  };
  try {
    document = parseDocument(source, { lineCounter, uniqueKeys: true, strict: true, stringKeys: true, version: '1.2', schema: 'core', prettyErrors: false });
    for (const error of [...document.errors, ...document.warnings]) add(error.message, [], error.pos?.[0] ?? 0);
    if (document.directives?.yaml?.version !== '1.2') add('Only YAML 1.2 configurations are supported.', [], 0);
    visit(document, (_, node) => {
      if (isAlias(node)) add('YAML aliases are not supported. Write the value explicitly so the evaluation stays self-contained.', [], node.range?.[0] ?? 0);
    });
    if (errors.length) return invalid();
    const parsed = document.toJS({ maxAliasCount: 0 });
    validateSchema(parsed, configSchema, [], add);
    if (errors.length) return invalid();
    const metrics = resolveMetrics(parsed, catalog, add);
    if (errors.length) return invalid();
    const scorerIds = new Set();
    metrics.forEach((metric, index) => {
      if (scorerIds.has(metric.id)) add(`Duplicate scorer ID: ${metric.id}. Every scorer, including disabled scorers, needs a unique ID.`, ['scorers', index, parsed.scorers[index].ref ? 'ref' : 'id']);
      scorerIds.add(metric.id);
    });
    if (!metrics.some(metric => metric.enabled)) add('Enable at least one scorer.', ['scorers']);
    const guidelineIds = new Set();
    parsed.guidelines.forEach((guideline, index) => {
      if (guidelineIds.has(guideline.id)) add(`Duplicate guideline ID: ${guideline.id}.`, ['guidelines', index, 'id']);
      guidelineIds.add(guideline.id);
    });
    if (parsed.dataset.sample.minimum > parsed.dataset.sample.size) add('The minimum sample count cannot exceed the requested sample size.', ['dataset', 'sample', 'minimum']);
    if (parsed.dataset.filters.start && parsed.dataset.filters.end && Date.parse(parsed.dataset.filters.start) > Date.parse(parsed.dataset.filters.end)) add('The dataset end must be on or after its start.', ['dataset', 'filters', 'end']);
    if (errors.length) return invalid();
    const spec = runtimeSpec(parsed, baseSpec, metrics);
    if (spec.metrics.some((metric) => metric.enabled && metric.kind === 'demo_judge')) warnings.push(spec.dataset.source === 'demo' ? 'Recorded semantic judgments use demo fixtures; this configuration does not call a model.' : 'Semantic scorers require supplied evaluator scores with provenance; missing judgments remain unscored.');
    if (spec.metrics.some((metric) => metric.enabled && metric.kind === 'recorded_judgment')) warnings.push('Custom judgment scorers require supplied evaluator scores under their configured judgment key, with provenance. Rubrics are preserved; no model is called.');
    if (spec.dataset.selection === 'errors_first') warnings.push('Errors-first selection is a diagnostic sample, not an unbiased production-quality estimate.');
    if (spec.automation.trigger === 'scheduled') warnings.push('The schedule is configuration only. No background worker or native schedule is created.');
    if (spec.automation.trigger === 'on_import' && spec.dataset.source !== 'import') warnings.push('After-import automation runs only for specifications whose dataset source is import.');
    return { valid: true, errors, warnings, spec, config: specToConfig(spec) };
  } catch (error) {
    add(error.message || 'The YAML configuration could not be compiled.', [], error.pos?.[0] ?? 0);
    return invalid();
  }
}
