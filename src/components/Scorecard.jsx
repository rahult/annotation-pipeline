import { ArrowUpRight, ArrowRight, FileText, Database, Settings2, UserRound, ChartNoAxesCombined, ChevronRight, Check } from 'lucide-react';
import { MetricIcon, StatusBadge, EmptyState } from './ui.jsx';
import { formatValue, runLabel, scoreLabel, timeAgo, dateTime } from '../utils.js';

export function WorkflowStrip({ onNavigate }) {
  const stages = [
    [FileText, 'Extract traces', 'Collect and prepare', 'agent interactions', 'connections'],
    [Database, 'Build dataset', 'Curate and label', 'evaluation dataset', 'dataset'],
    [Settings2, 'Run scorers', 'Evaluate with', 'automated scorers', 'guidelines'],
    [UserRound, 'Human review', 'Review failures', 'and sampled traces', 'annotations'],
    [ChartNoAxesCombined, 'Generate report', 'Summarize results', 'and share insights', 'reports'],
  ];
  return <div className="workflow-strip">{stages.map(([Icon, title, line1, line2, route], i) => <div className="workflow-step-wrap" key={title}><button className="workflow-step" onClick={() => onNavigate(route)}><span className="step-number">{i + 1}</span><Icon size={22} strokeWidth={1.7} /><span><strong>{title}</strong><small>{line1}<br />{line2}</small></span></button>{i < 4 && <ArrowRight className="workflow-arrow" size={18} />}</div>)}</div>;
}

export function SummaryStats({ summary, spec }) {
  return <div className="summary-stats">
    <div className="stat"><span className="stat-label" title="Weighted proportion of observed scorers that passed, averaged across traces">Overall score</span><div className="stat-value">{scoreLabel(summary.score)} <small>/ 100</small></div><span className="stat-note">Across {summary.metricResults?.length || 0} scoring dimensions</span></div>
    <div className="stat"><span className="stat-label">Pass rate</span><div className="stat-value">{scoreLabel(summary.passRate)}<small className="percent">%</small></div><span className="stat-note">{summary.passed} of {summary.total} traces passed</span></div>
    <div className="stat"><span className="stat-label">Evaluated traces</span><div className="stat-value">{summary.total}</div><span className="stat-note">{spec?.dataset.service === 'all' ? 'All services' : spec?.dataset.service || 'Dataset'} · {spec?.dataset.environment || 'all'}</span></div>
    <div className="stat"><span className="stat-label">Pending review</span><div className="stat-value">{summary.pendingReview}</div><span className="stat-note">Failures and sampled traces</span></div>
  </div>;
}

export function MetricScorecard({ summary, onMetric }) {
  return <section className="panel scorecard-panel"><div className="panel-header"><h3>Metric scorecard</h3><span className="small muted">Mean values</span></div><div className="table-wrap"><table className="data-table scorecard-table"><thead><tr><th>Metric</th><th>Score</th><th>Target</th><th title="Compares the mean with the target. Individual failures still affect the release gate.">Mean result</th></tr></thead><tbody>{(summary.metricResults || []).map(metric => <tr key={metric.id}><td><button className="metric-link" onClick={() => onMetric?.(metric)}><MetricIcon id={metric.id} /><span>{metric.name}</span></button></td><td className="numeric">{formatValue(metric.value, metric.unit)}</td><td className="numeric muted">{metric.operator === 'lte' ? '≤' : '≥'} {formatValue(metric.threshold, metric.unit)}</td><td><StatusBadge status={!metric.scoredCount || metric.scoredCount < metric.total ? 'blocked' : metric.passed ? 'passed' : 'failed'}>{!metric.scoredCount ? 'Unscored' : metric.scoredCount < metric.total ? `${metric.scoredCount}/${metric.total} scored` : metric.passed ? 'Passed' : 'Below target'}</StatusBadge></td></tr>)}</tbody></table></div></section>;
}

export function EvaluationTrend({ runs, target = 85 }) {
  const points = [...runs].slice(0, 5).reverse().filter(run => run.summary.score != null);
  const left = 42, top = 22, width = 430, height = 160;
  const floor = Math.max(0, Math.floor(Math.min(60, ...points.map(r => r.summary.score)) / 10) * 10);
  const max = 100;
  const getX = index => left + (points.length <= 1 ? width / 2 : index / (points.length - 1) * width);
  const getY = value => top + (max - value) / (max - floor || 1) * height;
  const ticks = Array.from({ length: 5 }, (_, i) => max - i * (max - floor) / 4);
  return <section className="panel trend-panel"><div className="trend-heading"><h3>Evaluation trend</h3><p className="small muted">Last {points.length} runs</p></div>{points.length ? <><svg viewBox="0 0 500 223" className="trend-chart" role="img" aria-label={`Overall scores for ${points.length} runs: ${points.map(r => scoreLabel(r.summary.score)).join(', ')}`}>
    {ticks.map(value => <g key={value}><line x1={left} x2={left + width} y1={getY(value)} y2={getY(value)} stroke="#e5ebed" /><text x={left - 12} y={getY(value) + 4} textAnchor="end">{Math.round(value)}</text></g>)}
    {points.map((run, i) => <g key={run.id}><line x1={getX(i)} x2={getX(i)} y1={top} y2={top + height} stroke="#edf1f3" /><text x={getX(i)} y={top + height + 23} textAnchor="middle">{runLabel(run).replace('RUN-', '').slice(-3)}</text></g>)}
    <polyline points={points.map((run, i) => `${getX(i)},${getY(run.summary.score)}`).join(' ')} fill="none" stroke="#007f7c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    {points.map((run, i) => <circle key={run.id} cx={getX(i)} cy={getY(run.summary.score)} r="4.5" fill="#007f7c"><title>{runLabel(run)}: {scoreLabel(run.summary.score)}</title></circle>)}
    </svg><div className="chart-legend"><span><i />Overall score</span><span className="muted small">From versioned run snapshots</span></div></> : <EmptyState title="Your trend starts here">Run an evaluation to see quality over time.</EmptyState>}</section>;
}

export function RunsTable({ runs, onSelect, limit, showVersion = false }) {
  if (!runs.length) return <EmptyState title="No runs yet">Your first run will freeze the dataset, execute scorers, and create a scorecard.</EmptyState>;
  return <div className="table-wrap"><table className="data-table runs-table"><thead><tr><th>Run</th><th>Dataset</th>{showVersion && <th>Guidelines</th>}<th>Score</th><th>Pass rate</th><th>Status</th><th>Started</th><th aria-label="Open run" /></tr></thead><tbody>{runs.slice(0, limit || runs.length).map(run => <tr key={run.id} onClick={() => onSelect(run)} className="clickable-row"><td><button className="text-link" onClick={event => { event.stopPropagation(); onSelect(run); }}>{runLabel(run)}</button></td><td>{run.specSnapshot?.dataset.service || 'Traces'} · {run.summary.total} traces</td>{showVersion && <td><span className="badge neutral">v{run.specVersion}</span></td>}<td className="numeric">{scoreLabel(run.summary.score)}</td><td className="numeric">{scoreLabel(run.summary.passRate)}%</td><td><StatusBadge status={run.summary.gate} /></td><td className="muted" title={dateTime(run.startedAt)}>{timeAgo(run.startedAt)}</td><td><ChevronRight size={15} className="muted" /></td></tr>)}</tbody></table></div>;
}

export function EvaluationOverview({ spec, runs, onNavigate, onSelectRun, onRun }) {
  const latest = runs[0];
  return <><WorkflowStrip onNavigate={onNavigate} />{latest ? <><div className="latest-heading"><div className="inline"><h2>Latest evaluation</h2><span className="small muted">{runLabel(latest)} · {timeAgo(latest.startedAt)}</span><StatusBadge status={latest.summary.gate} /></div><button className="text-link no-underline" onClick={() => onSelectRun(latest)}>View report <ArrowRight size={19} /></button></div><SummaryStats summary={latest.summary} spec={latest.specSnapshot} /><div className="scorecard-layout"><MetricScorecard summary={latest.summary} onMetric={() => onNavigate('guidelines')} /><EvaluationTrend runs={runs} target={spec.passThreshold} /></div><section className="panel recent-panel"><div className="panel-header"><h3>Recent runs</h3>{runs.length > 3 && <button className="text-link small no-underline" onClick={() => onNavigate('runs')}>View all runs <ArrowUpRight size={14} /></button>}</div><RunsTable runs={runs} limit={3} onSelect={onSelectRun} /></section></> : <EmptyState title="Your evaluation is ready to run" action={<button className="button primary" onClick={onRun}>Run first evaluation</button>}>Define your requirements, select your traces, then create your first scorecard.</EmptyState>}</>;
}
