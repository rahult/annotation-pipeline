import { LineCounter, isAlias, parseDocument, stringify, visit } from 'yaml';
import { createInitialState } from './domain.js';

const TYPES = ['latency', 'cost', 'tool_success', 'contains', 'attribute', 'recorded_judgment'];
const UNITS = ['score', 'ms', 'usd', 'percent', 'number'];
const DRAFT_FIELDS = new Set(['scope', 'target', 'slug', 'name', 'description', 'owner', 'tags', 'type', 'unit', 'attributeKey', 'keyword', 'judgmentKey', 'rubric', 'metricId', 'threshold', 'operator', 'weight', 'critical']);
const ENTRY_FIELDS = new Set(['id', 'scope', 'target', 'slug', 'name', 'description', 'owner', 'tags', 'versions', 'draft', 'deprecated']);
const RELEASE_FIELDS = new Set(['version', 'publishedAt', 'changeNote', 'definition']);
const OVERRIDE_FIELDS = new Set(['threshold', 'operator', 'weight', 'enabled', 'critical']);
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const clone = value => structuredClone(value);
const number = value => typeof value === 'number' && Number.isFinite(value);
const nonblank = value => typeof value === 'string' && value.trim().length > 0;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const judgmentKey = value => typeof value === 'string' && /^[a-z\d][a-z\d_.:/-]{0,159}$/i.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
const refFor = draft => draft.scope === 'global' ? `global/${draft.slug}` : `${draft.scope}/${draft.target}/${draft.slug}`;
const namespace = ref => ref.split('/').map(part => part.replaceAll('-', '_')).join('__');
const semanticVersion = value => typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) && value.split('.').every(part => Number.isSafeInteger(Number(part)));
const compareVersion = (left, right) => {
  const a = left.split('.').map(Number), b = right.split('.').map(Number);
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  return 0;
};

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function freezeReleases(catalog) {
  catalog.forEach(entry => { entry.versions.forEach(freeze); Object.freeze(entry.versions); });
  return catalog;
}

function stable(value) {
  return JSON.stringify(value, (_, item) => plain(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
}

function metadata(draft) {
  return { scope: draft.scope, target: draft.target, slug: draft.slug, name: draft.name, description: draft.description, owner: draft.owner, tags: clone(draft.tags) };
}

/** Validate a draft without publishing it or executing any code/model. */
export function validateScorerDraft(draft) {
  const errors = [];
  if (!plain(draft)) return { valid: false, errors: ['A scorer draft must be an object.'] };
  for (const key of Object.keys(draft)) if (!DRAFT_FIELDS.has(key)) errors.push(`Unsupported draft field: ${key}.`);
  if (!['global', 'domain', 'agent'].includes(draft.scope)) errors.push('Scope must be global, domain, or agent.');
  if (draft.scope === 'global' && draft.target !== '') errors.push('A global scorer must have an empty target.');
  if (['domain', 'agent'].includes(draft.scope) && (typeof draft.target !== 'string' || !slugPattern.test(draft.target) || draft.target.length > 100)) errors.push('Scoped scorers need an exact target slug, such as customer-support or support-agent.');
  if (typeof draft.slug !== 'string' || !slugPattern.test(draft.slug) || draft.slug.length > 80) errors.push('Use a lowercase scorer slug with letters, numbers, and single hyphens.');
  if (!nonblank(draft.name) || draft.name.length > 160) errors.push('Give the scorer a name of 1–160 characters.');
  if (typeof draft.description !== 'string' || draft.description.length > 10000) errors.push('Description must be text of at most 10,000 characters.');
  if (!nonblank(draft.owner) || draft.owner.length > 160) errors.push('Specify an owner of 1–160 characters.');
  if (!Array.isArray(draft.tags) || draft.tags.length > 20 || draft.tags.some(tag => !nonblank(tag) || tag.length > 60) || new Set(draft.tags).size !== draft.tags.length) errors.push('Tags must be a unique list of up to 20 nonblank strings.');
  if (!TYPES.includes(draft.type)) errors.push('Choose a supported deterministic or recorded-judgment scorer type.');
  if (!UNITS.includes(draft.unit)) errors.push('Unit must be score, ms, usd, percent, or number.');
  if (!['gte', 'lte'].includes(draft.operator)) errors.push('Operator must be gte or lte.');
  if (!number(draft.threshold) || draft.threshold < 0 || (draft.unit === 'score' && draft.threshold > 1) || (draft.unit === 'percent' && draft.threshold > 100)) errors.push('Threshold must be finite and within the selected unit scale.');
  if (!number(draft.weight) || draft.weight <= 0 || draft.weight > 1000000) errors.push('Weight must be greater than zero and at most 1,000,000.');
  if (typeof draft.critical !== 'boolean') errors.push('Critical must be true or false.');
  const expectedUnit = { latency: 'ms', cost: 'usd', tool_success: 'percent', contains: 'score', recorded_judgment: 'score' }[draft.type];
  if (expectedUnit && draft.unit !== expectedUnit) errors.push(`${draft.type} uses the ${expectedUnit} unit.`);
  if (draft.type === 'attribute' && (!nonblank(draft.attributeKey) || draft.attributeKey.length > 250)) errors.push('An attribute scorer needs the exact trace attribute key.');
  if (draft.type === 'contains' && (!nonblank(draft.keyword) || draft.keyword.length > 2000)) errors.push('A phrase scorer needs a nonblank phrase of at most 2,000 characters.');
  if (draft.type === 'recorded_judgment' && !judgmentKey(draft.judgmentKey)) errors.push('A recorded judgment needs a valid non-reserved evaluator score key.');
  if (draft.rubric !== undefined && (typeof draft.rubric !== 'string' || draft.rubric.length > 20000)) errors.push('Rubric must be text of at most 20,000 characters.');
  if (draft.attributeKey !== undefined && draft.type !== 'attribute') errors.push('Only attribute scorers use attributeKey.');
  if (draft.keyword !== undefined && draft.type !== 'contains') errors.push('Only phrase scorers use keyword.');
  if ((draft.judgmentKey !== undefined || draft.rubric !== undefined) && draft.type !== 'recorded_judgment') errors.push('Only recorded-judgment scorers use judgmentKey or rubric.');
  if (draft.metricId !== undefined) {
    if (draft.type === 'attribute' && draft.metricId !== `attribute_${namespace(refFor(draft))}`) errors.push('Attribute metric IDs are derived from their scoped catalog identity.');
    else if (draft.type === 'contains' && draft.metricId !== `contains_${namespace(refFor(draft))}`) errors.push('Catalog phrase metric IDs are derived from their scoped identity.');
    else if (draft.type === 'recorded_judgment') {
      const builtin = ['groundedness', 'relevance'].includes(draft.metricId);
      if (builtin && (draft.scope !== 'global' || draft.judgmentKey !== draft.metricId)) errors.push('Built-in judgment IDs are global and must match their evaluator score key.');
      if (!builtin && draft.metricId !== `judgment_${namespace(refFor(draft))}`) errors.push('Custom judgment IDs are derived from their scoped catalog identity.');
    } else if (!['attribute', 'contains'].includes(draft.type) && draft.metricId !== draft.type) errors.push('Built-in deterministic metric IDs must match their scorer type.');
  }
  return { valid: errors.length === 0, errors };
}

export function saveScorerDraft(catalog, draft, entryId) {
  const validation = validateScorerDraft(draft);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  if (!Array.isArray(catalog)) throw new Error('The scorer catalog must be a list.');
  const id = refFor(draft);
  const next = clone(catalog);
  const existing = next.find(entry => entry.id === (entryId ?? id));
  if (entryId && !existing) throw new Error(`Scorer ${entryId} was not found.`);
  if (!entryId && existing) throw new Error(`Scorer ${id} already exists. Choose another scope or slug, or explicitly edit that scorer.`);
  if (existing && existing.id !== id) throw new Error('A scorer scope, target, and slug are immutable. Create another scorer for a new identity.');
  if (existing?.deprecated) throw new Error('This scorer is deprecated; create a new scorer identity before publishing new work.');
  let entry;
  if (existing) {
    entry = existing;
    entry.draft = clone(draft);
    if (!entry.versions.length) Object.assign(entry, metadata(draft));
  } else {
    entry = { id, ...metadata(draft), versions: [], draft: clone(draft), deprecated: false };
    next.push(entry);
  }
  freezeReleases(next);
  return { catalog: next, entry };
}

export function publishScorerVersion(catalog, entryId, { version, changeNote } = {}) {
  if (!Array.isArray(catalog)) throw new Error('The scorer catalog must be a list.');
  if (!semanticVersion(version)) throw new Error('Publish an exact numeric semantic version such as 1.0.0; ranges and prerelease labels are not supported.');
  if (!nonblank(changeNote) || changeNote.length > 5000) throw new Error('Add a nonblank release note of at most 5,000 characters.');
  const next = clone(catalog);
  const entry = next.find(item => item.id === entryId);
  if (!entry) throw new Error(`Scorer ${entryId} was not found.`);
  if (entry.deprecated) throw new Error('Deprecated scorers cannot publish new releases.');
  if (!entry.draft) throw new Error('Save a scorer draft before publishing a version.');
  const validation = validateScorerDraft(entry.draft);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  if (refFor(entry.draft) !== entry.id) throw new Error('Draft scope and slug do not match the scorer identity.');
  if (entry.versions.some(release => release.version === version)) throw new Error(`Version ${version} is already published and cannot be overwritten.`);
  const latest = entry.versions.at(-1)?.version;
  if (latest && compareVersion(version, latest) <= 0) throw new Error(`Publish a version greater than ${latest}.`);
  const release = freeze({ version, publishedAt: new Date().toISOString(), changeNote, definition: clone(entry.draft) });
  entry.versions.push(release);
  Object.assign(entry, metadata(entry.draft));
  entry.draft = null;
  freezeReleases(next);
  return { catalog: next, entry, release };
}

function scopeOnly(entry, context) {
  if (entry.scope === 'global') return { available: true, reason: 'Available to every evaluation.' };
  if (entry.scope === 'domain') return entry.target === context.domain
    ? { available: true, reason: `Available in domain ${entry.target}.` }
    : { available: false, reason: `Requires domain ${entry.target}; this evaluation uses ${context.domain || 'no domain'}.` };
  if (entry.scope === 'agent') return entry.target === context.agent
    ? { available: true, reason: `Available for agent ${entry.target}.` }
    : { available: false, reason: `Requires agent ${entry.target}; this evaluation uses ${context.agent || 'no agent'}.` };
  return { available: false, reason: 'The scorer has an unsupported scope.' };
}

/** Availability for new adoption, including deprecation and publication state. */
export function scopeAvailability(entry, context = {}) {
  if (entry.deprecated) return { available: false, reason: 'Deprecated: unavailable for new adoption. Existing pinned releases remain executable.' };
  if (!entry.versions?.length) return { available: false, reason: 'Publish a version before using this scorer in an evaluation.' };
  return scopeOnly(entry, context);
}

/** Resolve an exact immutable pin; never select a latest version implicitly. */
export function metricFromCatalog(catalog, ref, version, context = {}, overrides = {}) {
  if (!Array.isArray(catalog)) throw new Error('The scorer catalog must be a list.');
  const entry = catalog.find(item => item.id === ref);
  if (!entry) throw new Error(`Scorer ${ref} was not found in the catalog.`);
  if (!semanticVersion(version)) throw new Error('Pin an exact published scorer version such as 1.0.0.');
  const release = entry.versions.find(item => item.version === version);
  if (!release) throw new Error(`Scorer ${ref} has no published version ${version}. Drafts cannot execute.`);
  const availability = scopeOnly(entry, context);
  if (!availability.available) throw new Error(availability.reason);
  if (context.adoption && entry.deprecated) throw new Error('Deprecated scorers cannot be adopted by a new evaluation. Existing pins remain executable.');
  if (!plain(overrides)) throw new Error('Scorer overrides must be an object.');
  for (const key of Object.keys(overrides)) if (!OVERRIDE_FIELDS.has(key)) throw new Error(`Unsupported scorer override: ${key}. Definitions can change only through a new published version.`);
  const definition = clone(release.definition);
  const validation = validateScorerDraft(definition);
  if (!validation.valid) throw new Error(`Published scorer ${ref}@${version} is invalid: ${validation.errors.join(' ')}`);
  const builtinJudgment = definition.type === 'recorded_judgment' && ['groundedness', 'relevance'].includes(definition.metricId);
  const metric = {
    id: definition.type === 'attribute' ? `attribute_${namespace(ref)}` : definition.type === 'contains' ? `contains_${namespace(ref)}` : definition.type === 'recorded_judgment' ? builtinJudgment ? definition.metricId : `judgment_${namespace(ref)}` : definition.metricId ?? definition.type,
    name: definition.name,
    description: definition.description,
    kind: definition.type === 'attribute' ? 'attribute' : definition.type === 'recorded_judgment' ? builtinJudgment ? 'demo_judge' : 'recorded_judgment' : 'deterministic',
    threshold: definition.threshold,
    operator: definition.operator,
    unit: definition.unit,
    weight: definition.weight,
    enabled: true,
    critical: definition.critical,
    ...(definition.type === 'attribute' ? { attributeKey: definition.attributeKey } : {}),
    ...(definition.type === 'contains' ? { keyword: definition.keyword } : {}),
    ...(definition.type === 'recorded_judgment' && !builtinJudgment ? { judgmentKey: definition.judgmentKey, ...(definition.rubric !== undefined ? { rubric: definition.rubric } : {}) } : {}),
    ...overrides,
    catalogRef: { ref, version },
  };
  const maximum = metric.unit === 'score' ? 1 : metric.unit === 'percent' ? 100 : Infinity;
  if (!number(metric.threshold) || metric.threshold < 0 || metric.threshold > maximum) throw new Error(`Threshold for ${ref} must be a finite value in the ${metric.unit} scale.`);
  if (!['gte', 'lte'].includes(metric.operator)) throw new Error('Scorer operator must be gte or lte.');
  if (!number(metric.weight) || metric.weight <= 0 || metric.weight > 1000000) throw new Error('Scorer weight must be positive and at most 1,000,000.');
  if (typeof metric.enabled !== 'boolean' || typeof metric.critical !== 'boolean') throw new Error('Scorer enabled and critical overrides must be boolean.');
  return metric;
}

function numeric(value) {
  if (number(value)) return value;
  if (typeof value === 'string' && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/** Discover measurements from the provided trace cohort, not from model guesses. */
export function discoverScorerCandidates(traces, catalog = []) {
  const rows = Array.isArray(traces) ? traces : [];
  const candidates = new Map();
  for (const trace of rows) for (const [key, raw] of Object.entries(plain(trace.attributes) ? trace.attributes : {})) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
    const value = numeric(raw);
    if (value === null) continue;
    if (!candidates.has(key)) candidates.set(key, { key, values: [], traceIds: [], sources: new Set() });
    const candidate = candidates.get(key);
    candidate.values.push(value);
    if (candidate.traceIds.length < 3) candidate.traceIds.push(trace.id ?? trace.traceId);
    candidate.sources.add(trace.source || 'unknown');
  }
  return [...candidates.values()].map(candidate => {
    const min = Math.min(...candidate.values), max = Math.max(...candidate.values);
    const key = candidate.key;
    const existingRefs = catalog.filter(entry => [...(entry.versions ?? []).map(release => release.definition), entry.draft].some(definition => definition?.type === 'attribute' && definition.attributeKey === key)).map(entry => entry.id);
    const suggestedUnit = /(?:^|[._-])(?:ms|duration_ms|latency_ms)$/.test(key) || /(?:duration|latency).*ms/.test(key) ? 'ms'
      : /(?:usd|cost_usd|price_usd)/.test(key) ? 'usd'
        : /(?:percent|percentage|pct)/.test(key) && min >= 0 && max <= 100 ? 'percent'
          : /(?:tokens?|count|calls?|attempts?|retries)(?:$|[._-])/.test(key) ? 'number'
            : min >= 0 && max <= 1 ? 'score' : 'number';
    return { key, count: candidate.values.length, total: rows.length, coverage: rows.length ? Math.round(candidate.values.length / rows.length * 1000) / 10 : 0, min, max, mean: candidate.values.reduce((sum, value) => sum + value, 0) / candidate.values.length, examples: [...new Set(candidate.values)].slice(0, 3), sampleTraceIds: candidate.traceIds, suggestedUnit, existingRefs, source: candidate.sources.size === 1 ? [...candidate.sources][0] : 'mixed', sources: [...candidate.sources], nonnegative: min >= 0 };
  }).sort((a, b) => b.coverage - a.coverage || a.key.localeCompare(b.key));
}

function validateCatalog(catalog, add) {
  if (!Array.isArray(catalog)) { add('scorers must be a list.', ['scorers']); return; }
  if (catalog.length > 200) add('Import at most 200 scorer entries.', ['scorers']);
  const ids = new Set();
  catalog.forEach((entry, index) => {
    const path = ['scorers', index];
    if (!plain(entry)) { add('A catalog entry must be an object.', path); return; }
    for (const key of Object.keys(entry)) if (!ENTRY_FIELDS.has(key)) add(`Unknown catalog entry field: ${key}.`, [...path, key]);
    for (const key of ENTRY_FIELDS) if (!Object.hasOwn(entry, key)) add(`Missing catalog entry field: ${key}.`, [...path, key]);
    if (!['global', 'domain', 'agent'].includes(entry.scope) || typeof entry.slug !== 'string' || !slugPattern.test(entry.slug) || (entry.scope === 'global' ? entry.target !== '' : typeof entry.target !== 'string' || !slugPattern.test(entry.target))) add('Invalid scoped scorer identity.', path);
    if (entry.id !== refFor(entry)) add('Entry ID must match its scope, target, and slug.', [...path, 'id']);
    if (ids.has(entry.id)) add(`Duplicate scorer reference: ${entry.id}.`, [...path, 'id']);
    ids.add(entry.id);
    if (!nonblank(entry.name) || !nonblank(entry.owner) || typeof entry.description !== 'string') add('Catalog entries require name, owner, and text description.', path);
    if (!Array.isArray(entry.tags) || entry.tags.some(tag => !nonblank(tag)) || new Set(entry.tags).size !== entry.tags.length) add('Entry tags must be a unique list of strings.', [...path, 'tags']);
    if (typeof entry.deprecated !== 'boolean') add('deprecated must be true or false.', [...path, 'deprecated']);
    if (!Array.isArray(entry.versions)) { add('versions must be a list.', [...path, 'versions']); return; }
    if (entry.versions.length > 100) add('Import at most 100 versions per scorer.', [...path, 'versions']);
    let previous;
    entry.versions.forEach((release, releaseIndex) => {
      const releasePath = [...path, 'versions', releaseIndex];
      if (!plain(release)) { add('Published version must be an object.', releasePath); return; }
      for (const key of Object.keys(release)) if (!RELEASE_FIELDS.has(key)) add(`Unknown release field: ${key}.`, [...releasePath, key]);
      for (const key of RELEASE_FIELDS) if (!Object.hasOwn(release, key)) add(`Missing release field: ${key}.`, [...releasePath, key]);
      if (!semanticVersion(release.version)) add('Published versions must use exact numeric X.Y.Z semantic versions.', [...releasePath, 'version']);
      else if (previous && compareVersion(release.version, previous) <= 0) add('Published versions must be unique and increasing.', [...releasePath, 'version']);
      if (semanticVersion(release.version)) previous = release.version;
      if (typeof release.publishedAt !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(release.publishedAt) || !Number.isFinite(Date.parse(release.publishedAt))) add('publishedAt must be an ISO timestamp with timezone.', [...releasePath, 'publishedAt']);
      if (!nonblank(release.changeNote)) add('A published version needs a release note.', [...releasePath, 'changeNote']);
      const validation = validateScorerDraft(release.definition);
      validation.errors.forEach(message => add(message, [...releasePath, 'definition']));
      if (plain(release.definition) && refFor(release.definition) !== entry.id) add('Published definition identity must match its catalog entry.', [...releasePath, 'definition']);
    });
    if (entry.draft !== null) {
      const validation = validateScorerDraft(entry.draft);
      validation.errors.forEach(message => add(message, [...path, 'draft']));
      if (plain(entry.draft) && refFor(entry.draft) !== entry.id) add('Draft identity must match its catalog entry.', [...path, 'draft']);
    }
    if (!entry.versions.length && entry.draft === null) add('An entry must have a draft or a published version.', path);
  });
}

export function catalogToYaml(catalog) {
  const errors = [];
  validateCatalog(catalog, message => errors.push(message));
  if (errors.length) throw new Error(errors.join(' '));
  return '# Tracegrade scorer catalog. Evaluations pin exact published versions.\n' + stringify({ apiVersion: 'tracegrade.dev/v1', kind: 'ScorerCatalog', scorers: clone(catalog) }, { indent: 2, lineWidth: 100, aliasDuplicateObjects: false });
}

export function parseCatalogYaml(source) {
  const errors = [];
  const invalid = () => ({ valid: false, errors, catalog: null });
  if (typeof source !== 'string' || !source.trim() || new TextEncoder().encode(source).byteLength > 1024 * 1024) {
    errors.push({ message: 'Provide a nonempty scorer catalog smaller than 1 MiB.', line: 1, column: 1, path: '$' });
    return invalid();
  }
  const lineCounter = new LineCounter();
  let document;
  const add = (message, path = [], offset) => {
    let node;
    if (offset === undefined && document) for (let length = path.length; length >= 0 && !node?.range; length--) {
      try { node = document.getIn(path.slice(0, length), true); } catch { /* Use nearest valid parent. */ }
    }
    const position = lineCounter.linePos(offset ?? node?.range?.[0] ?? 0);
    errors.push({ message, line: position.line || 1, column: position.col || 1, path: path.reduce((name, part) => typeof part === 'number' ? `${name}[${part}]` : name ? `${name}.${part}` : part, '') || '$' });
  };
  try {
    document = parseDocument(source, { lineCounter, uniqueKeys: true, strict: true, stringKeys: true, version: '1.2', schema: 'core', prettyErrors: false });
    [...document.errors, ...document.warnings].forEach(error => add(error.message, [], error.pos?.[0]));
    if (document.directives?.yaml?.version !== '1.2') add('Use YAML 1.2 for scorer catalogs.');
    visit(document, (_, node) => { if (isAlias(node)) add('Aliases are not supported in scorer catalogs.', [], node.range?.[0]); });
    if (errors.length) return invalid();
    const parsed = document.toJS({ maxAliasCount: 0 });
    if (!plain(parsed)) { add('A catalog must be a YAML object.'); return invalid(); }
    for (const key of Object.keys(parsed)) if (!['apiVersion', 'kind', 'scorers'].includes(key)) add(`Unknown catalog field: ${key}.`, [key]);
    if (parsed.apiVersion !== 'tracegrade.dev/v1') add('apiVersion must be tracegrade.dev/v1.', ['apiVersion']);
    if (parsed.kind !== 'ScorerCatalog') add('kind must be ScorerCatalog.', ['kind']);
    validateCatalog(parsed.scorers, add);
    if (errors.length) return invalid();
    return { valid: true, errors, catalog: freezeReleases(clone(parsed.scorers)) };
  } catch (error) { add(error.message || 'Could not parse the scorer catalog.'); return invalid(); }
}

/** Merge without overwriting an immutable release or silently replacing local drafts. */
export function mergeCatalog(current, incoming) {
  for (const catalog of [current, incoming]) {
    const errors = [];
    validateCatalog(catalog, message => errors.push(message));
    if (errors.length) throw new Error(errors.join(' '));
  }
  const next = clone(current);
  let added = 0, updated = 0;
  for (const entry of incoming) {
    const existing = next.find(item => item.id === entry.id);
    if (!existing) { next.push(clone(entry)); added++; continue; }
    const before = stable(existing);
    for (const release of entry.versions) {
      const sameVersion = existing.versions.find(item => item.version === release.version);
      if (sameVersion && stable(sameVersion) !== stable(release)) throw new Error(`Conflict: ${entry.id}@${release.version} is already published with different content. Published versions cannot be overwritten.`);
      if (!sameVersion) existing.versions.push(clone(release));
    }
    existing.versions.sort((a, b) => compareVersion(a.version, b.version));
    if (existing.draft && entry.draft && stable(existing.draft) !== stable(entry.draft)) throw new Error(`Conflict: ${entry.id} has a different local draft. Save it under a new identity or reconcile it before importing.`);
    if (!existing.draft && entry.draft) existing.draft = clone(entry.draft);
    existing.deprecated = existing.deprecated || entry.deprecated;
    const latestDefinition = existing.versions.at(-1)?.definition ?? existing.draft;
    if (latestDefinition) Object.assign(existing, metadata(latestDefinition));
    if (stable(existing) !== before) updated++;
  }
  return { catalog: freezeReleases(next), added, updated };
}

/** Explicit sample catalog; no entries imply a live model or external integration. */
export function createScorerCatalog() {
  const publishedAt = '2026-11-01T09:00:00.000Z';
  const baseMetrics = createInitialState().specs[0].metrics;
  const slugs = { groundedness: 'groundedness', relevance: 'answer-relevance', latency: 'response-latency', tool_success: 'tool-success', cost: 'cost-per-response' };
  const entries = baseMetrics.map(metric => {
    const definition = {
      scope: 'global', target: '', slug: slugs[metric.id], name: metric.name, description: metric.description, owner: 'Evaluation platform', tags: metric.kind === 'demo_judge' ? ['quality', 'recorded-judgment'] : ['operations', 'deterministic'],
      type: metric.kind === 'demo_judge' ? 'recorded_judgment' : metric.id, unit: metric.unit, metricId: metric.id, threshold: metric.threshold, operator: metric.operator, weight: metric.weight, critical: metric.critical,
      ...(metric.kind === 'demo_judge' ? { judgmentKey: metric.id, rubric: metric.id === 'groundedness' ? 'Assess whether each material claim is supported by supplied context. Supply a 0–1 result and evaluator provenance.' : 'Assess whether the final answer addresses the stated user request. Supply a 0–1 result and evaluator provenance.' } : {}),
    };
    return { id: refFor(definition), ...metadata(definition), versions: [{ version: '1.0.0', publishedAt, changeNote: 'Initial reusable scorer definition. Demo semantic scores are recorded fixtures.', definition }], draft: null, deprecated: false };
  });
  const scoped = [
    { scope: 'domain', target: 'customer-support', slug: 'escalation-language', name: 'Escalation language', description: 'Check for the configured human-support phrase in the final response. This is a literal check, not semantic escalation verification.', owner: 'Customer support quality', tags: ['support', 'escalation'], type: 'contains', unit: 'score', keyword: 'support', threshold: 1, operator: 'gte', weight: 10, critical: false },
    { scope: 'domain', target: 'customer-support', slug: 'policy-compliance', name: 'Policy compliance', description: 'Use a recorded policy judgment supplied by your evaluator; absent judgments remain unscored.', owner: 'Customer support quality', tags: ['support', 'policy', 'recorded-judgment'], type: 'recorded_judgment', unit: 'score', judgmentKey: 'policy_compliance', rubric: 'Check whether actions and claims comply with the supplied support policy. Record supporting evidence and a 0–1 score; do not invent an authorization.', threshold: 0.9, operator: 'gte', weight: 20, critical: true },
    { scope: 'domain', target: 'document-review', slug: 'citation-accuracy', name: 'Citation accuracy', description: 'Use an externally recorded citation-accuracy judgment for document review.', owner: 'Document review quality', tags: ['documents', 'citations', 'recorded-judgment'], type: 'recorded_judgment', unit: 'score', judgmentKey: 'citation_accuracy', rubric: 'Verify that cited text supports each material finding and comes from the referenced document. Supply the evaluated score with provenance.', threshold: 0.95, operator: 'gte', weight: 25, critical: true },
    { scope: 'agent', target: 'support-agent', slug: 'tool-outcome-validity', name: 'Tool outcome validity', description: 'Evaluate the recorded percentage of tool calls with explicit successful outcomes.', owner: 'Support agent team', tags: ['tools', 'agent', 'deterministic'], type: 'attribute', unit: 'percent', attributeKey: 'agent.tool_success_percent', threshold: 100, operator: 'gte', weight: 15, critical: false },
  ];
  for (const definition of scoped) entries.push({ id: refFor(definition), ...metadata(definition), versions: [{ version: '1.0.0', publishedAt, changeNote: 'Initial scoped definition; scope and evidence requirements are explicit.', definition }], draft: null, deprecated: false });
  const draft = { scope: 'agent', target: 'support-agent', slug: 'retrieval-confidence', name: 'Retrieval confidence', description: 'Draft requirement for a measured retrieval-confidence attribute. Publish only after validating that the source emits it.', owner: 'Support agent team', tags: ['retrieval', 'draft'], type: 'attribute', unit: 'score', attributeKey: 'retrieval.confidence', threshold: 0.85, operator: 'gte', weight: 10, critical: false };
  entries.push({ id: refFor(draft), ...metadata(draft), versions: [], draft, deprecated: false });
  return freezeReleases(entries);
}
