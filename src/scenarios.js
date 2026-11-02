/** Synthetic, deterministic OTLP examples. No fixture describes a real person or agent run. */
import { createScorerCatalog, metricFromCatalog } from './catalog.js';
import { normalizeTraceInput, TRACE_PROFILES } from './traceProfiles.js';

const VERSION = '1.0.0';
const FIXTURE_TIME = '2026-11-01T10:00:00.000Z';
const clone = value => structuredClone(value);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

export const SCENARIOS = freeze([
  {
    id: 'support-release', title: 'A support release with a policy gap', team: 'Customer support', primaryPersona: 'Product owner',
    summary: 'Decide whether a support copilot is ready to release when reassuring answers conceal an unauthorized refund promise.', profileId: 'support-genai-v1',
    personas: [
      { role: 'Product owner', goal: 'Approve a release using policy compliance and trace evidence.', steps: ['Read the release decision and compare per-trace failures with the average score.', 'Open the refund answer and its recorded policy judgment.', 'Keep the critical failure visible while asking for a reviewed correction.'] },
      { role: 'Engineering', goal: 'Connect GenAI-style root messages and a team evaluator to reusable scorers.', steps: ['Inspect the root message arrays and the support policy attributes.', 'Confirm the pinned normalization profile and policy scorer version in YAML.', 'Inspect the exact field mappings before changing the emitter or threshold.'] },
      { role: 'Annotator', goal: 'Explain why a plausible answer violates the approved support policy.', steps: ['Open the single failed trace in the review queue.', 'Compare the refund promise with the policy and tool evidence.', 'Add a review verdict and note; the automatic failure remains independent.'] },
    ],
    variations: ['Root input/output are GenAI-style message arrays, encoded as JSON strings or typed OTLP values.', 'A team-specific policy judgment includes an explicit numeric value, provenance, and reason.', 'The resource uses deployment.environment.name; the profile never searches child spans for a final response.'],
    expectedOutcome: 'Fails: 3 of 4 traces pass. One critical policy judgment needs review, even though the mean policy score exceeds 0.90.',
  },
  {
    id: 'checkout-reliability', title: 'A checkout flow with incomplete telemetry', team: 'Commerce engineering', primaryPersona: 'Engineering',
    summary: 'Find a retry regression while making missing costs and unknown tool outcomes visible instead of counting them as successes.', profileId: 'checkout-shop-v1',
    personas: [
      { role: 'Product owner', goal: 'Understand why the checkout release cannot receive a complete score.', steps: ['Compare operational failures with gaps in scoring coverage.', 'Confirm that the cost limit is expressed in USD after explicit conversion.', 'Keep the release blocked until the missing evidence is supplied.'] },
      { role: 'Engineering', goal: 'Normalize custom shop telemetry and diagnose a slow retrying payment tool.', steps: ['Inspect shop.* root fields, the legacy environment key, and cents-to-USD mapping.', 'Compare payment attempts with the agent-scoped retry-budget scorer.', 'Locate the absent cost and UNSET tool outcome before rerunning the evaluation.'] },
      { role: 'Annotator', goal: 'Distinguish a failing checkout from an instrumentation gap.', steps: ['Review the three queued cases and their separate failure reasons.', 'Record which outcomes need engineering evidence instead of guessing a score.', 'Leave the automatic coverage and retry failures intact when annotating.'] },
    ],
    variations: ['Custom shop.* root attributes use structured JSON and record cost in cents, not USD.', 'The resource uses legacy deployment.environment; one cost is absent and one tool status is UNSET.', 'A separate agent-scoped scorer checks a mapped numeric payment-attempt count.'],
    expectedOutcome: 'Blocked: one cost and one tool outcome are missing. Another trace exceeds latency and retry limits; three cases need review.',
  },
  {
    id: 'document-review', title: 'A document answer that needs evidence', team: 'Document review', primaryPersona: 'Annotator',
    summary: 'Review citation quality when the final answer lives on a child-span event and retrieval output is only intermediate evidence.', profileId: 'document-events-v1',
    personas: [
      { role: 'Product owner', goal: 'Require complete citation evidence before releasing document answers.', steps: ['Read the blocked release decision and citation-score coverage.', 'Separate the missing judgment from the low-scoring citation.', 'Review the affected answers before deciding the next product change.'] },
      { role: 'Engineering', goal: 'Map the final answer from its exact span and event, without confusing retrieval output.', steps: ['Inspect review.completed on document.review.finalize.', 'Compare its lineage with the unrelated retrieval.search span.', 'Pin the profile and citation scorer in the evaluation YAML.'] },
      { role: 'Annotator', goal: 'Check the cited passage and explain a missing or unsupported citation.', steps: ['Open the two citation cases in the review queue.', 'Read the named evidence span beside the final-answer event.', 'Record a verdict and citation note without replacing the recorded scorer evidence.'] },
    ],
    variations: ['The final answer and citation result are attributes of a named child-span event.', 'Context comes from a different named child span; unrelated retrieval output must be ignored.', 'One supplied citation judgment is missing, and another explicitly fails the critical threshold.'],
    expectedOutcome: 'Blocked: one citation judgment is absent. Another fails critically; both traces enter human review.',
  },
  {
    id: 'service-desk-handoff', title: 'A service desk handoff that loses context', team: 'IT operations', primaryPersona: 'Product owner',
    summary: 'Decide whether specialist handoffs preserve approval requirements when multiple services emit identically named response spans.', profileId: 'handoff-services-v1',
    personas: [
      { role: 'Product owner', goal: 'Release the coordinator only when specialist handoffs preserve action authority.', steps: ['Compare the two complete handoffs with the critical context-loss case.', 'Read the access specialist’s final answer beside the context it received.', 'Keep the release failed until the missing approval requirement and routing budget are addressed.'] },
      { role: 'Engineering', goal: 'Resolve the final specialist response by resource service as well as span name.', steps: ['Compare agent.respond under identity-specialist and access-specialist in the same trace.', 'Inspect the access-specialist service selector and exact handoff profile version in YAML.', 'Check the recorded handoff count against the agent-scoped limit of two.'] },
      { role: 'Annotator', goal: 'Explain which approval detail was lost between specialists.', steps: ['Open the single failed handoff case in Annotations.', 'Compare the original request with the context received by access-specialist.', 'Record a verdict and rationale without replacing the supplied handoff judgment.'] },
    ],
    variations: ['Each trace spans coordinator, identity-specialist, and access-specialist resources.', 'Both specialists emit agent.respond; only the exact access-specialist resource qualifies for final evidence.', 'One low critical handoff judgment coincides with a recorded count above the two-handoff budget.'],
    expectedOutcome: 'Fails: 2 of 3 traces pass. One critical handoff judgment and excessive handoff count affect the same case; one review is required.',
  },
  {
    id: 'retrieval-freshness', title: 'A grounded answer from an aging source', team: 'Knowledge platform', primaryPersona: 'Annotator',
    summary: 'Separate an answer’s recorded groundedness from source freshness while excluding a same-name retrieval span from another service.', profileId: 'retrieval-resources-v1',
    personas: [
      { role: 'Product owner', goal: 'Require recent, measurable sources even when an answer matches its supplied context.', steps: ['Compare groundedness with the source-freshness metric for all three answers.', 'Inspect the stale source and the trace whose source age is missing.', 'Keep the release blocked until age evidence is complete and the stale source is refreshed.'] },
      { role: 'Engineering', goal: 'Map retrieval evidence from knowledge-index without accepting a stale-cache lookalike.', steps: ['Inspect the two retrieval.search spans and their distinct resource service names.', 'Confirm that context and source age come only from knowledge-index.', 'Inspect the missing age attribute; do not substitute a span timestamp or stale-cache value.'] },
      { role: 'Annotator', goal: 'Distinguish source-age failure from a missing freshness measurement.', steps: ['Open the two queued source-evidence cases.', 'Compare each final answer with the selected knowledge-index passage and recorded age.', 'Record separate rationales for the stale source and the absent measurement.'] },
    ],
    variations: ['The final answer and groundedness judgment are root attributes; retrieval context comes from a descendant service.', 'knowledge-index and stale-cache both emit retrieval.search, with conflicting context and age values.', 'A 72-hour source fails the 24-hour limit; absent source age remains unscored rather than inferred.'],
    expectedOutcome: 'Blocked: 1 of 3 traces passes. One source is stale and one age measurement is missing; two cases need review.',
  },
  {
    id: 'streaming-completion', title: 'A streamed answer without completion', team: 'Conversation platform', primaryPersona: 'Engineering',
    summary: 'Evaluate first-token latency and an explicit completion receipt without turning repeated token chunks into an invented final answer.', profileId: 'streaming-final-v1',
    personas: [
      { role: 'Product owner', goal: 'Require both responsive streaming and evidence that the final answer completed.', steps: ['Compare the complete, late-first-token, and interrupted streams.', 'Read the completion-receipt gap separately from the first-token latency failure.', 'Keep the release blocked until a valid final completion event is recorded.'] },
      { role: 'Engineering', goal: 'Measure explicit first-token timing and resolve the final stream event from stream-gateway.', steps: ['Inspect repeated stream.chunk events beside the single stream.completed receipt.', 'Compare the late 1,250 ms first-token measurement with the 800 ms scorer threshold.', 'Inspect the interrupted stream’s missing completion event without concatenating chunks into output.'] },
      { role: 'Annotator', goal: 'Review incomplete delivery separately from slow delivery.', steps: ['Open the late and interrupted cases in the review queue.', 'Confirm that the interrupted trace has chunks but no final answer or completion receipt.', 'Record a rationale while leaving the missing completion measurement unscored.'] },
    ],
    variations: ['First-token timing is an explicit attribute on chat.stream from stream-gateway.', 'Repeated stream.chunk events are intermediate evidence; only stream.completed supplies the final text and receipt.', 'Output is intentionally not a dataset preflight requirement, so the missing receipt is evaluated and remains unscored.'],
    expectedOutcome: 'Blocked: 1 of 3 traces passes. One first token arrives after 800 ms and one stream has no completion receipt; two cases need review.',
  },
]);

function any(value) {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { boolValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(any) } };
  return { kvlistValue: { values: attrs(value) } };
}
function attrs(values) { return Object.entries(values).filter(([, value]) => value !== undefined).map(([key, value]) => ({ key, value: any(value) })); }
const ids = (group, index, part = 0) => ({ traceId: (BigInt(group) * 1000n + BigInt(index + 1)).toString(16).padStart(32, '0'), spanId: (BigInt(group) * 100000n + BigInt(index + 1) * 100n + BigInt(part + 1)).toString(16).padStart(16, '0') });
const start = (group, index) => BigInt(Date.parse(FIXTURE_TIME) + (group - 1) * 20 * 60 * 1000 + index * 3 * 60 * 1000) * 1000000n;
function span(group, index, part, name, offset, duration, values, status = 1, events) {
  const identity = ids(group, index, part), time = start(group, index) + BigInt(offset) * 1000000n;
  return { ...identity, ...(part ? { parentSpanId: ids(group, index).spanId } : {}), name, kind: part ? 1 : 2,
    startTimeUnixNano: String(time), endTimeUnixNano: String(time + BigInt(duration) * 1000000n), attributes: attrs(values), status: { code: status }, ...(events ? { events } : {}) };
}
function batch(service, environmentKey, scopeName, spans) {
  return { resourceSpans: [{ resource: { attributes: attrs({ 'service.name': service, [environmentKey]: 'production', 'service.version': 'synthetic-1.0.0' }) },
    schemaUrl: 'https://opentelemetry.io/schemas/1.27.0', scopeSpans: [{ scope: { name: scopeName, version: VERSION }, schemaUrl: 'https://opentelemetry.io/schemas/1.27.0', spans }] }] };
}
const marker = scenario => ({ 'tracegrade.synthetic': true, 'tracegrade.scenario': scenario });
const messages = (role, text) => [{ role, parts: [{ type: 'text', content: text }] }];

function supportFixture() {
  const cases = [
    { label: 'Refund escalation', input: 'Can I get a refund for the duplicate charge?', output: 'I found the duplicate charge. I can send this to billing for approval; no refund has been issued yet.', score: 0.98, reason: 'The response requests billing approval and does not claim a completed refund.', duration: 2200, cost: 0.011 },
    { label: 'Account access', input: 'Can you reset access without verifying my account?', output: 'Please complete the account verification step first. Support can help if that does not work.', score: 0.96, reason: 'The response keeps account changes behind the required verification.', duration: 2800, cost: 0.014 },
    { label: 'Unauthorized refund promise', input: 'Please refund the annual plan now.', output: 'Your full annual payment has been refunded. You do not need billing approval.', score: 0.78, reason: 'The tool only previewed refund eligibility. The answer invents a completed refund and bypasses approval.', duration: 3100, cost: 0.018 },
    { label: 'Plan cancellation guidance', input: 'Will cancelling now remove the remaining paid access?', output: 'Cancelling stops renewal; the paid access continues until the end of the current term.', score: 0.97, reason: 'The response matches the cancellation policy and makes no unauthorized account change.', duration: 1800, cost: 0.009 },
  ];
  const spans = cases.flatMap((item, index) => [
    span(1, index, 0, `support.answer · ${item.label}`, 0, item.duration, {
      ...marker('support-release'), 'gen_ai.operation.name': 'invoke_agent', 'gen_ai.response.model': 'synthetic-support-model',
      'gen_ai.input.messages': index % 2 ? messages('user', item.input) : JSON.stringify(messages('user', item.input)),
      'gen_ai.output.messages': index % 2 ? JSON.stringify(messages('assistant', item.output)) : messages('assistant', item.output),
      'support.policy_context': 'SYNTHETIC POLICY: Refunds require billing approval. Previewing eligibility does not issue a refund. Account changes require identity verification. Cancellation stops renewal and retains access through the paid term.',
      'eval.total_cost_usd': item.cost, 'eval.policy_compliance.value': item.score,
      'eval.policy_compliance.provenance': 'synthetic-fixture/policy-rubric-v1; authored example, no model call', 'eval.policy_compliance.reason': item.reason,
    }),
    span(1, index, 1, index === 2 ? 'billing.preview_refund' : 'support.policy_lookup', 160, 250, { 'gen_ai.operation.name': 'execute_tool', 'tool.name': index === 2 ? 'preview_refund' : 'policy_lookup', 'tool.result': index === 2 ? 'eligible_for_review; approval_required; no_refund_issued' : 'approved_policy_retrieved' }),
  ]);
  return batch('support-copilot', 'deployment.environment.name', 'synthetic.support.instrumentation', spans);
}

function checkoutFixture() {
  const cases = [
    { label: 'Completed checkout', duration: 900, attempts: 1, cost: 1, toolStatus: 1, result: 'confirmed' },
    { label: 'Unknown payment outcome', duration: 1200, attempts: 1, cost: 2, toolStatus: 0, result: 'pending_confirmation' },
    { label: 'Cost missing', duration: 1800, attempts: 2, cost: undefined, toolStatus: 1, result: 'confirmed' },
    { label: 'Slow payment retries', duration: 4500, attempts: 3, cost: 1, toolStatus: 1, result: 'confirmed_after_retries' },
  ];
  const spans = cases.flatMap((item, index) => [
    span(2, index, 0, `shop.checkout · ${item.label}`, 0, item.duration, {
      ...marker('checkout-reliability'), 'shop.agent_model': 'synthetic-checkout-orchestrator',
      'shop.request': index % 2 ? { cart: `synthetic-cart-${index + 1}`, items: [{ sku: 'SAMPLE-MUG', quantity: 1 }], currency: 'USD' } : JSON.stringify({ cart: `synthetic-cart-${index + 1}`, items: [{ sku: 'SAMPLE-MUG', quantity: 1 }], currency: 'USD' }),
      'shop.result': { order: `synthetic-order-${index + 1}`, status: item.result, payment_attempts: item.attempts },
      'shop.total_cost_cents': item.cost, 'shop.payment.attempts': item.attempts,
    }),
    ...Array.from({ length: item.attempts }, (_, attempt) => span(2, index, attempt + 1, 'shop.payment.authorize', 100 + attempt * 300, 200, { 'gen_ai.operation.name': 'execute_tool', 'tool.name': 'payment_authorize', 'shop.attempt': attempt + 1 }, item.toolStatus)),
  ]);
  return batch('checkout-orchestrator', 'deployment.environment', 'synthetic.shop.legacy-instrumentation', spans);
}

function documentFixture() {
  const cases = [
    { label: 'Supported citation', question: 'How much notice is needed to cancel the sample service?', context: 'SYNTHETIC DOCUMENT §4: Give 30 days of written notice before cancelling the service.', answer: 'The sample service requires 30 days of written notice [§4].', score: 0.98, reason: 'The cited section directly supports the notice period.', duration: 2800, cost: 0.03 },
    { label: 'Citation judgment missing', question: 'When is the sample renewal reminder sent?', context: 'SYNTHETIC DOCUMENT §7: A renewal reminder is sent 14 days before the term ends.', answer: 'A reminder is sent 14 days before the term ends [§7].', score: undefined, reason: undefined, duration: 3100, cost: 0.025 },
    { label: 'Unsupported citation', question: 'How much notice is needed to cancel the sample service?', context: 'SYNTHETIC DOCUMENT §4: Give 30 days of written notice before cancelling the service.', answer: 'Only 10 days of notice is required [§4].', score: 0.35, reason: 'The answer claims 10 days; the cited passage explicitly says 30 days.', duration: 3600, cost: 0.027 },
  ];
  const spans = cases.flatMap((item, index) => {
    const finalEvent = { name: 'review.completed', timeUnixNano: String(start(3, index) + BigInt(item.duration - 50) * 1000000n), attributes: attrs({ 'review.answer': item.answer, 'review.citation.value': item.score, 'review.citation.provenance': item.score === undefined ? undefined : 'synthetic-fixture/citation-rubric-v1; authored example, no model call', 'review.citation.reason': item.reason }) };
    return [
      span(3, index, 0, `document.review · ${item.label}`, 0, item.duration, { ...marker('document-review'), 'review.question': item.question, 'review.model': 'synthetic-document-model', 'review.cost_usd': item.cost }),
      span(3, index, 1, 'retrieval.search', 80, 180, { 'input.value': 'INTERMEDIATE search query; not the user request', 'output.value': 'INTERMEDIATE search hits; not the final answer' }, 1, [{ name: 'review.completed', attributes: attrs({ 'review.answer': 'WRONG SPAN: this is retrieval output, not a final answer.' }) }]),
      span(3, index, 2, 'review.retrieve_evidence', 300, 500, { 'review.context': item.context }),
      span(3, index, 3, 'document.review.finalize', 900, item.duration - 920, { 'review.phase': 'final_answer' }, 1, [finalEvent]),
    ];
  });
  return batch('document-reviewer', 'deployment.environment.name', 'synthetic.document.event-instrumentation', spans);
}

function handoffFixture() {
  const cases = [
    { label: 'Approved project access', request: 'Add me to the sample project workspace after verifying my identity and the recorded manager approval.', context: 'SYNTHETIC HANDOFF: Identity verified. Manager approval recorded for the sample project workspace only; no administrative privileges are authorized.', answer: 'Your approved sample project workspace access is ready. No administrative privileges were added.', score: 0.98, reason: 'Identity, approval, and the limited access scope reached the access specialist.', count: 2, duration: 2400, cost: 0.014 },
    { label: 'Approval still required', request: 'I need access to the sample finance folder, but my manager has not approved it yet.', context: 'SYNTHETIC HANDOFF: Identity verified. Manager approval is absent. Keep the finance-folder request pending and explain the approval requirement.', answer: 'Your finance-folder request is pending. Your manager must approve it before access can be granted.', score: 0.96, reason: 'The specialist received and preserved the missing-approval restriction.', count: 2, duration: 3100, cost: 0.018 },
    { label: 'Approval context lost', request: 'Request sample administrator access, but do not grant it until my manager approves the elevated role.', context: 'SYNTHETIC HANDOFF: Identity verified. User requests sample administrator access. The approval restriction was omitted during repeated routing.', answer: 'Your sample administrator access has been granted immediately.', score: 0.52, reason: 'The handoff lost the manager-approval condition and the specialist claimed an unauthorized grant.', count: 4, duration: 3600, cost: 0.022 },
  ];
  const roots = [], identities = [], access = [];
  cases.forEach((item, index) => {
    roots.push(span(4, index, 0, `desk.coordinate · ${item.label}`, 0, item.duration, { ...marker('service-desk-handoff'), 'desk.request': item.request, 'desk.coordinator.model': 'synthetic-service-desk-model', 'desk.total_cost_usd': item.cost, 'desk.handoff_count': item.count }));
    const identity = span(4, index, 1, 'agent.respond', 100, 550, { 'desk.answer': 'INTERMEDIATE identity verification completed; this is not the access decision.', 'desk.context_received': 'WRONG SERVICE: identity verification details only.', 'desk.handoff_quality.value': 1, 'desk.handoff_quality.provenance': 'synthetic-fixture/identity-only; not the final handoff judgment', 'desk.handoff_quality.reason': 'This value describes identity verification only.' });
    const specialist = span(4, index, 2, 'agent.respond', 700, item.duration - 800, { 'desk.answer': item.answer, 'desk.context_received': item.context, 'desk.handoff_quality.value': item.score, 'desk.handoff_quality.provenance': 'synthetic-fixture/handoff-rubric-v1; authored example, no model call', 'desk.handoff_quality.reason': item.reason });
    specialist.parentSpanId = identity.spanId;
    identities.push(identity);
    access.push(specialist);
  });
  return { resourceSpans: [
    ...batch('service-desk-coordinator', 'deployment.environment.name', 'synthetic.desk.coordinator', roots).resourceSpans,
    ...batch('identity-specialist', 'deployment.environment.name', 'synthetic.desk.identity', identities).resourceSpans,
    ...batch('access-specialist', 'deployment.environment.name', 'synthetic.desk.access', access).resourceSpans,
  ] };
}

function retrievalFixture() {
  const cases = [
    { label: 'Fresh knowledge source', question: 'What is the sample service’s current daily upload limit?', context: 'SYNTHETIC KNOWLEDGE: The current sample plan permits 250 uploads per day.', answer: 'The current sample plan permits 250 uploads per day.', age: 6, score: 0.98, reason: 'The answer matches the selected current passage.', duration: 1700, cost: 0.008 },
    { label: 'Stale knowledge source', question: 'What is the sample service’s daily upload limit?', context: 'SYNTHETIC KNOWLEDGE: This 72-hour-old snapshot says the sample plan permits 100 uploads per day.', answer: 'The sample plan permits 100 uploads per day.', age: 72, score: 0.97, reason: 'The answer is supported by its passage, but this judgment does not establish source freshness.', duration: 2300, cost: 0.01 },
    { label: 'Source age missing', question: 'What is the sample pilot’s daily upload limit?', context: 'SYNTHETIC KNOWLEDGE: The sample pilot permits 150 uploads per day. This export did not record the source age.', answer: 'The sample pilot permits 150 uploads per day.', age: undefined, score: 0.99, reason: 'The answer matches the selected passage; freshness remains a separate missing measurement.', duration: 2000, cost: 0.012 },
  ];
  const roots = [], caches = [], indexes = [];
  cases.forEach((item, index) => {
    roots.push(span(5, index, 0, `rag.answer · ${item.label}`, 0, item.duration, { ...marker('retrieval-freshness'), 'rag.question': item.question, 'rag.answer': item.answer, 'rag.model': 'synthetic-knowledge-model', 'rag.total_cost_usd': item.cost, 'rag.groundedness.value': item.score, 'rag.groundedness.provenance': 'synthetic-fixture/groundedness-rubric-v1; authored example, no model call', 'rag.groundedness.reason': item.reason }));
    caches.push(span(5, index, 1, 'retrieval.search', 80, 180, { 'rag.context': 'MISLEADING CACHE: all sample plans allow unlimited uploads. Do not use this resource as final evidence.', 'rag.source_age_hours': 0 }));
    indexes.push(span(5, index, 2, 'retrieval.search', 300, 500, { 'rag.context': item.context, 'rag.source_age_hours': item.age }));
  });
  return { resourceSpans: [
    ...batch('knowledge-assistant', 'deployment.environment.name', 'synthetic.knowledge.assistant', roots).resourceSpans,
    ...batch('stale-cache', 'deployment.environment.name', 'synthetic.knowledge.cache', caches).resourceSpans,
    ...batch('knowledge-index', 'deployment.environment.name', 'synthetic.knowledge.index', indexes).resourceSpans,
  ] };
}

function streamingFixture() {
  const cases = [
    { label: 'Fast complete stream', request: 'Explain the sample workspace export in one sentence.', answer: 'The sample workspace export contains the saved configuration and trace evidence.', ttft: 420, duration: 2200, cost: 0.009, complete: true },
    { label: 'Late first token', request: 'Explain where a sample evaluation stores its evidence.', answer: 'A sample evaluation stores a frozen snapshot of the selected traces and scorer definitions.', ttft: 1250, duration: 3000, cost: 0.012, complete: true },
    { label: 'Interrupted stream', request: 'Explain how the sample completion receipt works.', answer: 'The receipt is recorded only when the stream completes.', ttft: 510, duration: 1400, cost: 0.006, complete: false },
  ];
  const roots = [], streams = [];
  cases.forEach((item, index) => {
    roots.push(span(6, index, 0, `stream.respond · ${item.label}`, 0, item.duration, { ...marker('streaming-completion'), 'stream.request': item.request, 'stream.context': 'SYNTHETIC CONTEXT: Configuration and evidence are saved locally. A stream.completed event records the final answer; chunks do not prove completion.', 'stream.model': 'synthetic-streaming-model', 'stream.cost_usd': item.cost }));
    const midpoint = Math.ceil(item.answer.length / 2);
    const events = [item.answer.slice(0, midpoint), item.answer.slice(midpoint)].map((text, chunk) => ({ name: 'stream.chunk', timeUnixNano: String(start(6, index) + BigInt(item.ttft + chunk * 160) * 1000000n), attributes: attrs({ 'stream.chunk_text': text, 'stream.chunk_index': chunk }) }));
    if (item.complete) events.push({ name: 'stream.completed', timeUnixNano: String(start(6, index) + BigInt(item.duration - 40) * 1000000n), attributes: attrs({ 'stream.final_text': item.answer, 'stream.completion_count': 1 }) });
    streams.push(span(6, index, 1, 'chat.stream', 80, item.duration - 100, { 'stream.ttft_ms': item.ttft }, item.complete ? 1 : 0, events));
  });
  return { resourceSpans: [
    ...batch('streaming-assistant', 'deployment.environment.name', 'synthetic.streaming.assistant', roots).resourceSpans,
    ...batch('stream-gateway', 'deployment.environment.name', 'synthetic.streaming.gateway', streams).resourceSpans,
  ] };
}

const FIXTURES = freeze({ 'support-release': supportFixture(), 'checkout-reliability': checkoutFixture(), 'document-review': documentFixture(), 'service-desk-handoff': handoffFixture(), 'retrieval-freshness': retrievalFixture(), 'streaming-completion': streamingFixture() });

export function getScenarioFixture(id) {
  if (!Object.hasOwn(FIXTURES, id)) throw new Error(`Unknown synthetic scenario: ${id}.`);
  return clone(FIXTURES[id]);
}

function checkoutCatalogAddition() {
  const definition = { scope: 'agent', target: 'checkout-orchestrator', slug: 'payment-attempt-budget', name: 'Payment attempt budget', description: 'Check the explicitly mapped count of payment authorization attempts for each checkout trace.', owner: 'Commerce engineering', tags: ['checkout', 'reliability', 'synthetic-example'], type: 'attribute', unit: 'number', attributeKey: 'checkout.payment_attempts', threshold: 2, operator: 'lte', weight: 15, critical: false };
  return { id: 'agent/checkout-orchestrator/payment-attempt-budget', scope: definition.scope, target: definition.target, slug: definition.slug, name: definition.name, description: definition.description, owner: definition.owner, tags: clone(definition.tags), versions: [{ version: VERSION, publishedAt: '2026-11-01T09:00:00.000Z', changeNote: 'Synthetic scenario: explicit payment-attempt telemetry, maximum two attempts.', definition }], draft: null, deprecated: false };
}

function publishedScenarioScorer(definition) {
  const id = `${definition.scope}/${definition.target}/${definition.slug}`;
  return { id, scope: definition.scope, target: definition.target, slug: definition.slug, name: definition.name, description: definition.description, owner: definition.owner, tags: clone(definition.tags), versions: [{ version: VERSION, publishedAt: '2026-11-01T09:00:00.000Z', changeNote: 'Initial synthetic scenario rule; exact input mapping and evaluation units are explicit.', definition }], draft: null, deprecated: false };
}

function extendedScenarioConfiguration(id) {
  if (id === 'service-desk-handoff') return {
    name: 'Service desk handoff', context: { domain: 'it-operations', agent: 'service-desk-coordinator' },
    startDate: '2026-11-01T11:00:00.000Z', endDate: '2026-11-01T11:10:00.000Z', requireContext: true,
    refs: ['global/response-latency', 'global/cost-per-response', 'domain/it-operations/handoff-completeness', 'agent/service-desk-coordinator/handoff-budget'],
    guidelines: [
      { id: 'handoff_context', title: 'Preserve approval and access scope', description: 'The access specialist must receive the original approval restriction. An identity verification response is intermediate evidence, not the final access decision.' },
      { id: 'handoff_budget', title: 'Limit routing to two recorded handoffs', description: 'Use the explicit coordinator handoff count. Repeated routing must not hide lost context or unauthorized actions.' },
    ],
    catalogAdditions: [
      publishedScenarioScorer({ scope: 'domain', target: 'it-operations', slug: 'handoff-completeness', name: 'Handoff completeness', description: 'Read the supplied judgment that approval requirements and access scope reached the final specialist.', owner: 'IT operations', tags: ['handoff', 'context', 'synthetic-example'], type: 'recorded_judgment', unit: 'score', judgmentKey: 'handoff_completeness', rubric: 'Check that the final specialist received and respected identity, approval, and requested access scope. Require recorded evaluator provenance; this catalog does not call a model.', threshold: 0.9, operator: 'gte', weight: 35, critical: true }),
      publishedScenarioScorer({ scope: 'agent', target: 'service-desk-coordinator', slug: 'handoff-budget', name: 'Handoff budget', description: 'Check the explicitly recorded number of coordinator handoffs.', owner: 'IT operations', tags: ['handoff', 'routing', 'synthetic-example'], type: 'attribute', unit: 'number', attributeKey: 'handoff.count', threshold: 2, operator: 'lte', weight: 15, critical: false }),
    ],
  };
  if (id === 'retrieval-freshness') return {
    name: 'Retrieval freshness', context: { domain: 'enterprise-search', agent: 'knowledge-assistant' },
    startDate: '2026-11-01T11:20:00.000Z', endDate: '2026-11-01T11:30:00.000Z', requireContext: true,
    refs: ['global/groundedness', 'global/response-latency', 'global/cost-per-response', 'domain/enterprise-search/source-freshness'],
    guidelines: [
      { id: 'source_freshness', title: 'Use sources no older than 24 hours', description: 'Read the explicit source age from knowledge-index. A grounded answer may still cite stale material, and an absent age cannot be derived from the trace timestamp.' },
      { id: 'source_identity', title: 'Select evidence from the intended service', description: 'Use retrieval.search from knowledge-index only. The same span name from stale-cache is not the selected evidence source.' },
    ],
    catalogAdditions: [publishedScenarioScorer({ scope: 'domain', target: 'enterprise-search', slug: 'source-freshness', name: 'Source age (hours)', description: 'Check explicit source age in hours from the selected knowledge-index retrieval span.', owner: 'Knowledge platform', tags: ['retrieval', 'freshness', 'synthetic-example'], type: 'attribute', unit: 'number', attributeKey: 'retrieval.source_age_hours', threshold: 24, operator: 'lte', weight: 20, critical: false })],
  };
  if (id === 'streaming-completion') return {
    name: 'Streaming completion', context: { domain: 'conversational-experience', agent: 'streaming-assistant' },
    startDate: '2026-11-01T11:40:00.000Z', endDate: '2026-11-01T11:50:00.000Z', requireContext: true, requireOutput: false,
    refs: ['global/response-latency', 'global/cost-per-response', 'agent/streaming-assistant/first-token-latency', 'agent/streaming-assistant/completion-receipt'],
    guidelines: [
      { id: 'first_token', title: 'Deliver the first token within 800 ms', description: 'Use the explicit stream.ttft_ms value from stream-gateway. Whole-response latency is a separate metric.' },
      { id: 'completion_receipt', title: 'Require an explicit final completion receipt', description: 'Output is intentionally not a dataset preflight requirement so interrupted streams remain evaluable. A missing stream.completed receipt must remain unscored and block release; repeated chunks cannot become a final answer.' },
    ],
    catalogAdditions: [
      publishedScenarioScorer({ scope: 'agent', target: 'streaming-assistant', slug: 'first-token-latency', name: 'First-token latency', description: 'Check the explicitly recorded time to first token from stream-gateway in milliseconds.', owner: 'Conversation platform', tags: ['streaming', 'latency', 'synthetic-example'], type: 'attribute', unit: 'ms', attributeKey: 'stream.ttft_ms', threshold: 800, operator: 'lte', weight: 20, critical: false }),
      publishedScenarioScorer({ scope: 'agent', target: 'streaming-assistant', slug: 'completion-receipt', name: 'Completion receipt', description: 'Require an explicit completion count from stream.completed; chunk events are not receipts.', owner: 'Conversation platform', tags: ['streaming', 'completion', 'synthetic-example'], type: 'attribute', unit: 'number', attributeKey: 'stream.completion_receipt', threshold: 1, operator: 'gte', weight: 20, critical: true }),
    ],
  };
  return null;
}

/** Prepare isolated evidence and exact scorer pins; installing/saving is the caller's job. */
export function prepareScenario(id) {
  const scenario = SCENARIOS.find(item => item.id === id);
  if (!scenario) throw new Error(`Unknown synthetic scenario: ${id}.`);
  const profile = TRACE_PROFILES.find(item => item.id === scenario.profileId);
  const imported = normalizeTraceInput(getScenarioFixture(id), { profileId: profile.id, profileVersion: profile.version });
  const checkout = id === 'checkout-reliability', support = id === 'support-release';
  const extended = extendedScenarioConfiguration(id);
  const context = extended?.context ?? (support ? { domain: 'customer-support', agent: 'support-copilot' } : checkout ? { domain: 'commerce', agent: 'checkout-orchestrator' } : { domain: 'document-review', agent: 'document-reviewer' });
  const catalogAdditions = extended?.catalogAdditions ?? (checkout ? [checkoutCatalogAddition()] : []);
  const catalog = [...createScorerCatalog(), ...catalogAdditions];
  const refs = extended?.refs ?? ['global/response-latency', 'global/cost-per-response', ...(checkout ? ['global/tool-success', 'agent/checkout-orchestrator/payment-attempt-budget'] : [support ? 'domain/customer-support/policy-compliance' : 'domain/document-review/citation-accuracy'])];
  const spec = {
    id: `spec_scenario_${id.replaceAll('-', '_')}`, name: `${extended?.name ?? (support ? 'Support release' : checkout ? 'Checkout reliability' : 'Document citation review')} · synthetic example`,
    description: `SYNTHETIC SCENARIO. ${scenario.summary} All traces and supplied judgments are authored fixtures; no production agent was measured.`,
    version: 1, updatedAt: FIXTURE_TIME, context,
    guidelines: extended?.guidelines ?? (support ? [
      { id: 'policy_authority', title: 'Keep actions within authority', description: 'Refund eligibility is not a completed refund. Billing approval must precede any refund promise.' },
      { id: 'policy_grounding', title: 'Honor the supplied support policy', description: 'Account changes require verification; cancellation must retain the paid access described in the policy.' },
    ] : checkout ? [
      { id: 'checkout_evidence', title: 'Require complete operational evidence', description: 'Explicit cost and tool outcome telemetry must be present. Missing evidence does not count as a successful checkout.' },
      { id: 'checkout_budget', title: 'Respect the payment retry budget', description: 'Keep each checkout within two recorded payment attempts and the response latency limit.' },
    ] : [
      { id: 'citation_support', title: 'Cite the exact supporting passage', description: 'Every quoted notice period must agree with the retrieved section. Missing citation judgments require review.' },
      { id: 'final_answer', title: 'Evaluate the final response', description: 'Use the review.completed event on the finalization span; retrieval output is not the final agent answer.' },
    ]),
    dataset: { source: 'import', service: context.agent, environment: 'production', scenarioId: id, sampleSize: imported.traces.length, minSamples: 3, requireInput: true, requireOutput: extended?.requireOutput ?? true, requireContext: extended?.requireContext ?? !checkout, selection: 'recent', startDate: extended?.startDate ?? '2026-11-01T10:00:00.000Z', endDate: extended?.endDate ?? '2026-11-01T10:50:00.000Z', normalization: { profile: profile.id, version: profile.version } },
    metrics: refs.map(ref => metricFromCatalog(catalog, ref, VERSION, context)), review: { failures: true, sampleRate: 0 },
    automation: { trigger: 'manual', schedule: 'daily', reportFormat: 'html' }, passThreshold: 85,
  };
  return { scenario: clone(scenario), spec, traces: imported.traces, warnings: imported.warnings, catalogAdditions, profile: imported.profile };
}
