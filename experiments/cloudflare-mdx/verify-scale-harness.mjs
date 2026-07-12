import { readFile } from 'node:fs/promises';
import nodePath from 'node:path';
import {
  BASE_SCALES,
  loadScaleManifest,
  prepareScaleManifest,
  REFINEMENT_SCALES,
  SCALE_MANIFEST_FILE,
  selectScalePrefix,
} from './scale-corpus.mjs';
import { BASELINE_POOL_ENVIRONMENT, normalizePoolEnvironment } from './pool-environment.mjs';
import { validateFrozenPerformanceHostPolicy } from './local-host-policy.mjs';
import { LIFECYCLE_FIXED_RUNTIME_PROFILE, normalizeRuntimeProfile } from './runtime-profile.mjs';
import {
  readScaleCorrectnessGate,
  requirePassedScaleCorrectnessGate,
} from './correctness-gate.mjs';
import {
  captureCorrectnessHarnessSourceManifest,
  EXPECTED_COMPILER_ENVIRONMENT,
  requirePinnedCompilerEnvironment,
} from './environment-provenance.mjs';

if (!process.argv[2]) throw new Error('Expected a Cloudflare Docs project root');
const projectRoot = nodePath.resolve(process.argv[2]);

const committedText = await readFile(SCALE_MANIFEST_FILE, 'utf8');
const committed = await loadScaleManifest();
const regenerated = await prepareScaleManifest(projectRoot);
const regeneratedText = `${JSON.stringify(regenerated, null, 2)}\n`;
if (committedText !== regeneratedText) {
  throw new Error('Committed cloudflare-mdx-scale-v1 manifest is not reproducible');
}
const compilerEnvironment = await requirePinnedCompilerEnvironment(projectRoot);
if (JSON.stringify(compilerEnvironment) !== JSON.stringify(EXPECTED_COMPILER_ENVIRONMENT)) {
  throw new Error('Compiler environment no longer matches the frozen package and lockfile pins');
}
const harnessSourceManifest = await captureCorrectnessHarnessSourceManifest();
if (
  harnessSourceManifest.sourceCount < 1 ||
  !/^[a-f0-9]{64}$/.test(harnessSourceManifest.selectionSha256) ||
  new Set(harnessSourceManifest.entries.map(({ relativePath }) => relativePath)).size !==
    harnessSourceManifest.entries.length
) {
  throw new Error('Harness source manifest is incomplete or duplicated');
}

const expectedCollectionCounts = {
  32: { changelog: 3, compatibility: 1, docs: 23, partials: 5 },
  128: { changelog: 14, compatibility: 1, docs: 93, partials: 20 },
  256: { changelog: 28, compatibility: 1, docs: 187, partials: 40 },
  512: { changelog: 55, compatibility: 1, docs: 375, partials: 81 },
  1024: { changelog: 110, compatibility: 1, docs: 751, partials: 162 },
  2048: { changelog: 221, compatibility: 1, docs: 1502, partials: 324 },
  4096: { changelog: 442, compatibility: 1, docs: 3005, partials: 648 },
  9157: { changelog: 988, compatibility: 1, docs: 6719, partials: 1449 },
};
for (const scale of BASE_SCALES) {
  const actual = committed.prefixes[String(scale)].summary.collections;
  if (JSON.stringify(actual) !== JSON.stringify(expectedCollectionCounts[scale])) {
    throw new Error(`Scale ${scale} collection allocation changed: ${JSON.stringify(actual)}`);
  }
}

const { gate: correctnessGate } = await readScaleCorrectnessGate();

const baseMatrix = await readJson('scale-base-screen-matrix.json');
assertBaselineConfiguration(baseMatrix);
if (
  baseMatrix.correctnessGate !== 'scale-correctness-gate.json' ||
  (baseMatrix.executionEnabled === true && correctnessGate.status !== 'passed')
) {
  throw new Error('Base screen may be enabled only after the explicit correctness gate passes');
}
if (
  JSON.stringify(baseMatrix.cases.map(({ selectionScale }) => selectionScale)) !==
  JSON.stringify(BASE_SCALES)
) {
  throw new Error('Base screen matrix does not contain every frozen base scale once');
}
for (const [index, definition] of baseMatrix.cases.entries()) {
  assertScaleCase(definition, committed);
  if (
    JSON.stringify(definition.variants) !==
      JSON.stringify([
        'ordinary',
        'worker-1',
        'worker-2',
        'worker-3',
        'worker-4',
        'worker-5',
        'worker-6',
        'worker-7',
        'worker-8',
      ]) ||
    definition.instrumentation !== false ||
    definition.warmups !== 0 ||
    definition.repeats !== 1 ||
    definition.startIndex !== index
  ) {
    throw new Error(`Base screen case ${definition.name} changed its frozen rotation`);
  }
}

const refinementMatrix = await readJson('scale-refinement-matrix.json');
assertBaselineConfiguration(refinementMatrix);
if (
  refinementMatrix.executionEnabled !== false ||
  refinementMatrix.directionChangingBaseInterval !== null ||
  refinementMatrix.cases.length !== 0
) {
  throw new Error(
    'Refinement template must remain disabled until the base direction change exists',
  );
}
const allowedRefinement = Object.fromEntries(
  REFINEMENT_SCALES.map((scale) => [
    String(scale),
    committed.prefixes[String(scale)].selectionSha256,
  ]),
);
if (
  JSON.stringify(refinementMatrix.allowedRefinementPrefixes) !== JSON.stringify(allowedRefinement)
) {
  throw new Error('Refinement scale hashes differ from the committed manifest');
}
const intervalScales = Object.values(refinementMatrix.eligibleScalesByBaseInterval).flat();
if (JSON.stringify(intervalScales) !== JSON.stringify(REFINEMENT_SCALES)) {
  throw new Error('Refinement intervals do not partition the frozen refinement scales');
}
if (
  refinementMatrix.caseTemplate.instrumentation !== false ||
  refinementMatrix.caseTemplate.warmups !== 0 ||
  refinementMatrix.caseTemplate.repeats !== 1 ||
  JSON.stringify(refinementMatrix.caseTemplate.variants) !==
    JSON.stringify(baseMatrix.cases[0].variants)
) {
  throw new Error('Refinement case template differs from the frozen base screen lane');
}

const smokeMatrix = await readJson('scale-smoke-matrix.json');
if (smokeMatrix.evidenceKind !== 'correctness-only') {
  throw new Error('Scale smoke matrix must never be classified as performance evidence');
}
assertPoolEnvironment(smokeMatrix);
assertLifecycleFixedRuntime(smokeMatrix);
for (const definition of smokeMatrix.cases) assertScaleCase(definition, committed);
if (!smokeMatrix.cases.every(({ measurementMode }) => measurementMode === 'correctness-only')) {
  throw new Error('Scale correctness smoke must not collect timing or CPU measurements');
}
if (smokeMatrix.cases.length !== 1 || smokeMatrix.cases[0].selectionScale !== 32) {
  throw new Error('Scale smoke matrix must cover the frozen 32-source prefix');
}
const fullCorrectnessMatrix = await readJson('scale-full-correctness-matrix.json');
if (fullCorrectnessMatrix.evidenceKind !== 'correctness-only') {
  throw new Error('Full-corpus admission must remain correctness-only');
}
assertPoolEnvironment(fullCorrectnessMatrix);
assertLifecycleFixedRuntime(fullCorrectnessMatrix);
for (const definition of fullCorrectnessMatrix.cases) {
  assertScaleCase(definition, committed);
}
if (
  fullCorrectnessMatrix.cases.length !== 1 ||
  fullCorrectnessMatrix.executionEnabled !== true ||
  fullCorrectnessMatrix.cases[0].selectionScale !== 9_157 ||
  fullCorrectnessMatrix.cases[0].measurementMode !== 'correctness-only' ||
  fullCorrectnessMatrix.cases[0].repeats !== 2 ||
  fullCorrectnessMatrix.sourceMapCapability?.status !== 'product-failure' ||
  fullCorrectnessMatrix.sourceMapCapability?.protocolAmendment !==
    '.agents/docs/scale-crossover-protocol-amendment-2.md'
) {
  throw new Error('Full-corpus correctness admission changed');
}

const graphSmoke = await readJson('scale-graph-smoke-config.json');
assertPoolEnvironment(graphSmoke);
assertLifecycleFixedRuntime(graphSmoke);
assertScaleCase(graphSmoke, committed);
if (
  graphSmoke.selectionScale !== 32 ||
  graphSmoke.classification !== 'correctness-only' ||
  graphSmoke.rawParityRequired !== false ||
  graphSmoke.runLinkCheck !== false ||
  graphSmoke.measurementMode !== 'correctness-only'
) {
  throw new Error('Scale graph smoke boundary changed');
}
const graphFormal = await readJson('graph-formal-matrix.json');
assertBaselineConfiguration(graphFormal);
if (
  graphFormal.executionEnabled !== false ||
  graphFormal.selectedWorkerCount !== null ||
  graphFormal.confirmedCrossoverPoint !== null ||
  graphFormal.cases.length !== 0 ||
  graphFormal.caseTemplate?.repeats !== 10 ||
  graphFormal.caseTemplate?.measurementMode !== 'measurement' ||
  JSON.stringify(graphFormal.caseTemplate?.variantTemplate) !==
    JSON.stringify(['ordinary', 'managed-${selectedWorkerCount}', 'worker-${selectedWorkerCount}'])
) {
  throw new Error('Graph formal matrix must await the screened worker count');
}

const semanticSentinel = await readJson('scale-semantic-sentinel.json');
const expectedSentinelEntries = [
  ...committed.semanticSentinel.existingGraphSmoke,
  ...committed.semanticSentinel.playgroundSources,
  ...committed.semanticSentinel.mermaidSources,
].filter((path, index, values) => values.indexOf(path) === index);
if (
  semanticSentinel.classification !== 'correctness-only' ||
  semanticSentinel.executionEnabled !== true ||
  JSON.stringify(semanticSentinel.successEntries) !== JSON.stringify(expectedSentinelEntries) ||
  JSON.stringify(semanticSentinel.successVariants) !==
    JSON.stringify(['ordinary', 'managed-2', 'worker-2']) ||
  JSON.stringify(semanticSentinel.diagnosticVariants) !==
    JSON.stringify(['ordinary', 'worker-2']) ||
  semanticSentinel.diagnosticFixture.path !== committed.semanticSentinel.invalidDiagnosticFixture ||
  semanticSentinel.diagnosticFixture.sourceSha256 !==
    'b2bc6ad588143570f64369291f6d7d19f36b324a28b389d5a7a29354b977e191'
) {
  throw new Error('Semantic sentinel definition differs from the committed manifest');
}
assertPoolEnvironment(semanticSentinel);
assertLifecycleFixedRuntime(semanticSentinel);

if (correctnessGate.status === 'passed') {
  await requirePassedScaleCorrectnessGate();
} else if (
  correctnessGate.requiredArtifacts.fullCorpus.status !== 'missing' ||
  correctnessGate.requiredArtifacts.semanticSentinel.status !== 'missing' ||
  correctnessGate.sourceMapCapability.status !== 'product-failure' ||
  baseMatrix.executionEnabled !== false
) {
  throw new Error('Blocked correctness gate no longer records its exact blockers');
}

const graphCorrectnessArtifact = await readJson(
  'data/2026-07-12-scale-v1-32-graph-correctness.raw.json',
);
if (
  graphCorrectnessArtifact.classification !== 'correctness-only' ||
  graphCorrectnessArtifact.timingEligible !== false ||
  !isHistoricalReclassification(graphCorrectnessArtifact.reclassification) ||
  graphCorrectnessArtifact.runs.length !== 3 ||
  graphCorrectnessArtifact.parity.rawDifferences.length !== 0
) {
  throw new Error('Frozen 32-source graph correctness artifact changed classification or parity');
}
assertHistoricalArtifactRuns(
  graphCorrectnessArtifact.runs,
  committed.prefixes['32'].selectionSha256,
);
if (
  JSON.stringify(graphCorrectnessArtifact.parity.mdxAstroMetaModules) !==
  JSON.stringify({ ordinary: 32, 'managed-2': 32, 'worker-2': 0 })
) {
  throw new Error('Frozen graph correctness artifact lost the meta.astro defect pattern');
}

const kernelCorrectnessArtifact = await readJson(
  'data/2026-07-12-scale-v1-32-kernel-correctness.raw.json',
);
if (
  kernelCorrectnessArtifact.evidenceKind !== 'correctness-only' ||
  kernelCorrectnessArtifact.measurementFieldsPresent !== false ||
  kernelCorrectnessArtifact.timingEligible !== false ||
  !isHistoricalReclassification(kernelCorrectnessArtifact.reclassification) ||
  kernelCorrectnessArtifact.runs.length !== 2 ||
  kernelCorrectnessArtifact.validationErrors.length !== 0 ||
  kernelCorrectnessArtifact.rawOutputDifferences.length !== 0
) {
  throw new Error('Frozen 32-source kernel correctness artifact changed classification or parity');
}
assertHistoricalArtifactRuns(
  kernelCorrectnessArtifact.runs,
  committed.prefixes['32'].selectionSha256,
);
const workerTimelineArtifact = kernelCorrectnessArtifact.runs.find(
  ({ variant }) => variant === 'worker-2',
);
if (
  workerTimelineArtifact.metrics.kernelTimeline.completedEntries !== 32 ||
  JSON.stringify(
    workerTimelineArtifact.metrics.kernelTimeline.perWorker.map(({ calls }) => calls),
  ) !== JSON.stringify([13, 19]) ||
  workerTimelineArtifact.metrics.clockAnchors !== undefined
) {
  throw new Error('Frozen pre-anchor worker timeline artifact changed');
}

const playgroundSources = committed.entries
  .filter(({ featureClass }) => featureClass === 'playground')
  .map(({ relativePath }) => relativePath)
  .sort();
if (
  playgroundSources.length !== 6 ||
  JSON.stringify(playgroundSources) !==
    JSON.stringify([...committed.semanticSentinel.playgroundSources].sort())
) {
  throw new Error('Semantic sentinel does not contain all six playground sources');
}
for (const relativePath of [
  ...committed.semanticSentinel.existingGraphSmoke,
  ...committed.semanticSentinel.playgroundSources,
  ...committed.semanticSentinel.mermaidSources,
]) {
  if (!committed.entries.some((entry) => entry.relativePath === relativePath)) {
    throw new Error(`Semantic sentinel source is outside the production manifest: ${relativePath}`);
  }
}
const invalidFixture = nodePath.resolve(
  import.meta.dirname,
  '../../',
  committed.semanticSentinel.invalidDiagnosticFixture,
);
if (!(await readFile(invalidFixture, 'utf8')).includes('<Broken attribute={')) {
  throw new Error('Invalid-MDX diagnostic fixture changed unexpectedly');
}

const checkedPrefix = await selectScalePrefix({
  projectRoot,
  scale: 32,
  expectedPrefixSha256: committed.prefixes['32'].selectionSha256,
});
if (checkedPrefix.absolutePaths.length !== 32) {
  throw new Error('Scale selection did not return exactly 32 source paths');
}

console.log(
  JSON.stringify({
    valid: true,
    algorithm: committed.algorithm,
    sources: committed.entries.length,
    baseScales: BASE_SCALES,
    refinementScales: REFINEMENT_SCALES,
    fullSelectionSha256: committed.fullSelectionSha256,
    checkedMatrices: [
      'scale-base-screen-matrix.json',
      'scale-refinement-matrix.json',
      'scale-smoke-matrix.json',
      'scale-full-correctness-matrix.json',
      'scale-graph-smoke-config.json',
      'scale-semantic-sentinel.json',
      'scale-correctness-gate.json',
      'graph-formal-matrix.json',
    ],
  }),
);

async function readJson(fileName) {
  return JSON.parse(await readFile(nodePath.join(import.meta.dirname, fileName), 'utf8'));
}

function assertBaselineConfiguration(matrix) {
  assertPoolEnvironment(matrix);
  assertLifecycleFixedRuntime(matrix);
  validateFrozenPerformanceHostPolicy(matrix.hostPolicy);
}

function assertPoolEnvironment(value) {
  const actual = normalizePoolEnvironment(value.poolEnvironment);
  if (JSON.stringify(actual) !== JSON.stringify(BASELINE_POOL_ENVIRONMENT)) {
    throw new Error(`Matrix does not pin the baseline pools: ${JSON.stringify(actual)}`);
  }
}

function assertLifecycleFixedRuntime(value) {
  const actual = normalizeRuntimeProfile(value.runtimeProfile);
  if (JSON.stringify(actual) !== JSON.stringify(LIFECYCLE_FIXED_RUNTIME_PROFILE)) {
    throw new Error(`Matrix does not pin the lifecycle-fixed runtime: ${JSON.stringify(actual)}`);
  }
}

function assertScaleCase(definition, manifest) {
  if (definition.corpus !== 'cloudflare-mdx-scale-v1') {
    throw new Error(`${definition.name ?? 'graph smoke'} does not select the scale manifest`);
  }
  const expected = manifest.prefixes[String(definition.selectionScale)]?.selectionSha256;
  if (!expected || definition.selectionPrefixSha256 !== expected) {
    throw new Error(
      `${definition.name ?? 'graph smoke'} has stale prefix hash ${definition.selectionPrefixSha256}`,
    );
  }
}

function assertHistoricalArtifactRuns(runs, prefixSha256) {
  const timingFields = [
    'totalElapsedMs',
    'mainPluginConstructionElapsedMs',
    'pluginSetupElapsedMs',
    'rolldownCreateElapsedMs',
    'generateAndWorkerLifecycleElapsedMs',
    'closeElapsedMs',
    'cpuUserMs',
    'cpuSystemMs',
    'peakRssBytes',
  ];
  for (const run of runs) {
    if (
      run.measurementMode !== 'correctness-only' ||
      run.runtimeProfile?.kind !== 'unchanged-baseline' ||
      run.runtimeProfile?.rolldownCommit !== '0aa600b5721b852cdc4095c7122a929a8cb4a798' ||
      run.runtimeProfile?.bindingSha256 !==
        'deec0b2cb7a12e507ff223e12535c3280ab5fe8371f2fcc92f9db206163f1c5d' ||
      run.runtimeProfile?.distSha256 !==
        'e30311e764bae7fba9afe27665db741d556a7c3728eb67cfbe7ce0fed3135ebc' ||
      run.selection?.prefixSha256 !== prefixSha256 ||
      run.transformedEntryCount !== 32 ||
      timingFields.some((field) => Object.hasOwn(run, field))
    ) {
      throw new Error(
        `Historical correctness artifact contains timing or selection drift: ${run.variant}`,
      );
    }
  }
}

function isHistoricalReclassification(value) {
  return (
    value?.kind === 'historical-0aa-artifact' &&
    value?.recordedKind === 'unchanged-baseline' &&
    value?.lifecycleClaimEligible === false &&
    value?.timingEligible === false
  );
}
