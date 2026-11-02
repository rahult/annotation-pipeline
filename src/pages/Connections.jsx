import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Database, Download, FileJson, Info, Link2, LoaderCircle, LockKeyhole, Upload } from 'lucide-react';
import { normalizeTraceInput, TRACE_PROFILES } from '../traceProfiles.js';
import { download } from '../utils.js';
import TraceProfileSelector from '../components/TraceProfileSelector.jsx';

const MAX_BYTES = 8 * 1024 * 1024;
const PROVIDERS = ['OTLP JSON export', 'Custom JSON endpoint', 'Grafana Tempo', 'Jaeger', 'Arize Phoenix', 'Langfuse'];
const STAGED_PROVIDERS = new Set(PROVIDERS.slice(2));

const SAMPLE_TRACES = [
  {
    id: 'example-refund-01',
    traceId: '0af7651916cd43dd8448eb211c80319c',
    name: 'Check refund eligibility',
    service: 'support-agent',
    environment: 'production',
    startedAt: '2026-11-02T09:00:00.000Z',
    durationMs: 1850,
    costUsd: 0.012,
    status: 'ok',
    input: 'Can I get a refund for an order placed five days ago?',
    output: 'Orders are eligible for a refund within 30 days. I can help you start a request.',
    context: 'Refund policy: unused orders may be refunded within 30 days of purchase.',
    expectedOutput: 'Explain the 30-day refund window and offer to start the request.',
    model: 'your-model-version',
    tags: ['refund', 'example'],
    spans: [
      { id: 'root-01', parentId: null, name: 'support_agent', type: 'agent', durationMs: 1850, startMs: 0, status: 'ok', attributes: {} },
      { id: 'tool-01', parentId: 'root-01', name: 'lookup_policy', type: 'tool', durationMs: 180, startMs: 40, status: 'ok', attributes: {} },
    ],
    attributes: {},
  },
  {
    id: 'example-delivery-02',
    traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
    name: 'Find a delayed delivery',
    service: 'support-agent',
    environment: 'production',
    startedAt: '2026-11-02T09:02:00.000Z',
    durationMs: 4300,
    costUsd: 0.018,
    status: 'error',
    input: 'My delivery has not arrived. Can you check its status?',
    output: 'I could not reach the delivery service. I can help you contact our support team.',
    context: 'If the tracking service is unavailable, explain the issue and offer human support.',
    expectedOutput: 'Do not invent a delivery status. Offer a support handoff.',
    model: 'your-model-version',
    tags: ['delivery', 'example'],
    spans: [
      { id: 'root-02', parentId: null, name: 'support_agent', type: 'agent', durationMs: 4300, startMs: 0, status: 'error', attributes: {} },
      { id: 'tool-02', parentId: 'root-02', name: 'get_delivery_status', type: 'tool', durationMs: 3900, startMs: 50, status: 'error', attributes: {} },
    ],
    attributes: {},
  },
];

const TRACE_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Tracegrade normalized trace import',
  description: 'Import a JSON array of trace records, or an OTLP JSON resourceSpans payload. Missing fields remain missing; missing semantic scores are not generated.',
  type: 'array',
  minItems: 1,
  items: {
    type: 'object',
    required: ['id', 'name', 'service', 'startedAt'],
    properties: {
      id: { type: 'string', minLength: 1 },
      traceId: { type: 'string' },
      name: { type: 'string' },
      service: { type: 'string' },
      environment: { type: 'string' },
      startedAt: { type: 'string', format: 'date-time' },
      durationMs: { type: ['number', 'null'], minimum: 0 },
      costUsd: { type: ['number', 'null'], minimum: 0 },
      status: { enum: ['ok', 'error'] },
      input: { type: 'string' },
      output: { type: 'string' },
      context: { type: 'string' },
      expectedOutput: { type: 'string' },
      model: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      spans: { type: 'array', items: { type: 'object' } },
      attributes: { type: 'object' },
    },
    additionalProperties: true,
  },
};

function validateEndpoint(value) {
  let endpoint;
  try { endpoint = new URL(value.trim()); } catch { throw new Error('Enter a valid HTTPS export or query URL.'); }
  if (endpoint.protocol !== 'https:') throw new Error('Use an HTTPS endpoint to protect trace data and credentials in transit.');
  if (endpoint.username || endpoint.password) throw new Error('Remove credentials from the URL. Use the session-only bearer token field.');
  for (const key of endpoint.searchParams.keys()) {
    if (/token|api[_-]?key|secret|password|authorization/i.test(key)) {
      throw new Error('Remove authentication values from the URL. Use the session-only bearer token field.');
    }
  }
  return endpoint.toString();
}

async function readLimitedResponse(response) {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_BYTES) throw new Error('This export exceeds 8 MiB. Narrow the query or export a smaller dataset.');
  if (!response.body?.getReader) {
    const text = await response.text();
    if (new Blob([text]).size > MAX_BYTES) throw new Error('This export exceeds 8 MiB. Narrow the query or export a smaller dataset.');
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BYTES) {
        await reader.cancel();
        throw new Error('This export exceeds 8 MiB. Narrow the query or export a smaller dataset.');
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export default function Connections({ connector, onSave, onImport, onToast }) {
  const [provider, setProvider] = useState(() => PROVIDERS.includes(connector?.provider) ? connector.provider : 'OTLP JSON export');
  const [endpoint, setEndpoint] = useState(connector?.endpoint || '');
  const [service, setService] = useState(connector?.service || 'support-agent');
  const [normalization, setNormalization] = useState(() => connector?.profileId && connector.profileId !== 'auto' ? { profile: connector.profileId, version: connector.profileVersion || '' } : undefined);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [imported, setImported] = useState(null);
  const fileInput = useRef(null);
  const request = useRef(null);
  const mounted = useRef(true);
  const customEndpoint = provider === 'Custom JSON endpoint';
  const stagedAdapter = STAGED_PROVIDERS.has(provider);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, []);

  function changeProvider(event) {
    setProvider(event.target.value);
    setToken('');
    setError('');
  }

  function profileSettings() {
    if (normalization && !TRACE_PROFILES.some(profile => profile.id === normalization.profile && profile.version === normalization.version)) {
      throw new Error('Choose an available exact trace mapping profile version.');
    }
    return { profileId: normalization?.profile ?? 'auto', profileVersion: normalization?.version };
  }

  function saveConfiguration(event) {
    event.preventDefault();
    setError('');
    try {
      const validEndpoint = customEndpoint ? validateEndpoint(endpoint) : '';
      if (!service.trim()) throw new Error('Add a service label so you can identify this trace source.');
      onSave({ provider, endpoint: validEndpoint, service: service.trim(), ...profileSettings(), status: 'configured' });
      onToast?.('Source configuration saved. No external connection has been made.');
    } catch (cause) {
      setError(cause.message || 'The source configuration could not be saved.');
    }
  }

  async function finishImport(payload, label, sourceProvider, sourceEndpoint, mapping) {
    const result = normalizeTraceInput(payload, mapping);
    if (!result.traces?.length) throw new Error('No trace records were found. Export OTLP JSON resourceSpans or a normalized trace array.');
    await onImport(result);
    onSave({ provider: sourceProvider, endpoint: sourceEndpoint, service: service.trim() || 'support-agent', ...mapping, status: 'imported' });
    if (!mounted.current) return;
    setImported({ count: result.traces.length, label, mapping, warnings: result.warnings || [] });
    onToast?.(`${result.traces.length} traces imported. Select Imported traces in your dataset requirements.`);
  }

  async function importFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy('file');
    setError('');
    try {
      if (file.size > MAX_BYTES) throw new Error('This file exceeds 8 MiB. Export a smaller trace dataset.');
      const mapping = profileSettings();
      const text = await file.text();
      if (!mounted.current) return;
      await finishImport(text, file.name, 'OTLP JSON export', '', mapping);
    } catch (cause) {
      if (mounted.current) setError(cause.message || 'The trace file could not be imported.');
    } finally {
      if (mounted.current) setBusy('');
    }
  }

  async function testAndImport() {
    setError('');
    let timer;
    try {
      if (!customEndpoint) throw new Error('Choose Custom JSON endpoint to import from a URL.');
      const validEndpoint = validateEndpoint(endpoint);
      const mapping = profileSettings();
      if (!service.trim()) throw new Error('Add a service label before importing.');
      setBusy('endpoint');
      const controller = new AbortController();
      request.current = controller;
      timer = setTimeout(() => controller.abort(), 15_000);
      const headers = { Accept: 'application/json' };
      if (token.trim()) headers.Authorization = `Bearer ${token.trim()}`;
      const response = await fetch(validEndpoint, {
        method: 'GET',
        headers,
        mode: 'cors',
        credentials: 'omit',
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`The endpoint returned HTTP ${response.status}. Check the query URL and access permissions.`);
      const text = await readLimitedResponse(response);
      if (!mounted.current) return;
      await finishImport(text, new URL(validEndpoint).hostname, 'Custom JSON endpoint', validEndpoint, mapping);
      if (mounted.current) setToken('');
    } catch (cause) {
      if (mounted.current) {
        if (cause.name === 'AbortError') setError('The request timed out after 15 seconds. Try a smaller export or check the endpoint.');
        else if (cause instanceof TypeError) setError('The browser could not read this endpoint. Check the URL, network access, and CORS settings. Redirects are not followed. You can also import an exported JSON file.');
        else setError(cause.message || 'The endpoint could not be imported.');
      }
    } finally {
      clearTimeout(timer);
      request.current = null;
      if (mounted.current) setBusy('');
    }
  }

  return (
    <div className="stack">
      <div className="section-heading">
        <div>
          <h1>Connections</h1>
          <p className="subtext">Bring your existing traces. Keep your observability stack.</p>
        </div>
      </div>

      <div className="callout">
        <Database size={19} aria-hidden="true" />
        <div>
          <strong>{connector?.status === 'imported' ? 'Trace snapshot imported' : connector?.status === 'configured' ? 'Source configured · not connected' : 'Demo dataset · no external connection'}</strong>
          <p className="small muted">{connector?.status === 'imported'
            ? 'Your imported data is available in Datasets. Imports are snapshots; no continuous sync is running.'
            : connector?.status === 'configured'
              ? 'The configuration is saved in this browser. Import a JSON export or test a custom query endpoint to read traces.'
              : 'Explore the complete evaluation workflow with sample traces, then import your own.'}</p>
        </div>
      </div>

      {error ? <div className="callout warning" role="alert"><Info size={18} aria-hidden="true" /><div>{error}</div></div> : null}
      {imported ? (
        <div className="callout" role="status">
          <CheckCircle2 size={19} aria-hidden="true" />
          <div>
            <strong>{imported.count} traces imported from {imported.label}</strong>
            <p className="small muted">Set your evaluation’s dataset source to Imported traces. Semantic metrics without supplied judgments remain unscored.</p>
            <p className="small muted">Mapping: {imported.mapping.profileId === 'auto' ? 'Auto · legacy field mapping' : `${imported.mapping.profileId} @ ${imported.mapping.profileVersion}`}.</p>
            {imported.mapping.profileId !== 'auto' ? <p className="small muted">Choose this mapping in Dataset and save it to make the same raw import reproducible from evaluation YAML.</p> : null}
            {imported.warnings.length ? <details><summary className="small">{imported.warnings.length} import notes</summary><ul className="small">{imported.warnings.slice(0, 8).map((warning, index) => <li key={index}>{String(warning)}</li>)}</ul>{imported.warnings.length > 8 ? <p className="small muted">{imported.warnings.length - 8} more notes. Review the imported dataset for completeness.</p> : null}</details> : null}
          </div>
        </div>
      ) : null}

      <section className="panel"><div className="panel-header"><h2>Import mapping</h2><span className="badge neutral">Files & endpoints</span></div><div className="panel-body"><TraceProfileSelector value={normalization} onChange={setNormalization} disabled={Boolean(busy)} /></div></section>

      <div className="connections-grid">
        <section className="panel">
          <div className="panel-header"><h2>Trace source</h2><span className={`badge ${stagedAdapter ? 'warning' : 'teal'}`}>{stagedAdapter ? 'Adapter contract' : 'Available'}</span></div>
          <form className="panel-body stack" onSubmit={saveConfiguration}>
            <label className="field">
              <span className="field-label">Provider</span>
              <select className="select" value={provider} onChange={changeProvider} disabled={Boolean(busy)}>{PROVIDERS.map((item) => <option key={item}>{item}</option>)}</select>
            </label>
            <label className="field">
              <span className="field-label">Service label</span>
              <input className="input" value={service} onChange={(event) => setService(event.target.value)} placeholder="support-agent" maxLength={120} required />
              <span className="field-hint">A name for this source. Dataset filters use each imported trace’s actual service.</span>
            </label>

            {customEndpoint ? (
              <>
                <label className="field">
                  <span className="field-label">JSON query or export endpoint</span>
                  <input className="input" type="url" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://traces.example.com/api/export" autoComplete="off" required />
                  <span className="field-hint">GET must return OTLP JSON resourceSpans or a normalized trace array. The endpoint must allow this site’s origin through CORS.</span>
                </label>
                <label className="field">
                  <span className="field-label">Bearer token <span className="muted">(optional)</span></span>
                  <input className="input" type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Session only" autoComplete="off" name="tracegrade-session-token" />
                  <span className="field-hint inline"><LockKeyhole size={13} aria-hidden="true" /> Kept in memory for this page only. Never saved with the configuration.</span>
                </label>
              </>
            ) : stagedAdapter ? (
              <div className="callout warning"><Info size={18} aria-hidden="true" /><div><strong>{provider} adapter is contract-only</strong><p className="small">Export OTLP JSON or map to normalized records. This prototype does not include a native {provider} client or send queries to it.</p></div></div>
            ) : (
              <p className="small muted">Import a JSON export from your tracing platform. Resource spans and normalized trace arrays are supported; no endpoint or token is needed.</p>
            )}

            <div className="callout"><Info size={17} aria-hidden="true" /><p className="small">OTLP ingestion endpoints receive telemetry; use your platform’s export or query API to read it.</p></div>
            <div className="form-actions">
              <button className="button secondary" type="submit" disabled={Boolean(busy)}>Save configuration</button>
              {customEndpoint ? <button className="button primary" type="button" onClick={testAndImport} disabled={Boolean(busy)}>{busy === 'endpoint' ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <Link2 size={16} aria-hidden="true" />}{busy === 'endpoint' ? 'Reading traces…' : 'Test & import'}</button> : null}
            </div>
            <p className="field-hint">Save stores configuration only. Custom endpoint reads run in your browser; there is no server proxy.</p>
          </form>
        </section>

        <section className="panel">
          <div className="panel-header"><h2>Import a trace export</h2><FileJson size={18} aria-hidden="true" /></div>
          <div className="panel-body stack">
            <div className="empty-state">
              <Upload size={28} aria-hidden="true" />
              <h3>Your traces, ready to evaluate</h3>
              <p className="subtext">Choose an OTLP JSON export or normalized trace array. Up to 8 MiB per file.</p>
              <button className="button primary" type="button" onClick={() => fileInput.current?.click()} disabled={Boolean(busy)}>{busy === 'file' ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <Upload size={16} aria-hidden="true" />}{busy === 'file' ? 'Importing…' : 'Choose JSON file'}</button>
              <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={importFile} aria-label="Import trace JSON file" />
            </div>
            <div className="divider" />
            <div><h3>Start with a clear contract</h3><p className="small muted">Use the example to map an export from any tracing backend. Two example records are included; adjust your dataset’s minimum sample count when trying them.</p></div>
            <div className="inline">
              <button type="button" className="button secondary" onClick={() => download(JSON.stringify(SAMPLE_TRACES, null, 2), 'tracegrade-example-traces.json')}><Download size={15} aria-hidden="true" /> Sample JSON</button>
              <button type="button" className="button ghost" onClick={() => download(JSON.stringify(TRACE_SCHEMA, null, 2), 'tracegrade-trace-schema.json')}><Download size={15} aria-hidden="true" /> JSON schema</button>
            </div>
            <p className="field-hint">The sample is already normalized; select Auto when importing it. Explicit team profiles require OTLP resourceSpans with the declared fields.</p>
            <p className="field-hint">Imported traces and evaluation results are saved in this browser. Import only data you intend to keep in this prototype.</p>
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-header"><h2>Adapter contract</h2><span className="badge neutral">Read → normalize → evaluate</span></div>
        <div className="panel-body"><p className="subtext">Preserve trace identity and evidence when mapping your platform’s export. Missing measurements stay unscored.</p></div>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th scope="col">Evaluation field</th><th scope="col">Normalized record</th><th scope="col">What to preserve</th></tr></thead>
            <tbody>
              <tr><td>Trace identity</td><td><code>id · traceId · spans</code></td><td className="muted">Stable trace IDs, span IDs, parent relationships</td></tr>
              <tr><td>Dataset selection</td><td><code>service · environment · startedAt</code></td><td className="muted">Service name, environment, ISO timestamp</td></tr>
              <tr><td>Evaluation evidence</td><td><code>input · output · context</code></td><td className="muted">User request, agent response, retrieved context</td></tr>
              <tr><td>Measured behavior</td><td><code>durationMs · costUsd · status</code></td><td className="muted">Milliseconds, USD cost, actual success or error</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
