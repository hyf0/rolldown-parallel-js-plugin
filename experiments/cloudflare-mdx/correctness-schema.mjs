const RUNTIME_KEYS = [
  'kind',
  'rolldownCommit',
  'bindingSha256',
  'distSha256',
  'baseCommit',
  'changeScope',
];
const POOL_KEYS = [
  'ROLLDOWN_WORKER_THREADS',
  'RAYON_NUM_THREADS',
  'ROLLDOWN_MAX_BLOCKING_THREADS',
];
const SOURCE_RECORD_KEYS = ['path', 'sha256'];
const HARNESS_KEYS = ['schema', 'recordFormat', 'sourceCount', 'selectionSha256', 'entries'];
const HARNESS_ENTRY_KEYS = ['relativePath', 'bytes', 'sourceSha256'];
const COMPILER_KEYS = [
  'schema',
  'node',
  'installedBy',
  'projectFiles',
  'packages',
  'dependencyClosure',
];
const COMPILER_PACKAGE_KEYS = ['name', 'version', 'treeSha256'];
const DEPENDENCY_CLOSURE_KEYS = [
  'schema',
  'roots',
  'packageCount',
  'edgeCount',
  'selectionSha256',
];
const OUTPUT_NORMALIZATION_KEYS = ['kind', 'playgroundUrls', 'files'];
const GRAPH_OUTPUT_NORMALIZATION_KEYS = [
  'kind',
  'eligibleSourceEntries',
  'eligibleOutputFiles',
  'playgroundUrls',
  'files',
];
const BOUNDARY_KEYS = [
  'definition',
  'localResolutionCalls',
  'unresolvedLocalEdges',
  'resolvedLocalModuleCount',
  'externalResolutionCalls',
  'externalAstroResolutionCalls',
  'externalNodeResolutionCalls',
  'externalPackageResolutionCalls',
  'externalProtocolResolutionCalls',
  'externalSpecifiers',
  'rawLeafModules',
  'rawLeafBytes',
  'assetLeafModules',
  'assetLeafBytes',
  'cssLeafModules',
  'cssLeafBytes',
  'dataLeafModules',
  'dataLeafBytes',
  'astroModuleInstances',
  'astroSourceFiles',
  'astroCompiledSourceBytes',
  'astroCompiledOutputBytes',
  'omittedAstroCssBlocks',
  'omittedAstroCssBytes',
  'omittedCssDependencyReferences',
  'omittedCssLocalDependencyReferences',
  'omittedCssExternalDependencyReferences',
  'omittedCssLocalDependencies',
  'omittedAstroClientScriptBlocks',
  'omittedAstroInlineClientScriptBlocks',
  'omittedAstroExternalClientScriptBlocks',
  'omittedAstroInlineClientScriptBytes',
  'omittedAstroInlineClientScriptImportEdges',
  'omittedAstroClientSpecifierEdges',
  'omittedAstroClientLocalImportEdges',
  'omittedAstroClientExternalImportEdges',
  'omittedAstroClientLocalModules',
  'omittedAstroClientExternalSpecifiers',
  'omittedHydratedComponents',
  'omittedClientOnlyComponents',
  'omittedServerComponents',
];

export function assertFullCorrectnessArtifactSchema(report) {
  exactKeys(report, [
    'schema',
    'evidenceKind',
    'executionMode',
    'measurementFieldsPresent',
    'timingEligible',
    'conclusionEligible',
    'executionScope',
    'node',
    'nodeBinary',
    'runner',
    'caseRunner',
    'environment',
    'matrix',
    'validationErrors',
    'rawOutputDifferences',
    'runs',
  ], '$');
  sourceRecord(report.runner, '$.runner');
  sourceRecord(report.caseRunner, '$.caseRunner');
  fullEnvironment(report.environment, '$.environment');
  fullMatrix(report.matrix, '$.matrix');
  array(report.validationErrors, '$.validationErrors', scalar);
  array(report.rawOutputDifferences, '$.rawOutputDifferences', scalar);
  array(report.runs, '$.runs', fullRun);
}

export function assertSemanticCorrectnessArtifactSchema(report) {
  exactKeys(report, [
    'schema',
    'classification',
    'timingEligible',
    'measurementFieldsPresent',
    'node',
    'nodeBinary',
    'config',
    'environment',
    'runner',
    'childRunners',
    'success',
    'diagnostic',
  ], '$');
  semanticConfig(report.config, '$.config');
  semanticEnvironment(report.environment, '$.environment');
  sourceRecord(report.runner, '$.runner');
  exactKeys(report.childRunners, ['success', 'diagnostic'], '$.childRunners');
  sourceRecord(report.childRunners.success, '$.childRunners.success');
  sourceRecord(report.childRunners.diagnostic, '$.childRunners.diagnostic');
  semanticSuccess(report.success, '$.success');
  semanticDiagnostic(report.diagnostic, '$.diagnostic');
}

function fullEnvironment(value, path) {
  exactKeys(value, [
    'parentCiMarkers',
    'childCiMarkersCleared',
    'parentRunLinkCheck',
    'parentPoolEnvironment',
    'childPoolEnvironment',
    'runtimeProfile',
    'compilerEnvironment',
    'harnessSourceManifest',
    'correctnessGate',
    'childMaxBufferBytes',
    'childInputRunLinkCheck',
    'runCaseProfilePolicy',
  ], path);
  exactKeys(value.parentCiMarkers, [
    'CI',
    'GITHUB_ACTIONS',
    'BUILDKITE',
    'CIRCLECI',
    'TF_BUILD',
    'JENKINS_URL',
  ], `${path}.parentCiMarkers`);
  array(value.childCiMarkersCleared, `${path}.childCiMarkersCleared`, scalar);
  exactKeys(value.parentPoolEnvironment, POOL_KEYS, `${path}.parentPoolEnvironment`);
  pool(value.childPoolEnvironment, `${path}.childPoolEnvironment`);
  runtime(value.runtimeProfile, `${path}.runtimeProfile`);
  compiler(value.compilerEnvironment, `${path}.compilerEnvironment`);
  harness(value.harnessSourceManifest, `${path}.harnessSourceManifest`);
  if (value.correctnessGate !== null) fail(`${path}.correctnessGate must be null`);
  exactKeys(value.runCaseProfilePolicy, ['default', 'ci-link-check'], `${path}.runCaseProfilePolicy`);
}

function fullMatrix(value, path) {
  exactKeys(value, [
    'executionScope',
    'evidenceKind',
    'executionEnabled',
    'runtimeProfile',
    'poolEnvironment',
    'sourceMapCapability',
    'cases',
  ], path);
  runtime(value.runtimeProfile, `${path}.runtimeProfile`);
  pool(value.poolEnvironment, `${path}.poolEnvironment`);
  sourceMapCapability(value.sourceMapCapability, `${path}.sourceMapCapability`);
  array(value.cases, `${path}.cases`, fullCase);
}

function fullCase(value, path) {
  exactKeys(value, [
    'name',
    'projectRoot',
    'rolldownPackageRoot',
    'corpus',
    'buildProfile',
    'selectionScale',
    'selectionPrefixSha256',
    'instrumentation',
    'rustInstrumentation',
    'measurementMode',
    'variants',
    'warmups',
    'repeats',
  ], path);
  array(value.variants, `${path}.variants`, scalar);
}

function fullRun(value, path) {
  exactKeys(value, [
    'name',
    'index',
    'sequence',
    'variant',
    'workerCount',
    'workerModel',
    'corpus',
    'selection',
    'buildProfile',
    'effectiveRunLinkCheck',
    'limit',
    'instrumentation',
    'rustInstrumentation',
    'measurementMode',
    'lifecycleClaim',
    'evidenceKind',
    'fixedNow',
    'discoveredProductionMdxFiles',
    'discoveredDocsMdxFiles',
    'transformedEntryCount',
    'projectCommit',
    'rolldownCommit',
    'bindingHash',
    'distHash',
    'sourceManifestHash',
    'poolEnvironment',
    'runtimeProfile',
    'outputBytes',
    'outputChunks',
    'outputHash',
    'normalizedOutputBytes',
    'normalizedOutputHash',
    'outputNormalization',
    'correctnessCounters',
  ], path);
  selection(value.selection, `${path}.selection`);
  pool(value.poolEnvironment, `${path}.poolEnvironment`);
  runtime(value.runtimeProfile, `${path}.runtimeProfile`);
  exactKeys(value.outputNormalization, OUTPUT_NORMALIZATION_KEYS, `${path}.outputNormalization`);
  array(value.outputNormalization.files, `${path}.outputNormalization.files`, scalar);
  correctnessCounters(value.correctnessCounters, `${path}.correctnessCounters`);
}

function selection(value, path) {
  exactKeys(value, [
    'algorithm',
    'scale',
    'prefixSha256',
    'prefixSummary',
    'manifestFullSelectionSha256',
  ], path);
  exactKeys(value.prefixSummary, [
    'sources',
    'bytes',
    'lines',
    'fencedBlocks',
    'collections',
    'featureClasses',
    'languages',
  ], `${path}.prefixSummary`);
  numberRecord(value.prefixSummary.collections, `${path}.prefixSummary.collections`);
  numberRecord(value.prefixSummary.featureClasses, `${path}.prefixSummary.featureClasses`);
  numberRecord(value.prefixSummary.languages, `${path}.prefixSummary.languages`);
}

function correctnessCounters(value, path) {
  exactKeys(value, [
    'schema',
    'factoryCalls',
    'workerMask',
    'handlerCalls',
    'nullMapResults',
    'nonNullMapResults',
    'active',
    'unknownIdCalls',
    'distinctHandlerIds',
    'missingHandlerIds',
    'duplicateHandlerIds',
    'perWorkerCalls',
    'entries',
  ], path);
  array(value.missingHandlerIds, `${path}.missingHandlerIds`, scalar);
  array(value.duplicateHandlerIds, `${path}.duplicateHandlerIds`, scalar);
  array(value.perWorkerCalls, `${path}.perWorkerCalls`, scalar);
  array(value.entries, `${path}.entries`, (entry, entryPath) =>
    exactKeys(entry, ['id', 'hits', 'worker'], entryPath),
  );
}

function semanticConfig(value, path) {
  exactKeys(value, [
    'schema',
    'algorithm',
    'classification',
    'executionEnabled',
    'projectRoot',
    'rolldownPackageRoot',
    'runtimeProfile',
    'poolEnvironment',
    'fixedNow',
    'successVariants',
    'diagnosticVariants',
    'successEntries',
    'coverage',
    'diagnosticFixture',
  ], path);
  runtime(value.runtimeProfile, `${path}.runtimeProfile`);
  pool(value.poolEnvironment, `${path}.poolEnvironment`);
  array(value.successVariants, `${path}.successVariants`, scalar);
  array(value.diagnosticVariants, `${path}.diagnosticVariants`, scalar);
  array(value.successEntries, `${path}.successEntries`, scalar);
  exactKeys(value.coverage, [
    'existingGraphSmokeEntries',
    'allPlaygroundSources',
    'fixedMermaidSources',
  ], `${path}.coverage`);
  diagnosticFixture(value.diagnosticFixture, `${path}.diagnosticFixture`);
}

function semanticEnvironment(value, path) {
  exactKeys(value, [
    'runtimeProfile',
    'compilerEnvironment',
    'harnessSourceManifest',
    'childPoolEnvironment',
    'parentCiMarkers',
    'childCiMarkersCleared',
    'childMaxBufferBytes',
  ], path);
  runtime(value.runtimeProfile, `${path}.runtimeProfile`);
  compiler(value.compilerEnvironment, `${path}.compilerEnvironment`);
  harness(value.harnessSourceManifest, `${path}.harnessSourceManifest`);
  pool(value.childPoolEnvironment, `${path}.childPoolEnvironment`);
  exactKeys(value.parentCiMarkers, [
    'CI',
    'GITHUB_ACTIONS',
    'BUILDKITE',
    'CIRCLECI',
    'TF_BUILD',
    'JENKINS_URL',
  ], `${path}.parentCiMarkers`);
  array(value.childCiMarkersCleared, `${path}.childCiMarkersCleared`, scalar);
}

function semanticSuccess(value, path) {
  exactKeys(value, ['entries', 'parity', 'productCapabilities', 'runs'], path);
  array(value.entries, `${path}.entries`, scalar);
  exactKeys(value.parity, [
    'graph',
    'normalizedOutput',
    'metadataPattern',
    'productMetadataParity',
    'fields',
  ], `${path}.parity`);
  exactKeys(value.parity.metadataPattern, ['ordinary', 'managed-2', 'worker-2'], `${path}.parity.metadataPattern`);
  array(value.parity.fields, `${path}.parity.fields`, scalar);
  exactKeys(value.productCapabilities, ['metadata'], `${path}.productCapabilities`);
  array(value.runs, `${path}.runs`, semanticSuccessRun);
}

function semanticSuccessRun(value, path) {
  exactKeys(value, [
    'variant',
    'workerCount',
    'workerModel',
    'corpus',
    'entries',
    'fixedNow',
    'graphProfile',
    'instrumentation',
    'rustInstrumentation',
    'measurementMode',
    'lifecycleClaim',
    'evidenceKind',
    'runLinkCheck',
    'transformedEntryCount',
    'discoveredProductionMdxFiles',
    'projectCommit',
    'rolldownCommit',
    'bindingHash',
    'distHash',
    'sourceManifestHash',
    'poolEnvironment',
    'runtimeProfile',
    'outputBytes',
    'outputChunks',
    'outputAssets',
    'outputHash',
    'normalizedOutputBytes',
    'normalizedOutputHash',
    'outputNormalization',
    'codeModuleCount',
    'codeHash',
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
    'mdxAstroMetaModules',
    'boundaryHash',
    'boundary',
  ], path);
  array(value.entries, `${path}.entries`, scalar);
  exactKeys(value.graphProfile, [
    'runLinkCheck',
    'publicCiRunLinkCheck',
    'sameConfigurationAsPublicCi',
    'linkValidatorBoundary',
  ], `${path}.graphProfile`);
  pool(value.poolEnvironment, `${path}.poolEnvironment`);
  runtime(value.runtimeProfile, `${path}.runtimeProfile`);
  exactKeys(value.outputNormalization, GRAPH_OUTPUT_NORMALIZATION_KEYS, `${path}.outputNormalization`);
  array(value.outputNormalization.eligibleOutputFiles, `${path}.outputNormalization.eligibleOutputFiles`, scalar);
  array(value.outputNormalization.files, `${path}.outputNormalization.files`, scalar);
  array(value.codeOnlyModules, `${path}.codeOnlyModules`, scalar);
  array(value.graphWithoutObservedCode, `${path}.graphWithoutObservedCode`, scalar);
  array(value.graphNonProjectInternalIds, `${path}.graphNonProjectInternalIds`, scalar);
  numberRecord(value.moduleKindCounts, `${path}.moduleKindCounts`);
  boundary(value.boundary, `${path}.boundary`);
}

function boundary(value, path) {
  exactKeys(value, BOUNDARY_KEYS, path);
  exactKeys(value.definition, ['included', 'excluded'], `${path}.definition`);
  array(value.definition.included, `${path}.definition.included`, scalar);
  array(value.definition.excluded, `${path}.definition.excluded`, scalar);
  for (const key of [
    'externalSpecifiers',
    'omittedCssLocalDependencies',
    'omittedAstroClientLocalModules',
    'omittedAstroClientExternalSpecifiers',
  ]) {
    array(value[key], `${path}.${key}`, scalar);
  }
}

function semanticDiagnostic(value, path) {
  exactKeys(value, ['fixture', 'parity', 'productCapability', 'runs'], path);
  diagnosticFixture(value.fixture, `${path}.fixture`);
  exactKeys(value.parity, [
    'structured',
    'nonAbort',
    'exact',
    'fields',
    'fixtureMapping',
    'differences',
  ], `${path}.parity`);
  array(value.parity.fields, `${path}.parity.fields`, scalar);
  exactKeys(value.parity.fixtureMapping, ['ordinary', 'worker-2'], `${path}.parity.fixtureMapping`);
  for (const variant of ['ordinary', 'worker-2']) {
    exactKeys(value.parity.fixtureMapping[variant], [
      'fixturePath',
      'fixtureSha256',
      'idHasFixture',
      'stackHasFixture',
      'stackHasPluginName',
      'pluginCode',
      'line',
      'column',
    ], `${path}.parity.fixtureMapping.${variant}`);
  }
  array(value.parity.differences, `${path}.parity.differences`, (difference, differencePath) => {
    exactKeys(difference, ['field', 'values'], differencePath);
    exactKeys(difference.values, ['ordinary', 'worker-2'], `${differencePath}.values`);
  });
  array(value.runs, `${path}.runs`, diagnosticRun);
}

function diagnosticRun(value, path) {
  exactKeys(value, [
    'variant',
    'workerCount',
    'workerModel',
    'corpus',
    'measurementMode',
    'evidenceKind',
    'timingEligible',
    'projectCommit',
    'rolldownCommit',
    'bindingHash',
    'distHash',
    'sourceManifestHash',
    'poolEnvironment',
    'runtimeProfile',
    'fixture',
    'diagnostic',
  ], path);
  pool(value.poolEnvironment, `${path}.poolEnvironment`);
  runtime(value.runtimeProfile, `${path}.runtimeProfile`);
  exactKeys(value.fixture, ['path', 'sourceSha256'], `${path}.fixture`);
  exactKeys(value.diagnostic, [
    'name',
    'message',
    'code',
    'pluginCode',
    'plugin',
    'hook',
    'id',
    'loc',
    'frame',
    'causeName',
    'causeMessage',
    'stackHasFixture',
    'stackHasPluginName',
    'line',
    'column',
  ], `${path}.diagnostic`);
}

function compiler(value, path) {
  exactKeys(value, COMPILER_KEYS, path);
  exactKeys(value.projectFiles, [
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'node_modules/.modules.yaml',
  ], `${path}.projectFiles`);
  array(value.packages, `${path}.packages`, (entry, entryPath) =>
    exactKeys(entry, COMPILER_PACKAGE_KEYS, entryPath),
  );
  exactKeys(value.dependencyClosure, DEPENDENCY_CLOSURE_KEYS, `${path}.dependencyClosure`);
  array(value.dependencyClosure.roots, `${path}.dependencyClosure.roots`, scalar);
}

function harness(value, path) {
  exactKeys(value, HARNESS_KEYS, path);
  array(value.entries, `${path}.entries`, (entry, entryPath) =>
    exactKeys(entry, HARNESS_ENTRY_KEYS, entryPath),
  );
}

function runtime(value, path) {
  exactKeys(value, RUNTIME_KEYS, path);
}

function pool(value, path) {
  exactKeys(value, POOL_KEYS, path);
}

function sourceRecord(value, path) {
  exactKeys(value, SOURCE_RECORD_KEYS, path);
}

function sourceMapCapability(value, path) {
  exactKeys(value, ['status', 'reason', 'protocolAmendment'], path);
}

function diagnosticFixture(value, path) {
  exactKeys(value, [
    'path',
    'sourceSha256',
    'expectedResult',
    'requireExactParity',
    'capabilityStatusOnDifference',
    'timingEligible',
  ], path);
}

function numberRecord(value, path) {
  object(value, path);
  for (const [key, entry] of Object.entries(value)) {
    if (key.length === 0 || !Number.isFinite(entry)) fail(`${path}.${key} must be a finite number`);
  }
}

function array(value, path, validate) {
  if (!Array.isArray(value)) fail(`${path} must be an array`);
  value.forEach((entry, index) => validate(entry, `${path}[${index}]`));
}

function scalar(value, path) {
  if (value !== null && typeof value === 'object') fail(`${path} must be a scalar`);
}

function exactKeys(value, keys, path) {
  object(value, path);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${path} keys differ: expected ${expected.join(',')}; got ${actual.join(',')}`);
  }
}

function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${path} must be an object`);
}

function fail(message) {
  throw new Error(`Correctness artifact schema violation: ${message}`);
}
