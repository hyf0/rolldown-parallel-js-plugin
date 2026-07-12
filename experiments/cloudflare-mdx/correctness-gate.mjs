import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import nodePath from 'node:path';
import {
  captureCorrectnessHarnessSourceManifest,
  EXPECTED_COMPILER_ENVIRONMENT,
  requirePinnedCompilerEnvironment,
} from './environment-provenance.mjs';
import { BASELINE_POOL_ENVIRONMENT, normalizePoolEnvironment } from './pool-environment.mjs';
import {
  EXPECTED_PROJECT_COMMIT,
  EXPECTED_SOURCE_MANIFEST_SHA256,
  loadScaleManifest,
  prepareScaleManifest,
} from './scale-corpus.mjs';
import { LIFECYCLE_FIXED_RUNTIME_PROFILE, normalizeRuntimeProfile } from './runtime-profile.mjs';
import {
  assertFullCorrectnessArtifactSchema,
  assertSemanticCorrectnessArtifactSchema,
} from './correctness-schema.mjs';

export const SCALE_CORRECTNESS_GATE_FILE = nodePath.join(
  import.meta.dirname,
  'scale-correctness-gate.json',
);

const AMENDMENT_PATH = '.agents/docs/scale-crossover-protocol-amendment-2.md';
const FULL_SCALE = 9_157;
export async function readScaleCorrectnessGate(path = SCALE_CORRECTNESS_GATE_FILE) {
  const gatePath = nodePath.resolve(path);
  const source = await readFile(gatePath);
  const gate = JSON.parse(source);
  validateGateShape(gate);
  return {
    gatePath,
    gateSha256: createHash('sha256').update(source).digest('hex'),
    gate,
  };
}

export async function requirePassedScaleCorrectnessGate(path = SCALE_CORRECTNESS_GATE_FILE) {
  const { gatePath, gateSha256, gate } = await readScaleCorrectnessGate(path);
  if (gate.status !== 'passed') {
    throw new Error(`Scale correctness gate is ${gate.status}: ${gate.blockedBy}`);
  }
  const directory = nodePath.dirname(gatePath);
  const fullCorpus = await readPinnedArtifact(directory, gate.requiredArtifacts.fullCorpus);
  const semantic = await readPinnedArtifact(directory, gate.requiredArtifacts.semanticSentinel);
  const context = await createValidationContext(fullCorpus, semantic);
  await validateFullCorpusArtifact(fullCorpus, gate.runtimeProfile, context);
  await validateSemanticArtifact(semantic, gate.runtimeProfile, context);
  return { gatePath, gateSha256, gate };
}

export function validateGateShape(gate) {
  if (gate.schema !== 1 || !['blocked', 'passed'].includes(gate.status)) {
    throw new Error('Scale correctness gate must be schema 1 and blocked or passed');
  }
  const profile = normalizeRuntimeProfile(gate.runtimeProfile);
  if (!same(profile, LIFECYCLE_FIXED_RUNTIME_PROFILE)) {
    throw new Error('Scale correctness gate must pin the lifecycle-fixed baseline');
  }
  if (
    Object.keys(gate.requiredArtifacts ?? {}).sort().join(',') !==
    'fullCorpus,semanticSentinel'
  ) {
    throw new Error('Scale correctness gate must require exactly both correctness artifacts');
  }
  for (const [name, artifact] of Object.entries(gate.requiredArtifacts)) {
    if (typeof artifact.path !== 'string' || artifact.path.length === 0) {
      throw new Error(`Correctness artifact ${name} must have a path`);
    }
    if (gate.status === 'passed') {
      if (artifact.status !== 'passed' || !/^[a-f0-9]{64}$/.test(artifact.sha256 ?? '')) {
        throw new Error(`Passed correctness artifact ${name} must pin a SHA-256`);
      }
    }
  }
  assertProductFailure(gate.sourceMapCapability, 'gate');
}

export async function createValidationContext(fullCorpus, semantic) {
  const projectRoots = [
    fullCorpus.matrix?.cases?.[0]?.projectRoot,
    semantic.config?.projectRoot,
  ];
  if (
    projectRoots.some((root) => !nodePath.isAbsolute(root ?? '')) ||
    new Set(projectRoots).size !== 1
  ) {
    throw new Error('Correctness artifacts must use one absolute Cloudflare project root');
  }
  const manifest = await loadScaleManifest();
  const regenerated = await prepareScaleManifest(projectRoots[0]);
  if (!same(regenerated, manifest)) {
    throw new Error('The full scale manifest is not reproducible from the pinned project source');
  }
  const compilerEnvironment = await requirePinnedCompilerEnvironment(projectRoots[0]);
  const harnessSourceManifest = await captureCorrectnessHarnessSourceManifest();
  return {
    projectRoot: projectRoots[0],
    manifest,
    compilerEnvironment,
    harnessSourceManifest,
  };
}

export async function validateFullCorpusArtifact(report, runtimeProfile, context) {
  assertFullCorrectnessArtifactSchema(report);
  if (
    report.evidenceKind !== 'correctness-only' ||
    report.timingEligible !== false ||
    report.measurementFieldsPresent !== false ||
    report.conclusionEligible !== false ||
    report.executionScope !== 'local-only' ||
    report.validationErrors?.length !== 0 ||
    report.runs?.length !== 4
  ) {
    throw new Error('Full-corpus correctness artifact has invalid classification or run count');
  }
  const expectedRuntime = normalizeRuntimeProfile(runtimeProfile);
  assertRuntime(report.matrix?.runtimeProfile, expectedRuntime, 'full matrix');
  assertRuntime(report.environment?.runtimeProfile, expectedRuntime, 'full environment');
  assertPools(report.matrix?.poolEnvironment, 'full matrix');
  assertPools(report.environment?.childPoolEnvironment, 'full environment');
  assertEnvironmentProvenance(report.environment, context);
  assertSourceRecord(report.runner, 'run-matrix.mjs', context);
  assertSourceRecord(report.caseRunner, 'run-case.mjs', context);
  assertProductFailure(report.matrix?.sourceMapCapability, 'full matrix');
  const definition = report.matrix?.cases?.[0];
  if (
    report.matrix?.evidenceKind !== 'correctness-only' ||
    report.matrix?.executionEnabled !== true ||
    report.matrix?.cases?.length !== 1 ||
    definition?.corpus !== 'cloudflare-mdx-scale-v1' ||
    definition?.selectionScale !== FULL_SCALE ||
    definition?.selectionPrefixSha256 !== context.manifest.fullSelectionSha256 ||
    definition?.measurementMode !== 'correctness-only' ||
    definition?.instrumentation !== true ||
    definition?.rustInstrumentation !== false ||
    definition?.warmups !== 0 ||
    definition?.repeats !== 2 ||
    !same(definition?.variants, ['ordinary', 'worker-4']) ||
    definition?.projectRoot !== context.projectRoot
  ) {
    throw new Error('Full-corpus matrix does not pin the exact four-run admission');
  }

  const expectedEntries = context.manifest.entries.map(({ relativePath }) => relativePath);
  const variants = report.runs.map(({ variant }) => variant).sort();
  if (!same(variants, ['ordinary', 'ordinary', 'worker-4', 'worker-4'])) {
    throw new Error('Full-corpus correctness artifact must repeat ordinary and worker-4 twice');
  }
  for (const index of [0, 1]) {
    const block = report.runs.filter((run) => run.index === index);
    if (block.length !== 2 || !same(block.map(({ variant }) => variant).sort(), ['ordinary', 'worker-4'])) {
      throw new Error(`Full-corpus correctness block ${index} is incomplete`);
    }
  }
  if (!same(report.runs.map(({ sequence }) => sequence).sort((a, b) => a - b), [0, 1, 2, 3])) {
    throw new Error('Full-corpus correctness sequence is incomplete');
  }

  for (const run of report.runs) {
    validateFullRun(run, expectedRuntime, context, expectedEntries);
  }
  for (const field of [
    'transformedEntryCount',
    'selection',
    'outputChunks',
    'normalizedOutputBytes',
    'normalizedOutputHash',
    'outputNormalization',
  ]) {
    if (new Set(report.runs.map((run) => JSON.stringify(run[field]))).size !== 1) {
      throw new Error(`Four-run normalized determinism failed for ${field}`);
    }
  }
}

export async function validateSemanticArtifact(report, runtimeProfile, context) {
  assertSemanticCorrectnessArtifactSchema(report);
  if (
    report.classification !== 'correctness-only' ||
    report.timingEligible !== false ||
    report.measurementFieldsPresent !== false
  ) {
    throw new Error('Semantic sentinel artifact is misclassified');
  }
  const expectedRuntime = normalizeRuntimeProfile(runtimeProfile);
  assertRuntime(report.config?.runtimeProfile, expectedRuntime, 'semantic config');
  assertRuntime(report.environment?.runtimeProfile, expectedRuntime, 'semantic environment');
  assertPools(report.config?.poolEnvironment, 'semantic config');
  assertPools(report.environment?.childPoolEnvironment, 'semantic environment');
  assertEnvironmentProvenance(report.environment, context);
  assertSourceRecord(report.runner, 'run-semantic-sentinel.mjs', context);
  assertSourceRecord(report.childRunners?.success, 'run-graph-case.mjs', context);
  assertSourceRecord(report.childRunners?.diagnostic, 'run-case.mjs', context);
  if (report.config?.projectRoot !== context.projectRoot) {
    throw new Error('Semantic sentinel used a different project root');
  }
  const expectedEntries = unique([
    ...context.manifest.semanticSentinel.existingGraphSmoke,
    ...context.manifest.semanticSentinel.playgroundSources,
    ...context.manifest.semanticSentinel.mermaidSources,
  ]);
  if (
    !same(report.config?.successEntries, expectedEntries) ||
    !same(report.success?.entries, expectedEntries) ||
    !same(report.config?.successVariants, ['ordinary', 'managed-2', 'worker-2']) ||
    !same(report.config?.diagnosticVariants, ['ordinary', 'worker-2']) ||
    report.config?.coverage?.existingGraphSmokeEntries !== 5 ||
    report.config?.coverage?.allPlaygroundSources !== 6 ||
    report.config?.coverage?.fixedMermaidSources !== 2
  ) {
    throw new Error('Semantic sentinel entries, variants, or rare-syntax coverage changed');
  }
  const fixture = report.config?.diagnosticFixture;
  if (
    fixture?.path !== context.manifest.semanticSentinel.invalidDiagnosticFixture ||
    fixture?.sourceSha256 !== 'b2bc6ad588143570f64369291f6d7d19f36b324a28b389d5a7a29354b977e191' ||
    fixture?.expectedResult !== 'structured-error' ||
    fixture?.requireExactParity !== false ||
    fixture?.capabilityStatusOnDifference !== 'product-failure' ||
    fixture?.timingEligible !== false
  ) {
    throw new Error('Semantic diagnostic fixture pin changed');
  }
  if (
    report.success?.parity?.graph !== true ||
    report.success?.parity?.normalizedOutput !== true ||
    report.success?.parity?.productMetadataParity !== false ||
    report.success?.productCapabilities?.metadata !== 'product-failure' ||
    !same(report.success?.parity?.metadataPattern, {
      ordinary: expectedEntries.length,
      'managed-2': expectedEntries.length,
      'worker-2': 0,
    })
  ) {
    throw new Error('Semantic graph/output parity or metadata product failure is incomplete');
  }
  const successRuns = report.success?.runs ?? [];
  if (
    successRuns.length !== 3 ||
    !same(successRuns.map(({ variant }) => variant), ['ordinary', 'managed-2', 'worker-2'])
  ) {
    throw new Error('Semantic success variants are missing or reordered');
  }
  for (const run of successRuns) {
    assertCommonRunPins(run, expectedRuntime, context);
    if (
      run.corpus !== 'graph-smoke' ||
      run.measurementMode !== 'correctness-only' ||
      run.transformedEntryCount !== expectedEntries.length ||
      !same(run.entries, expectedEntries)
    ) {
      throw new Error(`Semantic success coverage changed for ${run.variant}`);
    }
  }
  for (const field of [
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
  ]) {
    if (new Set(successRuns.map((run) => JSON.stringify(run[field]))).size !== 1) {
      throw new Error(`Semantic success runs differ for ${field}`);
    }
  }
  const derivedMetadataPattern = Object.fromEntries(
    successRuns.map((run) => [run.variant, run.mdxAstroMetaModules]),
  );
  if (!same(derivedMetadataPattern, report.success.parity.metadataPattern)) {
    throw new Error('Semantic metadata product failure is not derived from the recorded runs');
  }

  const diagnosticRuns = report.diagnostic?.runs ?? [];
  if (
    diagnosticRuns.length !== 2 ||
    !same(diagnosticRuns.map(({ variant }) => variant), ['ordinary', 'worker-2']) ||
    report.diagnostic?.parity?.structured !== true ||
    report.diagnostic?.parity?.nonAbort !== true ||
    !['pass', 'product-failure'].includes(report.diagnostic?.productCapability)
  ) {
    throw new Error('Semantic diagnostic variants or product classification are incomplete');
  }
  for (const run of diagnosticRuns) {
    assertCommonRunPins(run, expectedRuntime, context);
    validateDiagnosticRun(run, fixture, report.diagnostic.parity.fixtureMapping?.[run.variant]);
  }
  const expectedDiagnosticFields = [
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
  if (!same(report.diagnostic?.parity?.fields, expectedDiagnosticFields)) {
    throw new Error('Semantic diagnostic comparison fields are incomplete');
  }
  const derivedDifferences = expectedDiagnosticFields.flatMap((field) => {
    const values = Object.fromEntries(
      diagnosticRuns.map((run) => [run.variant, run.diagnostic[field] ?? null]),
    );
    return new Set(Object.values(values).map((value) => JSON.stringify(value))).size === 1
      ? []
      : [{ field, values }];
  });
  const exactDiagnostics = derivedDifferences.length === 0;
  if (
    report.diagnostic.parity.exact !== exactDiagnostics ||
    !same(report.diagnostic.parity.differences, derivedDifferences) ||
    report.diagnostic.productCapability !== (exactDiagnostics ? 'pass' : 'product-failure')
  ) {
    throw new Error('Semantic diagnostic comparison is not derived from the recorded runs');
  }
}

async function readPinnedArtifact(directory, reference) {
  const path = nodePath.resolve(directory, reference.path);
  const source = await readFile(path);
  const actualSha256 = createHash('sha256').update(source).digest('hex');
  if (actualSha256 !== reference.sha256) {
    throw new Error(`Correctness artifact hash mismatch for ${reference.path}: ${actualSha256}`);
  }
  return JSON.parse(source);
}

function validateFullRun(run, runtime, context, expectedEntries) {
  assertCommonRunPins(run, runtime, context);
  if (
    run.measurementMode !== 'correctness-only' ||
    run.evidenceKind !== 'correctness-only' ||
    run.corpus !== 'cloudflare-mdx-scale-v1' ||
    run.transformedEntryCount !== FULL_SCALE ||
    run.discoveredProductionMdxFiles !== FULL_SCALE ||
    run.selection?.algorithm !== 'cloudflare-mdx-scale-v1' ||
    run.selection?.scale !== FULL_SCALE ||
    run.selection?.prefixSha256 !== context.manifest.fullSelectionSha256 ||
    run.selection?.manifestFullSelectionSha256 !== context.manifest.fullSelectionSha256
  ) {
    throw new Error(`Invalid full-corpus selection for ${run.variant}`);
  }
  const counters = run.correctnessCounters;
  if (
    counters?.schema !== 1 ||
    counters.handlerCalls !== FULL_SCALE ||
    counters.nullMapResults !== FULL_SCALE ||
    counters.nonNullMapResults !== 0 ||
    counters.active !== 0 ||
    counters.unknownIdCalls !== 0 ||
    counters.distinctHandlerIds !== FULL_SCALE ||
    counters.missingHandlerIds?.length !== 0 ||
    counters.duplicateHandlerIds?.length !== 0 ||
    counters.entries?.length !== FULL_SCALE ||
    !same(counters.entries.map(({ id }) => id), expectedEntries) ||
    counters.entries.some(({ hits }) => hits !== 1) ||
    counters.perWorkerCalls?.reduce((sum, calls) => sum + calls, 0) !== FULL_SCALE
  ) {
    throw new Error(`Exact transform or null-map counters failed for ${run.variant}`);
  }
  const workerCount = run.variant === 'ordinary' ? 1 : 4;
  const derivedPerWorkerCalls = Array(12).fill(0);
  for (const { worker } of counters.entries) {
    if (Number.isInteger(worker) && worker >= 0 && worker < derivedPerWorkerCalls.length) {
      derivedPerWorkerCalls[worker]++;
    }
  }
  if (
    counters.factoryCalls !== workerCount ||
    counters.workerMask !== (workerCount === 1 ? '1' : 'f') ||
    counters.perWorkerCalls.length !== 12 ||
    !same(counters.perWorkerCalls, derivedPerWorkerCalls) ||
    counters.perWorkerCalls.slice(0, workerCount).some((calls) => calls < 1) ||
    counters.perWorkerCalls.slice(workerCount).some((calls) => calls !== 0) ||
    counters.entries.some(({ worker }) => !Number.isInteger(worker) || worker < 0 || worker >= workerCount)
  ) {
    throw new Error(`Exact worker counters failed for ${run.variant}`);
  }
}

function validateDiagnosticRun(run, fixture, mapping) {
  const fields = ['stackHasFixture', 'stackHasPluginName', 'pluginCode', 'line', 'column'];
  if (
    run.corpus !== 'semantic-diagnostic' ||
    run.measurementMode !== 'correctness-only' ||
    run.fixture?.path !== 'fixtures/invalid-diagnostic.mdx' ||
    run.fixture?.sourceSha256 !== fixture.sourceSha256 ||
    typeof run.diagnostic?.name !== 'string' ||
    typeof run.diagnostic?.message !== 'string' ||
    fields.some((field) => !Object.hasOwn(run.diagnostic, field)) ||
    typeof run.diagnostic.stackHasFixture !== 'boolean' ||
    typeof run.diagnostic.stackHasPluginName !== 'boolean'
  ) {
    throw new Error(`Diagnostic capture is incomplete for ${run.variant}`);
  }
  const expectedMapping = {
    fixturePath: run.fixture.path,
    fixtureSha256: run.fixture.sourceSha256,
    idHasFixture:
      typeof run.diagnostic.id === 'string' && run.diagnostic.id.includes('invalid-diagnostic.mdx'),
    stackHasFixture: run.diagnostic.stackHasFixture,
    stackHasPluginName: run.diagnostic.stackHasPluginName,
    pluginCode: run.diagnostic.pluginCode,
    line: run.diagnostic.line,
    column: run.diagnostic.column,
  };
  if (!same(mapping, expectedMapping)) {
    throw new Error(`Fixture-to-diagnostic mapping changed for ${run.variant}`);
  }
}

function assertCommonRunPins(run, runtime, context) {
  assertRuntime(run.runtimeProfile, runtime, `${run.variant} runtime`);
  assertPools(run.poolEnvironment, `${run.variant} pools`);
  if (
    run.projectCommit !== EXPECTED_PROJECT_COMMIT ||
    run.sourceManifestHash !== EXPECTED_SOURCE_MANIFEST_SHA256 ||
    run.rolldownCommit !== runtime.rolldownCommit ||
    run.bindingHash !== runtime.bindingSha256 ||
    run.distHash !== runtime.distSha256
  ) {
    throw new Error(`${run.variant} source or runtime pins differ`);
  }
}

function assertEnvironmentProvenance(environment, context) {
  if (
    !same(environment?.compilerEnvironment, EXPECTED_COMPILER_ENVIRONMENT) ||
    !same(environment.compilerEnvironment, context.compilerEnvironment) ||
    !same(environment?.harnessSourceManifest, context.harnessSourceManifest)
  ) {
    throw new Error('Compiler, lockfile, installed-package, or harness provenance differs');
  }
}

function assertSourceRecord(record, expectedName, context) {
  const expected = context.harnessSourceManifest.entries.find(
    ({ relativePath }) => relativePath === expectedName,
  );
  if (
    !expected ||
    nodePath.basename(record?.path ?? '') !== expectedName ||
    record?.sha256 !== expected.sourceSha256
  ) {
    throw new Error(`Artifact does not pin the current ${expectedName} source`);
  }
}

function assertProductFailure(value, label) {
  if (value?.status !== 'product-failure' || value?.protocolAmendment !== AMENDMENT_PATH) {
    throw new Error(`${label} must retain the explicit MDX null-map product failure`);
  }
}

function assertRuntime(value, expected, label) {
  if (!same(normalizeRuntimeProfile(value), normalizeRuntimeProfile(expected))) {
    throw new Error(`${label} does not use the lifecycle-fixed runtime`);
  }
}

function assertPools(value, label) {
  if (!same(normalizePoolEnvironment(value), BASELINE_POOL_ENVIRONMENT)) {
    throw new Error(`${label} does not use the frozen pools`);
  }
}

function unique(values) {
  return values.filter((value, index) => values.indexOf(value) === index);
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
