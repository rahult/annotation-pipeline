import { useState } from 'react';
import { AlertCircle, ArrowRight, Check, CircleCheck, Clock, Database, Download, FileBarChart, FileText, Play, Save, Settings2, ShieldCheck, Users } from 'lucide-react';
import { clone, download } from '../utils.js';
import { specToYaml } from '../config.js';

function Stage({ number, icon: Icon, title, description, detail, action, onAction, children }) {
  return (
    <li className="pipeline-stage">
      <div className="pipeline-stage-rail"><span className="pipeline-stage-number">{number}</span></div>
      <div className="pipeline-stage-content">
        <div className="pipeline-stage-heading"><div className="inline"><Icon size={19} /><h3>{title}</h3></div><button className="button ghost" type="button" onClick={onAction}>{action}<ArrowRight size={15} /></button></div>
        <p className="subtext">{description}</p>
        <div className="pipeline-stage-detail">{detail}</div>
        {children}
      </div>
    </li>
  );
}

export default function Pipeline({ spec, onSave, onRun, onNavigate, onToast, validation }) {
  const [draft, setDraft] = useState(() => clone(spec));
  const [error, setError] = useState('');
  const enabledMetrics = draft.metrics.filter(metric => metric.enabled);
  const dirty = JSON.stringify(draft) !== JSON.stringify(spec);
  const validationErrors = validation?.errors || [];
  const validationWarnings = validation?.warnings || [];

  function save(event) {
    event.preventDefault();
    const sampleRate = Number(draft.review.sampleRate);
    if (draft.review.sampleRate === '' || !Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 100) { setError('Set the human review sample between 0 and 100%.'); return; }
    setError('');
    onSave({ ...draft, review: { ...draft.review, sampleRate } });
  }

  function exportPipeline() {
    download(spec.configYaml || specToYaml(spec), 'evaluation.yml', 'application/yaml');
    onToast?.('Saved evaluation YAML exported.');
  }

  return (
    <div className="stack">
      <div className="section-heading"><div><h2>Your evaluation pipeline</h2><p className="subtext">One specification connects the evidence, scorers, and release decision.</p></div><button className="button secondary" type="button" onClick={exportPipeline}><Download size={16} /> Export YAML</button></div>
      <div className="pipeline-layout">
        <section className="panel">
          <div className="panel-header"><h3>From traces to a decision</h3><span className="badge teal">5 stages</span></div>
          <ol className="pipeline-stages">
            <Stage number="1" icon={FileText} title="Extract traces" description="Bring existing agent interactions into the evaluation workspace." detail={<><span className="badge neutral">{spec.dataset.source === 'demo' ? 'Sample workspace' : 'Imported OTLP JSON'}</span><span>{spec.dataset.service === 'all' ? 'All services' : spec.dataset.service} · {spec.dataset.environment === 'all' ? 'All environments' : spec.dataset.environment}</span></>} action="Connections" onAction={() => onNavigate('connections')} />
            <Stage number="2" icon={Database} title="Build dataset" description="Select the cohort, validate required evidence, and freeze a run snapshot." detail={<><span>Up to <strong>{spec.dataset.sampleSize}</strong> traces</span><span>Minimum <strong>{spec.dataset.minSamples}</strong></span><span>{spec.dataset.selection === 'errors_first' ? 'Errors first' : 'Most recent first'}</span></>} action="Configure dataset" onAction={() => onNavigate('dataset')} />
            <Stage number="3" icon={Settings2} title="Run scorers" description="Apply enabled metrics to every trace and preserve each score with its reason." detail={enabledMetrics.map(metric => <span className="badge neutral" key={metric.id}>{metric.name}{metric.critical ? ' · critical' : ''}</span>)} action="Edit metrics" onAction={() => onNavigate('guidelines')} />
            <Stage number="4" icon={Users} title="Human review" description="Review failures and a repeatable sample of the remaining interactions." detail={<><span>{spec.review.failures ? 'All failures queued' : 'Failure review off'}</span><span><strong>{spec.review.sampleRate}%</strong> sample rate</span><span>Verdict + rationale</span></>} action="Open review queue" onAction={() => onNavigate('annotations')} />
            <Stage number="5" icon={FileBarChart} title="Generate report" description="Publish the scorecard, release gate, and supporting trace-level evidence." detail={<><span className="badge teal">HTML report</span><span className="badge neutral">CSV results</span><span className="badge neutral">JSON evidence</span></>} action="View reports" onAction={() => onNavigate('reports')} />
          </ol>
        </section>

        <aside className="stack pipeline-aside">
          <section className="panel">
            <div className="panel-header"><h3><ShieldCheck size={18} /> Preflight check</h3></div>
            <div className="panel-body stack">
              <div className={`callout ${validation?.valid ? '' : 'warning'}`}>
                {validation?.valid ? <CircleCheck size={19} /> : <AlertCircle size={19} />}
                <div><strong>{validation?.valid ? 'Dataset ready' : 'Dataset needs attention'}</strong><p>{validation?.valid ? 'The current cohort meets your dataset requirements.' : 'Resolve these requirements before evaluating.'}</p></div>
              </div>
              {validationErrors.length ? <ul className="validation-list">{validationErrors.map((message, index) => <li key={index}>{typeof message === 'string' ? message : message.message || JSON.stringify(message)}</li>)}</ul> : null}
              <dl className="detail-list"><div><dt>Eligible traces</dt><dd>{validation?.eligibleCount ?? '—'}</dd></div><div><dt>Minimum required</dt><dd>{spec.dataset.minSamples}</dd></div><div><dt>Enabled scorers</dt><dd>{enabledMetrics.length}</dd></div><div><dt>Specification</dt><dd>Version {spec.version}</dd></div></dl>
              {validationWarnings.length ? <div className="small muted">{validationWarnings.map((message, index) => <p key={index}>{typeof message === 'string' ? message : message.message || JSON.stringify(message)}</p>)}</div> : null}
              <button className="button primary full-width" type="button" onClick={onRun} disabled={!validation?.valid || dirty}><Play size={16} /> Run evaluation</button>
              <p className="field-hint">{dirty ? 'Save pipeline changes before running.' : 'Runs use the saved specification and current dataset.'}</p>
            </div>
          </section>
          <div className="callout"><FileText size={18} /><div><strong>Reproducible by design.</strong><p>Each run stores its guideline version, dataset snapshot, scorer settings, and individual results. New settings apply to new runs.</p></div></div>
        </aside>
      </div>

      <form className="panel" onSubmit={save}>
        <div className="panel-header"><h3><Clock size={18} /> Execution and review</h3>{dirty ? <span className="badge warning">Unsaved changes</span> : <span className="badge neutral">Browser-local prototype</span>}</div>
        <div className="panel-body stack">
          <div className="form-grid three">
            <label className="field" htmlFor="pipeline-trigger"><span className="field-label">Run trigger</span><select className="select" id="pipeline-trigger" value={draft.automation.trigger} onChange={event => setDraft(previous => ({ ...previous, automation: { ...previous.automation, trigger: event.target.value } }))}><option value="manual">Manual run</option><option value="on_import">After trace import</option><option value="scheduled">Scheduled · configuration only</option></select><span className="field-hint">Runs after import execute while this workspace is open.</span></label>
            {draft.automation.trigger === 'scheduled' ? <label className="field" htmlFor="pipeline-schedule"><span className="field-label">Requested schedule</span><select className="select" id="pipeline-schedule" value={draft.automation.schedule} onChange={event => setDraft(previous => ({ ...previous, automation: { ...previous.automation, schedule: event.target.value } }))}><option value="hourly">Every hour</option><option value="daily">Daily</option><option value="weekly">Weekly</option></select><span className="field-hint">Exported for a future server worker.</span></label> : <label className="field" htmlFor="pipeline-format"><span className="field-label">Preferred report format</span><select className="select" id="pipeline-format" value={draft.automation.reportFormat || 'html'} onChange={event => setDraft(previous => ({ ...previous, automation: { ...previous.automation, reportFormat: event.target.value } }))}><option value="html">HTML report</option><option value="csv">CSV results</option><option value="json">JSON evidence</option></select><span className="field-hint">All formats remain available after a run.</span></label>}
            <label className="field" htmlFor="pipeline-review-rate"><span className="field-label">Review sample (%)</span><input className="input" id="pipeline-review-rate" type="number" min="0" max="100" step="1" required value={draft.review.sampleRate} onChange={event => setDraft(previous => ({ ...previous, review: { ...previous.review, sampleRate: event.target.value } }))} /><span className="field-hint">A repeatable sample for human quality checks.</span></label>
          </div>
          <label className="check-row"><input type="checkbox" checked={draft.review.failures} onChange={event => setDraft(previous => ({ ...previous, review: { ...previous.review, failures: event.target.checked } }))} /><span>Always queue failed traces for human review</span></label>
          {draft.automation.trigger === 'scheduled' ? <div className="callout warning"><Clock size={18} /><div><strong>Configuration only · requires worker</strong><p>No background job is running. This schedule is included in the exported pipeline and needs a server-side scheduler and tracing adapter to execute unattended.</p></div></div> : null}
          {draft.automation.trigger === 'on_import' && draft.dataset.source !== 'import' ? <div className="callout warning"><AlertCircle size={18} /><div><strong>Select imported traces for automatic runs.</strong><p>Set the Dataset source to imported traces before using this trigger, so a new import is evaluated against the intended cohort.</p></div></div> : null}
          {error ? <div className="callout warning" role="alert"><AlertCircle size={18} /><span>{error}</span></div> : null}
          <div className="form-actions"><p className="subtext small"><Check size={15} /> Reviewer verdicts are separate from automated release criteria.</p><div className="inline"><button className="button secondary" type="button" disabled={!dirty} onClick={() => { setDraft(clone(spec)); setError(''); }}>Discard changes</button><button className="button primary" type="submit" disabled={!dirty}><Save size={16} /> Save pipeline</button></div></div>
        </div>
      </form>
    </div>
  );
}
