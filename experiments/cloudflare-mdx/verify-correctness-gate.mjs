import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import {
  readScaleCorrectnessGate,
  requirePassedScaleCorrectnessGate,
  validateFullCorpusArtifact,
  validateGateShape,
  validateSemanticArtifact,
} from './correctness-gate.mjs';
import {
  assertFullCorrectnessArtifactSchema,
  assertSemanticCorrectnessArtifactSchema,
} from './correctness-schema.mjs';
import {
  captureCorrectnessHarnessSourceManifest,
  EXPECTED_COMPILER_ENVIRONMENT,
} from './environment-provenance.mjs';
import { FROZEN_PERFORMANCE_HOST_POLICY } from './local-host-policy.mjs';
import { BASELINE_POOL_ENVIRONMENT } from './pool-environment.mjs';
import {
  EXPECTED_PROJECT_COMMIT,
  EXPECTED_SOURCE_MANIFEST_SHA256,
  loadScaleManifest,
} from './scale-corpus.mjs';
import { LIFECYCLE_FIXED_RUNTIME_PROFILE } from './runtime-profile.mjs';

const { gate } = await readScaleCorrectnessGate();
if (gate.status === 'passed') {
  await requirePassedScaleCorrectnessGate();
} else {
  await expectReject(
    () => requirePassedScaleCorrectnessGate(),
    'blocked correctness gate execution',
  );
}

const malformedGate = structuredClone(gate);
delete malformedGate.requiredArtifacts.semanticSentinel;
await expectReject(() => validateGateShape(malformedGate), 'missing semantic gate reference');
const falseMapGate = structuredClone(gate);
falseMapGate.sourceMapCapability.status = 'pass';
await expectReject(() => validateGateShape(falseMapGate), 'false source-map pass');

const manifest = await loadScaleManifest();
const context = {
  projectRoot:
    '/Users/yunfeihe/Documents/github-opensource/.worktrees/cloudflare-docs-rolldown-build',
  manifest,
  compilerEnvironment: EXPECTED_COMPILER_ENVIRONMENT,
  harnessSourceManifest: await captureCorrectnessHarnessSourceManifest(),
};
const validFull = syntheticFullReport(context);
assertFullCorrectnessArtifactSchema(validFull);
for (const [name, mutate] of [
  ['unknown top-level field', (value) => (value.observations = [])],
  ['aliased resource field', (value) => (value.runs[0].residentSample = 1)],
  ['rust metrics field', (value) => (value.runs[0].rustMetrics = [])],
  ['lifecycle metrics field', (value) => (value.runs[0].lifecycleMetrics = [])],
  ['nested counter extension', (value) => (value.runs[0].correctnessCounters.samples = [])],
  ['nested source extension', (value) => (value.runner.revision = 'unknown')],
]) {
  const report = structuredClone(validFull);
  mutate(report);
  await expectReject(() => assertFullCorrectnessArtifactSchema(report), name);
}
await validateFullCorpusArtifact(validFull, LIFECYCLE_FIXED_RUNTIME_PROFILE, context);
for (const [name, mutate] of [
  ['full hidden duration', (value) => (value.runs[0].totalElapsedMs = 1)],
  ['full missing hit', (value) => (value.runs[0].correctnessCounters.entries[0].hits = 0)],
  ['full non-null map', (value) => (value.runs[0].correctnessCounters.nonNullMapResults = 1)],
  ['full output drift', (value) => (value.runs[0].normalizedOutputHash = 'f'.repeat(64))],
  ['full pool drift', (value) => (value.runs[0].poolEnvironment.RAYON_NUM_THREADS = '11')],
]) {
  const report = structuredClone(validFull);
  mutate(report);
  await expectReject(
    () => validateFullCorpusArtifact(report, LIFECYCLE_FIXED_RUNTIME_PROFILE, context),
    name,
  );
}

const validSemantic = syntheticSemanticReport(context);
assertSemanticCorrectnessArtifactSchema(validSemantic);
await validateSemanticArtifact(validSemantic, LIFECYCLE_FIXED_RUNTIME_PROFILE, context);
for (const [name, mutate] of [
  ['semantic missing entry', (value) => value.success.entries.pop()],
  ['semantic false metadata pass', (value) => (value.success.productCapabilities.metadata = 'pass')],
  ['semantic missing pluginCode', (value) => delete value.diagnostic.runs[0].diagnostic.pluginCode],
  [
    'semantic fixture mapping drift',
    (value) => (value.diagnostic.parity.fixtureMapping.ordinary.stackHasFixture = true),
  ],
]) {
  const report = structuredClone(validSemantic);
  mutate(report);
  await expectReject(
    () => validateSemanticArtifact(report, LIFECYCLE_FIXED_RUNTIME_PROFILE, context),
    name,
  );
}

const directory = await mkdtemp(nodePath.join(tmpdir(), 'mdx-correctness-policy-'));
try {
  const graphConfig = JSON.parse(
    await readFile(nodePath.join(import.meta.dirname, 'graph-formal-matrix.json'), 'utf8'),
  );
  const createGraphCase = (name, graphPoint, scale, startIndex) => {
    const { variantTemplate: _variantTemplate, ...template } = graphConfig.caseTemplate;
    return {
      ...template,
      name,
      graphPoint,
      corpus: 'cloudflare-mdx-scale-v1',
      selectionScale: scale,
      selectionPrefixSha256: manifest.prefixes[String(scale)].selectionSha256,
      variants: ['ordinary', 'managed-4', 'worker-4'],
      startIndex,
    };
  };
  const validGraphConfig = {
    ...graphConfig,
    executionEnabled: true,
    selectedWorkerCount: 4,
    confirmedCrossoverPoint: 512,
    cases: [
      createGraphCase('cloudflare-mdx-graph-confirmed-crossover-512', 'confirmed-crossover', 512, 0),
      createGraphCase('cloudflare-mdx-graph-full-9157', 'full-corpus', 9_157, 10),
    ],
  };
  const validConfigPath = nodePath.join(directory, 'valid-graph-config.json');
  await writeFile(validConfigPath, JSON.stringify(validGraphConfig));
  const validConfigResult = spawnSync(
    process.execPath,
    [nodePath.join(import.meta.dirname, 'run-graph-matrix.mjs'), '--check-config', validConfigPath],
    { encoding: 'utf8' },
  );
  if (validConfigResult.status !== 0) {
    throw new Error(`Exact graph config was rejected: ${validConfigResult.stderr}`);
  }
  const validCoverage = syntheticGraphCoverageReport(validGraphConfig);
  const validCoveragePath = nodePath.join(directory, 'valid-graph-coverage.json');
  await writeFile(validCoveragePath, JSON.stringify(validCoverage));
  const coverageCommand = [
    nodePath.join(import.meta.dirname, 'summarize-graph-matrix.mjs'),
    '--verify-coverage',
  ];
  const validCoverageResult = spawnSync(process.execPath, [...coverageCommand, validCoveragePath], {
    encoding: 'utf8',
  });
  if (validCoverageResult.status !== 0) {
    throw new Error(`Exact graph coverage was rejected: ${validCoverageResult.stderr}`);
  }
  for (const [name, mutate] of [
    ['graph missing case', (value) => value.config.cases.pop()],
    ['graph missing run', (value) => value.runs.pop()],
    ['graph hash drift', (value) => (value.runs[0].graphHash = 'f'.repeat(64))],
    ['graph boundary drift', (value) => (value.runs[0].boundaryHash = 'f'.repeat(64))],
    ['graph output drift', (value) => (value.runs[0].normalizedOutputHash = 'f'.repeat(64))],
    ['graph false parity', (value) => (value.parity[0].graph = false)],
  ]) {
    const report = structuredClone(validCoverage);
    mutate(report);
    const path = nodePath.join(directory, `${name.replaceAll(' ', '-')}.json`);
    await writeFile(path, JSON.stringify(report));
    assertRejectedProcess(
      spawnSync(process.execPath, [...coverageCommand, path], { encoding: 'utf8' }),
      name,
    );
  }
  const incompleteConfig = { ...validGraphConfig, cases: validGraphConfig.cases.slice(0, 1) };
  const incompleteConfigPath = nodePath.join(directory, 'incomplete-graph-config.json');
  await writeFile(incompleteConfigPath, JSON.stringify(incompleteConfig));
  assertRejectedProcess(
    spawnSync(
      process.execPath,
      [nodePath.join(import.meta.dirname, 'run-graph-matrix.mjs'), '--check-config', incompleteConfigPath],
      { encoding: 'utf8' },
    ),
    'graph config missing exact cases',
  );
  const missingRunsPath = nodePath.join(directory, 'missing-graph-runs.json');
  await writeFile(
    missingRunsPath,
    JSON.stringify({
      kind: 'local-graph-formal-matrix',
      executionScope: 'local-only',
      evidenceKind: 'performance-confirmation',
      measurementFieldsPresent: true,
      timingEligible: true,
      conclusionEligible: true,
      config: {
        ...validGraphConfig,
        hostPolicy: FROZEN_PERFORMANCE_HOST_POLICY,
      },
      runs: [],
    }),
  );
  assertRejectedProcess(
    spawnSync(
      process.execPath,
      [nodePath.join(import.meta.dirname, 'summarize-graph-matrix.mjs'), missingRunsPath],
      { encoding: 'utf8' },
    ),
    'graph summary missing exact cases and runs',
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log(
  JSON.stringify({
    valid: true,
    gateStatus: gate.status,
    negativeChecks: 21,
    canonicalSchemaNegativeChecks: 6,
    graphCoverageNegativeChecks: 6,
    fullCorpusSources: manifest.entries.length,
    sourceMapCapability: gate.sourceMapCapability.status,
  }),
);

function syntheticFullReport(context) {
  const normalizedOutputHash = 'a'.repeat(64);
  const definition = {
    name: 'cloudflare-mdx-scale-v1-9157-correctness',
    projectRoot: context.projectRoot,
    rolldownPackageRoot:
      '/Users/yunfeihe/Documents/github-opensource/.worktrees/rolldown-parallel-js-plugin-scale-baseline/packages/rolldown',
    corpus: 'cloudflare-mdx-scale-v1',
    buildProfile: 'default',
    selectionScale: 9_157,
    selectionPrefixSha256: context.manifest.fullSelectionSha256,
    instrumentation: true,
    rustInstrumentation: false,
    measurementMode: 'correctness-only',
    variants: ['ordinary', 'worker-4'],
    warmups: 0,
    repeats: 2,
  };
  const run = (variant, index, sequence) => {
    const workers = variant === 'ordinary' ? 1 : 4;
    const perWorkerCalls = Array(12).fill(0);
    for (let entry = 0; entry < 9_157; entry++) perWorkerCalls[entry % workers]++;
    return {
      name: definition.name,
      index,
      sequence,
      variant,
      workerCount: workers === 1 ? 0 : workers,
      workerModel: workers === 1 ? 'ordinary' : 'rolldown',
      corpus: definition.corpus,
      buildProfile: 'default',
      effectiveRunLinkCheck: false,
      limit: 0,
      instrumentation: true,
      rustInstrumentation: false,
      measurementMode: 'correctness-only',
      lifecycleClaim: false,
      evidenceKind: 'correctness-only',
      fixedNow: '2026-07-12T00:00:00.000Z',
      transformedEntryCount: 9_157,
      discoveredProductionMdxFiles: 9_157,
      discoveredDocsMdxFiles: 6_719,
      projectCommit: EXPECTED_PROJECT_COMMIT,
      rolldownCommit: LIFECYCLE_FIXED_RUNTIME_PROFILE.rolldownCommit,
      bindingHash: LIFECYCLE_FIXED_RUNTIME_PROFILE.bindingSha256,
      distHash: LIFECYCLE_FIXED_RUNTIME_PROFILE.distSha256,
      sourceManifestHash: EXPECTED_SOURCE_MANIFEST_SHA256,
      poolEnvironment: structuredClone(BASELINE_POOL_ENVIRONMENT),
      runtimeProfile: structuredClone(LIFECYCLE_FIXED_RUNTIME_PROFILE),
      selection: {
        algorithm: 'cloudflare-mdx-scale-v1',
        scale: 9_157,
        prefixSha256: context.manifest.fullSelectionSha256,
        prefixSummary: context.manifest.prefixes['9157'].summary,
        manifestFullSelectionSha256: context.manifest.fullSelectionSha256,
      },
      outputChunks: 9_157,
      outputBytes: 1,
      outputHash: 'b'.repeat(64),
      normalizedOutputBytes: 1,
      normalizedOutputHash,
      outputNormalization: { kind: 'undici-formdata-boundary', playgroundUrls: 0, files: [] },
      correctnessCounters: {
        schema: 1,
        factoryCalls: workers,
        workerMask: workers === 1 ? '1' : 'f',
        handlerCalls: 9_157,
        nullMapResults: 9_157,
        nonNullMapResults: 0,
        active: 0,
        unknownIdCalls: 0,
        distinctHandlerIds: 9_157,
        missingHandlerIds: [],
        duplicateHandlerIds: [],
        perWorkerCalls,
        entries: context.manifest.entries.map(({ relativePath }, entry) => ({
          id: relativePath,
          hits: 1,
          worker: entry % workers,
        })),
      },
    };
  };
  return {
    schema: 1,
    evidenceKind: 'correctness-only',
    executionMode: 'current-evidence',
    timingEligible: false,
    measurementFieldsPresent: false,
    conclusionEligible: false,
    executionScope: 'local-only',
    node: 'v24.18.0',
    nodeBinary: process.execPath,
    validationErrors: [],
    rawOutputDifferences: [],
    matrix: {
      executionScope: 'local-only',
      evidenceKind: 'correctness-only',
      executionEnabled: true,
      runtimeProfile: structuredClone(LIFECYCLE_FIXED_RUNTIME_PROFILE),
      poolEnvironment: structuredClone(BASELINE_POOL_ENVIRONMENT),
      sourceMapCapability: productMapFailure(),
      cases: [definition],
    },
    environment: fullProvenanceEnvironment(context),
    runner: sourceRecord(context, 'run-matrix.mjs'),
    caseRunner: sourceRecord(context, 'run-case.mjs'),
    runs: [run('ordinary', 0, 0), run('worker-4', 0, 1), run('worker-4', 1, 2), run('ordinary', 1, 3)],
  };
}

function syntheticSemanticReport(context) {
  const entries = [
    ...context.manifest.semanticSentinel.existingGraphSmoke,
    ...context.manifest.semanticSentinel.playgroundSources,
    ...context.manifest.semanticSentinel.mermaidSources,
  ].filter((value, index, values) => values.indexOf(value) === index);
  const fixture = {
    path: context.manifest.semanticSentinel.invalidDiagnosticFixture,
    sourceSha256: 'b2bc6ad588143570f64369291f6d7d19f36b324a28b389d5a7a29354b977e191',
    expectedResult: 'structured-error',
    requireExactParity: false,
    capabilityStatusOnDifference: 'product-failure',
    timingEligible: false,
  };
  const common = (variant) => ({
    variant,
    projectCommit: EXPECTED_PROJECT_COMMIT,
    rolldownCommit: LIFECYCLE_FIXED_RUNTIME_PROFILE.rolldownCommit,
    bindingHash: LIFECYCLE_FIXED_RUNTIME_PROFILE.bindingSha256,
    distHash: LIFECYCLE_FIXED_RUNTIME_PROFILE.distSha256,
    sourceManifestHash: EXPECTED_SOURCE_MANIFEST_SHA256,
    poolEnvironment: structuredClone(BASELINE_POOL_ENVIRONMENT),
    runtimeProfile: structuredClone(LIFECYCLE_FIXED_RUNTIME_PROFILE),
    measurementMode: 'correctness-only',
  });
  const diagnostic = (variant) => ({
    ...common(variant),
    workerCount: variant === 'ordinary' ? 0 : 2,
    workerModel: variant === 'ordinary' ? 'ordinary' : 'rolldown',
    corpus: 'semantic-diagnostic',
    evidenceKind: 'correctness-only',
    timingEligible: false,
    fixture: {
      path: 'fixtures/invalid-diagnostic.mdx',
      sourceSha256: fixture.sourceSha256,
    },
    diagnostic: {
      name: 'Error',
      message: 'invalid fixture',
      code: null,
      pluginCode: null,
      plugin: null,
      hook: null,
      id: null,
      loc: null,
      frame: null,
      causeName: null,
      causeMessage: null,
      stackHasFixture: false,
      stackHasPluginName: false,
      line: null,
      column: null,
    },
  });
  const diagnosticRuns = [diagnostic('ordinary'), diagnostic('worker-2')];
  const fixtureMapping = Object.fromEntries(
    diagnosticRuns.map((run) => [
      run.variant,
      {
        fixturePath: run.fixture.path,
        fixtureSha256: run.fixture.sourceSha256,
        idHasFixture: false,
        stackHasFixture: false,
        stackHasPluginName: false,
        pluginCode: null,
        line: null,
        column: null,
      },
    ]),
  );
  return {
    schema: 1,
    classification: 'correctness-only',
    timingEligible: false,
    measurementFieldsPresent: false,
    node: 'v24.18.0',
    nodeBinary: process.execPath,
    config: {
      schema: 1,
      algorithm: 'cloudflare-mdx-scale-v1',
      classification: 'correctness-only',
      executionEnabled: true,
      projectRoot: context.projectRoot,
      rolldownPackageRoot:
        '/Users/yunfeihe/Documents/github-opensource/.worktrees/rolldown-parallel-js-plugin-scale-baseline/packages/rolldown',
      runtimeProfile: structuredClone(LIFECYCLE_FIXED_RUNTIME_PROFILE),
      poolEnvironment: structuredClone(BASELINE_POOL_ENVIRONMENT),
      fixedNow: '2026-07-12T00:00:00.000Z',
      successEntries: entries,
      successVariants: ['ordinary', 'managed-2', 'worker-2'],
      diagnosticVariants: ['ordinary', 'worker-2'],
      coverage: {
        existingGraphSmokeEntries: 5,
        allPlaygroundSources: 6,
        fixedMermaidSources: 2,
      },
      diagnosticFixture: fixture,
    },
    environment: provenanceEnvironment(context),
    runner: sourceRecord(context, 'run-semantic-sentinel.mjs'),
    childRunners: {
      success: sourceRecord(context, 'run-graph-case.mjs'),
      diagnostic: sourceRecord(context, 'run-case.mjs'),
    },
    success: {
      entries,
      parity: {
        graph: true,
        normalizedOutput: true,
        metadataPattern: { ordinary: entries.length, 'managed-2': entries.length, 'worker-2': 0 },
        productMetadataParity: false,
        fields: semanticParityFields(),
      },
      productCapabilities: { metadata: 'product-failure' },
      runs: ['ordinary', 'managed-2', 'worker-2'].map((variant) => ({
        ...common(variant),
        corpus: 'graph-smoke',
        workerCount: variant === 'ordinary' ? 0 : 2,
        workerModel: variant === 'ordinary' ? 'ordinary' : variant === 'worker-2' ? 'rolldown' : 'plugin-managed',
        fixedNow: '2026-07-12T00:00:00.000Z',
        graphProfile: {
          runLinkCheck: false,
          publicCiRunLinkCheck: true,
          sameConfigurationAsPublicCi: false,
          linkValidatorBoundary: 'synthetic',
        },
        instrumentation: false,
        rustInstrumentation: false,
        lifecycleClaim: false,
        evidenceKind: 'correctness-only',
        runLinkCheck: false,
        transformedEntryCount: entries.length,
        discoveredProductionMdxFiles: 9_157,
        mdxAstroMetaModules: variant === 'worker-2' ? 0 : entries.length,
        entries,
        outputBytes: 1,
        outputChunks: 1,
        outputAssets: 0,
        outputHash: 'a'.repeat(64),
        normalizedOutputBytes: 1,
        normalizedOutputHash: 'b'.repeat(64),
        outputNormalization: {
          kind: 'undici-formdata-boundary',
          eligibleSourceEntries: 0,
          eligibleOutputFiles: [],
          playgroundUrls: 0,
          files: [],
        },
        codeModuleCount: 1,
        codeHash: 'c'.repeat(64),
        codeOnlyModules: [],
        graphWithoutObservedCode: [],
        graphModuleCount: 1,
        graphStaticEdges: 0,
        graphDynamicEdges: 0,
        graphProjectStaticEdges: 0,
        graphExternalStaticEdges: 0,
        graphNonProjectInternalStaticEdges: 0,
        graphNonProjectInternalIds: [],
        graphHash: 'd'.repeat(64),
        moduleKindCounts: { mdx: entries.length },
        boundaryHash: 'e'.repeat(64),
        boundary: syntheticBoundary(),
      })),
    },
    diagnostic: {
      fixture,
      productCapability: 'pass',
      parity: {
        structured: true,
        nonAbort: true,
        exact: true,
        fields: [
          'name', 'message', 'code', 'plugin', 'hook', 'id', 'loc', 'frame', 'causeName',
          'causeMessage', 'stackHasFixture', 'stackHasPluginName', 'pluginCode', 'line', 'column',
        ],
        fixtureMapping,
        differences: [],
      },
      runs: diagnosticRuns,
    },
  };
}

function provenanceEnvironment(context) {
  return {
    runtimeProfile: structuredClone(LIFECYCLE_FIXED_RUNTIME_PROFILE),
    childPoolEnvironment: structuredClone(BASELINE_POOL_ENVIRONMENT),
    compilerEnvironment: structuredClone(context.compilerEnvironment),
    harnessSourceManifest: structuredClone(context.harnessSourceManifest),
    parentCiMarkers: {
      CI: null, GITHUB_ACTIONS: null, BUILDKITE: null, CIRCLECI: null,
      TF_BUILD: null, JENKINS_URL: null,
    },
    childCiMarkersCleared: ['CI', 'GITHUB_ACTIONS', 'BUILDKITE', 'CIRCLECI', 'TF_BUILD', 'JENKINS_URL'],
    childMaxBufferBytes: 67_108_864,
  };
}

function semanticParityFields() {
  return [
    'graphProfile', 'transformedEntryCount', 'codeModuleCount', 'codeOnlyModules',
    'graphWithoutObservedCode', 'graphModuleCount', 'graphStaticEdges', 'graphDynamicEdges',
    'graphProjectStaticEdges', 'graphExternalStaticEdges', 'graphNonProjectInternalStaticEdges',
    'graphNonProjectInternalIds', 'graphHash', 'moduleKindCounts', 'boundaryHash', 'boundary',
    'outputChunks', 'outputAssets', 'normalizedOutputBytes', 'normalizedOutputHash',
    'outputNormalization',
  ];
}

function syntheticBoundary() {
  return {
    definition: { included: [], excluded: [] },
    localResolutionCalls: 0, unresolvedLocalEdges: 0, resolvedLocalModuleCount: 0,
    externalResolutionCalls: 0, externalAstroResolutionCalls: 0, externalNodeResolutionCalls: 0,
    externalPackageResolutionCalls: 0, externalProtocolResolutionCalls: 0,
    externalSpecifiers: [], rawLeafModules: 0, rawLeafBytes: 0, assetLeafModules: 0,
    assetLeafBytes: 0, cssLeafModules: 0, cssLeafBytes: 0, dataLeafModules: 0,
    dataLeafBytes: 0, astroModuleInstances: 0, astroSourceFiles: 0,
    astroCompiledSourceBytes: 0, astroCompiledOutputBytes: 0, omittedAstroCssBlocks: 0,
    omittedAstroCssBytes: 0, omittedCssDependencyReferences: 0,
    omittedCssLocalDependencyReferences: 0, omittedCssExternalDependencyReferences: 0,
    omittedCssLocalDependencies: [], omittedAstroClientScriptBlocks: 0,
    omittedAstroInlineClientScriptBlocks: 0, omittedAstroExternalClientScriptBlocks: 0,
    omittedAstroInlineClientScriptBytes: 0, omittedAstroInlineClientScriptImportEdges: 0,
    omittedAstroClientSpecifierEdges: 0, omittedAstroClientLocalImportEdges: 0,
    omittedAstroClientExternalImportEdges: 0, omittedAstroClientLocalModules: [],
    omittedAstroClientExternalSpecifiers: [], omittedHydratedComponents: 0,
    omittedClientOnlyComponents: 0, omittedServerComponents: 0,
  };
}

function syntheticGraphCoverageReport(config) {
  const parityFields = [
    'graphProfile', 'instrumentation', 'transformedEntryCount', 'selection',
    'codeModuleCount', 'codeOnlyModules', 'graphWithoutObservedCode', 'graphModuleCount',
    'graphStaticEdges', 'graphDynamicEdges', 'graphProjectStaticEdges',
    'graphExternalStaticEdges', 'graphNonProjectInternalStaticEdges',
    'graphNonProjectInternalIds', 'graphHash', 'moduleKindCounts', 'boundaryHash', 'boundary',
    'outputChunks', 'outputAssets', 'normalizedOutputBytes', 'normalizedOutputHash',
    'outputNormalization',
  ];
  const runs = [];
  const parity = [];
  for (const definition of config.cases) {
    for (let index = definition.startIndex; index < definition.startIndex + 10; index++) {
      for (const variant of definition.variants) {
        runs.push({
          name: definition.name,
          index,
          variant,
          measurementMode: 'measurement',
          selection: {
            scale: definition.selectionScale,
            prefixSha256: definition.selectionPrefixSha256,
          },
          graphProfile: { synthetic: true },
          instrumentation: false,
          transformedEntryCount: definition.selectionScale,
          codeModuleCount: 1,
          codeOnlyModules: [],
          graphWithoutObservedCode: [],
          graphModuleCount: 1,
          graphStaticEdges: 0,
          graphDynamicEdges: 0,
          graphProjectStaticEdges: 0,
          graphExternalStaticEdges: 0,
          graphNonProjectInternalStaticEdges: 0,
          graphNonProjectInternalIds: [],
          graphHash: 'a'.repeat(64),
          moduleKindCounts: { mdx: definition.selectionScale },
          boundaryHash: 'b'.repeat(64),
          boundary: { synthetic: true },
          outputChunks: 1,
          outputAssets: 0,
          normalizedOutputBytes: 1,
          normalizedOutputHash: 'c'.repeat(64),
          outputNormalization: { synthetic: true },
          codeHash: 'd'.repeat(64),
          outputBytes: 1,
          outputHash: 'e'.repeat(64),
          mdxAstroMetaModules: variant.startsWith('worker-') ? 0 : definition.selectionScale,
        });
      }
    }
    parity.push({
      name: definition.name,
      graph: true,
      boundary: true,
      normalizedOutput: true,
      moduleMetadataPattern: true,
      rawParityRequired: false,
      fields: parityFields,
      mdxAstroMetaModules: Object.fromEntries(
        definition.variants.map((variant) => [
          variant,
          [variant.startsWith('worker-') ? 0 : definition.selectionScale],
        ]),
      ),
      rawDifferences: [],
    });
  }
  return { config, runs, parity };
}

function productMapFailure() {
  return {
    status: 'product-failure',
    reason: 'Pinned adapter returns null maps.',
    protocolAmendment: '.agents/docs/scale-crossover-protocol-amendment-2.md',
  };
}

function fullProvenanceEnvironment(context) {
  return {
    parentCiMarkers: {
      CI: null, GITHUB_ACTIONS: null, BUILDKITE: null, CIRCLECI: null,
      TF_BUILD: null, JENKINS_URL: null,
    },
    childCiMarkersCleared: ['CI', 'GITHUB_ACTIONS', 'BUILDKITE', 'CIRCLECI', 'TF_BUILD', 'JENKINS_URL'],
    parentRunLinkCheck: null,
    parentPoolEnvironment: structuredClone(BASELINE_POOL_ENVIRONMENT),
    childPoolEnvironment: structuredClone(BASELINE_POOL_ENVIRONMENT),
    runtimeProfile: structuredClone(LIFECYCLE_FIXED_RUNTIME_PROFILE),
    compilerEnvironment: structuredClone(context.compilerEnvironment),
    harnessSourceManifest: structuredClone(context.harnessSourceManifest),
    correctnessGate: null,
    childMaxBufferBytes: 67_108_864,
    childInputRunLinkCheck: null,
    runCaseProfilePolicy: { default: false, 'ci-link-check': true },
  };
}

function sourceRecord(context, name) {
  const entry = context.harnessSourceManifest.entries.find(
    ({ relativePath }) => relativePath === name,
  );
  return { path: nodePath.join(import.meta.dirname, name), sha256: entry.sourceSha256 };
}

async function expectReject(action, label) {
  let rejected = false;
  try {
    await action();
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(`Negative verifier accepted ${label}`);
}

function assertRejectedProcess(result, label) {
  if (result.status === 0) throw new Error(`Negative verifier accepted ${label}`);
}
