import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from './domain.js';
import { canonicalSpecification, canonicalWorkspace } from './configurationState.js';
import { specToYaml } from './config.js';
import { createScorerCatalog, metricFromCatalog } from './catalog.js';

test('persisted YAML is authoritative over stale form projections and keeps comments', () => {
  const spec = createInitialState().specs[0];
  const source = '# Product owner acceptance criteria\n' + specToYaml({ ...spec, name: 'Canonical evaluation', passThreshold: 92 });
  const saved = canonicalSpecification({ ...spec, name: 'Stale name', passThreshold: 10 }, source);
  assert.equal(saved.name, 'Canonical evaluation');
  assert.equal(saved.passThreshold, 92);
  assert.equal(saved.configYaml, source);
  assert.equal(saved.id, spec.id);
});

test('a form edit regenerates YAML and old run snapshots retain their configuration', () => {
  const workspace = canonicalWorkspace(createInitialState());
  const previous = workspace.specs[0];
  const originalSnapshot = structuredClone(workspace.runs[0].specSnapshot);
  const updated = canonicalSpecification({ ...previous, name: 'Revised acceptance criteria', passThreshold: 91 });
  assert.equal(updated.name, 'Revised acceptance criteria');
  assert.match(updated.configYaml, /minimum_pass_rate: 91/);
  assert.notEqual(updated.configYaml, previous.configYaml);
  assert.deepEqual(workspace.runs[0].specSnapshot, originalSnapshot);
});

test('invalid saved YAML fails instead of silently replacing the workspace', () => {
  const workspace = createInitialState();
  workspace.specs[0].configYaml = 'kind: Unsupported';
  assert.throws(() => canonicalWorkspace(workspace), /apiVersion|kind|metadata|Unknown|must|required/i);
});

test('legacy unsaved projections gain known context and pinned builtins without changing their cohort', () => {
  const original = createInitialState();
  const migrated = canonicalWorkspace(original);
  assert.ok(Array.isArray(migrated.scorerCatalog) && migrated.scorerCatalog.length);
  for (let index = 0; index < original.specs.length; index++) {
    const spec = migrated.specs[index];
    assert.deepEqual(spec.dataset, original.specs[index].dataset);
    assert.deepEqual(spec.context, { domain: 'customer-support', agent: 'support-agent' });
    assert.ok(spec.metrics.every(metric => metric.catalogRef?.version === '1.0.0'));
    assert.match(spec.configYaml, /ref: global\//);
    spec.metrics.forEach((metric, metricIndex) => {
      const old = original.specs[index].metrics[metricIndex];
      for (const key of ['id', 'kind', 'threshold', 'operator', 'weight', 'enabled', 'critical']) assert.equal(metric[key], old[key]);
    });
  }
  assert.equal(original.scorerCatalog, undefined, 'Migration does not mutate the incoming object.');
  assert.equal(migrated.runs[0].specSnapshot.metrics[0].catalogRef, undefined, 'Historical inline scores are not migrated to references.');
});

test('authored YAML remains byte-for-byte authoritative and does not acquire inferred context or pins', () => {
  const original = createInitialState();
  const source = '# Retain my hand-written comments\n' + specToYaml(original.specs[0]);
  original.specs[0] = { ...original.specs[0], configYaml: source, context: { domain: 'stale-domain', agent: 'stale-agent' } };
  const migrated = canonicalWorkspace(original);
  assert.equal(migrated.specs[0].configYaml, source);
  assert.equal(migrated.specs[0].context, undefined);
  assert.equal(migrated.specs[0].metrics[0].catalogRef, undefined);
});

test('an explicitly empty catalog remains empty and missing pinned references fail instead of seeding silently', () => {
  const workspace = createInitialState();
  workspace.scorerCatalog = [];
  const migrated = canonicalWorkspace(workspace);
  assert.deepEqual(migrated.scorerCatalog, []);
  assert.ok(migrated.specs[0].metrics.every(metric => !metric.catalogRef));
  const pinned = metricFromCatalog(createScorerCatalog(), 'global/response-latency', '1.0.0', {});
  workspace.specs[0] = { ...workspace.specs[0], metrics: [pinned] };
  workspace.specs[0].configYaml = specToYaml(workspace.specs[0]);
  assert.throws(() => canonicalWorkspace(workspace), /scorer|catalog|not found|unknown/i);
});

test('historical snapshot definitions are never re-resolved against the current catalog', () => {
  const workspace = createInitialState();
  const pinned = metricFromCatalog(createScorerCatalog(), 'global/response-latency', '1.0.0', {});
  const historicalSpec = { ...workspace.runs[0].specSnapshot, metrics: [pinned] };
  historicalSpec.configYaml = specToYaml(historicalSpec);
  workspace.runs[0] = { ...workspace.runs[0], specSnapshot: historicalSpec };
  workspace.scorerCatalog = [];
  const before = structuredClone(workspace.runs[0]);
  const migrated = canonicalWorkspace(workspace);
  assert.deepEqual(migrated.runs[0], before);
});

test('migration does not invent a domain or slug identity for unfamiliar service names', () => {
  const workspace = createInitialState();
  workspace.specs[0].dataset.service = 'payments.api';
  const migrated = canonicalWorkspace(workspace);
  assert.equal(migrated.specs[0].context, undefined);
  assert.equal(migrated.specs[0].dataset.service, 'payments.api');
});
