import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertCircle, ArrowRight, ArrowUpRight, BarChart3, BookOpen, Bot, Boxes, Check, CheckCircle2, ChevronRight, Code2, Copy, Download, Eye, FileCode2, GitBranch, GitFork, Globe2, Layers3, Plus, Search, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Upload, UserRound, X } from 'lucide-react';
import { catalogToYaml, discoverScorerCandidates, scopeAvailability } from '../catalog.js';
import { download, formatValue } from '../utils.js';
import { EmptyState, Modal, Notice } from '../components/ui.jsx';
import ScorerBuilder, { freshDraft, SCORER_TYPES, scorerInput, slugify } from '../components/ScorerBuilder.jsx';
import '../catalog.css';

const SCOPE_ICONS = { global: Globe2, domain: Boxes, agent: Bot };
const SCOPE_NAMES = { global: 'Global', domain: 'Domain', agent: 'Agent' };

function sortedVersions(entry) {
  return [...(entry.versions || [])].sort((a, b) => {
    const left = a.version.split('.').map(Number), right = b.version.split('.').map(Number);
    return (right[0] - left[0]) || (right[1] - left[1]) || (right[2] - left[2]);
  });
}

function latestVersion(entry) { return sortedVersions(entry)[0]; }
function latestDefinition(entry) { return latestVersion(entry)?.definition || entry.draft || {}; }
function nextVersion(entry) {
  const latest = latestVersion(entry)?.version;
  if (!latest) return '1.0.0';
  const [major, minor, patch] = latest.split('.').map(Number);
  return `${major}.${minor}.${patch + 1}`;
}
function scopeText(entry) { return entry.scope === 'global' ? 'Global' : `${SCOPE_NAMES[entry.scope] || entry.scope} · ${entry.target}`; }
function shortNumber(value) { return Number.isFinite(Number(value)) ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—'; }
function currentContext(spec) { return { domain: spec.context?.domain || '', agent: spec.context?.agent || '' }; }

function adoption(entry, release, spec) {
  const metrics = spec.metrics || [];
  const exact = metrics.find(metric => metric.catalogRef?.ref === entry.id && metric.catalogRef?.version === release?.version);
  if (exact) return { label: 'Added', added: true };
  if (metrics.some(metric => metric.catalogRef?.ref === entry.id)) return { label: 'Use version', added: false };
  const metricId = release?.definition?.metricId || (['latency', 'cost', 'tool_success'].includes(release?.definition?.type) ? release.definition.type : undefined);
  if (metricId && metrics.some(metric => metric.id === metricId && !metric.catalogRef)) return { label: 'Pin in evaluation', added: false };
  return { label: 'Add to evaluation', added: false };
}

function ScopeBadge({ entry }) {
  const Icon = SCOPE_ICONS[entry.scope] || Layers3;
  return <span className={`catalog-scope-badge scope-${entry.scope}`}><Icon size={13} />{scopeText(entry)}</span>;
}

function EvaluationContext({ spec, specs, onSelectSpec, onContextChange }) {
  const context = currentContext(spec);
  const [domain, setDomain] = useState(context.domain);
  const [agent, setAgent] = useState(context.agent);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDomain(context.domain); setAgent(context.agent); setError(''); }, [spec.id, context.domain, context.agent]);
  const dirty = domain.trim() !== context.domain || agent.trim() !== context.agent;
  async function apply(event) {
    event.preventDefault(); setError(''); setSaving(true);
    try {
      const result = await onContextChange({ domain: domain.trim(), agent: agent.trim() });
      if (result === false) setError('The context could not be applied. Check the workspace message for incompatible pinned scorers or invalid labels.');
    } catch (cause) { setError(cause.message || 'The evaluation context could not be saved.'); }
    finally { setSaving(false); }
  }
  return <section className="panel catalog-context"><div className="catalog-context-heading"><div className="inline"><Layers3 size={18} /><strong>Evaluation context</strong><span className="badge neutral">v{spec.version}</span></div><span className="small muted">Scopes match these labels exactly</span></div><form onSubmit={apply} className="catalog-context-form">
    <label className="field"><span className="field-label">Evaluation</span><select className="select" value={spec.id} onChange={event => onSelectSpec?.(event.target.value)}>{specs.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
    <label className="field"><span className="field-label">Domain</span><input className="input" value={domain} onChange={event => setDomain(event.target.value)} maxLength={120} placeholder="e.g. customer-support" /></label>
    <label className="field"><span className="field-label">Agent</span><input className="input" value={agent} onChange={event => setAgent(event.target.value)} maxLength={120} placeholder="e.g. support-agent" /></label>
    <button className="button secondary" type="submit" disabled={!dirty || saving}><Check size={15} />{saving ? 'Applying…' : 'Apply context'}</button>
  </form>{error ? <p className="catalog-inline-error" role="alert"><AlertCircle size={14} />{error}</p> : null}<p className="catalog-context-note">Global scorers apply everywhere. Domain and agent scorers require an exact match. These labels express applicability, not access permissions.</p></section>;
}

function CatalogRow({ entry, spec, specs, context, onInspect, onAdd }) {
  const release = latestVersion(entry), definition = latestDefinition(entry);
  const availability = scopeAvailability(entry, context);
  const use = adoption(entry, release, spec);
  const usages = specs.filter(item => item.metrics?.some(metric => metric.catalogRef?.ref === entry.id)).length;
  const Icon = SCOPE_ICONS[entry.scope] || Globe2;
  return <article className={`catalog-item ${!availability.available ? 'unavailable' : ''}`}>
    <div className="catalog-item-main"><div className={`catalog-item-icon scope-${entry.scope}`}><Icon size={20} strokeWidth={1.6} /></div><div><button type="button" className="catalog-item-name" onClick={onInspect}>{entry.name}<ChevronRight size={14} /></button><p>{entry.description || definition.description}</p><div className="catalog-item-tags"><span><UserRound size={11} />{entry.owner || 'Owner not set'}</span>{(entry.tags || []).slice(0, 3).map(tag => <span key={tag} className="catalog-tag">{tag}</span>)}</div></div></div>
    <div className="catalog-item-evidence"><span className="catalog-cell-label">Execution / input</span><strong>{SCORER_TYPES[definition.type]?.short || definition.type}</strong><code title={scorerInput(definition)}>{scorerInput(definition)}</code></div>
    <div className="catalog-item-scope"><span className="catalog-cell-label">Scope</span><ScopeBadge entry={entry} />{!availability.available ? <span className="catalog-availability" title={availability.reason}>{entry.deprecated ? 'Deprecated' : !release ? 'Publish to use' : 'Outside this context'}</span> : <span className="catalog-availability available"><Check size={11} />Available here</span>}</div>
    <div className="catalog-item-version"><span className="catalog-cell-label">Lifecycle</span>{release ? <strong>v{release.version}</strong> : <span className="badge warning">Draft only</span>}{entry.draft && release ? <span className="catalog-draft-label">Draft changes</span> : null}<span>{usages ? `${usages} evaluation${usages === 1 ? '' : 's'}` : 'No evaluation pins'}</span></div>
    <div className="catalog-item-actions"><button className="button secondary" type="button" onClick={onInspect}><Eye size={14} />Inspect</button><button className={`button ${use.added ? 'ghost' : 'primary'}`} type="button" disabled={!release || !availability.available || use.added} title={!availability.available ? availability.reason : !release ? 'Publish a version before adding this scorer.' : use.added ? 'This exact version is already pinned.' : `Pin ${entry.id}@${release.version}`} onClick={() => onAdd(entry.id, release.version)}>{use.added ? <Check size={14} /> : <Plus size={14} />}{use.label}</button></div>
  </article>;
}

function ScorerDetail({ entry, initialVersion, spec, specs, context, onClose, onEdit, onFork, onAdd, onPublish, onToast }) {
  const releases = sortedVersions(entry);
  const [selection, setSelection] = useState(initialVersion || releases[0]?.version || 'draft');
  const [version, setVersion] = useState(() => nextVersion(entry));
  const [changeNote, setChangeNote] = useState('');
  const [error, setError] = useState('');
  const [publishing, setPublishing] = useState(false);
  const release = releases.find(item => item.version === selection);
  const draftSelected = selection === 'draft';
  const definition = draftSelected ? entry.draft : release?.definition;
  const availability = scopeAvailability(entry, context);
  const use = adoption(entry, release, spec);
  const usages = specs.flatMap(item => (item.metrics || []).filter(metric => metric.catalogRef?.ref === entry.id).map(metric => ({ spec: item, version: metric.catalogRef.version })));
  const snippet = `scorers:\n  - ref: ${entry.id}\n    version: "${release?.version || '1.0.0'}"\n`;
  async function publish(event) {
    event.preventDefault(); setError('');
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version.trim())) { setError('Use an exact version such as 1.0.0, without ranges or prefixes.'); return; }
    if (changeNote.trim().length < 3) { setError('Add a short change note before publishing.'); return; }
    setPublishing(true);
    try {
      const updated = await onPublish(entry.id, { version: version.trim(), changeNote: changeNote.trim() });
      if (!updated) { setError('The version was not published. Review the workspace message for the reason.'); return; }
      setSelection(version.trim()); setChangeNote(''); setVersion(nextVersion(updated));
    } catch (cause) { setError(cause.message || 'This version could not be published.'); }
    finally { setPublishing(false); }
  }
  async function copyReference() {
    try { await navigator.clipboard.writeText(snippet); onToast?.('Exact scorer reference copied.'); }
    catch { download(snippet, `${entry.slug}-reference.yml`, 'application/yaml'); onToast?.('Reference downloaded as YAML.'); }
  }
  return <Modal drawer title="Scorer details" onClose={onClose} className="catalog-detail"><div className="catalog-detail-body stack">
    <div className="catalog-detail-title"><ScopeBadge entry={entry} /><h2>{definition?.name || entry.name}</h2><p className="subtext">{definition?.description || entry.description}</p><code>{entry.id}</code></div>
    <div className="catalog-detail-version-row"><label className="field"><span className="field-label">Definition version</span><select className="select" value={selection} onChange={event => { setSelection(event.target.value); setError(''); }}>{entry.draft ? <option value="draft">Draft · not published</option> : null}{releases.map(item => <option key={item.version} value={item.version}>v{item.version} · published</option>)}</select></label><div className="catalog-version-status">{draftSelected ? <><span className="badge warning">Draft</span><span>Publish before adoption</span></> : <><span className="badge success">Published</span><span>{release?.publishedAt ? new Date(release.publishedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Immutable version'}</span></>}</div></div>
    {entry.deprecated ? <Notice tone="warning">This scorer is deprecated. Existing pinned results remain reproducible; new adoption is unavailable.</Notice> : !availability.available ? <Notice tone="warning">{availability.reason}</Notice> : null}
    {definition ? <>
      <section className="catalog-definition"><div className="section-heading"><h3>Scoring contract</h3><span className="badge neutral">{SCORER_TYPES[definition.type]?.short || definition.type}</span></div><dl className="detail-list"><div><dt>Owner</dt><dd>{definition.owner || entry.owner}</dd></div><div><dt>Default target</dt><dd>{definition.operator === 'lte' ? '≤' : '≥'} {formatValue(definition.threshold, definition.unit)}</dd></div><div><dt>Default weight</dt><dd>{definition.weight}</dd></div><div><dt>Release impact</dt><dd>{definition.critical ? 'Critical · any failed trace blocks' : 'Weighted metric'}</dd></div></dl><div className="catalog-required-input"><span className="field-label">Required input</span><code>{scorerInput(definition)}</code><p className="field-hint">Missing evidence remains unscored. The evaluator does not infer values to fill gaps.</p></div>{definition.keyword ? <div className="catalog-required-input"><span className="field-label">Literal phrase</span><code>{definition.keyword}</code></div> : null}{definition.rubric ? <div className="catalog-rubric"><h4>Rubric</h4><p>{definition.rubric}</p></div> : null}{definition.type === 'recorded_judgment' ? <Notice>This scorer consumes recorded external judgments with provenance. Publishing a rubric does not create or execute an LLM judge.</Notice> : null}{(definition.tags || []).length ? <div className="catalog-detail-tags">{definition.tags.map(tag => <span className="catalog-tag" key={tag}>{tag}</span>)}</div> : null}</section>
      {!draftSelected && release ? <section className="catalog-reference"><div className="section-heading"><h3>Pin this exact version</h3><button className="button ghost" type="button" onClick={copyReference}><Copy size={14} />Copy YAML</button></div><pre className="code-block">{snippet}</pre><p className="small muted">Catalog updates never change this pin. Each evaluation can retain its own thresholds and weights.</p>{release.changeNote ? <p className="catalog-release-note"><GitBranch size={14} /><span><strong>Release note</strong>{release.changeNote}</span></p> : null}</section> : null}
      {draftSelected ? <form className="catalog-publish" onSubmit={publish}><div className="section-heading"><h3>Publish an immutable version</h3><ShieldCheck size={18} /></div><p>Publishing makes the definition available in this local catalog. Existing evaluation pins remain unchanged.</p><div className="form-grid"><label className="field"><span className="field-label">Exact version</span><input className="input" value={version} onChange={event => setVersion(event.target.value)} placeholder="1.0.0" maxLength={40} required /></label><div className="field"><span className="field-label">Previous version</span><div className="scorer-builder-readonly">{releases[0] ? `v${releases[0].version}` : 'First published version'}</div></div></div><label className="field"><span className="field-label">Change note</span><textarea className="textarea" rows={2} value={changeNote} onChange={event => setChangeNote(event.target.value)} minLength={3} maxLength={2000} required placeholder="What changed, and when should teams adopt this version?" /></label>{error ? <p className="catalog-inline-error" role="alert"><AlertCircle size={15} />{error}</p> : null}<button className="button primary align-start" type="submit" disabled={publishing || entry.deprecated}><CheckCircle2 size={16} />{publishing ? 'Publishing…' : `Publish ${version || 'version'}`}</button></form> : null}
    </> : <EmptyState title="No definition selected">Choose a published version or edit this scorer’s draft.</EmptyState>}
    <section className="catalog-usage"><div className="section-heading"><h3>Evaluation usage</h3><span className="badge neutral">{usages.length} pins</span></div>{usages.length ? <ul>{usages.map((item, index) => <li key={`${item.spec.id}-${index}`}><div><strong>{item.spec.name}</strong><span>{item.spec.id === spec.id ? 'Current evaluation' : `Specification v${item.spec.version}`}</span></div><code>@{item.version}</code></li>)}</ul> : <p className="small muted">No saved evaluation currently pins this scorer. Add a published version to start using it.</p>}</section>
  </div><div className="catalog-detail-footer"><div className="inline"><button type="button" className="button secondary" disabled={entry.deprecated} title={entry.deprecated ? 'Fork a deprecated scorer to create a new identity.' : undefined} onClick={() => onEdit(entry, entry.draft || definition)}><Settings2 size={15} />{entry.draft ? 'Edit draft' : 'Create next draft'}</button><button type="button" className="button ghost" disabled={!definition} onClick={() => onFork(entry, definition)}><GitFork size={15} />Fork scorer</button></div>{!draftSelected && release ? <button className="button primary" type="button" disabled={!availability.available || use.added} title={!availability.available ? availability.reason : undefined} onClick={() => onAdd(entry.id, release.version)}>{use.added ? <Check size={15} /> : <Plus size={15} />}{use.label}</button> : <span className="small muted">Drafts cannot be added to evaluations.</span>}</div></Modal>;
}

function Discovery({ candidates, traces, context, catalog, onBuild, onInspect, onNavigate }) {
  const [search, setSearch] = useState('');
  const visible = candidates.filter(candidate => candidate.key.toLowerCase().includes(search.toLowerCase()));
  return <div className="stack catalog-discovery"><div className="catalog-discovery-intro"><div className="catalog-discovery-symbol"><Activity size={26} strokeWidth={1.6} /></div><div><h2>Find scorer inputs in your traces</h2><p>Inspect numeric attributes observed in this evaluation’s selected cohort. Choose the product rule and scope yourself.</p></div><span className="badge neutral">{traces.length} selected traces</span></div><Notice>Discovery reads loaded trace attributes. Coverage describes this cohort only; it does not prove that an attribute is reliable, meaningful, or present across all production traffic.</Notice>
    {traces.length ? <section className="panel"><div className="panel-header"><h3>Observed numeric attributes</h3><span className="small muted">{candidates.length} candidates</span></div><div className="filter-bar"><label className="search-field"><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search observed attribute keys…" aria-label="Search numeric trace attributes" /></label></div>{visible.length ? <div className="table-wrap"><table className="data-table catalog-discovery-table"><thead><tr><th>Trace attribute</th><th>Coverage</th><th>Observed range</th><th>Catalog use</th><th /></tr></thead><tbody>{visible.map(candidate => <tr key={candidate.key}><td><code>{candidate.key}</code><span className="catalog-suggested-unit">Suggested unit: {candidate.suggestedUnit || 'number'} · confirm in builder</span></td><td><div className="catalog-coverage"><strong>{shortNumber(candidate.coverage)}%</strong><span>{candidate.count} / {candidate.total} traces</span><div><span style={{ width: `${Math.max(0, Math.min(100, candidate.coverage))}%` }} /></div></div></td><td className="numeric">{shortNumber(candidate.min)} <span className="muted">to</span> {shortNumber(candidate.max)}</td><td>{candidate.existingRefs?.length ? <div className="catalog-existing-refs">{candidate.existingRefs.slice(0, 2).map(ref => <button className="text-link no-underline" type="button" key={ref} onClick={() => onInspect(catalog.find(entry => entry.id === ref))}>{catalog.find(entry => entry.id === ref)?.name || ref}<ArrowUpRight size={12} /></button>)}{candidate.existingRefs.length > 2 ? <span className="small muted">+{candidate.existingRefs.length - 2} more</span> : null}</div> : <span className="small muted">No scorer yet</span>}</td><td><button className="button secondary" type="button" onClick={() => onBuild(candidate)}><Plus size={14} />Build scorer</button></td></tr>)}</tbody></table></div> : <EmptyState icon={Search} title={search ? 'No matching attributes' : 'No numeric attributes observed'}>{search ? 'Try another key.' : 'This cohort has no numeric values on trace.attributes. Import richer trace evidence or define a scorer from a known contract.'}</EmptyState>}</section> : <EmptyState icon={Activity} title="Select a trace cohort first" action={<button className="button secondary" type="button" onClick={() => onNavigate('dataset')}>Open dataset <ArrowRight size={15} /></button>}>Your evaluation currently selects no traces. Import a dataset or adjust its filters to discover actual scorer inputs.</EmptyState>}
  </div>;
}

export default function ScorerCatalog({ catalog = [], spec, specs = [], traces = [], onSaveDraft, onPublish, onAddToEvaluation, onContextChange, onSelectSpec, onImportCatalog, onToast, onNavigate }) {
  const [tab, setTab] = useState('catalog');
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState('all');
  const [tag, setTag] = useState('');
  const [lifecycle, setLifecycle] = useState('all');
  const [availableOnly, setAvailableOnly] = useState(true);
  const [detail, setDetail] = useState(null);
  const [builder, setBuilder] = useState(null);
  const [fileError, setFileError] = useState('');
  const [importing, setImporting] = useState(false);
  const fileInput = useRef(null);
  const context = currentContext(spec);
  const tags = useMemo(() => [...new Set(catalog.flatMap(entry => entry.tags || []))].sort(), [catalog]);
  const candidates = useMemo(() => discoverScorerCandidates(traces, catalog), [traces, catalog]);
  const selectedEntry = detail ? catalog.find(entry => entry.id === detail.id) : null;
  const visible = catalog.filter(entry => {
    const haystack = [entry.name, entry.description, entry.id, entry.owner, ...(entry.tags || [])].join(' ').toLowerCase();
    if (search && !haystack.includes(search.toLowerCase())) return false;
    if (scope !== 'all' && entry.scope !== scope) return false;
    if (tag && !(entry.tags || []).includes(tag)) return false;
    if (availableOnly && !scopeAvailability(entry, context).available) return false;
    if (lifecycle === 'published' && !entry.versions?.length) return false;
    if (lifecycle === 'draft' && !entry.draft) return false;
    if (lifecycle === 'deprecated' && !entry.deprecated) return false;
    return true;
  });
  const publishedCount = catalog.filter(entry => entry.versions?.length).length;

  function inspect(entry, version) { if (entry) setDetail({ id: entry.id, version: version || latestVersion(entry)?.version || 'draft' }); }
  function edit(entry, definition) { setDetail(null); setBuilder({ initialDraft: structuredClone(entry.draft || definition || freshDraft(context)), entryId: entry.id }); }
  function fork(entry, definition) {
    setDetail(null);
    const { metricId, ...independent } = structuredClone(definition);
    setBuilder({ initialDraft: { ...independent, scope: entry.scope, target: entry.target || '', slug: `${entry.slug.slice(0, 75)}-copy`, name: `${(definition.name || entry.name).slice(0, 155)} copy` }, forkFrom: entry });
  }
  function buildCandidate(candidate) {
    const unit = candidate.suggestedUnit || 'number';
    const name = candidate.key.split('.').at(-1).replace(/[_-]/g, ' ');
    setBuilder({ candidate, initialDraft: freshDraft(context, {
      name: `${name.charAt(0).toUpperCase() + name.slice(1)} threshold`, slug: slugify(candidate.key),
      description: `Evaluate the observed ${candidate.key} attribute against a product-defined limit.`,
      attributeKey: candidate.key, unit,
      threshold: Math.max(0, Math.min(unit === 'score' ? 1 : unit === 'percent' ? 100 : Infinity, Number(candidate.max) || 0)),
      tags: ['observed-attribute'],
    }) });
  }
  async function importFile(event) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    setImporting(true); setFileError('');
    try {
      if (file.size > 256 * 1024) throw new Error('Import a scorer catalog smaller than 256 KiB.');
      const result = await onImportCatalog(await file.text());
      if (result === false) throw new Error('The catalog could not be imported. Review the workspace message for conflicting identities or invalid definitions.');
    } catch (cause) { setFileError(cause.message || 'The catalog file could not be imported.'); }
    finally { setImporting(false); }
  }

  return <div className="catalog-page stack">
    <div className="section-heading page-heading catalog-page-heading"><div><h1>Scorer catalog</h1><p className="subtext">Discover the evidence. Build the rule. Reuse a version you trust.</p></div><div className="inline catalog-page-actions"><button className="button secondary" type="button" onClick={() => fileInput.current?.click()} disabled={importing}><Upload size={16} />{importing ? 'Importing…' : 'Import YAML'}</button><button className="button secondary" type="button" onClick={() => { try { download(catalogToYaml(catalog), 'tracegrade-scorer-catalog.yml', 'application/yaml'); onToast?.('Scorer catalog exported with exact versions.'); } catch (error) { setFileError(error.message); } }}><Download size={16} />Export YAML</button><button className="button primary" type="button" onClick={() => setBuilder({ initialDraft: freshDraft(context) })}><Plus size={17} />Build scorer</button><input ref={fileInput} className="sr-only" type="file" accept=".yaml,.yml,text/yaml,application/yaml" aria-label="Import scorer catalog YAML" onChange={importFile} /></div></div>
    <EvaluationContext spec={spec} specs={specs.length ? specs : [spec]} onSelectSpec={onSelectSpec} onContextChange={onContextChange} />
    {fileError ? <Notice tone="error">{fileError}</Notice> : null}
    <div className="catalog-tabs" role="tablist" aria-label="Catalog views"><button type="button" role="tab" aria-selected={tab === 'catalog'} className={tab === 'catalog' ? 'active' : ''} onClick={() => setTab('catalog')}><BookOpen size={16} />Catalog <span>{catalog.length}</span></button><button type="button" role="tab" aria-selected={tab === 'discover'} className={tab === 'discover' ? 'active' : ''} onClick={() => setTab('discover')}><Activity size={16} />Discover traces <span>{candidates.length}</span></button><span className="catalog-tabs-note">Local registry · exact version pins</span></div>
    {tab === 'catalog' ? <div className="stack catalog-browser"><div className="catalog-scope-filters" role="group" aria-label="Filter scorers by scope">{[['all', Layers3, 'All scopes'], ['global', Globe2, 'Global'], ['domain', Boxes, 'Domain'], ['agent', Bot, 'Agent']].map(([key, Icon, label]) => <button key={key} type="button" aria-pressed={scope === key} className={scope === key ? 'active' : ''} onClick={() => setScope(key)}><Icon size={17} /><strong>{label}</strong><span>{key === 'all' ? catalog.length : catalog.filter(entry => entry.scope === key).length}</span></button>)}</div>
      <div className="catalog-filters"><label className="search-field"><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search scorers, owners, tags, or references…" aria-label="Search scorer catalog" />{search ? <button className="icon-button" type="button" aria-label="Clear scorer search" onClick={() => setSearch('')}><X size={14} /></button> : null}</label><select className="select" aria-label="Filter by tag" value={tag} onChange={event => setTag(event.target.value)}><option value="">All tags</option>{tags.map(item => <option key={item}>{item}</option>)}</select><select className="select" aria-label="Filter by lifecycle" value={lifecycle} onChange={event => { setLifecycle(event.target.value); if (event.target.value === 'draft' || event.target.value === 'deprecated') setAvailableOnly(false); }}><option value="all">All states</option><option value="published">Published</option><option value="draft">Has draft</option><option value="deprecated">Deprecated</option></select><label className="check-row catalog-available-filter"><input type="checkbox" checked={availableOnly} onChange={event => setAvailableOnly(event.target.checked)} /><span>Available to this evaluation</span></label></div>
      <section className="panel catalog-list"><div className="catalog-list-heading"><div><strong>{visible.length} scorer{visible.length === 1 ? '' : 's'}</strong><span>{publishedCount} published in this workspace</span></div><span className="small muted">Published definitions are immutable</span></div>{visible.length ? visible.map(entry => <CatalogRow key={entry.id} entry={entry} spec={spec} specs={specs} context={context} onInspect={() => inspect(entry)} onAdd={onAddToEvaluation} />) : <EmptyState icon={Search} title="No scorers match this view" action={<button className="button secondary" type="button" onClick={() => { setSearch(''); setScope('all'); setTag(''); setLifecycle('all'); setAvailableOnly(false); }}>Show all scorers</button>}>Adjust the scope, search, tags, or applicability filter. You can also build a new scorer for this evaluation.</EmptyState>}</section>
      <div className="catalog-contract-note"><ShieldCheck size={19} /><p><strong>A reusable definition, an explicit adoption.</strong> Drafts become available only after publishing. Adding a scorer pins its exact version; later catalog changes never silently change an evaluation.</p><button className="text-link no-underline" type="button" onClick={() => onNavigate('playground')}>Open YAML playground <ArrowRight size={15} /></button></div>
    </div> : <Discovery candidates={candidates} traces={traces} context={context} catalog={catalog} onBuild={buildCandidate} onInspect={inspect} onNavigate={onNavigate} />}
    {selectedEntry ? <ScorerDetail key={`${selectedEntry.id}:${detail.version}`} entry={selectedEntry} initialVersion={detail.version} spec={spec} specs={specs} context={context} onClose={() => setDetail(null)} onEdit={edit} onFork={fork} onAdd={onAddToEvaluation} onPublish={onPublish} onToast={onToast} /> : null}
    {builder ? <ScorerBuilder {...builder} context={context} onSaveDraft={onSaveDraft} onSaved={entry => { setBuilder(null); inspect(entry, 'draft'); }} onClose={() => setBuilder(null)} /> : null}
  </div>;
}
