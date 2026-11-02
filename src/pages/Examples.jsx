import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Activity, AlertCircle, ArrowRight, BookOpen, Check, CheckCircle2, ClipboardCheck, Download, FileJson, GitBranch, LoaderCircle, MessageSquare, Play, Search, ShieldCheck, Users, Wrench, X } from 'lucide-react';
import { SCENARIOS, getScenarioFixture } from '../scenarios.js';
import { TRACE_PROFILES } from '../traceProfiles.js';
import { download } from '../utils.js';
import { EmptyState, Modal, Notice } from '../components/ui.jsx';
import '../examples.css';

function roleKind(role) {
  const value = String(role || '').toLowerCase();
  if (/annotat|review/.test(value)) return 'annotator';
  if (/product|owner/.test(value)) return 'product';
  return 'engineer';
}

const ROLE_ICONS = { product: ClipboardCheck, engineer: Wrench, annotator: MessageSquare };
const DESTINATIONS = { product: 'reports', engineer: 'datasets', annotator: 'annotations' };
const DESTINATION_LABELS = { product: 'evaluation report', engineer: 'trace dataset', annotator: 'human review queue' };
const PERSPECTIVES = [['default', 'Scenario default'], ['Product owner', 'Product owner'], ['Engineering', 'Engineering'], ['Annotator', 'Annotator']];
const jsonText = value => typeof value === 'string' ? value : value == null ? '—' : JSON.stringify(value);
const asProfiles = profiles => Array.isArray(profiles) ? profiles : Object.values(profiles || {});

function handleTabKey(event, values, current, onSelect) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !values.length) return;
  event.preventDefault();
  const index = Math.max(0, values.indexOf(current));
  const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? values.length - 1
    : (index + (event.key === 'ArrowRight' ? 1 : -1) + values.length) % values.length;
  onSelect(values[nextIndex]);
  event.currentTarget.parentElement?.querySelectorAll('[role="tab"]')[nextIndex]?.focus();
}

function defaultRole(scenario) {
  return scenario.personas.find(persona => persona.role === scenario.primaryPersona)?.role
    || scenario.personas.find(persona => roleKind(persona.role) === roleKind(scenario.primaryPersona))?.role
    || scenario.personas[0]?.role;
}

function perspectiveRole(scenario, perspective) {
  if (perspective === 'default') return defaultRole(scenario);
  return scenario.personas.find(persona => persona.role === perspective)?.role
    || scenario.personas.find(persona => roleKind(persona.role) === roleKind(perspective))?.role
    || defaultRole(scenario);
}

function matchesScenario(scenario, query) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = [scenario.id, scenario.title, scenario.team, scenario.summary, ...(scenario.variations || []),
    ...scenario.personas.flatMap(persona => [persona.role, persona.goal])].filter(Boolean).join(' ').toLocaleLowerCase();
  return words.every(word => text.includes(word));
}

function ScenarioCard({ scenario, profile, installed, role, onRoleChange, onLoadScenario, onInspect }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const persona = scenario.personas.find(item => item.role === role) || scenario.personas[0];
  const kind = roleKind(persona?.role || scenario.primaryPersona);
  const PrimaryIcon = ROLE_ICONS[roleKind(scenario.primaryPersona)];

  async function openScenario() {
    if (loading) return;
    setLoading(true); setError('');
    try {
      const result = await onLoadScenario(scenario.id, DESTINATIONS[kind]);
      if (result === false && mounted.current) setError('The scenario could not be opened. Review the workspace message for details.');
    } catch (cause) { if (mounted.current) setError(cause.message || 'The scenario could not be loaded.'); }
    finally { if (mounted.current) setLoading(false); }
  }

  return <article className={`example-card example-${roleKind(scenario.primaryPersona)}`}>
    <header className="example-card-header"><div className="example-card-topline"><span className="example-scenario-symbol"><PrimaryIcon size={22} strokeWidth={1.6} /></span><div className="example-state-badges"><span className="badge neutral">Synthetic data</span>{installed ? <span className="badge success"><Check size={11} />Loaded</span> : null}</div></div><span className="example-team">{scenario.team}</span><h2>{scenario.title}</h2><p>{scenario.summary}</p></header>

    <section className="example-telemetry"><div className="example-section-label"><Activity size={14} /><h3>Telemetry variation</h3></div><ul>{(scenario.variations || []).slice(0, 2).map((variation, index) => <li key={index}>{variation}</li>)}</ul><button className="text-link no-underline" type="button" onClick={() => onInspect('mapping')} disabled={!profile}><GitBranch size={13} />View field mappings <ArrowRight size={13} /></button>{profile ? <span className="example-profile-label">{profile.name} · v{profile.version}</span> : null}</section>

    <section className="example-persona"><div className="example-section-label"><Users size={14} /><h3>Choose a perspective</h3></div><div className="example-persona-tabs" role="tablist" aria-label={`Perspectives for ${scenario.title}`}>{scenario.personas.map((item, index) => { const Icon = ROLE_ICONS[roleKind(item.role)]; return <button type="button" role="tab" id={`persona-${scenario.id}-tab-${index}`} aria-selected={role === item.role} aria-controls={`persona-${scenario.id}`} tabIndex={role === item.role ? 0 : -1} className={role === item.role ? 'active' : ''} key={item.role} onClick={() => onRoleChange(item.role)} onKeyDown={event => handleTabKey(event, scenario.personas.map(value => value.role), role, onRoleChange)} disabled={loading}><Icon size={13} /><span>{item.role}</span></button>; })}</div><div className="example-persona-content" id={`persona-${scenario.id}`} role="tabpanel" tabIndex={0} aria-labelledby={`persona-${scenario.id}-tab-${scenario.personas.indexOf(persona)}`}><div className="example-persona-goal"><span>Your goal</span><p>{persona?.goal}</p></div><ol className="example-persona-steps">{(persona?.steps || []).map((step, index) => <li key={index}><span>{index + 1}</span><p>{step}</p></li>)}</ol></div></section>

    <section className="example-outcome"><CheckCircle2 size={16} /><div><h3>Expected from this fixture</h3><p>{scenario.expectedOutcome}</p></div></section>
    <div className="example-actions">{error ? <p className="example-error" role="alert"><AlertCircle size={15} />{error}</p> : null}<div className="example-action-buttons"><button type="button" className="button primary" onClick={openScenario} disabled={loading}>{loading ? <LoaderCircle size={15} className="spin" /> : installed ? <ArrowRight size={15} /> : <Play size={15} />}{loading ? 'Loading…' : installed ? 'Open scenario' : 'Load scenario'}</button><button type="button" className="button secondary" onClick={() => onInspect('fixture')}><FileJson size={15} />Fixture JSON</button></div><p>{installed ? 'Opens your existing copy; edits are preserved.' : 'Creates a separate evaluation, traces, scorers, and first run.'} <span>Opens the {DESTINATION_LABELS[kind]}.</span></p></div>
  </article>;
}

function FieldMapping({ field }) {
  const selector = [
    field.attribute ? { label: 'attribute', value: field.attribute } : null,
    field.serviceName ? { label: 'service.name', value: field.serviceName } : null,
    field.spanName ? { label: 'span', value: field.spanName } : null,
    field.eventName ? { label: 'event', value: field.eventName } : null,
    field.path ? { label: 'path', value: field.path } : null,
  ].filter(Boolean);
  return <tr><td><code className="example-canonical-field">{field.target}</code></td><td><span className="example-source-kind">{jsonText(field.source)}</span></td><td>{selector.length ? <div className="example-mapping-selectors">{selector.map(item => <span key={item.label}><small>{item.label}</small><code>{jsonText(item.value)}</code></span>)}</div> : <span className="muted small">Defined by the profile</span>}</td><td><div className="example-mapping-processing">{field.unit ? <span><small>Input unit</small><code>{jsonText(field.unit)}</code></span> : null}{field.format ? <span><small>Format</small><code>{jsonText(field.format)}</code></span> : null}{field.transform ? <span className="example-mapping-transform">{jsonText(field.transform)}</span> : null}{!field.unit && !field.format && !field.transform ? <span className="muted">As recorded</span> : null}</div></td></tr>;
}

function ScenarioInspector({ scenario, profile, initialTab, onClose, onToast }) {
  const [tab, setTab] = useState(initialTab);
  const fixture = useMemo(() => {
    try { return { text: JSON.stringify(getScenarioFixture(scenario.id), null, 2), error: null }; }
    catch (error) { return { text: '', error: error.message || 'This fixture could not be read.' }; }
  }, [scenario.id]);
  function downloadFixture() {
    if (!fixture.text) return;
    download(fixture.text, `${scenario.id}-otel-fixture.json`, 'application/json');
    onToast?.('Synthetic OpenTelemetry fixture downloaded.');
  }
  return <Modal drawer title="Scenario evidence and mapping" onClose={onClose} className="examples-inspector"><div className="examples-inspector-heading"><span className="badge neutral">Synthetic scenario</span><h2>{scenario.title}</h2><p>{scenario.team}</p></div><div className="examples-inspector-tabs" role="tablist" aria-label="Scenario evidence views"><button type="button" role="tab" id={`scenario-${scenario.id}-mapping-tab`} aria-selected={tab === 'mapping'} aria-controls={`scenario-${scenario.id}-evidence-panel`} tabIndex={tab === 'mapping' ? 0 : -1} className={tab === 'mapping' ? 'active' : ''} onClick={() => setTab('mapping')} onKeyDown={event => handleTabKey(event, ['mapping', 'fixture'], tab, setTab)}><GitBranch size={15} />Field mappings</button><button type="button" role="tab" id={`scenario-${scenario.id}-fixture-tab`} aria-selected={tab === 'fixture'} aria-controls={`scenario-${scenario.id}-evidence-panel`} tabIndex={tab === 'fixture' ? 0 : -1} className={tab === 'fixture' ? 'active' : ''} onClick={() => setTab('fixture')} onKeyDown={event => handleTabKey(event, ['mapping', 'fixture'], tab, setTab)}><FileJson size={15} />Raw fixture</button></div><div className="examples-inspector-body" role="tabpanel" id={`scenario-${scenario.id}-evidence-panel`} aria-labelledby={`scenario-${scenario.id}-${tab}-tab`} tabIndex={0}>
    {tab === 'mapping' ? profile ? <div className="stack"><div className="examples-profile-heading"><div><h3>{profile.name}</h3><code>{profile.id}@{profile.version}</code></div><span className="badge teal">Explicit profile</span></div><p className="subtext">{profile.description}</p><Notice>These rules name the exact source of each canonical field. Missing fields remain missing and can block scoring; the normalizer does not invent responses, cost, or tool outcomes.</Notice><section className="panel"><div className="panel-header"><h3>Source → canonical fields</h3><span className="small muted">{profile.fields?.length || 0} mappings</span></div><div className="table-wrap" tabIndex={0} role="region" aria-label="Exact source field mappings"><table className="data-table examples-mapping-table"><thead><tr><th>Canonical field</th><th>Source</th><th>Exact selector</th><th>Processing</th></tr></thead><tbody>{(profile.fields || []).map((field, index) => <FieldMapping key={`${field.target}-${index}`} field={field} />)}</tbody></table></div></section><section className="examples-variation-details"><h3>Why this team needs this profile</h3><ul>{(scenario.variations || []).map((variation, index) => <li key={index}>{variation}</li>)}</ul></section><details className="examples-profile-json"><summary>Exact profile definition</summary><pre className="code-block" tabIndex={0} aria-label="Exact normalization profile JSON">{JSON.stringify(profile, null, 2)}</pre><button type="button" className="button secondary" onClick={() => { download(JSON.stringify(profile, null, 2), `${profile.id}-profile.json`, 'application/json'); onToast?.('Normalization profile definition downloaded.'); }}><Download size={14} />Download profile</button></details></div> : <EmptyState icon={GitBranch} title="Profile not available">This scenario’s normalization profile could not be found.</EmptyState> : <div className="stack"><div className="section-heading"><div><h3>Raw OpenTelemetry fixture</h3><p className="small muted">Synthetic inputs, outputs, spans, and instrumentation.</p></div><button type="button" className="button secondary" disabled={!fixture.text} onClick={downloadFixture}><Download size={15} />Download JSON</button></div>{fixture.error ? <Notice tone="error">{fixture.error}</Notice> : <pre className="code-block examples-fixture-json" tabIndex={0} aria-label="Raw OpenTelemetry fixture JSON">{fixture.text}</pre>}<p className="small muted">Use this fixture to inspect the team’s original telemetry shape. Loading the scenario applies its named normalization profile before evaluation.</p></div>}
  </div><div className="examples-inspector-footer"><span><ShieldCheck size={15} />Profile selection is recorded with normalized evidence.</span><button type="button" className="button secondary" onClick={onClose}>Close</button></div></Modal>;
}

export default function Examples({ scenarios = SCENARIOS, profiles = TRACE_PROFILES, onLoadScenario, onToast, onNavigate, installations = {} }) {
  const [inspector, setInspector] = useState(null);
  const [query, setQuery] = useState('');
  const [perspective, setPerspective] = useState('default');
  const [roleOverrides, setRoleOverrides] = useState({});
  const searchInput = useRef(null);
  const perspectiveInput = useRef(null);
  const explorerId = useId();
  const profileList = asProfiles(profiles);
  const visibleScenarios = useMemo(() => scenarios.filter(scenario => matchesScenario(scenario, query)), [scenarios, query]);
  const selectedScenario = inspector ? scenarios.find(scenario => scenario.id === inspector.id) : null;
  const selectedProfile = selectedScenario ? profileList.find(profile => profile.id === selectedScenario.profileId) : null;

  function clearSearch() {
    setQuery('');
    searchInput.current?.focus();
  }

  function changePerspective(value) {
    setPerspective(value);
    setRoleOverrides({});
  }

  function changeCardRole(scenario, role) {
    setRoleOverrides(previous => {
      const next = { ...previous };
      if (role === perspectiveRole(scenario, perspective)) delete next[scenario.id];
      else next[scenario.id] = role;
      return next;
    });
  }

  return <div className="examples-page stack">
    <div className="section-heading page-heading examples-page-heading">
      <div><h1>Examples</h1><p className="subtext">Different teams. Different telemetry. One repeatable evaluation workflow.</p></div>
      <span className="badge neutral">{scenarios.length} synthetic scenario{scenarios.length === 1 ? '' : 's'}</span>
    </div>
    <div className="examples-introduction">
      <div className="examples-intro-symbol"><BookOpen size={25} strokeWidth={1.6} /></div>
      <div><h2>Start from a scenario you recognize</h2><p>Choose a product owner, engineer, or annotator perspective. Load a separate evaluation with sample traces, explicit field mappings, reusable scorers, and an initial run.</p></div>
    </div>
    <section className="examples-explorer" aria-label="Explore examples">
      <div className="examples-toolbar">
        <div className="examples-search">
          <Search size={17} aria-hidden="true" />
          <label htmlFor={`${explorerId}-search`} className="sr-only">Search example scenarios</label>
          <input
            id={`${explorerId}-search`}
            ref={searchInput}
            type="search"
            value={query}
            maxLength={200}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => { if (event.key === 'Escape' && query) { event.preventDefault(); clearSearch(); } }}
            placeholder="Search teams, telemetry, or goals…"
            aria-controls={`${explorerId}-results`}
            aria-describedby={`${explorerId}-count`}
          />
          {query ? <button type="button" className="icon-button" aria-label="Clear scenario search" onClick={clearSearch}><X size={15} /></button> : null}
        </div>
        <label className="examples-perspective-control" htmlFor={`${explorerId}-perspective`}>
          <span><Users size={15} aria-hidden="true" />Perspective</span>
          <select id={`${explorerId}-perspective`} className="select" ref={perspectiveInput} value={perspective} onChange={event => changePerspective(event.target.value)} aria-describedby={`${explorerId}-perspective-help`}>
            {PERSPECTIVES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>
      <div className="examples-results-summary">
        <p id={`${explorerId}-count`} role="status" aria-live="polite" aria-atomic="true">Showing <strong>{visibleScenarios.length}</strong> of {scenarios.length} scenarios<span className="sr-only">. Default perspective: {perspective === 'default' ? 'each scenario’s primary role' : perspective}.</span></p>
        <div><p id={`${explorerId}-perspective-help`}>Sets all walkthroughs. Each card can use its own perspective.</p>{Object.keys(roleOverrides).length ? <button type="button" className="text-link no-underline" onClick={() => { setRoleOverrides({}); perspectiveInput.current?.focus(); }}>Reset card choices</button> : null}</div>
      </div>
    </section>
    <div className="examples-results" id={`${explorerId}-results`}>
      {visibleScenarios.length ? <div className={`examples-grid${visibleScenarios.length === 1 ? ' examples-single-result' : ''}`}>
        {visibleScenarios.map(scenario => <ScenarioCard
          key={scenario.id}
          scenario={scenario}
          profile={profileList.find(profile => profile.id === scenario.profileId)}
          installed={Boolean(installations[scenario.id]?.specId)}
          role={roleOverrides[scenario.id] || perspectiveRole(scenario, perspective)}
          onRoleChange={role => changeCardRole(scenario, role)}
          onLoadScenario={onLoadScenario}
          onInspect={tab => setInspector({ id: scenario.id, tab })}
        />)}
      </div> : scenarios.length ? <div className="panel examples-no-results"><EmptyState icon={Search} title="No scenarios match your search" action={<button type="button" className="button secondary" onClick={clearSearch}>Clear search</button>}>Try a team name, a telemetry pattern, or a role’s goal. Your perspective choices and loaded scenarios are preserved.</EmptyState></div> : <div className="panel"><EmptyState icon={BookOpen} title="No example scenarios available">You can still connect your own trace export and create an evaluation.</EmptyState></div>}
    </div>
    <div className="examples-perspective-note">
      <Users size={18} />
      <p>Perspectives describe goals and work steps. All perspectives use the same prototype workspace and permissions. Each scenario uses synthetic data and preserves your existing evaluations.</p>
      <button className="text-link no-underline" type="button" onClick={() => onNavigate('connections')}>Bring your own traces <ArrowRight size={15} /></button>
    </div>
    {selectedScenario ? <ScenarioInspector
      key={`${selectedScenario.id}-${inspector.tab}`}
      scenario={selectedScenario}
      profile={selectedProfile}
      initialTab={inspector.tab}
      onClose={() => setInspector(null)}
      onToast={onToast}
    /> : null}
  </div>;
}
