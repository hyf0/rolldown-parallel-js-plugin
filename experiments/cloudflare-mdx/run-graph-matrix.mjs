import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { cpus, platform, release, totalmem } from 'node:os';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  captureHostSnapshot,
  evaluateChildHostPolicy,
  hostDelta,
  validateFrozenPerformanceHostPolicy,
  waitForHostAdmission,
} from './local-host-policy.mjs';
import {
  applyPoolEnvironment,
  BASELINE_POOL_ENVIRONMENT,
  normalizePoolEnvironment,
  readPoolEnvironment,
} from './pool-environment.mjs';
import { FROZEN_SCALES, loadScaleManifest } from './scale-corpus.mjs';
import { normalizeRuntimeProfile, validateRuntimeLane } from './runtime-profile.mjs';
import { assertChildCaptureComplete, CHILD_MAX_BUFFER_BYTES } from './child-buffer-policy.mjs';
import { requirePassedScaleCorrectnessGate } from './correctness-gate.mjs';
import {
  captureCorrectnessHarnessSourceManifest,
  requirePinnedCompilerEnvironment,
} from './environment-provenance.mjs';

const checkOnly = process.argv[2] === '--check-config';
const configArgument = process.argv[checkOnly ? 3 : 2];
const outputArgument = process.argv[checkOnly ? 4 : 3];
const configPath = nodePath.resolve(
  configArgument ?? nodePath.join(import.meta.dirname, 'graph-formal-matrix.json'),
);
const outputPath = outputArgument ? nodePath.resolve(outputArgument) : undefined;
const config = JSON.parse(await readFile(configPath, 'utf8'));
const scaleManifest = await loadScaleManifest();
validateConfig(config, scaleManifest);
const poolEnvironment = normalizePoolEnvironment(
  config.poolEnvironment ?? BASELINE_POOL_ENVIRONMENT,
);
const runtimeProfile = normalizeRuntimeProfile(config.runtimeProfile);

if (checkOnly) {
  console.log(
    JSON.stringify({
      valid: true,
      configPath,
      executionScope: config.executionScope,
      blocks: config.cases.reduce((sum, definition) => sum + definition.repeats, 0),
      measuredRuns: config.cases.reduce(
        (sum, definition) => sum + definition.repeats * definition.variants.length,
        0,
      ),
      poolEnvironment,
      runtimeProfile,
      executionEnabled: config.executionEnabled ?? true,
      childMaxBufferBytes: CHILD_MAX_BUFFER_BYTES,
    }),
  );
  process.exit(0);
}
if (config.executionEnabled === false) {
  throw new Error(
    `This graph matrix is disabled: ${config.blockedBy ?? 'no execution gate was recorded'}`,
  );
}
const correctnessGateAdmission = await requirePassedScaleCorrectnessGate(
  nodePath.resolve(nodePath.dirname(configPath), config.correctnessGate),
);

const ciMarkerNames = ['CI', 'GITHUB_ACTIONS', 'BUILDKITE', 'CIRCLECI', 'TF_BUILD', 'JENKINS_URL'];
const activeCiMarkers = ciMarkerNames.filter((name) => isCiEnvironment(process.env[name]));
if (activeCiMarkers.length > 0) {
  throw new Error(
    `This benchmark is local-only; refuse to run with active CI markers: ${activeCiMarkers.join(', ')}`,
  );
}

const runnerPath = fileURLToPath(import.meta.url);
const caseRunnerPath = nodePath.join(import.meta.dirname, 'run-graph-case.mjs');
const runnerHash = createHash('sha256')
  .update(await readFile(runnerPath))
  .digest('hex');
const caseRunnerHash = createHash('sha256')
  .update(await readFile(caseRunnerPath))
  .digest('hex');
const parentCiMarkers = Object.fromEntries(
  ciMarkerNames.map((name) => [name, process.env[name] ?? null]),
);
const projectRoots = [...new Set(config.cases.map(({ projectRoot }) => projectRoot))];
if (projectRoots.length !== 1 || !nodePath.isAbsolute(projectRoots[0])) {
  throw new Error('A graph matrix must use one absolute project root');
}
const compilerEnvironment = await requirePinnedCompilerEnvironment(projectRoots[0]);
const harnessSourceManifest = await captureCorrectnessHarnessSourceManifest();

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
const startedAt = new Date().toISOString();
const hostAtStart = captureHostSnapshot();
const hostAdmissionAttempts = [];
const runs = [];
const rawDifferences = [];
const caseParity = [];
let executions = 0;
let sequence = 0;

for (const definition of config.cases) {
  const {
    name,
    variants,
    warmups = 0,
    repeats,
    startIndex = 0,
    rawParityRequired: _rawParityRequired,
    ...caseOptions
  } = definition;
  const firstRun = runs.length;

  for (let warmup = 0; warmup < warmups; warmup++) {
    for (const variant of variants) {
      execute(name, caseOptions, variant, startIndex + warmup, true);
    }
  }

  for (let offset = 0; offset < repeats; offset++) {
    const blockIndex = startIndex + offset;
    const rotation = blockIndex % variants.length;
    const order = [...variants.slice(rotation), ...variants.slice(0, rotation)];
    for (const variant of order) {
      execute(name, caseOptions, variant, blockIndex, false);
    }
  }

  const selected = runs.slice(firstRun);
  const parity = validateParity(name, selected, variants, repeats);
  caseParity.push(parity);
  rawDifferences.push(...parity.rawDifferences);
}

const report = {
  schema: 1,
  kind: 'local-graph-formal-matrix',
  evidenceKind: config.evidenceKind,
  measurementFieldsPresent: true,
  timingEligible: true,
  conclusionEligible: true,
  executionScope: 'local-only',
  startedAt,
  finishedAt: new Date().toISOString(),
  node: process.version,
  nodeBinary: process.execPath,
  runner: {
    path: runnerPath,
    sha256: runnerHash,
  },
  caseRunner: {
    path: caseRunnerPath,
    sha256: caseRunnerHash,
  },
  environment: {
    parentCiMarkers,
    childCiMarkersCleared: ciMarkerNames,
    parentRunLinkCheck: process.env.RUN_LINK_CHECK ?? null,
    parentPoolEnvironment: readPoolEnvironment(),
    childPoolEnvironment: poolEnvironment,
    runtimeProfile,
    compilerEnvironment,
    harnessSourceManifest,
    correctnessGate: {
      path: correctnessGateAdmission.gatePath,
      sha256: correctnessGateAdmission.gateSha256,
      status: correctnessGateAdmission.gate.status,
      requiredArtifacts: correctnessGateAdmission.gate.requiredArtifacts,
      sourceMapCapability: correctnessGateAdmission.gate.sourceMapCapability,
    },
    childMaxBufferBytes: CHILD_MAX_BUFFER_BYTES,
    childInputRunLinkCheck: null,
    runCaseRunLinkCheck: false,
  },
  host: {
    platform: platform(),
    release: release(),
    architecture: process.arch,
    cpuModel: cpus()[0]?.model,
    logicalCpuCount: cpus().length,
    totalMemoryBytes: totalmem(),
    atStart: hostAtStart,
    atFinish: captureHostSnapshot(),
  },
  config,
  hostAdmissionAttempts,
  hostPolicyViolations: [],
  validationErrors: [],
  rawDifferences,
  parity: caseParity,
  runs,
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) {
  await writeFile(outputPath, serialized);
  console.log(
    JSON.stringify({
      outputPath,
      runs: runs.length,
      startedAt,
      finishedAt: report.finishedAt,
    }),
  );
} else {
  process.stdout.write(serialized);
}

function execute(name, caseOptions, variant, index, warmup) {
  if (executions++ > 0) cooldown(config.hostPolicy.cooldownMs);

  const environment = { ...process.env };
  for (const marker of ciMarkerNames) {
    delete environment[marker];
  }
  delete environment.RUN_LINK_CHECK;
  delete environment.ROLLDOWN_PARALLEL_PLUGIN_METRICS;
  delete environment.ROLLDOWN_PARALLEL_PLUGIN_WORKERS;
  applyPoolEnvironment(environment, poolEnvironment);
  const options = {
    ...caseOptions,
    variant,
    expectedPoolEnvironment: poolEnvironment,
    runtimeProfile,
    rustInstrumentation: false,
    evidenceKind: config.evidenceKind,
  };
  const admission = waitForHostAdmission(config.hostPolicy);
  hostAdmissionAttempts.push(...admission.attempts);
  const hostBefore = admission.snapshot;
  const result = spawnSync(
    '/usr/bin/time',
    ['-l', process.execPath, '--expose-gc', caseRunnerPath, JSON.stringify(options)],
    {
      encoding: 'utf8',
      env: environment,
      maxBuffer: CHILD_MAX_BUFFER_BYTES,
    },
  );
  assertChildCaptureComplete(result, `${name}/${variant}`);
  if (result.status !== 0) {
    throw new Error(
      `${name}/${variant} exited ${result.status}:\n${result.stdout}\n${result.stderr}`,
    );
  }
  if (warmup) return;

  const peakRssMatch = result.stderr.match(/(\d+)\s+maximum resident set size/);
  if (!peakRssMatch) {
    throw new Error(`Could not parse peak RSS for ${name}/${variant}:\n${result.stderr}`);
  }
  const child = JSON.parse(result.stdout.trim());
  const expectedMetaModules = variant.startsWith('worker-') ? 0 : child.transformedEntryCount;
  if (child.mdxAstroMetaModules !== expectedMetaModules) {
    throw new Error(
      `${name}/${variant} meta.astro coverage was ${child.mdxAstroMetaModules}; expected ${expectedMetaModules}`,
    );
  }
  const hostAfter = captureHostSnapshot();
  const hostDeltas = hostDelta(hostBefore, hostAfter);
  const hostPolicyViolations = evaluateChildHostPolicy(config.hostPolicy, hostBefore, hostAfter);
  if (hostPolicyViolations.length > 0) {
    throw new Error(
      `${name}/${variant} violated the frozen host policy: ${hostPolicyViolations.join('; ')}`,
    );
  }
  runs.push({
    name,
    index,
    sequence: sequence++,
    peakRssBytes: Number(peakRssMatch[1]),
    hostBefore,
    hostAfter,
    hostDeltas,
    hostPolicyViolations,
    ...child,
  });
}

function validateParity(name, selected, variants, repeats) {
  for (const variant of variants) {
    const count = selected.filter((run) => run.variant === variant).length;
    if (count !== repeats) {
      throw new Error(`${name}/${variant} produced ${count} runs; expected ${repeats}`);
    }
  }
  for (const index of new Set(selected.map((run) => run.index))) {
    const block = selected.filter((run) => run.index === index);
    if (
      block.length !== variants.length ||
      new Set(block.map((run) => run.variant)).size !== variants.length
    ) {
      throw new Error(`${name} block ${index} does not contain every variant once`);
    }
  }
  for (const field of comparableFields) {
    const values = selected.map((run) => JSON.stringify(run[field]));
    if (new Set(values).size !== 1) {
      throw new Error(`${name} graph parity failed for ${field}: ${values.join(' != ')}`);
    }
  }
  const differences = rawFields.flatMap((field) => {
    const values = Object.fromEntries(
      variants.map((variant) => [
        variant,
        [
          ...new Set(
            selected
              .filter((run) => run.variant === variant)
              .map((run) => JSON.stringify(run[field])),
          ),
        ],
      ]),
    );
    return new Set(Object.values(values).flat()).size === 1 ? [] : [{ name, field, values }];
  });
  return {
    name,
    graph: true,
    boundary: true,
    normalizedOutput: true,
    moduleMetadataPattern: true,
    rawParityRequired: false,
    fields: comparableFields,
    mdxAstroMetaModules: Object.fromEntries(
      variants.map((variant) => [
        variant,
        [
          ...new Set(
            selected.filter((run) => run.variant === variant).map((run) => run.mdxAstroMetaModules),
          ),
        ],
      ]),
    ),
    rawDifferences: differences,
  };
}

function validateConfig(value, manifest) {
  if (value.executionScope !== 'local-only') {
    throw new Error('executionScope must be local-only');
  }
  if (!Array.isArray(value.cases)) {
    throw new Error('cases must be an array');
  }
  if (value.executionEnabled !== false && value.cases.length === 0) {
    throw new Error('An enabled graph matrix must contain cases');
  }
  if (value.evidenceKind !== 'performance-confirmation') {
    throw new Error('evidenceKind must be performance-confirmation');
  }
  validateFrozenPerformanceHostPolicy(value.hostPolicy);
  normalizePoolEnvironment(value.poolEnvironment ?? BASELINE_POOL_ENVIRONMENT);
  if (typeof value.correctnessGate !== 'string' || value.correctnessGate.length === 0) {
    throw new Error('Graph formal matrix must declare correctnessGate');
  }
  if (value.runtimeProfile === undefined) {
    throw new Error('Graph formal matrix must pin runtimeProfile');
  }
  const profile = normalizeRuntimeProfile(value.runtimeProfile);
  if (value.hostPolicy?.cooldownMs !== 15_000) {
    throw new Error('hostPolicy.cooldownMs must be 15000');
  }
  if (
    value.executionEnabled === false &&
    (value.selectedWorkerCount !== null ||
      value.confirmedCrossoverPoint !== null ||
      value.cases.length !== 0 ||
      value.caseTemplate?.repeats !== 10 ||
      value.caseTemplate?.warmups !== 0 ||
      value.caseTemplate?.measurementMode !== 'measurement' ||
      JSON.stringify(value.caseTemplate?.variantTemplate) !==
        JSON.stringify([
          'ordinary',
          'managed-${selectedWorkerCount}',
          'worker-${selectedWorkerCount}',
        ]))
  ) {
    throw new Error(
      'Disabled graph template must await a selected worker count and ten-block cases',
    );
  }
  if (
    value.executionEnabled !== false &&
    (!Number.isInteger(value.selectedWorkerCount) ||
      value.selectedWorkerCount < 1 ||
      value.selectedWorkerCount > 8)
  ) {
    throw new Error('Enabled graph matrix must pin selectedWorkerCount from one through eight');
  }
  if (
    value.executionEnabled !== false &&
    (!Number.isInteger(value.confirmedCrossoverPoint) ||
      !FROZEN_SCALES.includes(value.confirmedCrossoverPoint) ||
      value.confirmedCrossoverPoint >= 9_157)
  ) {
    throw new Error('Enabled graph matrix must pin a confirmed crossover point below 9,157');
  }
  const expectedVariants = [
    'ordinary',
    `managed-${value.selectedWorkerCount}`,
    `worker-${value.selectedWorkerCount}`,
  ];
  if (value.executionEnabled !== false) {
    const exactCases = [
      {
        name: `cloudflare-mdx-graph-confirmed-crossover-${value.confirmedCrossoverPoint}`,
        role: 'confirmed-crossover',
        scale: value.confirmedCrossoverPoint,
        startIndex: 0,
      },
      {
        name: 'cloudflare-mdx-graph-full-9157',
        role: 'full-corpus',
        scale: 9_157,
        startIndex: 10,
      },
    ];
    if (value.cases.length !== exactCases.length) {
      throw new Error('Enabled graph matrix must contain exactly crossover and full-corpus cases');
    }
    for (const [index, expected] of exactCases.entries()) {
      const definition = value.cases[index];
      if (
        definition.name !== expected.name ||
        definition.graphPoint !== expected.role ||
        definition.selectionScale !== expected.scale ||
        definition.startIndex !== expected.startIndex
      ) {
        throw new Error(`Graph case ${index} is not the exact ${expected.role} case`);
      }
    }
  }
  for (const definition of value.cases) {
    if (typeof definition.name !== 'string' || definition.name.length === 0) {
      throw new Error('Every case must have a name');
    }
    if (JSON.stringify(definition.variants) !== JSON.stringify(expectedVariants)) {
      throw new Error(
        `${definition.name} variants must use selected worker count ${value.selectedWorkerCount}`,
      );
    }
    if (definition.repeats !== 10) {
      throw new Error(`${definition.name} repeats must be 10`);
    }
    if ((definition.warmups ?? 0) !== 0) {
      throw new Error(`${definition.name} warmups must be 0`);
    }
    if (definition.instrumentation !== false) {
      throw new Error(`${definition.name} instrumentation must be false`);
    }
    if (definition.measurementMode !== 'measurement') {
      throw new Error(`${definition.name} measurementMode must be measurement`);
    }
    if (value.executionEnabled !== false) {
      validateRuntimeLane({
        runtimeProfile: profile,
        instrumentation: definition.instrumentation,
        rustInstrumentation: false,
        evidenceKind: value.evidenceKind,
        lifecycleClaim: definition.lifecycleClaim ?? false,
      });
    }
    if (definition.runLinkCheck !== false) {
      throw new Error(`${definition.name} runLinkCheck must be false`);
    }
    if (definition.rawParityRequired !== false) {
      throw new Error(`${definition.name} rawParityRequired must be false`);
    }
    if (definition.corpus !== 'cloudflare-mdx-scale-v1') {
      throw new Error(`${definition.name} must select the frozen scale corpus`);
    }
    if (
      !FROZEN_SCALES.includes(definition.selectionScale) ||
      definition.selectionPrefixSha256 !==
        manifest.prefixes[String(definition.selectionScale)]?.selectionSha256
    ) {
      throw new Error(`${definition.name} does not pin the exact frozen scale prefix`);
    }
    if (
      !nodePath.isAbsolute(definition.projectRoot) ||
      !nodePath.isAbsolute(definition.rolldownPackageRoot)
    ) {
      throw new Error(`${definition.name} roots must be absolute paths`);
    }
  }
}

function cooldown(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return;
  Atomics.wait(
    new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)),
    0,
    0,
    milliseconds,
  );
}

function isCiEnvironment(value) {
  return value !== undefined && !['', '0', 'false'].includes(value.toLowerCase());
}
