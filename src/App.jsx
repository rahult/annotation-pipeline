import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowRight, BarChart3, BookOpen, Check, ChevronDown, ChevronRight, ClipboardList, Code2, Database, Download, FileBarChart, FlaskConical, Home, Layers3, Link, Menu, PencilLine, Play, Plus, RotateCcw, Settings2, ShieldCheck, Sparkles, X } from 'lucide-react';
import { useWorkspace, resetWorkspace } from './store.jsx';
import { aggregateRun, evaluateRun, filterTraces, makeId, validateDataset } from './domain.js';
import { canonicalSpecification } from './configurationState.js';
import { saveScorerDraft, publishScorerVersion, metricFromCatalog, parseCatalogYaml, mergeCatalog } from './catalog.js';
import { SCENARIOS, prepareScenario } from './scenarios.js';
import { TRACE_PROFILES } from './traceProfiles.js';
import { clone, download, formatValue, runLabel, scoreLabel, timeAgo } from './utils.js';
import { EmptyState, MetricIcon, Modal, Notice, RunProgress, StatusBadge, Toast } from './components/ui.jsx';
import { EvaluationOverview, RunsTable } from './components/Scorecard.jsx';
import TraceDrawer from './components/TraceDrawer.jsx';
import Guidelines from './pages/Guidelines.jsx';
import Dataset from './pages/Dataset.jsx';
import Pipeline from './pages/Pipeline.jsx';
import Annotations from './pages/Annotations.jsx';
import Reports from './pages/Reports.jsx';
import Connections from './pages/Connections.jsx';
import Playground from './pages/Playground.jsx';
import ScorerCatalog from './pages/ScorerCatalog.jsx';
import Examples from './pages/Examples.jsx';

const NAV = [
  ['overview', Home, 'Overview'], ['evaluations', BarChart3, 'Evaluations'], ['datasets', Database, 'Datasets'],
  ['scorers', Settings2, 'Scorer catalog'], ['annotations', ClipboardList, 'Annotations'], ['reports', FileBarChart, 'Reports'],
  ['playground', Code2, 'Playground'],
  ['examples', FlaskConical, 'Examples'],
];
const TABS = [['overview', 'Overview'], ['guidelines', 'Guidelines'], ['dataset', 'Dataset'], ['pipeline', 'Pipeline'], ['runs', 'Runs']];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export default function App() {
  const { state, setState, saveError } = useWorkspace();
  const [page, setPage] = useState('examples');
  const [tab, setTab] = useState('overview');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [traceDetail, setTraceDetail] = useState(null);
  const [toast, setToast] = useState('');
  const [newEvaluation, setNewEvaluation] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [preflightError, setPreflightError] = useState(null);
  const [progress, setProgress] = useState(null);
  const [showProgress, setShowProgress] = useState(false);
  const toastTimer = useRef(null);
  const running = useRef(false);
  const focusAfterScenario = useRef(false);
  const catalogRef = useRef(state.scorerCatalog);
  catalogRef.current = state.scorerCatalog;
  const spec = state.specs.find(item => item.id === state.activeSpecId) || state.specs[0];
  const activeScenarioId = Object.entries(state.scenarioInstallations || {}).find(([, installation]) => installation.specId === spec.id)?.[0];
  const activeScenario = SCENARIOS.find(item => item.id === activeScenarioId);
  const allRuns = useMemo(() => state.runs.map(run => { const summary = aggregateRun(run, state.annotations); return { ...run, status: summary.gate, summary }; }).sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)), [state.runs, state.annotations]);
  const runs = useMemo(() => allRuns.filter(run => run.specId === spec.id), [allRuns, spec.id]);
  const validation = useMemo(() => validateDataset(state.traces, spec), [state.traces, spec]);
  const latestPending = runs[0]?.summary.pendingReview || 0;

  const notify = useCallback(message => {
    clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(''), 4500);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  useEffect(() => {
    if (focusAfterScenario.current) {
      document.getElementById('main-content')?.focus();
      focusAfterScenario.current = false;
    }
  }, [page, spec.id]);

  function navigate(destination) {
    if (TABS.some(([key]) => key === destination) && destination !== 'overview') { setPage('evaluations'); setTab(destination); }
    else { setPage(destination); if (destination === 'evaluations') setTab('overview'); }
    setMobileOpen(false);
    setSwitcherOpen(false);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function selectSpec(id) {
    setState(previous => ({ ...previous, activeSpecId: id }));
    setSelectedRunId('');
    if (!['playground', 'scorers'].includes(page)) { setPage('evaluations'); setTab('overview'); }
    setSwitcherOpen(false); setMobileOpen(false);
  }
  function saveSpec(next, yamlSource) {
    try {
      const canonical = canonicalSpecification(next, yamlSource, catalogRef.current);
      setState(previous => ({ ...previous, specs: previous.specs.map(item => item.id === next.id ? { ...canonical, version: item.version + 1, updatedAt: new Date().toISOString() } : item) }));
      notify(`Specification saved as version ${spec.version + 1}. Historical runs are preserved.`);
      return true;
    } catch (error) {
      notify(`Configuration could not be saved: ${error.message}`);
      return false;
    }
  }
  function updateCatalog(catalog) {
    catalogRef.current = catalog;
    setState(previous => ({ ...previous, scorerCatalog: catalog }));
  }
  function saveCatalogDraft(draft, entryId) {
    try {
      const result = saveScorerDraft(catalogRef.current, draft, entryId);
      updateCatalog(result.catalog);
      notify('Scorer draft saved. Publish a version to use it in evaluations.');
      return result.entry;
    } catch (error) { notify(error.message); return false; }
  }
  function publishCatalogScorer(entryId, release) {
    try {
      const result = publishScorerVersion(catalogRef.current, entryId, release);
      updateCatalog(result.catalog);
      notify(`Published ${result.entry.name} ${release.version}. Existing evaluation pins are unchanged.`);
      return result.entry;
    } catch (error) { notify(error.message); return false; }
  }
  function addCatalogScorer(ref, version) {
    try {
      const entry = catalogRef.current.find(item => item.id === ref);
      if (entry?.deprecated) throw new Error('This scorer is deprecated. Choose an active scorer for new adoption.');
      let metric = metricFromCatalog(catalogRef.current, ref, version, spec.context || {});
      const existing = spec.metrics.find(item => item.catalogRef?.ref === ref || item.id === metric.id);
      if (existing?.catalogRef?.ref === ref && existing.catalogRef.version === version) { notify('This scorer version is already in the evaluation.'); return true; }
      if (existing?.catalogRef && existing.catalogRef.ref !== ref) throw new Error(`The metric ID ${metric.id} is already used by another catalog scorer. Remove that metric before adopting this scorer.`);
      if (existing) {
        const overrides = Object.fromEntries(['threshold', 'operator', 'weight', 'enabled', 'critical'].map(key => [key, existing[key]]));
        metric = { ...metric, ...overrides };
      }
      const metrics = existing ? spec.metrics.map(item => item === existing ? metric : item) : [...spec.metrics, metric];
      if (!saveSpec({ ...spec, metrics })) return false;
      notify(`${metric.name} pinned to ${version}. Evaluation thresholds and previous runs are preserved.`);
      return true;
    } catch (error) { notify(error.message); return false; }
  }
  function importCatalog(source) {
    try {
      const parsed = parseCatalogYaml(source);
      if (!parsed.valid) throw new Error(parsed.errors.map(error => error.message).slice(0, 3).join(' '));
      const result = mergeCatalog(catalogRef.current, parsed.catalog);
      updateCatalog(result.catalog);
      notify(`Catalog imported: ${result.added} new scorers, ${result.updated} updated entries. Existing pins are preserved.`);
      return true;
    } catch (error) { notify(error.message); return false; }
  }
  function loadScenario(id, destination) {
    try {
      const scenario = SCENARIOS.find(item => item.id === id);
      if (!scenario) throw new Error('This example scenario is unavailable.');
      const target = destination || (/annotat/i.test(scenario.primaryPersona) ? 'annotations' : /engineer/i.test(scenario.primaryPersona) ? 'datasets' : 'evaluations');
      const installed = state.scenarioInstallations?.[id];
      if (installed && state.specs.some(item => item.id === installed.specId)) {
        focusAfterScenario.current = true;
        setState(previous => ({ ...previous, activeSpecId: installed.specId }));
        setSelectedRunId(state.runs.find(item => item.specId === installed.specId)?.id || '');
        navigate(target);
        notify('Opened the installed example. Your edits and annotations are preserved.');
        return true;
      }
      const prepared = prepareScenario(id);
      const existingTraceIds = new Set(state.traces.filter(trace => trace.source === 'import').map(trace => trace.id));
      if (prepared.traces.some(trace => existingTraceIds.has(trace.id))) throw new Error('Some example trace IDs already exist in this workspace. Existing evidence has been preserved. Use the existing records or a fresh workspace for this example.');
      const nextCatalog = mergeCatalog(catalogRef.current, prepared.catalogAdditions).catalog;
      const nextSpec = canonicalSpecification({ ...prepared.spec, id: makeId('spec'), version: 1, updatedAt: new Date().toISOString() }, undefined, nextCatalog);
      const run = evaluateRun(prepared.traces, nextSpec, []);
      catalogRef.current = nextCatalog;
      setState(previous => {
        const byId = new Map(previous.traces.map(trace => [`${trace.source}:${trace.id}`, trace]));
        prepared.traces.forEach(trace => byId.set(`import:${trace.id}`, { ...trace, source: 'import' }));
        const highest = Math.max(0, ...previous.runs.map(item => Number(item.label?.replace('RUN-', '')) || 0));
        return { ...previous, scorerCatalog: nextCatalog, specs: [...previous.specs, nextSpec], traces: [...byId.values()], runs: [{ ...run, label: `RUN-${String(highest + 1).padStart(3, '0')}` }, ...previous.runs], activeSpecId: nextSpec.id, scenarioInstallations: { ...previous.scenarioInstallations, [id]: { specId: nextSpec.id } }, importNotes: prepared.warnings, lastImportAt: new Date().toISOString() };
      });
      setSelectedRunId(run.id);
      focusAfterScenario.current = true;
      navigate(target);
      notify(`${scenario.title} loaded with ${prepared.traces.length} synthetic traces and a calculated ${run.summary.gate} result.`);
      return true;
    } catch (error) { notify(`Example could not be loaded: ${error.message}`); return false; }
  }
  function selectRun(run, destination) { setSelectedRunId(run.id); if (destination) navigate(destination); }
  function inspectTrace(trace, result) { setTraceDetail({ trace, result }); }

  async function runEvaluation() {
    if (running.current) return;
    const capturedSpec = clone(spec), capturedTraces = clone(state.traces);
    const check = validateDataset(capturedTraces, capturedSpec);
    if (!check.valid) { setPreflightError(check.errors); return; }
    running.current = true;
    setProgress(0); setShowProgress(true);
    try {
      await wait(180); setProgress(1);
      await wait(180); setProgress(2);
      const result = evaluateRun(capturedTraces, capturedSpec, []);
      await wait(220); setProgress(3);
      await wait(180); setProgress(4);
      await wait(160);
      setState(previous => {
        const highest = Math.max(0, ...previous.runs.map(item => Number(item.label?.replace('RUN-', '')) || 0));
        return { ...previous, runs: [{ ...result, label: `RUN-${String(highest + 1).padStart(3, '0')}` }, ...previous.runs] };
      });
      setSelectedRunId(result.id);
      setPage('evaluations'); setTab('overview');
      notify(`Evaluation complete. ${result.summary.total} traces scored; ${result.summary.pendingReview} awaiting review.`);
    } catch (err) { setPreflightError([err.message || 'Evaluation failed. Your existing runs are unchanged.']); }
    finally { running.current = false; setProgress(null); setShowProgress(false); }
  }

  function importDataset({ traces, warnings = [] }) {
    setState(previous => {
      const byId = new Map(previous.traces.map(trace => [`${trace.source}:${trace.id}`, trace]));
      traces.forEach(trace => byId.set(`import:${trace.id}`, { ...trace, source: 'import' }));
      const merged = [...byId.values()];
      let highest = Math.max(0, ...previous.runs.map(item => Number(item.label?.replace('RUN-', '')) || 0));
      const automaticRuns = previous.specs.filter(item => item.automation.trigger === 'on_import' && item.dataset.source === 'import').map(item => ({ ...evaluateRun(merged, item, previous.annotations), label: `RUN-${String(++highest).padStart(3, '0')}`, trigger: 'on_import' }));
      return { ...previous, traces: merged, runs: [...automaticRuns, ...previous.runs], importNotes: warnings.slice(0, 100), lastImportAt: new Date().toISOString() };
    });
    notify(`${traces.length} traces imported.${warnings.length ? ` ${warnings.length} import notes.` : ''} Select imported traces in your dataset.`);
  }
  function annotate(annotation) {
    setState(previous => ({ ...previous, annotations: [...previous.annotations, { ...annotation, id: makeId('annotation'), createdAt: new Date().toISOString() }] }));
  }

  function createEvaluation({ name, description, template }) {
    const base = clone(state.specs.find(item => item.id === template) || spec);
    const created = canonicalSpecification({ ...base, id: makeId('spec'), name, description, version: 1, updatedAt: new Date().toISOString() }, undefined, catalogRef.current);
    setState(previous => ({ ...previous, specs: [...previous.specs, created], activeSpecId: created.id }));
    setNewEvaluation(false); setPage('playground'); setSelectedRunId('');
    notify('Evaluation created. Edit its YAML or use the guideline and dataset forms.');
  }

  return <div className="app-shell">
    {mobileOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
      <button className="brand" onClick={() => navigate('overview')} aria-label="Tracegrade workspace overview"><svg viewBox="0 0 30 30" aria-hidden="true"><rect x="3" y="3" width="24" height="24" rx="2" /><path d="M3 14h7l6 6v7M9 27V17" /></svg><span>tracegrade</span></button>
      <div className="workspace-section"><span className="sidebar-label">Workspace</span><button className="workspace-selector" aria-expanded={switcherOpen} onClick={() => setSwitcherOpen(!switcherOpen)}>Product quality <ChevronDown size={16} /></button>{switcherOpen && <div className="workspace-menu"><span className="small muted">Evaluations in this workspace</span>{state.specs.map(item => <button key={item.id} onClick={() => selectSpec(item.id)}><span>{item.name}</span>{item.id === spec.id && <Check size={15} />}</button>)}<button className="new-eval-option" onClick={() => { setNewEvaluation(true); setSwitcherOpen(false); }}><Plus size={16} />New evaluation</button></div>}</div>
      <nav className="main-nav" aria-label="Main navigation">{NAV.map(([key, Icon, label]) => <button key={key} className={page === key ? 'active' : ''} onClick={() => navigate(key)}><Icon size={21} strokeWidth={1.6} /><span>{label}</span>{key === 'annotations' && latestPending > 0 && <span className="nav-count">{latestPending}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><button className={`connection-nav ${page === 'connections' ? 'active' : ''}`} onClick={() => navigate('connections')}><Link size={20} strokeWidth={1.7} /><span>Connections</span></button><button className="profile" onClick={() => setSettingsOpen(true)}><span className="avatar">PT</span><span>Product team</span><ChevronRight size={16} /></button><span className="sidebar-footnote">{activeScenario ? 'Synthetic scenario' : spec.dataset.source === 'demo' ? 'Sample traces' : 'Imported traces'} · local prototype</span></div>
    </aside>
    <div className="workspace-main"><header className="topbar"><div className="inline"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={21} /></button><button className="breadcrumb" onClick={() => navigate('overview')}>Workspace</button><span className="breadcrumb-divider">/</span><span>{page === 'connections' ? 'Connections' : NAV.find(([key]) => key === page)?.[2]}</span></div><div className="topbar-right"><button className="demo-indicator" onClick={() => navigate('connections')}>{activeScenario ? 'Synthetic scenario' : spec.dataset.source === 'demo' ? 'Demo workspace' : 'Imported traces'}<ChevronDown size={14} /></button><span className="topbar-divider" /><button className="avatar small-avatar" aria-label="Workspace settings" onClick={() => setSettingsOpen(true)}>PT</button></div></header>
      <main className="main-content" id="main-content" tabIndex={-1}>{saveError && <Notice tone="warning">{saveError} <button className="text-link" onClick={() => download(JSON.stringify(state, null, 2), 'tracegrade-workspace.json')}>Export workspace</button></Notice>}
        {activeScenario && page !== 'examples' && <div className="scenario-context-notice"><Notice><strong>Synthetic example: {activeScenario.title}.</strong> These fixtures illustrate {activeScenario.team} telemetry; they are not production measurements. <button className="text-link" onClick={() => navigate('examples')}>View persona scenarios</button></Notice></div>}
        {page === 'examples' && <Examples scenarios={SCENARIOS} profiles={TRACE_PROFILES} installations={state.scenarioInstallations || {}} onLoadScenario={loadScenario} onToast={notify} onNavigate={navigate} />}
        {page === 'playground' && <Playground key={`${spec.id}-${spec.version}`} spec={spec} specs={state.specs} catalog={state.scorerCatalog} traces={state.traces} annotations={state.annotations} onSave={saveSpec} onToast={notify} onNavigate={navigate} onSelectSpec={selectSpec} />}
        {page === 'overview' && <WorkspaceOverview specs={state.specs} runs={allRuns} onSelect={selectSpec} onCreate={() => setNewEvaluation(true)} />}
        {page === 'evaluations' && <><div className="evaluation-header"><div><h1>{spec.name}</h1><p>Evaluate every interaction. Ship with evidence.</p></div><div className="header-actions"><button className="button secondary" onClick={() => navigate('playground')}><Code2 size={18} />Edit YAML</button><button className="button primary" disabled={progress !== null} onClick={runEvaluation}><Play size={18} />{progress !== null ? 'Evaluating…' : 'Run evaluation'}</button></div></div><div className="evaluation-tabs" role="tablist" aria-label="Evaluation sections">{TABS.map(([key, label]) => <button role="tab" aria-selected={tab === key} key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>)}</div><div className={`tab-content ${tab === 'overview' ? 'overview-tab' : ''}`}>
          {tab === 'overview' && <EvaluationOverview spec={spec} runs={runs} onNavigate={navigate} onSelectRun={run => selectRun(run, 'reports')} onRun={runEvaluation} />}
          {tab === 'guidelines' && <Guidelines key={`${spec.id}-${spec.version}`} spec={spec} onSave={saveSpec} onToast={notify} />}
          {tab === 'dataset' && <Dataset key={`${spec.id}-${spec.version}`} spec={spec} traces={state.traces} importNotes={state.importNotes || []} onSave={saveSpec} onImport={importDataset} onTrace={inspectTrace} onToast={notify} onNavigate={navigate} />}
          {tab === 'pipeline' && <Pipeline key={`${spec.id}-${spec.version}`} spec={spec} onSave={saveSpec} onRun={runEvaluation} onNavigate={navigate} onToast={notify} validation={validation} />}
          {tab === 'runs' && <div className="stack"><div className="section-heading"><div><h2>Evaluation runs</h2><p className="subtext">Every result is pinned to its evidence and specification.</p></div><span className="badge neutral">{runs.length} runs</span></div><section className="panel"><RunsTable runs={runs} onSelect={run => selectRun(run, 'reports')} showVersion /></section></div>}
        </div></>}
        {page === 'datasets' && <Dataset key={`${spec.id}-${spec.version}`} spec={spec} traces={state.traces} importNotes={state.importNotes || []} onSave={saveSpec} onImport={importDataset} onTrace={inspectTrace} onToast={notify} onNavigate={navigate} />}
        {page === 'scorers' && <ScorerCatalog catalog={state.scorerCatalog} spec={spec} specs={state.specs} traces={filterTraces(state.traces, spec)} onSaveDraft={saveCatalogDraft} onPublish={publishCatalogScorer} onAddToEvaluation={addCatalogScorer} onContextChange={context => saveSpec({ ...spec, context })} onSelectSpec={selectSpec} onImportCatalog={importCatalog} onToast={notify} onNavigate={navigate} />}
        {page === 'annotations' && <Annotations runs={runs} annotations={state.annotations} selectedRunId={selectedRunId} onSelectRun={selectRun} onAnnotate={annotate} onToast={notify} />}
        {page === 'reports' && <Reports runs={runs} annotations={state.annotations} selectedRunId={selectedRunId} onSelectRun={selectRun} onTrace={inspectTrace} onNavigate={navigate} onToast={notify} />}
        {page === 'connections' && <Connections connector={state.connector} onSave={connector => setState(previous => ({ ...previous, connector }))} onImport={importDataset} onToast={notify} />}
      </main>
    </div>
    {traceDetail && <TraceDrawer {...traceDetail} onClose={() => setTraceDetail(null)} />}
    {newEvaluation && <NewEvaluationModal specs={state.specs} onCreate={createEvaluation} onClose={() => setNewEvaluation(false)} />}
    {showProgress && progress !== null && <RunProgress stage={progress} specName={spec.name} onClose={() => setShowProgress(false)} />}
    {preflightError && <Modal title="Evaluation needs more evidence" onClose={() => setPreflightError(null)}><div className="modal-body stack"><Notice tone="warning">The run was not started. Fix these requirements so the results are meaningful.</Notice><ul className="validation-list">{preflightError.map((error, i) => <li key={i}>{error}</li>)}</ul><button className="button primary" onClick={() => { setPreflightError(null); navigate('dataset'); }}>Review dataset requirements <ArrowRight size={16} /></button></div></Modal>}
    {settingsOpen && <Modal title="Workspace settings" onClose={() => setSettingsOpen(false)}><div className="modal-body stack"><div><h3>Product quality</h3><p className="subtext">Your prototype workspace is saved in this browser. Imported traces, guidelines, runs, and annotations stay together.</p></div><div className="detail-list"><div><span>Evaluations</span><strong>{state.specs.length}</strong></div><div><span>Trace records</span><strong>{state.traces.length}</strong></div><div><span>Evaluation runs</span><strong>{state.runs.length}</strong></div><div><span>Human annotations</span><strong>{state.annotations.length}</strong></div></div><button className="button secondary" onClick={() => { download(JSON.stringify(state, null, 2), 'tracegrade-workspace.json'); notify('Workspace exported with all evidence and configuration.'); }}><Download size={16} />Export complete workspace</button><div className="divider" /><ResetDemo onReset={() => { setState(resetWorkspace()); setSelectedRunId(''); setPage('playground'); setSettingsOpen(false); notify('Demo workspace reset.'); }} /></div></Modal>}
    <Toast message={toast} />
  </div>;
}

function WorkspaceOverview({ specs, runs, onSelect, onCreate }) {
  const latest = specs.map(spec => runs.find(run => run.specId === spec.id)).filter(Boolean);
  return <div className="stack"><div className="section-heading page-heading"><div><h1>Product quality</h1><p className="subtext">One place to define, measure, and improve your agents.</p></div><button className="button primary" onClick={onCreate}><Plus size={17} />New evaluation</button></div><div className="workspace-intro"><div className="intro-icon"><ShieldCheck size={28} /></div><div><h2>Turn product expectations into evidence.</h2><p>Start with a guideline. Choose the right traces. Let the pipeline bring every score, review, and release decision together.</p></div><button className="button secondary" onClick={() => onSelect(specs[0].id)}>Open evaluation <ArrowRight size={16} /></button></div><section className="panel"><div className="panel-header"><h3>Evaluations</h3><span className="small muted">{specs.length} specifications</span></div><div className="table-wrap"><table className="data-table evaluations-list"><thead><tr><th>Evaluation</th><th>Metrics</th><th>Dataset</th><th>Latest score</th><th>Release decision</th><th /></tr></thead><tbody>{specs.map(spec => { const run = runs.find(item => item.specId === spec.id); return <tr className="clickable-row" key={spec.id} onClick={() => onSelect(spec.id)}><td><button className="trace-name-button" onClick={() => onSelect(spec.id)}><strong>{spec.name}</strong><span>{spec.description}</span></button></td><td>{spec.metrics.filter(metric => metric.enabled).length} enabled</td><td>{spec.dataset.sampleSize} traces</td><td className="numeric">{run ? scoreLabel(run.summary.score) : '—'}</td><td>{run ? <StatusBadge status={run.summary.gate} /> : <span className="badge neutral">Ready to run</span>}</td><td><ChevronRight size={16} /></td></tr>; })}</tbody></table></div></section><div className="workflow-explanation"><BookOpen size={19} /><p><strong>Guidelines are the starting point.</strong> Each evaluation combines a versioned brief, dataset requirements, metric thresholds, and human review rules. Runs preserve the exact evidence used.</p></div></div>;
}

function NewEvaluationModal({ specs, onCreate, onClose }) {
  const [name, setName] = useState(''), [description, setDescription] = useState(''), [template, setTemplate] = useState(specs[0].id);
  return <Modal title="Create evaluation" onClose={onClose}><form className="modal-body stack" onSubmit={event => { event.preventDefault(); if (name.trim()) onCreate({ name: name.trim(), description: description.trim(), template }); }}><p className="subtext">Start with an existing specification, then adapt the guidelines, data, and metrics to your product.</p><label className="field"><span className="field-label">Evaluation name</span><input className="input" value={name} onChange={event => setName(event.target.value)} required maxLength={120} placeholder="e.g. Refund agent readiness" /></label><label className="field"><span className="field-label">Product objective</span><textarea className="textarea" value={description} onChange={event => setDescription(event.target.value)} rows={3} maxLength={2000} placeholder="What should this agent do well, and what must never happen?" /></label><label className="field"><span className="field-label">Start from</span><select className="select" value={template} onChange={event => setTemplate(event.target.value)}>{specs.map(spec => <option key={spec.id} value={spec.id}>{spec.name}</option>)}</select></label><div className="form-actions"><button className="button secondary" type="button" onClick={onClose}>Cancel</button><button className="button primary" type="submit"><Plus size={16} />Create evaluation</button></div></form></Modal>;
}

function ResetDemo({ onReset }) {
  const [confirm, setConfirm] = useState(false);
  return <div className="stack compact"><h3>Reset demo</h3><p className="small muted">This removes this browser’s edits, imported traces, runs, and annotations. Export a copy first if you want to keep them.</p>{confirm ? <div className="inline"><button className="button danger" onClick={onReset}>Reset this workspace</button><button className="button secondary" onClick={() => setConfirm(false)}>Cancel</button></div> : <button className="button secondary align-start" onClick={() => setConfirm(true)}><RotateCcw size={15} />Reset to sample data</button>}</div>;
}
