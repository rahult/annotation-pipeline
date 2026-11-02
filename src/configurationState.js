import { compileYaml, specToYaml } from './config.js';
import { createScorerCatalog, metricFromCatalog } from './catalog.js';

/** Compile every saved configuration through the same boundary used by the IDE. */
export function canonicalSpecification(spec, yamlSource, catalog) {
  const source = yamlSource ?? specToYaml(spec);
  const compiled = compileYaml(source, spec, catalog);
  if (!compiled.valid) {
    const problem = compiled.errors[0];
    throw new Error(`${problem.path ? `${problem.path}: ` : ''}${problem.message}`);
  }
  return { ...compiled.spec, configYaml: source };
}

export function canonicalWorkspace(workspace) {
  const scorerCatalog = workspace.scorerCatalog === undefined ? createScorerCatalog() : workspace.scorerCatalog;
  if (!Array.isArray(scorerCatalog)) throw new Error('The saved scorer catalog must be an array. It was not replaced with default data.');
  return {
    ...workspace,
    scorerCatalog,
    specs: workspace.specs.map(spec => {
      if (spec.configYaml !== undefined) return canonicalSpecification(spec, spec.configYaml, scorerCatalog);
      const service = spec.dataset?.service || '';
      const context = spec.context ?? { domain: service === 'support-agent' ? 'customer-support' : service === 'knowledge-agent' ? 'knowledge-management' : '', agent: service !== 'all' && /^[a-z0-9][a-z0-9_-]*$/.test(service) ? service : '' };
      const metrics = spec.metrics.map(metric => {
        const entry = scorerCatalog.find(item => item.scope === 'global' && item.versions?.some(release => release.version === '1.0.0' && release.definition?.metricId === metric.id));
        if (!entry || !['groundedness', 'relevance', 'latency', 'tool_success', 'cost'].includes(metric.id)) return metric;
        return metricFromCatalog(scorerCatalog, entry.id, '1.0.0', context, { threshold: metric.threshold, operator: metric.operator, weight: metric.weight, enabled: metric.enabled, critical: metric.critical ?? false });
      });
      return canonicalSpecification({ ...spec, context, metrics }, undefined, scorerCatalog);
    }),
    runs: workspace.runs.map(run => run.specSnapshot.configYaml !== undefined ? run : ({
      ...run,
      specSnapshot: { ...run.specSnapshot, configYaml: specToYaml(run.specSnapshot) },
    })),
  };
}
