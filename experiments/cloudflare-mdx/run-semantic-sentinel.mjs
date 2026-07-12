import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertChildCaptureComplete, CHILD_MAX_BUFFER_BYTES } from './child-buffer-policy.mjs';
import { applyPoolEnvironment, normalizePoolEnvironment } from './pool-environment.mjs';
import { loadScaleManifest } from './scale-corpus.mjs';
import {
  LIFECYCLE_FIXED_RUNTIME_PROFILE,
  normalizeRuntimeProfile,
  validateRuntimeLane,
} from './runtime-profile.mjs';
import {
  captureHarnessSourceManifest,
  requirePinnedCompilerEnvironment,
} from './environment-provenance.mjs';

const CI_MARKERS = ['CI', 'GITHUB_ACTIONS', 'BUILDKITE', 'CIRCLECI', 'TF_BUILD', 'JENKINS_URL'];
const checkOnly = process.argv[2] === '--check-config';
const configPath = nodePath.resolve(
  process.argv[checkOnly ? 3 : 2] ??
    nodePath.join(import.meta.dirname, 'scale-semantic-sentinel.json'),
);
const outputArgument = process.argv[checkOnly ? 4 : 3];
const outputPath = outputArgument ? nodePath.resolve(outputArgument) : undefined;
const config = JSON.parse(await readFile(configPath, 'utf8'));
const manifest = await loadScaleManifest();
const runtimeProfile = validateConfig(config, manifest);
const poolEnvironment = normalizePoolEnvironment(config.poolEnvironment);
const compilerEnvironment = await requirePinnedCompilerEnvironment(config.projectRoot);
const harnessSourceManifest = await captureHarnessSourceManifest();
const diagnosticFixturePath = nodePath.resolve(
  import.meta.dirname,
  '../..',
  config.diagnosticFixture.path,
);
const diagnosticFixtureSha256 = createHash('sha256')
  .update(await readFile(diagnosticFixturePath))
  .digest('hex');
if (diagnosticFixtureSha256 !== config.diagnosticFixture.sourceSha256) {
  throw new Error(`Semantic diagnostic fixture hash changed: ${diagnosticFixtureSha256}`);
}

if (checkOnly) {
  console.log(
    JSON.stringify({
      valid: true,
      classification: config.classification,
      executionEnabled: config.executionEnabled,
      successEntries: config.successEntries.length,
      successVariants: config.successVariants,
      diagnosticVariants: config.diagnosticVariants,
      runtimeProfile,
      poolEnvironment,
      timingEligible: false,
    }),
  );
  process.exit(0);
}
if (config.executionEnabled !== true) {
  throw new Error(`Semantic sentinel is disabled: ${config.blockedBy ?? 'unspecified reason'}`);
}
const activeCiMarkers = CI_MARKERS.filter((name) => isActiveCiValue(process.env[name]));
if (activeCiMarkers.length > 0) {
  throw new Error(
    `This local correctness runner refuses active CI markers: ${activeCiMarkers.join(', ')}`,
  );
}

const successRuns = config.successVariants.map((variant) =>
  runChild('run-graph-case.mjs', {
    projectRoot: config.projectRoot,
    rolldownPackageRoot: config.rolldownPackageRoot,
    runtimeProfile,
    expectedPoolEnvironment: poolEnvironment,
    variant,
    corpus: 'graph-smoke',
    entries: config.successEntries,
    runLinkCheck: false,
    instrumentation: false,
    rustInstrumentation: false,
    measurementMode: 'correctness-only',
    evidenceKind: 'correctness-only',
    lifecycleClaim: false,
    fixedNow: config.fixedNow,
  }),
);
const successParity = compareSuccessRuns(successRuns);
const diagnosticRuns = config.diagnosticVariants.map((variant) =>
  runChild('run-case.mjs', {
    projectRoot: config.projectRoot,
    rolldownPackageRoot: config.rolldownPackageRoot,
    runtimeProfile,
    expectedPoolEnvironment: poolEnvironment,
    variant,
    corpus: 'semantic-diagnostic',
    buildProfile: 'default',
    instrumentation: false,
    rustInstrumentation: false,
    measurementMode: 'correctness-only',
    evidenceKind: 'correctness-only',
    lifecycleClaim: false,
    fixedNow: config.fixedNow,
  }),
);
const diagnosticParity = compareDiagnostics(diagnosticRuns);
const report = {
  schema: 1,
  classification: 'correctness-only',
  timingEligible: false,
  measurementFieldsPresent: false,
  node: process.version,
  nodeBinary: process.execPath,
  config,
  environment: {
    runtimeProfile,
    compilerEnvironment,
    harnessSourceManifest,
    childPoolEnvironment: poolEnvironment,
    parentCiMarkers: Object.fromEntries(
      CI_MARKERS.map((name) => [name, process.env[name] ?? null]),
    ),
    childCiMarkersCleared: CI_MARKERS,
    childMaxBufferBytes: CHILD_MAX_BUFFER_BYTES,
  },
  runner: await sourceRecord(fileURLToPath(import.meta.url)),
  childRunners: {
    success: await sourceRecord(nodePath.join(import.meta.dirname, 'run-graph-case.mjs')),
    diagnostic: await sourceRecord(nodePath.join(import.meta.dirname, 'run-case.mjs')),
  },
  success: {
    entries: config.successEntries,
    parity: successParity,
    productCapabilities: {
      metadata: successParity.productMetadataParity ? 'pass' : 'product-failure',
    },
    runs: successRuns,
  },
  diagnostic: {
    fixture: config.diagnosticFixture,
    parity: diagnosticParity,
    productCapability: diagnosticParity.exact
      ? 'pass'
      : config.diagnosticFixture.capabilityStatusOnDifference,
    runs: diagnosticRuns,
  },
};
if (config.diagnosticFixture.requireExactParity && !diagnosticParity.exact) {
  throw new Error(`Diagnostic parity failed: ${JSON.stringify(diagnosticParity)}`);
}
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) {
  await writeFile(outputPath, serialized);
  console.log(JSON.stringify({ outputPath, timingEligible: false }));
} else {
  process.stdout.write(serialized);
}

function validateConfig(value, scaleManifest) {
  if (
    value.schema !== 1 ||
    value.algorithm !== 'cloudflare-mdx-scale-v1' ||
    value.classification !== 'correctness-only'
  ) {
    throw new Error('Semantic sentinel must be schema-1 correctness-only scale-v1');
  }
  if (!nodePath.isAbsolute(value.projectRoot) || !nodePath.isAbsolute(value.rolldownPackageRoot)) {
    throw new Error('Semantic sentinel roots must be absolute');
  }
  const profile = normalizeRuntimeProfile(value.runtimeProfile);
  if (JSON.stringify(profile) !== JSON.stringify(LIFECYCLE_FIXED_RUNTIME_PROFILE)) {
    throw new Error('Semantic sentinel must use the lifecycle-fixed baseline');
  }
  validateRuntimeLane({
    runtimeProfile: profile,
    instrumentation: false,
    rustInstrumentation: false,
    evidenceKind: 'correctness-only',
  });
  normalizePoolEnvironment(value.poolEnvironment);
  const expectedEntries = [
    ...scaleManifest.semanticSentinel.existingGraphSmoke,
    ...scaleManifest.semanticSentinel.playgroundSources,
    ...scaleManifest.semanticSentinel.mermaidSources,
  ].filter((entry, index, entries) => entries.indexOf(entry) === index);
  if (JSON.stringify(value.successEntries) !== JSON.stringify(expectedEntries)) {
    throw new Error('Semantic success entries differ from the frozen manifest');
  }
  if (
    JSON.stringify(value.successVariants) !==
      JSON.stringify(['ordinary', 'managed-2', 'worker-2']) ||
    JSON.stringify(value.diagnosticVariants) !== JSON.stringify(['ordinary', 'worker-2'])
  ) {
    throw new Error('Semantic variants differ from the frozen correctness lane');
  }
  if (
    value.diagnosticFixture?.path !== scaleManifest.semanticSentinel.invalidDiagnosticFixture ||
    value.diagnosticFixture?.sourceSha256 !==
      'b2bc6ad588143570f64369291f6d7d19f36b324a28b389d5a7a29354b977e191' ||
    value.diagnosticFixture?.expectedResult !== 'structured-error' ||
    value.diagnosticFixture?.timingEligible !== false
  ) {
    throw new Error('Semantic diagnostic fixture changed');
  }
  return profile;
}

function runChild(scriptName, options) {
  const environment = { ...process.env };
  for (const marker of CI_MARKERS) delete environment[marker];
  delete environment.RUN_LINK_CHECK;
  delete environment.ROLLDOWN_PARALLEL_PLUGIN_METRICS;
  delete environment.ROLLDOWN_PARALLEL_PLUGIN_WORKERS;
  applyPoolEnvironment(environment, poolEnvironment);
  const result = spawnSync(
    process.execPath,
    ['--expose-gc', nodePath.join(import.meta.dirname, scriptName), JSON.stringify(options)],
    { encoding: 'utf8', env: environment, maxBuffer: CHILD_MAX_BUFFER_BYTES },
  );
  assertChildCaptureComplete(result, `${scriptName}/${options.variant}`);
  if (result.status !== 0) {
    throw new Error(
      `${scriptName}/${options.variant} exited ${result.status}:\n${result.stdout}\n${result.stderr}`,
    );
  }
  return JSON.parse(result.stdout.trim());
}

function compareSuccessRuns(runs) {
  const fields = [
    'graphProfile',
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
  for (const field of fields) {
    const values = runs.map((run) => JSON.stringify(run[field]));
    if (new Set(values).size !== 1) {
      throw new Error(`Semantic success parity failed for ${field}: ${values.join(' != ')}`);
    }
  }
  const metadataByVariant = Object.fromEntries(
    runs.map((run) => [run.variant, run.mdxAstroMetaModules]),
  );
  for (const run of runs) {
    const expected = run.variant.startsWith('worker-') ? 0 : run.transformedEntryCount;
    if (run.mdxAstroMetaModules !== expected) {
      throw new Error(
        `Unexpected semantic metadata pattern for ${run.variant}: ${run.mdxAstroMetaModules}`,
      );
    }
  }
  return {
    graph: true,
    normalizedOutput: true,
    metadataPattern: metadataByVariant,
    productMetadataParity: new Set(Object.values(metadataByVariant)).size === 1,
    fields,
  };
}

function compareDiagnostics(runs) {
  const fields = [
    'name',
    'message',
    'code',
    'plugin',
    'hook',
    'id',
    'loc',
    'frame',
    'causeName',
    'causeMessage',
    'stackHasFixture',
    'stackHasPluginName',
    'pluginCode',
    'line',
    'column',
  ];
  const differences = fields.flatMap((field) => {
    const values = Object.fromEntries(
      runs.map((run) => [run.variant, run.diagnostic[field] ?? null]),
    );
    return new Set(Object.values(values).map((value) => JSON.stringify(value))).size === 1
      ? []
      : [{ field, values }];
  });
  return {
    structured: runs.every(
      (run) =>
        typeof run.diagnostic?.name === 'string' && typeof run.diagnostic?.message === 'string',
    ),
    nonAbort: true,
    exact: differences.length === 0,
    fields,
    fixtureMapping: Object.fromEntries(
      runs.map((run) => [
        run.variant,
        {
          fixturePath: run.fixture.path,
          fixtureSha256: run.fixture.sourceSha256,
          idHasFixture:
            typeof run.diagnostic.id === 'string' &&
            run.diagnostic.id.includes('invalid-diagnostic.mdx'),
          stackHasFixture: run.diagnostic.stackHasFixture,
          stackHasPluginName: run.diagnostic.stackHasPluginName,
          pluginCode: run.diagnostic.pluginCode,
          line: run.diagnostic.line,
          column: run.diagnostic.column,
        },
      ]),
    ),
    differences,
  };
}

async function sourceRecord(path) {
  return {
    path,
    sha256: createHash('sha256')
      .update(await readFile(path))
      .digest('hex'),
  };
}

function isActiveCiValue(value) {
  return value !== undefined && !['', '0', 'false'].includes(value.toLowerCase());
}
