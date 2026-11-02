import { useState } from 'react';
import { AlertCircle, ArrowRight, BookOpen, Check, FileCheck2, GitFork, Save, ShieldCheck } from 'lucide-react';
import { validateScorerDraft } from '../catalog.js';
import { Modal } from './ui.jsx';

export const SCORER_TYPES = {
  attribute: { label: 'Numeric trace attribute', short: 'Attribute', unit: 'number', threshold: 100, operator: 'lte', hint: 'Read a numeric value from an exact trace attribute key and compare it with your threshold.' },
  contains: { label: 'Response contains phrase', short: 'Phrase check', unit: 'score', threshold: 1, operator: 'gte', hint: 'Look for a literal phrase in the agent response, ignoring case. A match scores 1; otherwise 0.' },
  latency: { label: 'Response latency', short: 'Latency', unit: 'ms', threshold: 4000, operator: 'lte', hint: 'Compare the recorded end-to-end duration with a limit in milliseconds.' },
  cost: { label: 'Recorded trace cost', short: 'Cost', unit: 'usd', threshold: 0.03, operator: 'lte', hint: 'Compare explicitly recorded trace cost in USD. Token counts are not converted into an inferred price.' },
  tool_success: { label: 'Tool success rate', short: 'Tool success', unit: 'percent', threshold: 100, operator: 'gte', hint: 'Measure successful tool outcomes as a percentage. Missing or unknown outcomes remain unscored.' },
  recorded_judgment: { label: 'Recorded external judgment', short: 'Recorded judgment', unit: 'score', threshold: 0.85, operator: 'gte', hint: 'Consume a supplied 0–1 judgment with provenance. The rubric documents the expectation; this prototype does not call a model.' },
};

export function slugify(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function scorerInput(definition = {}) {
  if (definition.type === 'attribute') return `trace.attributes[${JSON.stringify(definition.attributeKey || 'attribute.key')}]`;
  if (definition.type === 'contains') return 'trace.output';
  if (definition.type === 'latency') return 'trace.durationMs';
  if (definition.type === 'cost') return 'trace.costUsd';
  if (definition.type === 'tool_success') return 'trace.spans[type=tool].status';
  if (definition.type === 'recorded_judgment') return `trace.evaluatorScores[${JSON.stringify(definition.judgmentKey || definition.metricId || 'judgment_key')}].value + provenance`;
  return 'Trace evidence';
}

export function freshDraft(context = {}, patch = {}) {
  return {
    scope: context.agent ? 'agent' : context.domain ? 'domain' : 'global',
    target: context.agent || context.domain || '',
    slug: '', name: '', description: '', owner: 'Product team', tags: [],
    type: 'attribute', unit: 'number', attributeKey: '', threshold: 100,
    operator: 'lte', weight: 10, critical: false,
    ...patch,
  };
}

export default function ScorerBuilder({ initialDraft, entryId, context = {}, forkFrom, candidate, onSaveDraft, onSaved, onClose }) {
  const [draft, setDraft] = useState(() => structuredClone(initialDraft || freshDraft(context)));
  const [tags, setTags] = useState(() => (initialDraft?.tags || []).join(', '));
  const [slugEdited, setSlugEdited] = useState(Boolean(initialDraft?.slug));
  const [errors, setErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const definition = SCORER_TYPES[draft.type] || SCORER_TYPES.attribute;
  const lockedIdentity = Boolean(entryId);
  const semantic = draft.type === 'recorded_judgment';
  const scopeName = draft.scope === 'global' ? 'global' : `${draft.scope}/${draft.target || 'target'}`;

  function update(key, value) { setDraft(previous => ({ ...previous, [key]: value })); }

  function changeType(type) {
    const next = SCORER_TYPES[type];
    setDraft(previous => {
      const { attributeKey, keyword, judgmentKey, rubric, metricId, ...shared } = previous;
      return { ...shared, type, unit: next.unit, threshold: next.threshold, operator: next.operator,
        ...(type === 'attribute' ? { attributeKey: '' } : {}),
        ...(type === 'contains' ? { keyword: '' } : {}),
        ...(type === 'recorded_judgment' ? { judgmentKey: slugify(previous.slug || previous.name).replaceAll('-', '_'), rubric: '' } : {}),
      };
    });
  }

  async function save(event) {
    event.preventDefault();
    const flat = { ...draft, scope: draft.scope, target: draft.scope === 'global' ? '' : String(draft.target || '').trim(),
      slug: String(draft.slug).trim(), name: String(draft.name).trim(), description: String(draft.description || '').trim(), owner: String(draft.owner || '').trim(),
      tags: [...new Set(tags.split(',').map(tag => tag.trim()).filter(Boolean))],
      threshold: draft.threshold === '' ? NaN : Number(draft.threshold), weight: draft.weight === '' ? NaN : Number(draft.weight),
    };
    const check = validateScorerDraft(flat);
    const messages = [...(check.errors || [])];
    if (forkFrom && flat.slug === forkFrom.slug) messages.push('Give this fork a new slug so its identity is explicit.');
    if (!check.valid || messages.length) { setErrors(messages.map(item => typeof item === 'string' ? item : item.message || String(item))); return; }
    setErrors([]); setSaving(true);
    try {
      const entry = await onSaveDraft(flat, entryId);
      if (!entry) { setErrors(['The draft was not saved. Review the workspace message and correct any conflicting identity.']); return; }
      onSaved(entry);
    } catch (error) { setErrors([error.message || 'The scorer draft could not be saved.']); }
    finally { setSaving(false); }
  }

  return <Modal drawer title={forkFrom ? 'Fork scorer' : entryId ? 'Edit scorer draft' : 'Build a scorer'} onClose={onClose} className="scorer-builder">
    <form className="scorer-builder-form" onSubmit={save}>
      <div className="scorer-builder-content stack">
        <div className="scorer-builder-intro"><span className="badge warning">Draft</span><p>{forkFrom ? 'Create an independent scorer with a new identity and an explicit scope.' : 'Define the evidence and a repeatable rule. Save a draft, then publish an immutable version.'}</p></div>
        {candidate ? <div className="callout"><FileCheck2 size={18} /><div><strong>Started from observed trace data</strong><p><code>{candidate.key}</code> appears in {candidate.count} of {candidate.total} selected traces. The initial threshold uses its observed maximum; change it to the limit your product actually needs.</p></div></div> : null}
        {lockedIdentity ? <div className="callout"><ShieldCheck size={17} /><p>This draft belongs to <code>{entryId}</code>. Published versions and evaluation pins remain unchanged. Use Fork to choose another identity or scope.</p></div> : null}

        <section className="scorer-builder-section">
          <div className="section-heading"><h3>Identity and ownership</h3><span className="small muted">01</span></div>
          <div className="form-grid">
            <label className="field"><span className="field-label">Scorer name</span><input className="input" value={draft.name} maxLength={160} required placeholder="e.g. Retrieval token budget" onChange={event => { const name = event.target.value; setDraft(previous => ({ ...previous, name, ...(!lockedIdentity && !slugEdited ? { slug: slugify(name) } : {}) })); }} /></label>
            <label className="field"><span className="field-label">Slug</span><input className="input" value={draft.slug} maxLength={80} required disabled={lockedIdentity} placeholder="retrieval-token-budget" onChange={event => { setSlugEdited(true); update('slug', event.target.value); }} /><span className="field-hint">A stable lowercase identifier, separated with hyphens.</span></label>
          </div>
          <div className="form-grid">
            <label className="field"><span className="field-label">Scope</span><select className="select" value={draft.scope} disabled={lockedIdentity} onChange={event => { const scope = event.target.value; setDraft(previous => ({ ...previous, scope, target: scope === 'global' ? '' : context[scope] || '' })); }}><option value="global">Global · reusable everywhere</option><option value="domain">Domain · one product domain</option><option value="agent">Agent · one agent identity</option></select></label>
            {draft.scope === 'global' ? <div className="field"><span className="field-label">Applicability</span><div className="scorer-builder-readonly">Available to every evaluation</div><span className="field-hint">Scope labels express applicability, not access permissions.</span></div> : <label className="field"><span className="field-label">{draft.scope === 'domain' ? 'Domain' : 'Agent'} target</span><input className="input" value={draft.target || ''} required maxLength={100} disabled={lockedIdentity} placeholder={draft.scope === 'domain' ? 'customer-support' : 'support-agent'} onChange={event => update('target', event.target.value)} /><span className="field-hint">Must exactly match the evaluation’s {draft.scope} label.</span></label>}
          </div>
          <div className="scorer-builder-reference"><span className="small muted">Scorer reference</span><code>{scopeName}/{draft.slug || 'scorer-slug'}</code></div>
          <label className="field"><span className="field-label">Description</span><textarea className="textarea" value={draft.description || ''} rows={2} maxLength={2000} required placeholder="What behavior does this scorer measure, and why does it matter?" onChange={event => update('description', event.target.value)} /></label>
          <div className="form-grid"><label className="field"><span className="field-label">Owner</span><input className="input" value={draft.owner || ''} maxLength={120} required onChange={event => update('owner', event.target.value)} /></label><label className="field"><span className="field-label">Tags</span><input className="input" value={tags} maxLength={300} placeholder="reliability, cost, retrieval" onChange={event => setTags(event.target.value)} /><span className="field-hint">Separate tags with commas.</span></label></div>
        </section>

        <section className="scorer-builder-section">
          <div className="section-heading"><h3>Evidence and execution</h3><span className="small muted">02</span></div>
          <label className="field"><span className="field-label">Scorer type</span><select className="select" value={draft.type} onChange={event => changeType(event.target.value)}>{Object.entries(SCORER_TYPES).map(([key, value]) => <option value={key} key={key}>{value.label}</option>)}</select><span className="field-hint">{definition.hint}</span></label>
          {draft.type === 'attribute' ? <label className="field"><span className="field-label">Numeric attribute key</span><input className="input" value={draft.attributeKey || ''} maxLength={250} required placeholder="gen_ai.usage.input_tokens" onChange={event => update('attributeKey', event.target.value)} /><span className="field-hint">An exact key in trace.attributes. A missing or nonnumeric value remains unscored.</span></label> : null}
          {draft.type === 'contains' ? <label className="field"><span className="field-label">Required phrase</span><input className="input" value={draft.keyword || ''} maxLength={2000} required placeholder="confirmation email" onChange={event => update('keyword', event.target.value)} /><span className="field-hint">A literal, case-insensitive phrase. No code or regular expression is executed.</span></label> : null}
          {semantic ? <><label className="field"><span className="field-label">Judgment key</span><input className="input" value={draft.judgmentKey || ''} maxLength={160} required placeholder="policy_compliance" onChange={event => update('judgmentKey', event.target.value)} /><span className="field-hint">Read evaluatorScores at this key. Each judgment needs a value and provenance.</span></label><label className="field"><span className="field-label">Evaluation rubric</span><textarea className="textarea" value={draft.rubric || ''} rows={4} maxLength={6000} required placeholder="Describe what a score of 0 and 1 mean, the evidence to examine, and when the evaluator should abstain." onChange={event => update('rubric', event.target.value)} /></label><div className="callout"><BookOpen size={18} /><p>This saves a rubric and consumes recorded judgments. It does not run an LLM judge. Missing external evidence blocks the evaluation rather than producing a guessed score.</p></div></> : null}
          <div className="scorer-builder-reference"><span className="small muted">Required input</span><code>{scorerInput(draft)}</code></div>
        </section>

        <section className="scorer-builder-section">
          <div className="section-heading"><h3>Default evaluation policy</h3><span className="small muted">03</span></div>
          <div className="form-grid three">
            <label className="field"><span className="field-label">Unit</span><select className="select" value={draft.unit} disabled={draft.type !== 'attribute'} onChange={event => update('unit', event.target.value)}><option value="number">Number / count</option><option value="score">Score · 0 to 1</option><option value="ms">Milliseconds</option><option value="usd">USD</option><option value="percent">Percent · 0 to 100</option></select></label>
            <label className="field"><span className="field-label">Pass condition</span><select className="select" value={draft.operator} onChange={event => update('operator', event.target.value)}><option value="lte">At most (≤)</option><option value="gte">At least (≥)</option></select></label>
            <label className="field"><span className="field-label">Threshold</span><input className="input" type="number" min={0} max={draft.unit === 'score' ? 1 : draft.unit === 'percent' ? 100 : undefined} step="any" required value={draft.threshold} onChange={event => update('threshold', event.target.value)} /></label>
          </div>
          <div className="form-grid"><label className="field"><span className="field-label">Weight</span><input className="input" type="number" min="0.01" max="1000000" step="any" required value={draft.weight} onChange={event => update('weight', event.target.value)} /><span className="field-hint">Relative weight in the evaluation’s scorer pass score.</span></label><label className="check-row scorer-builder-critical"><input type="checkbox" checked={Boolean(draft.critical)} onChange={event => update('critical', event.target.checked)} /><span><strong>Critical metric</strong><small>Any failed trace blocks release, regardless of the overall pass rate.</small></span></label></div>
          <p className="field-hint">These are defaults. Each evaluation can pin a published version and retain its own thresholds, weights, and release policy.</p>
        </section>
        {errors.length ? <div className="callout warning" role="alert"><AlertCircle size={18} /><div><strong>Review this draft</strong><ul className="validation-list">{errors.map((message, index) => <li key={index}>{message}</li>)}</ul></div></div> : null}
      </div>
      <div className="scorer-builder-footer"><span className="small muted"><Check size={14} /> Publish a version before using this scorer.</span><div className="inline"><button className="button secondary" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="button primary" type="submit" disabled={saving}><Save size={16} />{saving ? 'Saving…' : 'Save draft'}</button></div></div>
    </form>
  </Modal>;
}
