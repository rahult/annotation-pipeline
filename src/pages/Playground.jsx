import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, BarChart3, Check, CheckCircle2, ChevronRight, Code2, Database, Download, FileText, Layers3, LoaderCircle, Play, RotateCcw, Save, Upload, Users, X } from 'lucide-react';
import { compileYaml, configSchema, specToYaml } from '../config.js';
import { evaluateRun, exportReport, filterTraces, validateDataset } from '../domain.js';
import { download, scoreLabel } from '../utils.js';
import YamlEditor from '../components/YamlEditor.jsx';
import { EmptyState, Notice, StatusBadge } from '../components/ui.jsx';
import { MetricScorecard, SummaryStats } from '../components/Scorecard.jsx';
import TraceDrawer from '../components/TraceDrawer.jsx';

const MAX_YAML_BYTES = 256 * 1024;
const draftKey = id => `tracegrade.yamlDraft.v1.${id}`;

function initialDraft(spec, baseline) {
  try {
    const draft = JSON.parse(localStorage.getItem(draftKey(spec.id)));
    if (draft?.baseVersion === spec.version && typeof draft.yaml === 'string' && new Blob([draft.yaml]).size <= MAX_YAML_BYTES) return draft.yaml;
  } catch { /* A missing draft starts from the saved source. */ }
  return baseline;
}

function PipelinePreview({ spec, traces, validation, result }) {
  const selected = filterTraces(traces, spec);
  const metrics = spec.metrics.filter(metric => metric.enabled);
  const stages = [
    [Database, 'Extract traces', `${spec.dataset.service === 'all' ? 'All services' : spec.dataset.service} · ${spec.dataset.environment === 'all' ? 'all environments' : spec.dataset.environment}`],
    [FileText, 'Freeze dataset', `${selected.length} trace records`],
    [BarChart3, `Score ${metrics.length} metrics`, metrics.some(metric => ['demo_judge', 'recorded_judgment'].includes(metric.kind)) ? 'deterministic + recorded judgments' : 'deterministic trace evidence'],
    [Users, result ? `Queue ${result.summary.reviewTotal} reviews` : 'Queue human reviews', `${spec.review.failures ? 'failures + ' : ''}${spec.review.sampleRate}% quality sample`],
    [FileText, 'Generate report', 'scorecard, CSV and JSON'],
  ];
  const evidence = [['requireInput', 'Input'], ['requireOutput', 'Output'], ['requireContext', 'Context']].filter(([key]) => spec.dataset[key]);
  return <>
    <h3 className="playground-preview-heading">Pipeline preview</h3>
    <ol className="playground-pipeline">{stages.map(([Icon, title, detail], index) => <li key={index}><span className="playground-step-number">{index + 1}</span><Icon size={22} strokeWidth={1.6} /><div><strong>{title}</strong><p>{detail}</p></div></li>)}</ol>
    <section className="playground-dataset"><h3>Dataset requirements</h3><dl className="detail-list"><div><dt>Selected traces</dt><dd>{selected.length}</dd></div><div><dt>Minimum required</dt><dd>{spec.dataset.minSamples}</dd></div><div><dt>Required evidence</dt><dd className="inline">{evidence.length ? evidence.map(([key, label]) => <span className="badge neutral" key={key}>{label}</span>) : <span className="muted">None configured</span>}</dd></div></dl></section>
    {!validation.valid ? <div className="callout warning"><AlertCircle size={18} /><div><strong>Dataset needs attention</strong><ul className="validation-list">{validation.errors.map((error, index) => <li key={index}>{error}</li>)}</ul></div></div> : null}
    <div className="playground-isolation"><Layers3 size={25} strokeWidth={1.5} /><div><strong>Draft runs are isolated from saved evaluations</strong><p>Validate before saving a new specification version.</p></div></div>
    {spec.automation.trigger === 'scheduled' ? <p className="small muted">Scheduled execution is configuration only. This prototype does not run background jobs.</p> : null}
  </>;
}

function DraftResults({ result, stale, onTrace, onMetric, onSaveAndOpen, onDownload, canSave }) {
  if (!result) return <EmptyState icon={Play} title="Test your specification">Run a draft to evaluate the selected trace snapshot. Results stay separate from saved evaluation history.</EmptyState>;
  return <div className="stack playground-results">
    <div className="section-heading"><h3>Draft results</h3><StatusBadge status={result.summary.gate} /></div>
    {stale ? <Notice tone="warning"><strong>Results from previous draft.</strong> The YAML has changed since this run. Run the current draft to refresh the evidence.</Notice> : null}
    <SummaryStats summary={result.summary} spec={result.specSnapshot} />
    {result.summary.gateReasons.length ? <div className="playground-result-gate"><strong>Release gate</strong><ul className="validation-list">{result.summary.gateReasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul></div> : null}
    <MetricScorecard summary={result.summary} onMetric={onMetric} />
    <div className="panel"><div className="panel-header"><h3>Trace results</h3><span className="small muted">{result.results.length} traces</span></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Interaction</th><th>Score</th><th>Result</th><th /></tr></thead><tbody>{result.results.map(row => <tr key={row.traceId} className="clickable-row" onClick={() => onTrace(row)}><td><button className="text-link no-underline" type="button" onClick={event => { event.stopPropagation(); onTrace(row); }}>{row.traceName}</button></td><td className="numeric">{scoreLabel(row.score)}</td><td><StatusBadge status={row.unscored ? 'blocked' : row.passed ? 'passed' : 'failed'}>{row.unscored ? 'Unscored' : undefined}</StatusBadge></td><td><ChevronRight size={14} /></td></tr>)}</tbody></table></div></div>
    <div className="inline"><button className="button secondary" type="button" onClick={() => onDownload('html')}><Download size={15} />Draft report</button><button className="button secondary" type="button" onClick={() => onDownload('json')}>JSON evidence</button></div>
    <div className="playground-isolation"><Users size={23} /><div><strong>Continue into human review</strong><p>Save this specification, then run it from Evaluations to create a persistent review queue.</p><button className="text-link no-underline" type="button" onClick={onSaveAndOpen} disabled={!canSave}>Save & open evaluation <ArrowRight size={14} /></button></div></div>
  </div>;
}

export default function Playground({ spec, specs = [], catalog, traces, annotations, onSave, onToast, onNavigate, onSelectSpec }) {
  const baseline = spec.configYaml || specToYaml(spec);
  const [source, setSource] = useState(() => initialDraft(spec, baseline));
  const [compilation, setCompilation] = useState(() => compileYaml(initialDraft(spec, baseline), spec, catalog));
  const [validatedSource, setValidatedSource] = useState(() => initialDraft(spec, baseline));
  const [rightTab, setRightTab] = useState('preview');
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [fileError, setFileError] = useState('');
  const [storageError, setStorageError] = useState(false);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [result, setResult] = useState(null);
  const [resultSource, setResultSource] = useState('');
  const [running, setRunning] = useState(false);
  const [traceDetail, setTraceDetail] = useState(null);
  const editorApi = useRef(null);
  const fileInput = useRef(null);
  const runLock = useRef(false);
  const mounted = useRef(true);
  const dirty = source !== baseline;
  const checking = validatedSource !== source;
  const datasetValidation = useMemo(() => compilation.valid ? validateDataset(traces, compilation.spec) : null, [compilation, traces]);
  const warnings = [...new Set([...(compilation.warnings || []), ...(datasetValidation?.warnings || [])])];
  const canSave = compilation.valid && !checking && !running;
  const canRun = canSave && datasetValidation?.valid;
  const errors = compilation.errors || [];
  const filename = `${(compilation.spec?.name || spec.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'evaluation'}.yml`;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const timer = setTimeout(() => { setCompilation(compileYaml(source, spec, catalog)); setValidatedSource(source); }, 250);
    return () => clearTimeout(timer);
  }, [source, spec, catalog]);
  useEffect(() => {
    try {
      if (new Blob([source]).size > MAX_YAML_BYTES) throw new Error('Draft too large');
      localStorage.setItem(draftKey(spec.id), JSON.stringify({ baseVersion: spec.version, yaml: source }));
      setStorageError(false);
    } catch { setStorageError(true); }
  }, [source, spec.id, spec.version]);

  function validate(text = source, showFeedback = true) {
    const next = compileYaml(text, spec, catalog);
    setCompilation(next); setValidatedSource(text);
    setDiagnosticsOpen(!next.valid);
    if (showFeedback) onToast?.(next.valid ? 'YAML configuration is valid.' : `Found ${next.errors.length} configuration ${next.errors.length === 1 ? 'error' : 'errors'}.`);
    return next;
  }

  function save(text = source, openEvaluation = false) {
    const next = validate(text, false);
    if (!next.valid) { setDiagnosticsOpen(true); return; }
    if (text === baseline) {
      if (openEvaluation) { onNavigate('evaluations'); onToast?.('Run an evaluation to create a persistent review queue.'); }
      else onToast?.('This specification is already saved.');
      return;
    }
    if (onSave(next.spec, text) === false) return;
    if (openEvaluation) { onNavigate('evaluations'); onToast?.('Specification saved. Run an evaluation to create its review queue.'); }
  }

  async function runDraft(text = source) {
    if (runLock.current) return;
    const next = validate(text, false);
    if (!next.valid) { setDiagnosticsOpen(true); setRightTab('preview'); return; }
    const check = validateDataset(traces, next.spec);
    if (!check.valid) { setRightTab('preview'); onToast?.('The dataset needs attention before this draft can run.'); return; }
    runLock.current = true; setRunning(true); setFileError('');
    try {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const evaluation = evaluateRun(traces, { ...next.spec, configYaml: text }, [], { name: `${next.spec.name} · isolated draft` });
      if (!mounted.current) return;
      setResult(evaluation); setResultSource(text); setRightTab('results');
      onToast?.(`Draft complete: ${evaluation.summary.total} traces evaluated. Saved history is unchanged.`);
    } catch (error) { if (mounted.current) setFileError(error.message || 'This draft could not be evaluated.'); }
    finally { runLock.current = false; if (mounted.current) setRunning(false); }
  }

  async function importYaml(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      if (file.size > MAX_YAML_BYTES) throw new Error('Choose a YAML file smaller than 256 KiB.');
      const text = await file.text();
      if (!mounted.current) return;
      setSource(text); setFileError(''); setRightTab('preview'); validate(text, false);
      onToast?.('YAML imported as a draft. Validate before saving.');
    } catch (error) { if (mounted.current) setFileError(error.message || 'Could not read this YAML file.'); }
  }

  function downloadResult(format) {
    if (format === 'html') download(exportReport(result, []), 'tracegrade-draft-report.html', 'text/html;charset=utf-8');
    else download(JSON.stringify({ ...result, sourceYaml: resultSource, isolatedDraft: true }, null, 2), 'tracegrade-draft-results.json');
    onToast?.('Draft evidence downloaded.');
  }

  function inspectResult(row) {
    const trace = result.datasetSnapshot.find(item => item.id === row.traceId);
    if (trace) setTraceDetail({ trace, result: row });
  }

  function focusMetric(metric) {
    const configured = compilation.spec?.metrics.find(item => item.id === metric.id);
    const key = configured?.catalogRef ? 'ref' : 'id';
    const value = configured?.catalogRef?.ref || metric.id;
    const escapedId = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const declaration = new RegExp(`^\\s*(?:-\\s*)?${key}:\\s*(['\"]?)${escapedId}\\1\\s*(?:#.*)?$`);
    const index = source.split(/\r?\n/).findIndex(line => declaration.test(line));
    if (index >= 0) editorApi.current?.goToLine(index + 1);
    else editorApi.current?.focus();
  }

  return <div className="playground-page">
    <div className="section-heading page-heading playground-heading"><div><h1>Evaluation playground</h1><p className="subtext">Define in YAML. Validate against traces. Run with evidence.</p></div><div className="inline playground-actions"><button className="button secondary" type="button" onClick={() => fileInput.current?.click()}><Upload size={17} />Import YAML</button><button className="button secondary" type="button" onClick={() => { download(source, filename, 'application/yaml'); onToast?.('YAML draft exported.'); }}><Download size={17} />Export YAML</button><button className="button primary" type="button" disabled={!canRun} onClick={() => runDraft()}>{running ? <LoaderCircle className="spin" size={17} /> : <Play size={17} />}{running ? 'Evaluating…' : 'Run draft'}</button><input className="sr-only" type="file" ref={fileInput} accept=".yaml,.yml,text/yaml,application/yaml" aria-label="Import evaluation YAML file" onChange={importYaml} /></div></div>
    <div className="playground-toolbar"><div className="inline">{specs.length && onSelectSpec ? <label className="field"><span className="sr-only">Evaluation specification</span><select className="select" value={spec.id} onChange={event => onSelectSpec(event.target.value)}>{specs.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : <strong>{spec.name}</strong>}<span className="badge neutral">v{spec.version}</span><span className={`playground-save-state ${dirty ? 'dirty' : ''}`}>{dirty ? <span className="unsaved-dot" /> : <CheckCircle2 size={18} />} {dirty ? 'Unsaved draft' : 'Saved specification'}</span></div><span className="small muted">Schema v1</span></div>
    {fileError ? <Notice tone="error">{fileError}</Notice> : null}
    {storageError ? <Notice tone="warning">This draft is in memory only. Export the YAML before closing this page.</Notice> : null}
    <div className="playground-layout">
      <section className="playground-editor-panel panel" aria-label="YAML configuration editor">
        <div className="playground-editor-header"><div className="inline"><Code2 size={20} /><strong>evaluation.yml</strong>{dirty ? <span className="unsaved-dot" aria-label="Unsaved changes" /> : null}</div><div className="inline"><button className="icon-button" type="button" title="Reset draft to saved specification" aria-label="Reset draft to saved specification" disabled={!dirty} onClick={() => { setSource(baseline); validate(baseline, false); setFileError(''); }}><RotateCcw size={15} /></button><span className="small muted">YAML</span></div></div>
        <div className="playground-editor-body"><YamlEditor value={source} onChange={setSource} onRun={runDraft} onValidate={text => validate(text)} onSave={text => save(text)} onReady={api => { editorApi.current = api; }} onCursorChange={setCursor} /></div>
        {diagnosticsOpen && errors.length ? <div className="playground-diagnostics"><div className="inline"><strong>{errors.length} configuration {errors.length === 1 ? 'error' : 'errors'}</strong><button className="icon-button" type="button" aria-label="Hide configuration errors" onClick={() => setDiagnosticsOpen(false)}><X size={14} /></button></div>{errors.map((error, index) => <button className="playground-diagnostic" key={index} type="button" onClick={() => editorApi.current?.goToLine(error.line, error.column)}><AlertCircle size={15} /><span><strong>{error.line ? `Line ${error.line}${error.column ? `:${error.column}` : ''}` : error.path || 'Configuration'}{error.line && error.path ? ` · ${error.path}` : ''}</strong><span>{error.message}</span></span></button>)}</div> : null}
        <div className="playground-editor-footer"><button className={`playground-validation-state ${errors.length ? 'invalid' : ''}`} type="button" onClick={() => { validate(source, false); setDiagnosticsOpen(true); }} title={`Line ${cursor.line}, column ${cursor.column}. Esc then Tab moves focus out of the editor.`}>{checking ? <LoaderCircle className="spin" size={17} /> : errors.length ? <AlertCircle size={17} /> : <CheckCircle2 size={17} />}<span>YAML <span className="muted">· v1 schema · {checking ? 'checking…' : `${errors.length} errors`}</span></span></button><div className="inline"><button className="button secondary" type="button" onClick={() => validate()}><Check size={16} />Validate</button><button className="button primary" type="button" disabled={!canSave || !dirty} onClick={() => save()}><Save size={16} />Save specification</button></div></div>
      </section>
      <section className="playground-output-panel panel" aria-label="Evaluation preview and results">
        <div className="playground-output-tabs" role="tablist" aria-label="Playground output">{[['preview', 'Preview'], ['results', 'Results'], ['schema', 'Schema']].map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={rightTab === key} className={rightTab === key ? 'active' : ''} onClick={() => setRightTab(key)}>{label}{key === 'results' && result && source !== resultSource ? <span className="unsaved-dot" aria-label="Results from previous draft" /> : null}</button>)}</div>
        <div className="playground-output-content" role="tabpanel">
          {rightTab === 'preview' ? <>{checking ? <div className="playground-validity"><LoaderCircle size={21} className="spin" /><div><strong>Checking configuration</strong><p>The preview updates as your YAML changes.</p></div></div> : compilation.valid ? <><div className={`playground-validity ${datasetValidation.valid ? 'valid' : 'warning'}`}>{datasetValidation.valid ? <CheckCircle2 size={24} /> : <AlertCircle size={24} />}<div><strong>Configuration valid</strong><p>{datasetValidation.valid ? 'Ready to evaluate the selected traces.' : 'Import or select evidence to satisfy the dataset requirements.'}</p></div></div><PipelinePreview spec={compilation.spec} traces={traces} validation={datasetValidation} result={source === resultSource ? result : null} />{warnings.length ? <details className="playground-notes"><summary>{warnings.length} evaluation {warnings.length === 1 ? 'note' : 'notes'}</summary><ul className="validation-list">{warnings.map((warning, index) => <li key={index}>{typeof warning === 'string' ? warning : warning.message || JSON.stringify(warning)}</li>)}</ul></details> : null}</> : <><div className="playground-validity invalid"><AlertCircle size={23} /><div><strong>Configuration needs attention</strong><p>{errors.length} {errors.length === 1 ? 'error prevents' : 'errors prevent'} a reliable evaluation.</p></div></div><div className="playground-error-list">{errors.map((error, index) => <button className="playground-diagnostic" type="button" key={index} onClick={() => { setDiagnosticsOpen(true); editorApi.current?.goToLine(error.line, error.column); }}><AlertCircle size={15} /><span><strong>{error.line ? `Line ${error.line}` : error.path || 'Configuration'}</strong><span>{error.message}</span></span><ChevronRight size={15} /></button>)}</div></>}</> : null}
          {rightTab === 'results' ? <DraftResults result={result} stale={Boolean(result && source !== resultSource)} onTrace={inspectResult} onMetric={focusMetric} onSaveAndOpen={() => save(source, true)} onDownload={downloadResult} canSave={canSave} /> : null}
          {rightTab === 'schema' ? <div className="stack playground-schema"><div><h3>Configuration schema</h3><p className="subtext small">A versioned contract for guidelines, trace selection, scorers, reviews, and release criteria.</p></div><button className="button secondary align-start" type="button" onClick={() => download(JSON.stringify(configSchema, null, 2), 'tracegrade-evaluation-schema-v1.json')}><Download size={15} />Download JSON schema</button><pre className="code-block">{JSON.stringify(configSchema, null, 2)}</pre>{compilation.valid ? <details><summary>Compiled configuration</summary><pre className="code-block">{JSON.stringify(compilation.config, null, 2)}</pre><button className="button secondary" type="button" onClick={() => download(JSON.stringify(compilation.config, null, 2), 'tracegrade-compiled-configuration.json')}>Export compiled JSON</button></details> : null}</div> : null}
        </div>
      </section>
    </div>
    <div className="playground-footnote"><span>Ln {cursor.line}, Col {cursor.column} · 2-space indentation</span><span>⌘/Ctrl + Enter to run · ⌘/Ctrl + S to save · Esc, then Tab to leave editor</span></div>
    {traceDetail ? <TraceDrawer {...traceDetail} onClose={() => setTraceDetail(null)} /> : null}
  </div>;
}
