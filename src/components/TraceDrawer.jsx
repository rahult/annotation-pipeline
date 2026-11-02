import { useState } from 'react';
import { Copy, Check, ChevronRight, GitBranch, MessageSquare, Braces, Clock3, Coins } from 'lucide-react';
import { Modal, MetricIcon, StatusBadge, EmptyState } from './ui.jsx';
import { formatValue, dateTime } from '../utils.js';

export function TraceDetail({ trace, result, children }) {
  const [tab, setTab] = useState('conversation');
  const [copied, setCopied] = useState(false);
  async function copyId() { try { await navigator.clipboard.writeText(trace.traceId); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setCopied(false); } }
  return <div className="trace-detail"><div className="trace-meta"><div className="inline"><span className="badge neutral">{trace.service}</span><span className={`badge ${trace.status === 'error' ? 'danger' : trace.status === 'ok' ? 'success' : 'neutral'}`}>{trace.status === 'error' ? 'Trace error' : trace.status === 'ok' ? 'Completed' : 'Outcome unknown'}</span><span className="small muted">{trace.attributes?.['tracegrade.synthetic'] === true ? 'Synthetic scenario trace' : trace.source === 'demo' ? 'Sample trace' : 'Imported trace'}</span></div><h3>{trace.name}</h3><button className="trace-id" onClick={copyId} title="Copy correlation trace ID"><code>{trace.traceId}</code>{copied ? <Check size={13} /> : <Copy size={13} />}</button><div className="inline small muted"><span><Clock3 size={13} /> {formatValue(trace.durationMs, 'ms')}</span><span><Coins size={13} /> {formatValue(trace.costUsd, 'usd')}</span><span>{trace.model || 'Model not recorded'}</span><span>{dateTime(trace.startedAt)}</span></div></div>
    <div className="small-tabs"><button className={tab === 'conversation' ? 'active' : ''} onClick={() => setTab('conversation')}><MessageSquare size={15} />Conversation</button><button className={tab === 'spans' ? 'active' : ''} onClick={() => setTab('spans')}><GitBranch size={15} />Spans ({trace.spans?.length || 0})</button><button className={tab === 'attributes' ? 'active' : ''} onClick={() => setTab('attributes')}><Braces size={15} />Attributes</button>{trace.normalization && <button className={tab === 'mapping' ? 'active' : ''} onClick={() => setTab('mapping')}><GitBranch size={15} />Mapping</button>}</div>
    <div className="trace-content">{tab === 'conversation' ? <div className="stack"><ConversationBlock label="User input" text={trace.input} /><ConversationBlock label="Agent response" text={trace.output} accent /><ConversationBlock label="Retrieved context" text={trace.context} />{trace.expectedOutput && <ConversationBlock label="Expected response" text={trace.expectedOutput} />}</div> : tab === 'spans' ? trace.spans?.length ? <div className="span-list">{trace.spans.map(span => <SpanEvidence key={span.id} span={span} durationMs={trace.durationMs} />)}</div> : <EmptyState title="No child spans">This record includes only the root interaction.</EmptyState> : tab === 'mapping' ? <MappingEvidence normalization={trace.normalization} /> : <pre className="code-block">{JSON.stringify(trace.attributes || {}, null, 2)}</pre>}</div>
    {result && <section className="trace-scores"><div className="section-heading"><h3>Scorer evidence</h3><StatusBadge status={result.passed ? 'passed' : result.scores.some(score => score.value == null) ? 'blocked' : 'failed'} /></div>{result.scores.map(score => <div className="trace-score" key={score.metricId}><div className="inline"><MetricIcon id={score.metricId} /><strong>{score.name}</strong><span className="numeric">{score.value == null ? 'Unscored' : formatValue(score.value, score.unit || ({ latency: 'ms', cost: 'usd', tool_success: 'percent' }[score.metricId] || 'score'))}</span><span className={`score-dot ${score.pass == null ? 'neutral' : score.pass ? 'success' : 'danger'}`} /></div><p>{score.reason}</p></div>)}</section>}{children}
  </div>;
}

function SpanEvidence({ span, durationMs }) {
  const knownDuration = Number.isFinite(durationMs) && durationMs > 0;
  const status = span.status === 'error' ? 'Error' : span.status === 'ok' ? 'Completed' : 'Outcome unknown';
  const tone = span.status === 'error' ? 'danger' : span.status === 'ok' ? 'success' : 'warning';
  const events = Array.isArray(span.events) ? span.events : [];
  return <div className="span-evidence">
    <div className="span-row">
      <div className="span-info" style={{ paddingLeft: span.parentId ? 15 : 0 }}><GitBranch size={15} /><strong>{span.name}</strong><span className="small muted">{span.type}</span><span className={`badge ${tone}`}>{status}</span>{span.service && <span className="span-service">Service: <code>{span.service}</code></span>}</div>
      <div className="span-timeline" title={knownDuration ? 'Relative span timing' : 'Trace duration unavailable'}>{knownDuration && <span className={span.status === 'error' ? 'error' : span.status === 'ok' ? '' : 'unknown'} style={{ marginLeft: `${Math.max(0, Math.min(80, (span.startMs || 0) / durationMs * 100))}%`, width: `${Math.max(3, Math.min(100, (span.durationMs || 0) / durationMs * 100))}%` }} />}</div>
      <span className="numeric small">{formatValue(span.durationMs, 'ms')}</span>
    </div>
    <details className="span-attributes"><summary>Evidence for {span.name}{span.service ? ` · ${span.service}` : ''}</summary>
      <p className="small muted">Span ID: <code>{span.id}</code>{span.parentId ? <> · Parent: <code>{span.parentId}</code></> : ' · Root span'}</p>
      {span.instrumentationScope?.name && <p className="small muted">Instrumentation: <code>{span.instrumentationScope.name}</code>{span.instrumentationScope.version ? ` · v${span.instrumentationScope.version}` : ''}</p>}
      {span.resourceSchemaUrl && <p className="small muted">Resource schema: <code>{span.resourceSchemaUrl}</code></p>}
      {span.instrumentationScope?.schemaUrl && <p className="small muted">Scope schema: <code>{span.instrumentationScope.schemaUrl}</code></p>}
      {span.status !== 'error' && span.status !== 'ok' && <p className="small muted">No explicit success or error was recorded. Imported OTel statuses that are UNSET or absent remain unknown.</p>}
      <h4>Span attributes</h4><pre className="code-block">{JSON.stringify(span.attributes || {}, null, 2)}</pre>
      <div className="span-events"><h4>Recorded events ({events.length})</h4>{events.length ? <ol>{events.map((event, index) => <li key={`${event.name}-${index}`}><details><summary><strong>{event.name || 'Unnamed event'}</strong><span>{event.timestamp ? event.timestamp.replace('T', ' ').replace('Z', ' UTC') : 'Timestamp not recorded'}</span></summary>{event.timeUnixNano && <p className="small muted">Original timestamp: <code>{event.timeUnixNano}</code> ns</p>}<pre className="code-block">{JSON.stringify(event.attributes || {}, null, 2)}</pre></details></li>)}</ol> : <p className="small muted">No events were included in this span snapshot.</p>}<p className="small muted">Events are shown in recorded order. The mapping profile selects the event used for evaluation.</p></div>
    </details>
  </div>;
}

function MappingEvidence({ normalization }) {
  if (!normalization) return <EmptyState title="No mapping record">This trace predates explicit mapping profiles.</EmptyState>;
  const mappings = normalization.mappings || [];
  return <div className="stack trace-mapping">
    <div><h3>Ingestion mapping</h3><p className="subtext">{normalization.profileId} · v{normalization.profileVersion}</p><p className="small muted">This records where the evaluation evidence came from. Missing and ambiguous fields are kept unresolved.</p></div>
    {normalization.warnings?.length > 0 && <div className="callout warning"><div><strong>Mapping needs attention</strong><ul className="validation-list">{normalization.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></div></div>}
    <div className="table-wrap"><table className="data-table mapping-table"><thead><tr><th>Evaluation field</th><th>Recorded source</th><th>Result</th></tr></thead><tbody>{mappings.map((mapping, i) => <tr key={`${mapping.field}-${i}`}><td><code>{mapping.field}</code></td><td><strong className="small">{mapping.source}</strong>{mapping.attribute && <code className="mapping-source">{mapping.attribute}</code>}{mapping.serviceSelector && <span className="small muted">Required service: <code>{mapping.serviceSelector}</code></span>}{mapping.serviceName && <span className="small muted">Recorded service: <code>{mapping.serviceName}</code></span>}{mapping.spanName && <span className="small muted">Span: {mapping.spanName}</span>}{mapping.eventName && <span className="small muted">Event: {mapping.eventName}</span>}{mapping.spanId && <code className="mapping-source">Span ID: {mapping.spanId}</code>}{mapping.transform && <p className="small muted">{mapping.transform}</p>}{mapping.unit && <span className="small muted">Input unit: {mapping.unit}</span>}{mapping.detail && <p className="small muted">{mapping.detail}</p>}</td><td><span className={`badge ${mapping.status === 'resolved' ? 'success' : 'warning'}`}>{mapping.status}</span></td></tr>)}</tbody></table></div>
    {normalization.instrumentationScopes?.length > 0 && <div><h4>Instrumentation scopes</h4>{normalization.instrumentationScopes.map((scope, i) => <div className="mapping-instrumentation" key={i}><strong>{scope.name || 'Not recorded'}</strong><span className="small muted">{scope.version ? `v${scope.version}` : 'Version not recorded'}</span>{scope.schemaUrl && <code className="mapping-source">{scope.schemaUrl}</code>}</div>)}</div>}
    {normalization.resourceSchemaUrls?.length > 0 && <div><h4>Resource schema identifiers</h4>{normalization.resourceSchemaUrls.map((url, i) => <code className="mapping-source" key={i}>{url}</code>)}</div>}
  </div>;
}

function ConversationBlock({ label, text, accent }) {
  return <section className={`conversation-block ${accent ? 'accent' : ''}`}><h4>{label}</h4><p>{typeof text === 'string' ? text || 'Not recorded' : text ? JSON.stringify(text, null, 2) : 'Not recorded'}</p></section>;
}

export default function TraceDrawer({ trace, result, onClose }) { return <Modal title="Trace detail" onClose={onClose} drawer><TraceDetail trace={trace} result={result} /></Modal>; }
