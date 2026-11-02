import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compileYaml } from '../src/config.js';
import { createInitialState, evaluateRun, exportReport, exportCSV } from '../src/domain.js';
import { createScorerCatalog, parseCatalogYaml } from '../src/catalog.js';
import { normalizeTraceInput } from '../src/traceProfiles.js';

function commandArguments(raw) {
  const positional = [];
  let catalogPath;
  for (let index = 0; index < raw.length; index++) {
    const argument = raw[index];
    if (argument === '--catalog' || argument.startsWith('--catalog=')) {
      if (catalogPath !== undefined) throw new Error('Provide --catalog only once.');
      catalogPath = argument === '--catalog' ? raw[++index] : argument.slice('--catalog='.length);
      if (!catalogPath || catalogPath.startsWith('--')) throw new Error('--catalog requires the path to a scorer catalog YAML file.');
    } else if (argument.startsWith('--')) throw new Error(`Unknown option: ${argument}. Supported option: --catalog scorers.yml.`);
    else positional.push(argument);
  }
  if (positional.length > 3) throw new Error('Expected at most three positional arguments: configuration, traces, and output directory.');
  return { configPath: positional[0], tracePath: positional[1], outputPath: positional[2] || './evaluation-output', catalogPath };
}

try {
  const { configPath, tracePath, outputPath, catalogPath } = commandArguments(process.argv.slice(2));
  if (!configPath) {
    console.error('Usage: node scripts/evaluate.mjs evaluation.yml [traces.json|-] [output-directory] [--catalog scorers.yml]');
    console.error('Use - or omit traces for dataset.source: demo. Custom scorer references require their exported catalog.');
    process.exitCode = 2;
  } else {
    const yamlSource = readFileSync(resolve(configPath), 'utf8');
    let catalog = createScorerCatalog();
    if (catalogPath) {
      const importedCatalog = parseCatalogYaml(readFileSync(resolve(catalogPath), 'utf8'));
      if (!importedCatalog.valid) throw new Error(`Scorer catalog is invalid:\n${importedCatalog.errors.map(error => `${error.path || '$'}${error.line ? ` (line ${error.line})` : ''}: ${error.message}`).join('\n')}`);
      catalog = importedCatalog.catalog;
    }
    const compiled = compileYaml(yamlSource, undefined, catalog);
    if (!compiled.valid) {
      console.error(JSON.stringify({ valid: false, errors: compiled.errors }, null, 2));
      process.exitCode = 2;
    } else {
      const normalization = compiled.spec.dataset.normalization;
      const imported = tracePath && tracePath !== '-' ? normalizeTraceInput(readFileSync(resolve(tracePath), 'utf8'), {
        profileId: normalization?.profile ?? 'auto',
        profileVersion: normalization?.version,
      }) : null;
      if (!imported && compiled.spec.dataset.source === 'import') throw new Error('This configuration requires imported traces. Supply an OTLP JSON or normalized trace file.');
      const traces = imported?.traces || createInitialState().traces;
      const run = evaluateRun(traces, { ...compiled.spec, configYaml: yamlSource }, []);
      const output = resolve(outputPath);
      mkdirSync(output, { recursive: true });
      writeFileSync(resolve(output, 'report.html'), exportReport(run));
      writeFileSync(resolve(output, 'results.csv'), exportCSV(run));
      writeFileSync(resolve(output, 'run.json'), JSON.stringify({ ...run, importWarnings: imported?.warnings || [] }, null, 2));
      console.log(JSON.stringify({ output, runId: run.id, gate: run.summary.gate, score: run.summary.score, passRate: run.summary.passRate, total: run.summary.total, pendingReview: run.summary.pendingReview, reasons: run.summary.gateReasons }, null, 2));
      process.exitCode = run.summary.gate === 'passed' ? 0 : 1;
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
