import { useState } from 'react';
import { AlertCircle, BookOpen, Check, ChevronRight, Plus, Save, ShieldCheck, SlidersHorizontal, Trash2 } from 'lucide-react';
import { clone } from '../utils.js';
import { makeId } from '../domain.js';

function NumberField({ id, label, value, onChange, min = 0, max, step = 'any', hint }) {
  return (
    <label className="field" htmlFor={id}>
      <span className="field-label">{label}</span>
      <input className="input" id={id} type="number" min={min} max={max} step={step} value={value} onChange={event => onChange(event.target.value)} required />
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

function MetricEditor({ metric, onChange, onRemove }) {
  const semantic = ['demo_judge', 'recorded_judgment'].includes(metric.kind);
  const pinned = Boolean(metric.catalogRef);
  const attribute = metric.kind === 'attribute';
  const prefix = `metric-${metric.id}`;
  const max = metric.unit === 'percent' ? 100 : metric.unit === 'score' ? 1 : undefined;
  const unitLabel = { ms: 'ms', usd: 'USD', percent: '%', score: '0–1' }[metric.unit] || metric.unit;

  return (
    <section className={`metric-config ${metric.enabled ? '' : 'metric-disabled'}`} aria-label={`${metric.name} configuration`}>
      <div className="metric-config-heading">
        <div className="inline">
          <label className="check-row metric-enable">
            <input type="checkbox" checked={metric.enabled} onChange={event => onChange({ enabled: event.target.checked })} aria-label={`Enable ${metric.name}`} />
            <strong>{metric.name}</strong>
          </label>
          <span className={`badge ${semantic ? 'neutral' : 'teal'}`}>{semantic ? 'Recorded judgment' : attribute ? 'Trace attribute' : 'Deterministic'}</span>
        </div>
        {onRemove ? <button className="icon-button" type="button" aria-label={`Remove ${metric.name}`} onClick={onRemove}><Trash2 size={16} /></button> : null}
      </div>
      <p className="subtext metric-description">{metric.description}</p>{pinned && <p className="small muted"><strong>{metric.catalogRef.ref}@{metric.catalogRef.version}</strong> · Definition pinned in the scorer catalog. Thresholds, weights, and release rules remain editable here.</p>}
      {attribute ? <div className="form-grid three">
        <label className="field" htmlFor={`${prefix}-name`}><span className="field-label">Metric name</span><input className="input" id={`${prefix}-name`} disabled={pinned} value={metric.name} required maxLength={120} onChange={event => onChange({ name: event.target.value })} /></label>
        <label className="field" htmlFor={`${prefix}-attribute`}><span className="field-label">Trace attribute key</span><input className="input" id={`${prefix}-attribute`} disabled={pinned} value={metric.attributeKey || ''} required maxLength={250} placeholder="eval.safety_score" onChange={event => onChange({ attributeKey: event.target.value })} /><span className="field-hint">Exact key in trace attributes; missing values stay unscored.</span></label>
        <label className="field" htmlFor={`${prefix}-unit`}><span className="field-label">Value unit</span><select className="select" id={`${prefix}-unit`} disabled={pinned} value={metric.unit} onChange={event => onChange({ unit: event.target.value })}><option value="score">Score · 0 to 1</option><option value="percent">Percentage · 0 to 100</option><option value="ms">Milliseconds</option><option value="usd">US dollars</option><option value="number">Number · nonnegative</option></select><span className="field-hint">Reads a finite numeric value without calling a model.</span></label>
      </div> : null}
      <div className="form-grid three">
        <label className="field" htmlFor={`${prefix}-operator`}>
          <span className="field-label">Pass condition</span>
          <select className="select" id={`${prefix}-operator`} value={metric.operator} onChange={event => onChange({ operator: event.target.value })} disabled={!metric.enabled}>
            <option value="gte">At least ≥</option>
            <option value="lte">At most ≤</option>
          </select>
        </label>
        <label className="field" htmlFor={`${prefix}-threshold`}>
          <span className="field-label">Threshold <span className="muted">({unitLabel})</span></span>
          <input className="input" id={`${prefix}-threshold`} type="number" value={metric.threshold} min="0" max={max} step={metric.unit === 'ms' ? 1 : 'any'} disabled={!metric.enabled} required={metric.enabled} onChange={event => onChange({ threshold: event.target.value })} />
        </label>
        <label className="field" htmlFor={`${prefix}-weight`}>
          <span className="field-label">Weight</span>
          <input className="input" id={`${prefix}-weight`} type="number" value={metric.weight} min="0.01" step="any" disabled={!metric.enabled} required={metric.enabled} onChange={event => onChange({ weight: event.target.value })} />
        </label>
      </div>
      {(metric.id === 'contains' || metric.id.startsWith('contains_')) ? (
        <label className="field" htmlFor={`${prefix}-keyword`}>
          <span className="field-label">Required phrase</span>
          <input className="input" id={`${prefix}-keyword`} value={metric.keyword || ''} placeholder="For example: confirmation email" disabled={!metric.enabled || pinned} required={metric.enabled} maxLength={300} onChange={event => onChange({ keyword: event.target.value })} />
          <span className="field-hint">Checks whether the response includes this phrase, ignoring case. A match scores 1; no match scores 0.</span>
        </label>
      ) : null}
      <label className="check-row metric-critical">
        <input type="checkbox" checked={Boolean(metric.critical)} disabled={!metric.enabled} onChange={event => onChange({ critical: event.target.checked })} />
        <span>Critical metric <span className="muted">— any failed trace blocks release</span></span>
      </label>
    </section>
  );
}

function validateDraft(draft) {
  if (!draft.name.trim()) return 'Give this evaluation a name.';
  if (!draft.guidelines.length || draft.guidelines.some(rule => !rule.title.trim())) return 'Give every guideline a title, and keep at least one guideline.';
  const enabled = draft.metrics.filter(metric => metric.enabled);
  if (!enabled.length) return 'Enable at least one metric.';
  for (const metric of draft.metrics.filter(item => item.kind === 'attribute')) {
    if (!metric.name?.trim()) return 'Give every custom metric a name.';
    if (!metric.attributeKey?.trim()) return `${metric.name} needs a trace attribute key.`;
    if (!['score', 'ms', 'usd', 'percent', 'number'].includes(metric.unit)) return `${metric.name} needs a supported value unit.`;
  }
  for (const metric of enabled) {
    const threshold = Number(metric.threshold);
    const weight = Number(metric.weight);
    if (metric.threshold === '' || !Number.isFinite(threshold) || threshold < 0) return `${metric.name} needs a valid, nonnegative threshold.`;
    if (metric.unit === 'score' && threshold > 1) return `${metric.name} needs a threshold between 0 and 1.`;
    if (metric.unit === 'percent' && threshold > 100) return `${metric.name} needs a threshold between 0 and 100.`;
    if (metric.weight === '' || !Number.isFinite(weight) || weight <= 0) return `${metric.name} needs a positive weight.`;
    if ((metric.id === 'contains' || metric.id.startsWith('contains_')) && !metric.keyword?.trim()) return 'Enter a required phrase for the phrase scorer.';
  }
  const releaseThreshold = Number(draft.passThreshold);
  if (draft.passThreshold === '' || !Number.isFinite(releaseThreshold) || releaseThreshold < 0 || releaseThreshold > 100) return 'Set a release threshold between 0 and 100.';
  return '';
}

export default function Guidelines({ spec, onSave, onToast }) {
  const [draft, setDraft] = useState(() => clone(spec));
  const [error, setError] = useState('');
  const dirty = JSON.stringify(draft) !== JSON.stringify(spec);
  const enabledCount = draft.metrics.filter(metric => metric.enabled).length;

  function updateMetric(id, patch) {
    setDraft(previous => ({ ...previous, metrics: previous.metrics.map(metric => metric.id === id ? { ...metric, ...patch } : metric) }));
  }

  function updateGuideline(id, patch) {
    setDraft(previous => ({ ...previous, guidelines: previous.guidelines.map(rule => rule.id === id ? { ...rule, ...patch } : rule) }));
  }

  function addGuideline() {
    setDraft(previous => ({ ...previous, guidelines: [...previous.guidelines, { id: `guideline_${Date.now()}_${previous.guidelines.length}`, title: '', description: '' }] }));
  }

  function addPhraseScorer() {
    if (draft.metrics.some(metric => metric.id === 'contains')) return;
    setDraft(previous => ({ ...previous, metrics: [...previous.metrics, { id: 'contains', name: 'Required phrase', description: 'Check for a required phrase in the agent response.', kind: 'deterministic', threshold: 1, operator: 'gte', unit: 'score', weight: 1, enabled: true, critical: false, keyword: '' }] }));
    onToast?.('Phrase scorer added. Enter the phrase to check.');
  }

  function addAttributeMetric() {
    setDraft(previous => ({ ...previous, metrics: [...previous.metrics, { id: makeId('attribute'), name: 'Custom metric', description: 'Evaluate a numeric value recorded in your trace attributes.', kind: 'attribute', attributeKey: '', threshold: 0.8, operator: 'gte', unit: 'score', weight: 10, enabled: true, critical: false }] }));
    onToast?.('Custom metric added. Set its name, trace attribute, and threshold.');
  }

  function save(event) {
    event.preventDefault();
    const problem = validateDraft(draft);
    if (problem) { setError(problem); return; }
    const next = {
      ...draft,
      name: draft.name.trim(),
      description: draft.description.trim(),
      guidelines: draft.guidelines.map(rule => ({ ...rule, title: rule.title.trim(), description: rule.description.trim() })),
      passThreshold: Number(draft.passThreshold),
      metrics: draft.metrics.map(metric => ({ ...metric, threshold: Number(metric.threshold), weight: Number(metric.weight), ...((metric.id === 'contains' || metric.id.startsWith('contains_')) ? { keyword: metric.keyword.trim() } : {}), ...(metric.kind === 'attribute' ? { name: metric.name.trim(), attributeKey: metric.attributeKey.trim() } : {}) })),
    };
    setError('');
    onSave(next);
  }

  return (
    <form className="stack guidelines-form" onSubmit={save}>
      <div className="section-heading">
        <div><h2>Define what good looks like</h2><p className="subtext">Turn product expectations into repeatable evaluation criteria.</p></div>
        <span className={`badge ${dirty ? 'warning' : 'neutral'}`}>{dirty ? 'Unsaved changes' : `Version ${spec.version}`}</span>
      </div>

      <section className="panel">
        <div className="panel-header"><h3><BookOpen size={18} /> Evaluation brief</h3></div>
        <div className="panel-body stack">
          <div className="form-grid">
            <label className="field" htmlFor="evaluation-name"><span className="field-label">Evaluation name</span><input className="input" id="evaluation-name" value={draft.name} maxLength={120} required onChange={event => setDraft(previous => ({ ...previous, name: event.target.value }))} /></label>
            <div className="field"><span className="field-label">Evaluation scope</span><div className="input scope-readonly">{spec.dataset.service === 'all' ? 'All services' : spec.dataset.service}<ChevronRight size={14} /><span>{spec.dataset.environment === 'all' ? 'All environments' : spec.dataset.environment}</span></div><span className="field-hint">Change the source and cohort in the Dataset tab.</span></div>
          </div>
          <label className="field" htmlFor="evaluation-description"><span className="field-label">Product objective</span><textarea className="textarea" id="evaluation-description" value={draft.description} rows={2} maxLength={2000} onChange={event => setDraft(previous => ({ ...previous, description: event.target.value }))} /></label>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><div><h3>Product guidelines</h3><p className="subtext small">These instructions are preserved with every run and shown to reviewers.</p></div><button className="button secondary" type="button" onClick={addGuideline}><Plus size={15} /> Add guideline</button></div>
        <div className="panel-body stack">
          {draft.guidelines.map((rule, index) => (
            <div className="guideline-item" key={rule.id}>
              <span className="guideline-number">{String(index + 1).padStart(2, '0')}</span>
              <div className="stack guideline-fields">
                <label className="field" htmlFor={`guideline-${rule.id}-title`}><span className="field-label">Guideline {index + 1}</span><input className="input" id={`guideline-${rule.id}-title`} value={rule.title} placeholder="For example: Ground answers in approved knowledge" maxLength={160} required onChange={event => updateGuideline(rule.id, { title: event.target.value })} /></label>
                <label className="field" htmlFor={`guideline-${rule.id}-description`}><span className="field-label">Acceptance criteria</span><textarea className="textarea" id={`guideline-${rule.id}-description`} value={rule.description} rows={2} placeholder="Describe the behavior and the evidence a reviewer should look for." maxLength={3000} onChange={event => updateGuideline(rule.id, { description: event.target.value })} /></label>
              </div>
              <button className="icon-button" type="button" onClick={() => setDraft(previous => ({ ...previous, guidelines: previous.guidelines.filter(item => item.id !== rule.id) }))} disabled={draft.guidelines.length <= 1} aria-label={`Remove guideline ${index + 1}`} title={draft.guidelines.length <= 1 ? 'Keep at least one guideline' : 'Remove guideline'}><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><div><h3><SlidersHorizontal size={18} /> Metrics and scorers</h3><p className="subtext small">{enabledCount} enabled · thresholds are evaluated per trace.</p></div><div className="inline"><button className="button secondary" type="button" disabled={draft.metrics.some(metric => metric.id === 'contains')} onClick={addPhraseScorer}><Plus size={15} /> Add phrase scorer</button><button className="button secondary" type="button" onClick={addAttributeMetric}><Plus size={15} /> Add metric</button></div></div>
        <div className="panel-body stack">
          <div className="callout"><AlertCircle size={18} /><div><strong>Keep the evidence explicit.</strong><p>Latency, cost, tool success, and phrase checks use trace data. Semantic scorers use recorded sample judgments in demo mode. Imported traces without judgments remain unscored. Written guidelines do not automatically become a judge prompt.</p></div></div>
          <div className="metric-editor-list">
            {draft.metrics.map(metric => <MetricEditor key={metric.id} metric={metric} onChange={patch => updateMetric(metric.id, patch)} onRemove={metric.catalogRef || (metric.id === 'contains' || metric.id.startsWith('contains_')) || ['attribute', 'recorded_judgment'].includes(metric.kind) ? () => setDraft(previous => ({ ...previous, metrics: previous.metrics.filter(item => item.id !== metric.id) })) : undefined} />)}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><h3><ShieldCheck size={18} /> Release criteria</h3></div>
        <div className="panel-body form-grid">
          <NumberField id="release-threshold" label="Required pass rate (%)" value={draft.passThreshold} min={0} max={100} step="any" onChange={value => setDraft(previous => ({ ...previous, passThreshold: value }))} hint="The share of evaluated traces that must pass every enabled metric." />
          <div className="release-explanation"><strong>Evidence comes before a green scorecard.</strong><p className="subtext">Missing scorer results block release. Critical failures cannot be cleared by an annotation. Review completion is tracked separately from the automatic gate.</p></div>
        </div>
      </section>

      {error ? <div className="callout warning" role="alert"><AlertCircle size={18} /><span>{error}</span></div> : null}
      <div className="form-actions">
        <p className="subtext small"><Check size={15} /> Saving creates a new specification version. Past runs keep their original snapshot.</p>
        <div className="inline"><button className="button secondary" type="button" disabled={!dirty} onClick={() => { setDraft(clone(spec)); setError(''); }}>Discard changes</button><button className="button primary" type="submit" disabled={!dirty}><Save size={16} /> Save guidelines</button></div>
      </div>
    </form>
  );
}
