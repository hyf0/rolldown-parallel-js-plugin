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
import { FROZEN_SCALES } from './scale-corpus.mjs';
import { normalizeRuntimeProfile, validateRuntimeLane } from './runtime-profile.mjs';
import { assertChildCaptureComplete, CHILD_MAX_BUFFER_BYTES } from './child-buffer-policy.mjs';
import { requirePassedScaleCorrectnessGate } from './correctness-gate.mjs';
import {
  captureCorrectnessHarnessSourceManifest,
  requirePinnedCompilerEnvironment,
} from './environment-provenance.mjs';

const CI_MARKERS = ['CI', 'GITHUB_ACTIONS', 'BUILDKITE', 'CIRCLECI', 'TF_BUILD', 'JENKINS_URL'];
const checkOnly = process.argv[2] === '--check-config';
const matrixArgument = process.argv[checkOnly ? 3 : 2];
const outputArgument = process.argv[checkOnly ? 4 : 3];
const matrixPath = nodePath.resolve(matrixArgument ?? '');
const outputPath = outputArgument ? nodePath.resolve(outputArgument) : undefined;
const matrix = JSON.parse(await readFile(matrixPath, 'utf8'));
validateMatrix(matrix);
const performanceEvidence = matrix.evidenceKind.startsWith('performance-');
const correctnessOnly =
  matrix.evidenceKind === 'correctness-only' || matrix.evidenceKind === 'historical-replay';
const poolEnvironment = normalizePoolEnvironment(
  matrix.poolEnvironment ?? BASELINE_POOL_ENVIRONMENT,
);
const runtimeProfile = normalizeRuntimeProfile(matrix.runtimeProfile);
if (checkOnly) {
  console.log(
    JSON.stringify({
      valid: true,
      matrixPath,
      evidenceKind: matrix.evidenceKind,
      executionMode: matrix.executionMode ?? 'current-evidence',
      executionEnabled: matrix.executionEnabled ?? true,
      cases: matrix.cases.length,
      measuredRuns: matrix.cases.reduce(
        (sum, definition) => sum + (definition.repeats ?? 1) * definition.variants.length,
        0,
      ),
      poolEnvironment,
      runtimeProfile,
    }),
  );
  process.exit(0);
}
if (matrix.executionEnabled === false) {
  throw new Error(
    `This matrix is disabled: ${matrix.blockedBy ?? 'no execution gate was recorded'}`,
  );
}
const correctnessGateAdmission = performanceEvidence
  ? await requirePassedScaleCorrectnessGate(
      nodePath.resolve(nodePath.dirname(matrixPath), matrix.correctnessGate),
    )
  : undefined;

const activeCiMarkers = CI_MARKERS.filter((name) => isActiveCiValue(process.env[name]));
if (activeCiMarkers.length > 0) {
  throw new Error(
    `This benchmark is local-only; refuse to run with active CI markers: ${activeCiMarkers.join(', ')}`,
  );
}

const runnerPath = fileURLToPath(import.meta.url);
const caseRunnerPath = nodePath.join(import.meta.dirname, 'run-case.mjs');
const runnerHash = createHash('sha256')
  .update(await readFile(runnerPath))
  .digest('hex');
const caseRunnerHash = createHash('sha256')
  .update(await readFile(caseRunnerPath))
  .digest('hex');
const parentCiMarkers = Object.fromEntries(
  CI_MARKERS.map((name) => [name, process.env[name] ?? null]),
);
const projectRoots = [...new Set(matrix.cases.map(({ projectRoot }) => projectRoot))];
if (projectRoots.length !== 1 || !nodePath.isAbsolute(projectRoots[0])) {
  throw new Error('A matrix must use one absolute project root');
}
const compilerEnvironment = await requirePinnedCompilerEnvironment(projectRoots[0]);
const harnessSourceManifest = await captureCorrectnessHarnessSourceManifest();

const runs = [];
const validationErrors = [];
const rawOutputDifferences = [];
let sequence = 0;
let executions = 0;
const startedAt = performanceEvidence ? new Date().toISOString() : undefined;
const hostAtStart = performanceEvidence ? captureHostSnapshot() : undefined;
const hostAdmissionAttempts = [];
for (const definition of matrix.cases) {
  const { name, variants, warmups = 0, repeats = 1, startIndex = 0, ...caseOptions } = definition;
  if (!Array.isArray(variants) || variants.length === 0) throw new Error(`${name} has no variants`);
  const caseStart = runs.length;
  for (let index = 0; index < warmups; index++) {
    for (const variant of variants) execute(name, caseOptions, variant, index, true);
  }
  for (let index = 0; index < repeats; index++) {
    const blockIndex = startIndex + index;
    const offset = blockIndex % variants.length;
    const order = [...variants.slice(offset), ...variants.slice(0, offset)];
    for (const variant of order) execute(name, caseOptions, variant, blockIndex, false);
  }
  for (const field of [
    'transformedEntryCount',
    'selection',
    'outputChunks',
    'normalizedOutputBytes',
    'normalizedOutputHash',
  ]) {
    const values = new Set(runs.slice(caseStart).map((run) => JSON.stringify(run[field])));
    if (values.size !== 1) {
      const message = `${name} produced different ${field}: ${[...values]}`;
      if (!matrix.allowOutputMismatch) throw new Error(message);
      validationErrors.push(message);
    }
  }
  for (const field of ['outputBytes', 'outputHash']) {
    const values = new Set(runs.slice(caseStart).map((run) => run[field]));
    if (values.size !== 1) {
      rawOutputDifferences.push(`${name} produced different raw ${field}: ${[...values]}`);
    }
  }
}

const report = {
  schema: 1,
  evidenceKind: matrix.evidenceKind,
  executionMode: matrix.executionMode ?? 'current-evidence',
  measurementFieldsPresent: performanceEvidence,
  timingEligible: performanceEvidence,
  conclusionEligible: matrix.evidenceKind === 'performance-confirmation',
  executionScope: 'local-only',
  startedAt,
  finishedAt: performanceEvidence ? new Date().toISOString() : undefined,
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
    childCiMarkersCleared: CI_MARKERS,
    parentRunLinkCheck: process.env.RUN_LINK_CHECK ?? null,
    parentPoolEnvironment: readPoolEnvironment(),
    childPoolEnvironment: poolEnvironment,
    runtimeProfile,
    compilerEnvironment,
    harnessSourceManifest,
    correctnessGate: correctnessGateAdmission
      ? {
          path: correctnessGateAdmission.gatePath,
          sha256: correctnessGateAdmission.gateSha256,
          status: correctnessGateAdmission.gate.status,
          requiredArtifacts: correctnessGateAdmission.gate.requiredArtifacts,
          sourceMapCapability: correctnessGateAdmission.gate.sourceMapCapability,
        }
      : null,
    childMaxBufferBytes: CHILD_MAX_BUFFER_BYTES,
    childInputRunLinkCheck: null,
    runCaseProfilePolicy: {
      default: false,
      'ci-link-check': true,
    },
  },
  host: performanceEvidence
    ? {
        platform: platform(),
        release: release(),
        architecture: process.arch,
        cpuModel: cpus()[0]?.model,
        logicalCpuCount: cpus().length,
        totalMemoryBytes: totalmem(),
        atStart: hostAtStart,
        atFinish: captureHostSnapshot(),
      }
    : undefined,
  matrix,
  hostAdmissionAttempts: performanceEvidence ? hostAdmissionAttempts : undefined,
  hostPolicyViolations: performanceEvidence ? [] : undefined,
  validationErrors,
  rawOutputDifferences,
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
  const workerMatch = /^worker-(\d+)$/.exec(variant);
  const managedMatch = /^managed-(\d+)$/.exec(variant);
  const rustInstrumentation =
    caseOptions.rustInstrumentation ??
    (matrix.runtimeProfile === undefined && caseOptions.instrumentation === true);
  const environment = { ...process.env };
  for (const marker of CI_MARKERS) delete environment[marker];
  delete environment.RUN_LINK_CHECK;
  delete environment.ROLLDOWN_PARALLEL_PLUGIN_METRICS;
  delete environment.ROLLDOWN_PARALLEL_PLUGIN_WORKERS;
  applyPoolEnvironment(environment, poolEnvironment);
  if (workerMatch) environment.ROLLDOWN_PARALLEL_PLUGIN_WORKERS = workerMatch[1];
  if (rustInstrumentation && workerMatch) {
    environment.ROLLDOWN_PARALLEL_PLUGIN_METRICS = 'json';
  }
  if (executions++ > 0 && Number.isFinite(matrix.hostPolicy?.cooldownMs)) {
    Atomics.wait(
      new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)),
      0,
      0,
      matrix.hostPolicy.cooldownMs,
    );
  }
  const options = {
    ...caseOptions,
    variant,
    expectedPoolEnvironment: poolEnvironment,
    runtimeProfile,
    rustInstrumentation,
    evidenceKind: matrix.evidenceKind,
  };
  const admission = performanceEvidence ? waitForHostAdmission(matrix.hostPolicy) : undefined;
  if (admission) hostAdmissionAttempts.push(...admission.attempts);
  const hostBefore = performanceEvidence ? admission?.snapshot : undefined;
  const result = spawnSync(
    correctnessOnly ? process.execPath : '/usr/bin/time',
    correctnessOnly
      ? ['--expose-gc', caseRunnerPath, JSON.stringify(options)]
      : ['-l', process.execPath, '--expose-gc', caseRunnerPath, JSON.stringify(options)],
    { encoding: 'utf8', env: environment, maxBuffer: CHILD_MAX_BUFFER_BYTES },
  );
  assertChildCaptureComplete(result, `${name}/${variant}`);
  if (result.status !== 0) {
    throw new Error(
      `${name}/${variant} exited ${result.status}:\n${result.stdout}\n${result.stderr}`,
    );
  }
  if (warmup) return;
  const peakRssMatch = correctnessOnly
    ? undefined
    : result.stderr.match(/(\d+)\s+maximum resident set size/);
  if (!correctnessOnly && !peakRssMatch) {
    throw new Error(`Could not parse peak RSS for ${name}/${variant}`);
  }
  const child = JSON.parse(result.stdout.trim());
  const hostAfter = performanceEvidence ? captureHostSnapshot() : undefined;
  const hostPolicyViolations = performanceEvidence
    ? evaluateChildHostPolicy(matrix.hostPolicy, hostBefore, hostAfter)
    : [];
  if (hostPolicyViolations.length > 0) {
    throw new Error(
      `${name}/${variant} violated the frozen host policy: ${hostPolicyViolations.join('; ')}`,
    );
  }
  const rustMetrics = [
    ...result.stderr.matchAll(/^\[rolldown-parallel-plugin-metrics\] (\{.*\})$/gm),
  ].map((match) => JSON.parse(match[1]));
  const lifecycleMetrics = [
    ...result.stderr.matchAll(/^\[rolldown-parallel-plugin-init-metrics\] (\{.*\})$/gm),
  ].map((match) => JSON.parse(match[1]));
  if (caseOptions.instrumentation) {
    const expectedWorkerCount = workerMatch ? Number(workerMatch[1]) : 0;
    if (workerMatch && rustInstrumentation) {
      const initialization = lifecycleMetrics.find(
        ({ kind }) => kind === 'rolldown_parallel_plugin_init_metrics',
      );
      const termination = lifecycleMetrics.find(
        ({ kind }) => kind === 'rolldown_parallel_plugin_termination_metrics',
      );
      if (
        initialization?.workerCount !== expectedWorkerCount ||
        termination?.workerCount !== expectedWorkerCount ||
        rustMetrics.length !== 1
      ) {
        throw new Error(`${name}/${variant} emitted incomplete worker instrumentation`);
      }
      const rust = rustMetrics[0];
      if (
        (child.metrics ?? child.correctnessCounters)?.factoryCalls !== expectedWorkerCount ||
        rust.valueResults !== child.transformedEntryCount ||
        rust.errorResults !== 0 ||
        rust.cancelledBeforeAcquire !== 0 ||
        rust.cancelledDuringService !== 0 ||
        rust.permitQueuePending?.current !== 0 ||
        rust.wrapperOutstanding?.current !== 0 ||
        rust.permitInFlight?.current !== 0 ||
        rust.completedWrapperCalls !== rust.wrapperCalls
      ) {
        throw new Error(`${name}/${variant} failed worker completion checks`);
      }
    } else if (managedMatch) {
      throw new Error(`${name}/${variant} does not support instrumentation`);
    } else if (lifecycleMetrics.length !== 0 || rustMetrics.length !== 0) {
      throw new Error(`${name}/${variant} unexpectedly emitted worker instrumentation`);
    } else if (
      workerMatch &&
      (child.metrics ?? child.correctnessCounters)?.factoryCalls !== Number(workerMatch[1])
    ) {
      throw new Error(`${name}/${variant} did not initialize every JavaScript worker kernel`);
    } else if (!workerMatch && (child.metrics ?? child.correctnessCounters)?.factoryCalls !== 1) {
      throw new Error(`${name}/${variant} did not initialize one ordinary plugin`);
    }
  }
  runs.push({
    name,
    index,
    sequence: sequence++,
    peakRssBytes: peakRssMatch ? Number(peakRssMatch[1]) : undefined,
    hostBefore: performanceEvidence ? hostBefore : undefined,
    hostAfter: performanceEvidence ? hostAfter : undefined,
    hostDeltas: performanceEvidence ? hostDelta(hostBefore, hostAfter) : undefined,
    hostPolicyViolations: performanceEvidence ? hostPolicyViolations : undefined,
    ...child,
    rustMetrics: correctnessOnly ? undefined : rustMetrics,
    lifecycleMetrics: correctnessOnly ? undefined : lifecycleMetrics,
  });
}

function isActiveCiValue(value) {
  return value !== undefined && !['', '0', 'false'].includes(value.toLowerCase());
}

function validateMatrix(value) {
  if (!Array.isArray(value.cases)) throw new Error('matrix.cases must be an array');
  if (value.executionScope !== undefined && value.executionScope !== 'local-only') {
    throw new Error('executionScope must be local-only');
  }
  const allowedEvidenceKinds = new Set([
    'correctness-only',
    'historical-replay',
    'performance-screen',
    'performance-refinement',
    'performance-confirmation',
  ]);
  if (!allowedEvidenceKinds.has(value.evidenceKind)) {
    throw new Error(`Matrix evidenceKind must be explicit; got ${value.evidenceKind ?? 'missing'}`);
  }
  if (value.runtimeProfile === undefined) {
    throw new Error('Every matrix must pin runtimeProfile');
  }
  const performance = value.evidenceKind.startsWith('performance-');
  if (performance) {
    validateFrozenPerformanceHostPolicy(value.hostPolicy);
    if (typeof value.correctnessGate !== 'string' || value.correctnessGate.length === 0) {
      throw new Error('Every performance matrix must declare correctnessGate');
    }
  }
  normalizePoolEnvironment(value.poolEnvironment ?? BASELINE_POOL_ENVIRONMENT);
  const profile = normalizeRuntimeProfile(value.runtimeProfile);
  if (value.evidenceKind === 'historical-replay') {
    if (value.executionMode !== 'historical-replay' || profile.kind !== 'historical-0aa-artifact') {
      throw new Error(
        'Historical execution requires executionMode=historical-replay and the frozen historical profile',
      );
    }
  } else if (profile.kind === 'historical-0aa-artifact') {
    throw new Error('The historical runtime is allowed only for an explicit historical replay');
  }
  const screenVariants = [
    'ordinary',
    'worker-1',
    'worker-2',
    'worker-3',
    'worker-4',
    'worker-5',
    'worker-6',
    'worker-7',
    'worker-8',
  ];
  for (const definition of value.cases) {
    if (typeof definition.name !== 'string' || definition.name.length === 0) {
      throw new Error('Every matrix case must have a name');
    }
    if (!Array.isArray(definition.variants) || definition.variants.length === 0) {
      throw new Error(`${definition.name} has no variants`);
    }
    if (
      !definition.variants.every(
        (variant) =>
          variant === 'ordinary' || /^(?:worker|managed)-(?:[1-9]|1[0-2])$/.test(variant),
      )
    ) {
      throw new Error(`${definition.name} contains an invalid variant`);
    }
    if (performance && definition.instrumentation !== false) {
      throw new Error(`${definition.name} must disable instrumentation for wall evidence`);
    }
    if (
      (value.evidenceKind === 'correctness-only' || value.evidenceKind === 'historical-replay') &&
      definition.measurementMode !== 'correctness-only'
    ) {
      throw new Error(`${definition.name} must disable measurement collection`);
    }
    if (performance && (definition.measurementMode ?? 'measurement') !== 'measurement') {
      throw new Error(`${definition.name} must use the measurement lane`);
    }
    validateRuntimeLane({
      runtimeProfile: profile,
      instrumentation: definition.instrumentation ?? false,
      rustInstrumentation: definition.rustInstrumentation ?? false,
      evidenceKind: value.evidenceKind,
      lifecycleClaim: definition.lifecycleClaim ?? false,
    });
    if (
      value.evidenceKind === 'performance-screen' ||
      value.evidenceKind === 'performance-refinement'
    ) {
      if (
        JSON.stringify(definition.variants) !== JSON.stringify(screenVariants) ||
        (definition.warmups ?? 0) !== 0 ||
        (definition.repeats ?? 1) !== 1
      ) {
        throw new Error(`${definition.name} must be one no-warmup ordinary/worker-1..8 screen`);
      }
    }
    if (
      value.evidenceKind === 'performance-confirmation' &&
      ((definition.warmups ?? 0) !== 0 || definition.repeats !== 10)
    ) {
      throw new Error(
        `${definition.name} must use ten no-warmup rotated blocks for MDX confirmation`,
      );
    }
    if (definition.corpus === 'cloudflare-mdx-scale-v1') {
      if (!FROZEN_SCALES.includes(definition.selectionScale)) {
        throw new Error(`${definition.name} does not use a frozen scale`);
      }
      if (!/^[a-f0-9]{64}$/.test(definition.selectionPrefixSha256 ?? '')) {
        throw new Error(`${definition.name} must pin selectionPrefixSha256`);
      }
      if ((definition.limit ?? 0) !== 0) {
        throw new Error(`${definition.name} must not use the legacy limit`);
      }
    }
  }
}
