import { useEffect, useState } from 'react';
import { ArrowRight, ChevronDown, ChevronRight, Code2, Download, FileBarChart, FileJson, FileSpreadsheet, Search, ShieldCheck, Users } from 'lucide-react';
import { exportCSV, exportReport } from '../domain.js';
import { SummaryStats, MetricScorecard } from '../components/Scorecard.jsx';
import { StatusBadge, EmptyState, Notice } from '../components/ui.jsx';
import { dateTime, download, formatValue, runLabel, scoreLabel } from '../utils.js';

function traceStatus(result) {
  if (result.unscored || result.scores?.some(score => score.pass === null)) return 'unscored';
  return result.passed ? 'passed' : 'failed';
}

function latestAnnotationMap(annotations, runId) {
  const latest = new Map();
  for (const annotation of annotations) {
    if (annotation.runId !== runId) continue;
    const previous = latest.get(annotation.traceId);
    if (!previous || new Date(annotation.createdAt).getTime() >= new Date(previous.createdAt).getTime()) latest.set(annotation.traceId, annotation);
  }
  return latest;
}

function reviewComplete(annotation) {
  return annotation?.verdict === 'accepted' || annotation?.verdict === 'rejected';
}

function TraceEvidence({ run, annotations, onTrace }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const latest = latestAnnotationMap(annotations, run.id);
  const traces = new Map((run.datasetSnapshot || []).map(trace => [trace.id, trace]));
  const normalizedQuery = query.trim().toLowerCase();
  const results = (run.results || []).filter(result => {
    const trace = traces.get(result.traceId);
    const matchesSearch = !normalizedQuery || [result.traceName, result.traceId, trace?.input, trace?.output, trace?.model].some(value => String(value || '').toLowerCase().includes(normalizedQuery));
    const matchesStatus = status === 'all' || (status === 'review' ? result.needsReview && !reviewComplete(latest.get(result.traceId)) : traceStatus(result) === status);
    return matchesSearch && matchesStatus;
  });

  return (
    <section className="panel report-evidence">
      <div className="panel-header"><div><h3>Trace-level evidence</h3><p className="subtext small">Open an interaction to inspect its spans, scores, and reasoning.</p></div><span className="badge neutral">{run.results.length} traces</span></div>
      <div className="filter-bar">
        <label className="search-field" htmlFor="report-search"><Search size={17} /><input id="report-search" type="search" placeholder="Search traces, inputs, or responses…" value={query} onChange={event => setQuery(event.target.value)} aria-label="Search trace evidence" /></label>
        <label className="field report-filter" htmlFor="report-status"><span className="sr-only">Filter trace results</span><select className="select" id="report-status" value={status} onChange={event => setStatus(event.target.value)}><option value="all">All results</option><option value="passed">Passed</option><option value="failed">Failed</option><option value="unscored">Unscored</option><option value="review">Pending review</option></select></label>
        <span className="small muted">{results.length} of {run.results.length}</span>
      </div>
      {results.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Interaction</th><th>Score</th><th>Result</th><th>Latency</th><th>Review</th><th aria-label="Inspect trace" /></tr></thead><tbody>{results.map(result => {
        const trace = traces.get(result.traceId);
        const annotation = latest.get(result.traceId);
        const resultStatus = traceStatus(result);
        return <tr className={trace ? 'clickable-row' : ''} key={result.traceId} onClick={() => trace && onTrace(trace, result)}>
          <td><button className="result-name text-link no-underline" type="button" disabled={!trace} onClick={event => { event.stopPropagation(); if (trace) onTrace(trace, result); }}>{result.traceName || trace?.name || result.traceId}</button><div className="small muted trace-id">{trace?.traceId || result.traceId}</div></td>
          <td className="numeric">{scoreLabel(result.score)}<span className="small muted"> / 100</span></td>
          <td><StatusBadge status={resultStatus === 'unscored' ? 'blocked' : resultStatus}>{resultStatus === 'unscored' ? 'Unscored' : undefined}</StatusBadge></td>
          <td className="numeric">{formatValue(trace?.durationMs, 'ms')}</td>
          <td>{annotation ? <StatusBadge status={annotation.verdict} /> : result.needsReview ? <StatusBadge status="pending" /> : <span className="small muted">Not required</span>}</td>
          <td><ChevronRight size={15} className="muted" /></td>
        </tr>;
      })}</tbody></table></div> : <EmptyState icon={Search} title={run.results.length ? 'No matching interactions' : 'No traces were scored'}>{run.results.length ? 'Try another search or result filter.' : 'This run was blocked during validation. Resolve the release-gate requirements and create another run.'}</EmptyState>}
    </section>
  );
}

export default function Reports({ runs, annotations, selectedRunId, onSelectRun, onTrace, onNavigate, onToast }) {
  const [localRunId, setLocalRunId] = useState(() => selectedRunId || runs[0]?.id);
  const [showSnapshot, setShowSnapshot] = useState(false);
  const [exportError, setExportError] = useState('');
  const run = runs.find(item => item.id === (selectedRunId || localRunId)) || runs[0];
  useEffect(() => { setShowSnapshot(false); setExportError(''); }, [run?.id]);

  if (!run) return <EmptyState icon={FileBarChart} title="Your first report starts with an evaluation" action={<button className="button primary" type="button" onClick={() => onNavigate('guidelines')}>Configure evaluation <ArrowRight size={16} /></button>}>Define your guidelines and dataset, then run an evaluation to generate a versioned scorecard and trace-level evidence.</EmptyState>;

  const summary = run.summary;
  const runAnnotations = annotations.filter(annotation => annotation.runId === run.id);
  const filename = `tracegrade-${runLabel(run).toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
  const gateReasons = summary.gateReasons || [];
  const gateTitles = { passed: 'Release criteria met', failed: 'Release criteria not met', blocked: 'More evidence is required', review: 'Ready for human review' };

  function exportFile(format) {
    try {
      if (format === 'html') download(exportReport(run, annotations), `${filename}.html`, 'text/html;charset=utf-8');
      if (format === 'csv') download(exportCSV(run), `${filename}.csv`, 'text/csv;charset=utf-8');
      if (format === 'json') download(JSON.stringify({ ...run, status: summary.gate, annotations: runAnnotations }, null, 2), `${filename}.json`, 'application/json');
      setExportError('');
      onToast?.(`${format.toUpperCase()} report downloaded.`);
    } catch (error) {
      setExportError(`The report could not be exported: ${error.message || 'Please try again.'}`);
    }
  }

  return (
    <div className="stack report-body">
      <div className="section-heading report-heading"><div><h2>Evaluation report</h2><p className="subtext">{run.specName} · specification v{run.specVersion} · {dateTime(run.startedAt)}</p></div><StatusBadge status={summary.gate} /></div>
      <div className="report-toolbar">
        <label className="field report-run-selector" htmlFor="report-run"><span className="sr-only">Select evaluation run</span><select className="select" id="report-run" value={run.id} onChange={event => { const next = runs.find(item => item.id === event.target.value); if (next) { setLocalRunId(next.id); onSelectRun?.(next); } }}>{runs.map(item => <option value={item.id} key={item.id}>{runLabel(item)} · v{item.specVersion} · {dateTime(item.startedAt)}</option>)}</select></label>
        <div className="inline report-export-actions"><button className="button secondary" type="button" onClick={() => exportFile('csv')}><FileSpreadsheet size={16} /> CSV</button><button className="button secondary" type="button" onClick={() => exportFile('json')}><FileJson size={16} /> JSON</button><button className="button primary" type="button" onClick={() => exportFile('html')}><Download size={16} /> Download report</button></div>
      </div>
      {exportError ? <Notice tone="error">{exportError}</Notice> : null}
      <SummaryStats summary={summary} spec={run.specSnapshot} />

      <section className="panel report-gate">
        <div className="panel-header"><h3><ShieldCheck size={18} /> {gateTitles[summary.gate] || 'Release decision'}</h3>{summary.pendingReview > 0 ? <button className="button secondary" type="button" onClick={() => onNavigate('annotations')}><Users size={16} /> Review {summary.pendingReview} traces <ArrowRight size={15} /></button> : <span className="badge neutral">{summary.reviewed || 0} reviewed</span>}</div>
        <div className="panel-body">
          {gateReasons.length ? <ul className="gate-reasons">{gateReasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul> : <p className="subtext">All automatic checks and required human reviews have passed.</p>}
          <p className="small muted">Required trace pass rate: {run.specSnapshot.passThreshold}%. Critical failures: {summary.criticalFailures || 0}. Unscored traces: {summary.unscored || 0}. Reviewer verdicts never overwrite automatic scores.</p>
        </div>
      </section>

      <MetricScorecard summary={summary} onMetric={() => onNavigate('guidelines')} />
      <p className="small muted report-method">Metric values are means; each trace is evaluated against its threshold separately. The release gate uses the trace pass rate, critical failures, evidence coverage, and required reviews. {run.synthetic ? 'This scenario uses synthetic traces and supplied example judgments; no production agent was measured.' : run.demo ? 'Semantic scores in this run are recorded demo judgments.' : 'Semantic judgments are included only when supplied with evaluator provenance.'}</p>

      <TraceEvidence key={run.id} run={run} annotations={annotations} onTrace={onTrace} />

      <section className="panel snapshot-panel">
        <button className="snapshot-toggle" type="button" onClick={() => setShowSnapshot(previous => !previous)} aria-expanded={showSnapshot} aria-controls="report-spec-snapshot"><span className="inline"><Code2 size={18} /><strong>Specification snapshot</strong><span className="badge neutral">v{run.specVersion}</span></span>{showSnapshot ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</button>
        {showSnapshot ? <div className="panel-body" id="report-spec-snapshot"><p className="subtext small">This is the immutable configuration used by this run. Changes to current guidelines do not affect this snapshot.</p><pre className="code-block">{JSON.stringify(run.specSnapshot, null, 2)}</pre></div> : null}
      </section>
    </div>
  );
}
