import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { cpus, platform, release, totalmem } from 'node:os';
import nodePath from 'node:path';

const configPath = nodePath.resolve(
  process.argv[2] ??
    nodePath.join(import.meta.dirname, 'graph-smoke-config.json'),
);
const outputPath = process.argv[3]
  ? nodePath.resolve(process.argv[3])
  : undefined;
const config = JSON.parse(await readFile(configPath, 'utf8'));
if (!Array.isArray(config.variants) || config.variants.length < 2) {
  throw new Error('Graph config must contain at least two variants');
}
const rawParityRequired = config.rawParityRequired ?? true;
if (typeof rawParityRequired !== 'boolean') {
  throw new Error('rawParityRequired must be boolean');
}

const startedAt = new Date().toISOString();
const runs = config.variants.map((variant) =>
  runVariant({ ...config, variant }),
);
const metadataValues = Object.fromEntries(
  runs.map(({ variant, mdxAstroMetaModules }) => [
    variant,
    mdxAstroMetaModules,
  ]),
);
const comparableFields = [
  'graphProfile',
  'instrumentation',
  'transformedEntryCount',
  'codeModuleCount',
  'codeOnlyModules',
  'graphWithoutObservedCode',
  'graphModuleCount',
  'graphStaticEdges',
  'graphDynamicEdges',
  'graphProjectStaticEdges',
  'graphExternalStaticEdges',
  'graphNonProjectInternalStaticEdges',
  'graphNonProjectInternalIds',
  'graphHash',
  'moduleKindCounts',
  'boundaryHash',
  'boundary',
  'outputChunks',
  'outputAssets',
  'normalizedOutputBytes',
  'normalizedOutputHash',
  'outputNormalization',
];
const rawFields = ['codeHash', 'outputBytes', 'outputHash'];
if (rawParityRequired) comparableFields.push(...rawFields);
for (const field of comparableFields) {
  const serialized = runs.map((run) => JSON.stringify(run[field]));
  if (new Set(serialized).size !== 1) {
    throw new Error(
      `Graph parity failed for ${field}: ${serialized.join(' != ')}`,
    );
  }
}
const rawDifferences = rawFields.flatMap((field) => {
  const values = Object.fromEntries(
    runs.map((run) => [run.variant, run[field]]),
  );
  return new Set(Object.values(values).map((value) => JSON.stringify(value)))
    .size === 1
    ? []
    : [{ field, values }];
});
for (const run of runs) {
  const expected = run.variant.startsWith('worker-')
    ? 0
    : run.transformedEntryCount;
  if (run.mdxAstroMetaModules !== expected) {
    throw new Error(
      `Unexpected meta.astro coverage for ${run.variant}: expected ${expected}, got ${run.mdxAstroMetaModules}`,
    );
  }
}

const report = {
  schema: 1,
  startedAt,
  finishedAt: new Date().toISOString(),
  node: process.version,
  nodeBinary: process.execPath,
  host: {
    platform: platform(),
    release: release(),
    architecture: process.arch,
    cpuModel: cpus()[0]?.model,
    logicalCpuCount: cpus().length,
    totalMemoryBytes: totalmem(),
  },
  config,
  parity: {
    code: !rawDifferences.some(({ field }) => field === 'codeHash'),
    rawCode: !rawDifferences.some(({ field }) => field === 'codeHash'),
    graph: true,
    boundary: true,
    output: true,
    normalizedOutput: true,
    rawOutput: !rawDifferences.some(({ field }) => field.startsWith('output')),
    moduleMetadata: new Set(Object.values(metadataValues)).size === 1,
    moduleMetadataPattern: true,
    fields: comparableFields,
    mdxAstroMetaModules: metadataValues,
    rawParityRequired,
    rawDifferences,
  },
  runs,
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) {
  await writeFile(outputPath, serialized);
  console.log(
    JSON.stringify({
      outputPath,
      parity: report.parity,
      startedAt,
      finishedAt: report.finishedAt,
    }),
  );
} else {
  process.stdout.write(serialized);
}

function runVariant(options) {
  const {
    variants: _variants,
    rawParityRequired: _rawParityRequired,
    ...caseOptions
  } = options;
  const environment = { ...process.env };
  delete environment.ROLLDOWN_PARALLEL_PLUGIN_METRICS;
  delete environment.ROLLDOWN_PARALLEL_PLUGIN_WORKERS;
  const result = spawnSync(
    '/usr/bin/time',
    [
      '-l',
      process.execPath,
      '--expose-gc',
      nodePath.join(import.meta.dirname, 'run-graph-case.mjs'),
      JSON.stringify(caseOptions),
    ],
    { encoding: 'utf8', env: environment, maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(
      `${options.variant} exited ${result.status}:\n${result.stdout}\n${result.stderr}`,
    );
  }
  const peakRssMatch = result.stderr.match(/(\d+)\s+maximum resident set size/);
  if (!peakRssMatch) {
    throw new Error(`Could not parse peak RSS for ${options.variant}:\n${result.stderr}`);
  }
  return {
    ...JSON.parse(result.stdout.trim()),
    peakRssBytes: Number(peakRssMatch[1]),
  };
}
