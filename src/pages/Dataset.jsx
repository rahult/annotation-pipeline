import { useMemo, useRef, useState } from 'react';
import { Upload, Database, Search, Save, Download, ChevronRight, SlidersHorizontal, CheckCircle2, AlertCircle, FileJson, Filter } from 'lucide-react';
import { filterTraces, validateDataset } from '../domain.js';
import { normalizeTraceInput } from '../traceProfiles.js';
import { clone, download, formatValue, timeAgo } from '../utils.js';
import { EmptyState, Notice } from '../components/ui.jsx';
import TraceProfileSelector from '../components/TraceProfileSelector.jsx';

function editableDataset(dataset) {
  const draft = clone(dataset);
  for (const field of ['startDate', 'endDate']) {
    if (!draft[field]) continue;
    const date = new Date(draft[field]);
    if (!Number.isFinite(date.getTime())) continue;
    const pad = value => String(value).padStart(2, '0');
    draft[field] = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  return draft;
}

export default function Dataset({ spec, traces, importNotes = [], onSave, onImport, onTrace, onToast, onNavigate }) {
  const [draft, setDraft] = useState(() => editableDataset(spec.dataset));
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const fileInput = useRef(null);
  const draftSpec = useMemo(() => ({ ...spec, dataset: { ...draft, sampleSize: Number(draft.sampleSize), minSamples: Number(draft.minSamples) } }), [spec, draft]);
  const selected = useMemo(() => filterTraces(traces, draftSpec), [traces, draftSpec]);
  const validation = useMemo(() => validateDataset(traces, draftSpec), [traces, draftSpec]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(editableDataset(spec.dataset));
  const services = [...new Set(traces.filter(trace => trace.source === draft.source).map(trace => trace.service))].sort();
  const environments = [...new Set(traces.filter(trace => trace.source === draft.source).map(trace => trace.environment).filter(Boolean))].sort();
  const visible = selected.filter(trace => (status === 'all' || trace.status === status) && `${trace.name} ${trace.input} ${trace.traceId} ${trace.model}`.toLowerCase().includes(query.toLowerCase()));
  const update = (key, value) => setDraft(previous => ({ ...previous, [key]: value }));
  function setNormalization(normalization) {
    setDraft(previous => {
      const next = { ...previous };
      if (normalization) next.normalization = normalization;
      else delete next.normalization;
      return next;
    });
  }
  function save(event) {
    event.preventDefault();
    if (!Number.isInteger(Number(draft.sampleSize)) || Number(draft.sampleSize) < 1 || Number(draft.sampleSize) > 1000) { setError('Set the sample size to a whole number between 1 and 1,000.'); return; }
    if (!Number.isInteger(Number(draft.minSamples)) || Number(draft.minSamples) < 1 || Number(draft.minSamples) > Number(draft.sampleSize)) { setError('Minimum required must be between 1 and the sample size.'); return; }
    if (draft.startDate && draft.endDate && Date.parse(draft.startDate) > Date.parse(draft.endDate)) { setError('The start of your time window must precede the end.'); return; }
    setError('');
    const savedDataset = { ...draftSpec.dataset };
    for (const field of ['startDate', 'endDate']) if (savedDataset[field]) savedDataset[field] = new Date(savedDataset[field]).toISOString();
    onSave({ ...draftSpec, dataset: savedDataset });
  }
  async function loadFile(file) {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { setError('Choose a JSON export smaller than 8 MiB.'); return; }
    setImporting(true);
    try {
      const mapping = { profileId: draft.normalization?.profile ?? 'auto', profileVersion: draft.normalization?.version };
      const imported = normalizeTraceInput(await file.text(), mapping);
      if (!imported.traces?.length) throw new Error('No trace records were found in this export.');
      await onImport(imported);
      setDraft(previous => ({ ...previous, source: 'import', service: 'all', environment: 'all' }));
      setError('');
      onToast(`${imported.traces.length} traces imported. Save the dataset selection to evaluate them.`);
    } catch (err) { setError(err.message || 'Could not read this trace export.'); }
    finally { setImporting(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  return <div className="stack">
    <div className="section-heading"><div><h2>Build your evaluation dataset</h2><p className="subtext">Select the interactions and evidence your evaluation requires.</p></div><div className="inline"><button className="button secondary" onClick={() => fileInput.current?.click()} disabled={importing}><Upload size={16} />{importing ? 'Importing…' : 'Import traces'}</button><input ref={fileInput} type="file" accept=".json,application/json" className="sr-only" aria-label="Import trace JSON file" onChange={event => loadFile(event.target.files[0])} /></div></div>
    <div className="dataset-source-bar"><div className="source-icon"><Database size={24} /></div><div><strong>{draft.source === 'demo' ? 'Sample agent traces' : 'Imported trace snapshots'}</strong><p className="small muted">{traces.filter(trace => trace.source === draft.source).length} available traces · {draft.source === 'demo' ? 'Synthetic support interactions with recorded judgments' : 'Local JSON exports from your observability platform'}</p></div><button className="text-link no-underline" onClick={() => onNavigate('connections')}>Manage source <ChevronRight size={17} /></button></div>
    <div className="dataset-layout"><form className="panel dataset-requirements" onSubmit={save}><div className="panel-header"><h3><SlidersHorizontal size={17} /> Requirements</h3>{dirty && <span className="badge warning">Unsaved</span>}</div><div className="panel-body stack">
      <label className="field"><span className="field-label">Trace source</span><select className="select" value={draft.source} onChange={event => setDraft(previous => ({ ...previous, source: event.target.value, service: 'all', environment: 'all' }))}><option value="demo">Demo workspace</option><option value="import">Imported traces</option></select></label>
      {draft.scenarioId ? <Notice><div><strong>Synthetic fixture filter</strong><p className="small">Only traces marked synthetic with scenario <code>{draft.scenarioId}</code> are eligible, in addition to the service, environment, and time filters.</p><p className="field-hint">Declared in YAML as dataset.filters.scenario. Ordinary imported traces are excluded from this example.</p></div></Notice> : null}
      <TraceProfileSelector value={draft.normalization} onChange={setNormalization} disabled={importing} />
      <p className="field-hint">File imports use this draft mapping now. Save dataset to include it in evaluation YAML and command-line imports.</p>
      <label className="field"><span className="field-label">Service</span><select className="select" value={draft.service} onChange={event => update('service', event.target.value)}><option value="all">All services</option>{[...new Set([...services, draft.service].filter(value => value !== 'all'))].map(service => <option key={service}>{service}</option>)}</select></label>
      <label className="field"><span className="field-label">Environment</span><select className="select" value={draft.environment} onChange={event => update('environment', event.target.value)}><option value="all">All environments</option>{[...new Set([...environments, draft.environment].filter(value => value !== 'all'))].map(environment => <option key={environment}>{environment}</option>)}</select></label>
      <div className="form-grid"><label className="field"><span className="field-label">Sample size</span><input className="input" type="number" value={draft.sampleSize} min={1} max={1000} required onChange={event => update('sampleSize', event.target.value)} /></label><label className="field"><span className="field-label">Minimum required</span><input className="input" type="number" value={draft.minSamples} min={1} max={draft.sampleSize || 1000} required onChange={event => update('minSamples', event.target.value)} /></label></div>
      <label className="field"><span className="field-label">Selection strategy</span><select className="select" value={draft.selection} onChange={event => update('selection', event.target.value)}><option value="recent">Most recent first</option><option value="errors_first">Errors first</option></select></label>
      <details className="time-window"><summary>Time window <span className="muted small">optional</span></summary><div className="stack"><label className="field"><span className="field-label">From (local time)</span><input className="input" type="datetime-local" value={draft.startDate || ''} onChange={event => update('startDate', event.target.value)} /></label><label className="field"><span className="field-label">Until (local time)</span><input className="input" type="datetime-local" value={draft.endDate || ''} onChange={event => update('endDate', event.target.value)} /></label></div></details>
      <div className="divider" /><div className="stack compact"><span className="field-label">Required evidence</span>{[['requireInput', 'User input'], ['requireOutput', 'Agent response'], ['requireContext', 'Retrieved context']].map(([key, label]) => <label className="check-row" key={key}><input type="checkbox" checked={draft[key]} onChange={event => update(key, event.target.checked)} /><span>{label}</span></label>)}<p className="field-hint">Missing required evidence blocks the run.</p></div>
      {error && <Notice tone="error">{error}</Notice>}
      <button className="button primary full-width" type="submit" disabled={!dirty || importing}><Save size={16} />Save dataset</button>
    </div></form><div className="stack dataset-preview"><div className={`dataset-validation ${validation.valid ? 'valid' : 'invalid'}`}>{validation.valid ? <CheckCircle2 size={19} /> : <AlertCircle size={19} />}<div><strong>{validation.valid ? `${validation.eligibleCount} traces ready to evaluate` : 'Dataset requirements need attention'}</strong><p className="small">{validation.valid ? `${validation.matchedCount} matching traces · ${selected.length} selected · minimum ${draft.minSamples}` : validation.errors.join(' ')}</p></div></div>
      <section className="panel"><div className="panel-header"><h3>Trace preview <span className="count-label">{visible.length}</span></h3><button className="button ghost" disabled={!selected.length} onClick={() => { download(JSON.stringify(selected, null, 2), 'tracegrade-dataset-snapshot.json'); onToast('Dataset snapshot exported.'); }}><Download size={15} />Export</button></div><div className="filter-bar"><label className="search-field"><Search size={16} /><input aria-label="Search traces" placeholder="Search inputs, trace IDs, models…" value={query} onChange={event => setQuery(event.target.value)} /></label><select className="select filter-select" aria-label="Filter trace status" value={status} onChange={event => setStatus(event.target.value)}><option value="all">All statuses</option><option value="ok">Completed</option><option value="error">Errors</option><option value="unknown">Unknown</option></select></div>
        {visible.length ? <div className="table-wrap"><table className="data-table traces-table"><thead><tr><th>Interaction</th><th>Status</th><th>Duration</th><th>Spans</th><th>Started</th><th /></tr></thead><tbody>{visible.map(trace => <tr key={trace.id} className="clickable-row" onClick={() => onTrace(trace)}><td><button className="trace-name-button" onClick={event => { event.stopPropagation(); onTrace(trace); }}><strong>{trace.name}</strong><span>{trace.input || 'No input recorded'}</span></button></td><td><span className={`badge ${trace.status === 'error' ? 'danger' : trace.status === 'ok' ? 'success' : 'neutral'}`}>{trace.status === 'error' ? 'Error' : trace.status === 'ok' ? 'Completed' : 'Unknown'}</span></td><td className="numeric">{formatValue(trace.durationMs, 'ms')}</td><td className="numeric">{trace.spans?.length || 0}</td><td className="small muted">{timeAgo(trace.startedAt)}</td><td><ChevronRight size={15} /></td></tr>)}</tbody></table></div> : <EmptyState icon={Database} title={draft.source === 'import' ? 'Bring your traces into view' : 'No traces match'} action={draft.source === 'import' ? <button className="button secondary" onClick={() => fileInput.current?.click()}><Upload size={15} />Import JSON export</button> : null}>{query || status !== 'all' ? 'Try a different search or status filter.' : draft.source === 'import' ? 'Import an OTLP JSON export or normalized trace array, then select your cohort.' : 'Adjust the service, environment, or time window.'}</EmptyState>}
      </section><p className="small muted"><FileJson size={14} /> Each run stores its own dataset snapshot. Importing new traces never changes historical results.</p>{draft.source === 'import' && importNotes.length > 0 && <Notice tone="warning"><details open><summary>{importNotes.length} notes from the latest import</summary><ul className="validation-list">{importNotes.map((note, index) => <li key={index}>{note}</li>)}</ul></details></Notice>}{validation.warnings.length > 0 && <Notice>{validation.warnings.join(' ')}</Notice>}
    </div></div>
  </div>;
}
