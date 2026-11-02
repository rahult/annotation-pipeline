import { useId } from 'react';
import { TRACE_PROFILES } from '../traceProfiles.js';

function sourceLabel(field) {
  return [
    String(field.source || 'attribute').replaceAll('_', ' '),
    field.serviceName ? `service.name “${field.serviceName}”` : '',
    field.spanName ? `span “${field.spanName}”` : '',
    field.eventName ? `event “${field.eventName}”` : '',
    field.attribute || '',
  ].filter(Boolean).join(' · ');
}

/** A choice of concrete mappings, never a claim that a loaded trace was remapped. */
export default function TraceProfileSelector({ value, onChange, disabled = false }) {
  const id = useId();
  const profile = value ? TRACE_PROFILES.find(item => item.id === value.profile && item.version === value.version) : null;
  const selected = value ? `${value.profile}@${value.version}` : 'auto';
  function select(event) {
    if (event.target.value === 'auto') { onChange(undefined); return; }
    const next = TRACE_PROFILES.find(item => `${item.id}@${item.version}` === event.target.value);
    if (next) onChange({ profile: next.id, version: next.version });
  }
  return <div className="stack compact">
    <label className="field" htmlFor={id}>
      <span className="field-label">Trace mapping profile</span>
      <select id={id} className="select" value={selected} onChange={select} disabled={disabled} aria-describedby={`${id}-help`}>
        <option value="auto">Auto · legacy field mapping</option>
        {value && !profile ? <option value={selected}>Unavailable: {value.profile} @ {value.version || 'no version'}</option> : null}
        {TRACE_PROFILES.map(item => <option key={`${item.id}@${item.version}`} value={`${item.id}@${item.version}`}>{item.name} · v{item.version}</option>)}
      </select>
    </label>
    {profile ? <>
      <div className="inline"><span className="badge teal">v{profile.version}</span><span className="small muted">{profile.team}</span></div>
      <p id={`${id}-help`} className="field-hint">{profile.description}</p>
      <details className="time-window"><summary>Source field mapping <span className="small muted">· {profile.fields.length} fields</span></summary><ul className="validation-list small">{profile.fields.map((field, index) => <li key={`${field.target}-${index}`}><code>{field.target}</code><span> ← {sourceLabel(field)}</span>{field.transform ? <div className="field-hint">{field.transform}</div> : null}</li>)}</ul></details>
      <p className="field-hint">Reads only this profile’s declared evidence fields. Missing measurements remain unscored; a missing outcome never means success.</p>
    </> : <p id={`${id}-help`} className="field-hint">{value ? 'This exact profile version is unavailable. Select a supported mapping before importing or saving.' : 'Uses the existing root/child attribute heuristics for OTLP and accepts normalized trace records. Import notes flag fallback mappings.'}</p>}
    <p className="field-hint">Applies to the next import. Changing this selection does not remap traces already loaded.</p>
  </div>;
}
