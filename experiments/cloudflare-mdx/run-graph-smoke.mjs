import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import nodePath from 'node:path';
import {
  applyPoolEnvironment,
  BASELINE_POOL_ENVIRONMENT,
  normalizePoolEnvironment,
  readPoolEnvironment,
} from './pool-environment.mjs';
import { normalizeRuntimeProfile, validateRuntimeLane } from './runtime-profile.mjs';
import { assertChildCaptureComplete, CHILD_MAX_BUFFER_BYTES } from './child-buffer-policy.mjs';
import {
  captureCorrectnessHarnessSourceManifest,
  requirePinnedCompilerEnvironment,
} from './environment-provenance.mjs';

const ciMarkerNames = ['CI', 'GITHUB_ACTIONS', 'BUILDKITE', 'CIRCLECI', 'TF_BUILD', 'JENKINS_URL'];
const checkOnly = process.argv[2] === '--check-config';
const configPath = nodePath.resolve(
  process.argv[checkOnly ? 3 : 2] ?? nodePath.join(import.meta.dirname, 'graph-smoke-config.json'),
);
const outputPath = process.argv[checkOnly ? 4 : 3]
  ? nodePath.resolve(process.argv[checkOnly ? 4 : 3])
  : undefined;
const config = JSON.parse(await readFile(configPath, 'utf8'));
if (config.classification !== 'correctness-only' && config.classification !== 'historical-replay') {
  throw new Error('Graph correctness config must declare its classification');
}
if (config.classification === 'historical-replay' && config.executionMode !== 'historical-replay') {
  throw new Error('Historical graph execution requires executionMode=historical-replay');
}
const poolEnvironment = normalizePoolEnvironment(
  config.poolEnvironment ?? BASELINE_POOL_ENVIRONMENT,
);
const runtimeProfile = normalizeRuntimeProfile(config.runtimeProfile);
validateRuntimeLane({
  runtimeProfile,
  instrumentation: config.instrumentation ?? false,
  rustInstrumentation: false,
  evidenceKind: config.classification,
  lifecycleClaim: config.lifecycleClaim ?? false,
});
if (!Array.isArray(config.variants) || config.variants.length < 2) {
  throw new Error('Graph config must contain at least two variants');
}
const rawParityRequired = config.rawParityRequired ?? true;
if (typeof rawParityRequired !== 'boolean') {
  throw new Error('rawParityRequired must be boolean');
}
if (checkOnly) {
  console.log(
    JSON.stringify({
      valid: true,
      configPath,
      variants: config.variants,
      corpus: config.corpus,
      selectionScale: config.selectionScale ?? null,
      poolEnvironment,
      runtimeProfile,
      childMaxBufferBytes: CHILD_MAX_BUFFER_BYTES,
    }),
  );
  process.exit(0);
}
const activeCiMarkers = ciMarkerNames.filter((name) => isActiveCiValue(process.env[name]));
if (activeCiMarkers.length > 0) {
  throw new Error(
    `This local correctness runner refuses active CI markers: ${activeCiMarkers.join(', ')}`,
  );
}

const compilerEnvironment = await requirePinnedCompilerEnvironment(config.projectRoot);
const harnessSourceManifest = await captureCorrectnessHarnessSourceManifest();
const runs = config.variants.map((variant) =>
  runVariant({ ...config, variant, measurementMode: 'correctness-only' }),
);
const metadataValues = Object.fromEntries(
  runs.map(({ variant, mdxAstroMetaModules }) => [variant, mdxAstroMetaModules]),
);
const comparableFields = [
  'graphProfile',
  'instrumentation',
  'transformedEntryCount',
  'selection',
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
    throw new Error(`Graph parity failed for ${field}: ${serialized.join(' != ')}`);
  }
}
const rawDifferences = rawFields.flatMap((field) => {
  const values = Object.fromEntries(runs.map((run) => [run.variant, run[field]]));
  return new Set(Object.values(values).map((value) => JSON.stringify(value))).size === 1
    ? []
    : [{ field, values }];
});
for (const run of runs) {
  const expected = run.variant.startsWith('worker-') ? 0 : run.transformedEntryCount;
  if (run.mdxAstroMetaModules !== expected) {
    throw new Error(
      `Unexpected meta.astro coverage for ${run.variant}: expected ${expected}, got ${run.mdxAstroMetaModules}`,
    );
  }
}

const report = {
  schema: 1,
  classification: config.classification,
  timingEligible: false,
  measurementFieldsPresent: false,
  node: process.version,
  nodeBinary: process.execPath,
  environment: {
    parentPoolEnvironment: readPoolEnvironment(),
    childPoolEnvironment: poolEnvironment,
    runtimeProfile,
    compilerEnvironment,
    harnessSourceManifest,
    childMaxBufferBytes: CHILD_MAX_BUFFER_BYTES,
    parentCiMarkers: Object.fromEntries(
      ciMarkerNames.map((name) => [name, process.env[name] ?? null]),
    ),
    childCiMarkersCleared: ciMarkerNames,
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
    }),
  );
} else {
  process.stdout.write(serialized);
}

function runVariant(options) {
  const { variants: _variants, rawParityRequired: _rawParityRequired, ...caseOptions } = options;
  const environment = { ...process.env };
  for (const marker of ciMarkerNames) delete environment[marker];
  delete environment.ROLLDOWN_PARALLEL_PLUGIN_METRICS;
  delete environment.ROLLDOWN_PARALLEL_PLUGIN_WORKERS;
  applyPoolEnvironment(environment, poolEnvironment);
  caseOptions.expectedPoolEnvironment = poolEnvironment;
  caseOptions.runtimeProfile = runtimeProfile;
  caseOptions.rustInstrumentation = false;
  caseOptions.evidenceKind = config.classification;
  const result = spawnSync(
    process.execPath,
    [
      '--expose-gc',
      nodePath.join(import.meta.dirname, 'run-graph-case.mjs'),
      JSON.stringify(caseOptions),
    ],
    { encoding: 'utf8', env: environment, maxBuffer: CHILD_MAX_BUFFER_BYTES },
  );
  assertChildCaptureComplete(result, options.variant);
  if (result.status !== 0) {
    throw new Error(
      `${options.variant} exited ${result.status}:\n${result.stdout}\n${result.stderr}`,
    );
  }
  return JSON.parse(result.stdout.trim());
}

function isActiveCiValue(value) {
  return value !== undefined && !['', '0', 'false'].includes(value.toLowerCase());
}
