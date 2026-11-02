import { useMemo, useState } from 'react';
import { Check, CheckCheck, ChevronRight, ClipboardCheck, MessageSquare, Save, SkipForward, UserRound } from 'lucide-react';
import { TraceDetail } from '../components/TraceDrawer.jsx';
import { EmptyState, StatusBadge } from '../components/ui.jsx';
import { dateTime, runLabel } from '../utils.js';

export default function Annotations({ runs, annotations, selectedRunId, onSelectRun, onAnnotate, onToast }) {
  const run = runs.find(item => item.id === selectedRunId) || runs[0];
  const [filter, setFilter] = useState('pending');
  const [selectedId, setSelectedId] = useState('');
  const latestAnnotations = useMemo(() => {
    const map = new Map();
    [...annotations].filter(item => item.runId === run?.id).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).forEach(item => map.set(item.traceId, item));
    return map;
  }, [annotations, run?.id]);
  if (!run) return <EmptyState icon={ClipboardCheck} title="The review queue is empty">Run an evaluation to queue failures and quality checks for human review.</EmptyState>;
  const reviewItems = run.results.filter(item => item.needsReview);
  const items = reviewItems.filter(item => {
    const completed = ['accepted', 'rejected'].includes(latestAnnotations.get(item.traceId)?.verdict);
    return filter === 'all' || (filter === 'completed' ? completed : !completed);
  });
  const selected = items.find(item => item.traceId === selectedId) || items[0];
  const trace = run.datasetSnapshot.find(item => item.id === selected?.traceId);
  const pending = reviewItems.filter(item => !['accepted', 'rejected'].includes(latestAnnotations.get(item.traceId)?.verdict)).length;
  function save(annotation) {
    onAnnotate({ ...annotation, runId: run.id, traceId: selected.traceId });
    const index = items.findIndex(item => item.traceId === selected.traceId);
    setSelectedId(items[index + 1]?.traceId || items[index - 1]?.traceId || '');
    onToast(annotation.verdict === 'needs_work' ? 'Follow-up note saved. This trace remains in review.' : 'Annotation saved. Automated scores are preserved.');
  }
  return <div className="stack"><div className="section-heading"><div><h1>Human review</h1><p className="subtext">Add judgment to the evidence. Keep every decision accountable.</p></div><label className="field inline-select"><span className="sr-only">Run to review</span><select className="select" value={run.id} onChange={event => { onSelectRun(runs.find(item => item.id === event.target.value)); setSelectedId(''); }}>{runs.map(item => <option key={item.id} value={item.id}>{runLabel(item)} · {item.specName}</option>)}</select></label></div>
    <div className="review-summary"><ClipboardCheck size={22} /><strong>{pending} pending</strong><span className="muted">of {reviewItems.length} queued traces</span><div className="review-progress"><span style={{ width: `${reviewItems.length ? (reviewItems.length - pending) / reviewItems.length * 100 : 100}%` }} /></div><span className="small muted">{reviewItems.length - pending} reviewed</span><StatusBadge status={run.summary.gate} /></div>
    <div className="review-layout"><aside className="panel review-queue"><div className="panel-header"><h3>Review queue</h3></div><div className="segmented-control">{[['pending', 'Pending'], ['completed', 'Reviewed'], ['all', 'All']].map(([key, label]) => <button key={key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}>{label}</button>)}</div><div className="queue-list">{items.length ? items.map(item => { const annotation = latestAnnotations.get(item.traceId); return <button className={`queue-item ${selected?.traceId === item.traceId ? 'selected' : ''}`} key={item.traceId} onClick={() => setSelectedId(item.traceId)}><div className="inline"><span className={`score-dot ${item.passed ? 'success' : item.unscored ? 'neutral' : 'danger'}`} /><strong>{item.traceName}</strong><ChevronRight size={14} /></div><span className="small muted">{item.reviewReason || 'Quality review'}</span><div className="queue-tags">{annotation ? <StatusBadge status={annotation.verdict} /> : <span className="badge neutral">Not reviewed</span>}<span className="small muted">{item.scores.filter(score => score.pass === false).length} failed checks</span></div></button>; }) : <div className="queue-empty"><CheckCheck size={28} /><p>{filter === 'pending' ? 'All queued traces reviewed.' : 'No traces in this view.'}</p></div>}</div></aside>
      <section className="panel review-detail">{trace && selected ? <><TraceDetail key={`${run.id}-${selected.traceId}`} trace={trace} result={selected} /><AnnotationForm key={`${run.id}-${selected.traceId}-${latestAnnotations.get(selected.traceId)?.id || 'new'}`} annotation={latestAnnotations.get(selected.traceId)} guidelines={run.specSnapshot.guidelines} onSave={save} /></> : <EmptyState icon={CheckCheck} title={pending === 0 ? 'Review complete' : 'Select a trace'}>{pending === 0 ? 'Human judgments are recorded separately. Check the scorecard for the automatic release decision.' : 'Choose an interaction from the queue to inspect its evidence.'}</EmptyState>}</section>
    </div>
  </div>;
}

function AnnotationForm({ annotation, guidelines, onSave }) {
  const [verdict, setVerdict] = useState(annotation?.verdict || 'accepted');
  const [note, setNote] = useState(annotation?.note || '');
  const [error, setError] = useState('');
  return <form className="annotation-form" onSubmit={event => { event.preventDefault(); if (note.trim().length < 3) { setError('Add a meaningful rationale of at least three characters.'); return; } setError(''); onSave({ verdict, note: note.trim(), reviewer: 'Product reviewer' }); }}><div className="section-heading"><h3><MessageSquare size={18} /> Your assessment</h3>{annotation && <span className="small muted">Last reviewed {dateTime(annotation.createdAt)}</span>}</div><details className="review-guidelines"><summary>Review against {guidelines.length} product guidelines</summary>{guidelines.map(item => <div key={item.id}><strong>{item.title}</strong><p className="small muted">{item.description}</p></div>)}</details><div className="verdict-options">{[['accepted', 'Accept', 'The behavior is acceptable'], ['needs_work', 'Needs follow-up', 'Keep this trace in review'], ['rejected', 'Reject', 'The behavior is unacceptable']].map(([value, label, hint]) => <label className={verdict === value ? 'selected' : ''} key={value}><input type="radio" name="verdict" value={value} checked={verdict === value} onChange={() => setVerdict(value)} /><span><strong>{label}</strong><small>{hint}</small></span></label>)}</div><label className="field"><span className="field-label">Rationale</span><textarea className="textarea" value={note} onChange={event => setNote(event.target.value)} rows={3} required minLength={3} maxLength={3000} placeholder="What did you observe? Reference the evidence or guideline behind your decision." /></label>{error && <p className="field-hint" role="alert">{error}</p>}<div className="form-actions"><span className="small muted"><UserRound size={14} />Product reviewer · verdicts do not overwrite automated scores</span><button className="button primary" type="submit"><Save size={16} />Save annotation</button></div></form>;
}
