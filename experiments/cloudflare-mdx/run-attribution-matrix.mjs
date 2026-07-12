import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { cpus, platform, release, totalmem } from 'node:os';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deriveAttributionComparison,
  deriveAttributionSummary,
  validateAttributionMatrix,
  validateAttributionReport,
} from './attribution-admission.mjs';
import { writeFileAtomic } from './atomic-output.mjs';
import { assertChildCaptureComplete, CHILD_MAX_BUFFER_BYTES } from './child-buffer-policy.mjs';
import { requirePassedScaleCorrectnessGate } from './correctness-gate.mjs';
import {
  captureHarnessSourceManifest,
  requirePinnedCompilerEnvironment,
} from './environment-provenance.mjs';
import { requireCurrentEvidenceProvenance } from './evidence-provenance.mjs';
import {
  captureHostSnapshot,
  evaluateChildHostPolicy,
  hostDelta,
  waitForHostAdmission,
} from './local-host-policy.mjs';
import { applyPoolEnvironment, normalizePoolEnvironment, readPoolEnvironment } from './pool-environment.mjs';
import { normalizeRuntimeProfile } from './runtime-profile.mjs';

const CI_MARKERS = ['CI', 'GITHUB_ACTIONS', 'BUILDKITE', 'CIRCLECI', 'TF_BUILD', 'JENKINS_URL'];
const checkOnly = process.argv[2] === '--check-config';
const matrixPath = nodePath.resolve(process.argv[checkOnly ? 3 : 2] ?? '');
const outputArgument = process.argv[checkOnly ? 4 : 3];
const outputPath = outputArgument ? nodePath.resolve(outputArgument) : undefined;
const matrix = validateAttributionMatrix(JSON.parse(await readFile(matrixPath, 'utf8')));
const poolEnvironment = normalizePoolEnvironment(matrix.poolEnvironment);
const runtimeProfile = normalizeRuntimeProfile(matrix.runtimeProfile);

if (checkOnly) {
  console.log(
    JSON.stringify({
      valid: true,
      matrixPath,
      evidenceKind: matrix.evidenceKind,
      executionEnabled: matrix.executionEnabled ?? true,
      runs: matrix.cases[0].variants.length,
      timingEligible: false,
      runtimeProfile,
      poolEnvironment,
    }),
  );
  process.exit(0);
}
if (matrix.executionEnabled === false) {
  throw new Error(`This attribution matrix is disabled: ${matrix.blockedBy ?? 'no gate recorded'}`);
}
const activeCiMarkers = CI_MARKERS.filter((name) => isActiveCiValue(process.env[name]));
if (activeCiMarkers.length > 0) {
  throw new Error(
    `This attribution is local-only; refuse to run with active CI markers: ${activeCiMarkers.join(', ')}`,
  );
}

const gatePath = nodePath.resolve(nodePath.dirname(matrixPath), matrix.correctnessGate);
const correctnessGateAdmission = await requirePassedScaleCorrectnessGate(gatePath);
const correctnessOracle = await readCorrectnessOracle(correctnessGateAdmission);
const definition = matrix.cases[0];
const compilerEnvironment = await requirePinnedCompilerEnvironment(definition.projectRoot);
const harnessSourceManifest = await captureHarnessSourceManifest();
const runnerPath = fileURLToPath(import.meta.url);
const caseRunnerPath = nodePath.join(import.meta.dirname, 'run-case.mjs');
const runner = await sourceRecord(runnerPath);
const caseRunner = await sourceRecord(caseRunnerPath);
const parentCiMarkers = Object.fromEntries(
  CI_MARKERS.map((name) => [name, process.env[name] ?? null]),
);
const hostAdmissionAttempts = [];
const runs = [];
const startedAt = new Date().toISOString();
const hostAtStart = captureHostSnapshot();
let sequence = 0;

for (let index = 0; index < definition.repeats; index++) {
  const blockIndex = definition.startIndex + index;
  const offset = blockIndex % definition.variants.length;
  const variants = [
    ...definition.variants.slice(offset),
    ...definition.variants.slice(0, offset),
  ];
  for (const variant of variants) {
    if (runs.length > 0 && Number.isFinite(matrix.hostPolicy.cooldownMs)) {
      Atomics.wait(
        new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)),
        0,
        0,
        matrix.hostPolicy.cooldownMs,
      );
    }
    const admission = waitForHostAdmission(matrix.hostPolicy);
    hostAdmissionAttempts.push(...admission.attempts);
    const hostBefore = admission.snapshot;
    const environment = attributionEnvironment(variant);
    const options = {
      ...definition,
      variants: undefined,
      warmups: undefined,
      repeats: undefined,
      startIndex: undefined,
      name: undefined,
      variant,
      expectedPoolEnvironment: poolEnvironment,
      runtimeProfile,
      rustInstrumentation: true,
      evidenceKind: 'attribution',
    };
    const result = spawnSync(
      '/usr/bin/time',
      ['-l', process.execPath, '--expose-gc', caseRunnerPath, JSON.stringify(options)],
      { encoding: 'utf8', env: environment, maxBuffer: CHILD_MAX_BUFFER_BYTES },
    );
    assertChildCaptureComplete(result, `${definition.name}/${variant}`);
    const hostAfter = captureHostSnapshot();
    const hostPolicyViolations = evaluateChildHostPolicy(
      matrix.hostPolicy,
      hostBefore,
      hostAfter,
    );
    if (hostPolicyViolations.length > 0) {
      throw new Error(
        `${definition.name}/${variant} violated the frozen post-child host gate: ${hostPolicyViolations.join('; ')}`,
      );
    }
    if (result.status !== 0) {
      throw new Error(
        `${definition.name}/${variant} exited ${result.status}:\n${result.stdout}\n${result.stderr}`,
      );
    }
    const peakRssMatch = result.stderr.match(/(\d+)\s+maximum resident set size/);
    if (!peakRssMatch) throw new Error(`Could not parse peak RSS for ${definition.name}/${variant}`);
    const child = JSON.parse(result.stdout.trim());
    const run = {
      name: definition.name,
      index: blockIndex,
      sequence: sequence++,
      hostPolicy: matrix.hostPolicy,
      hostBefore,
      hostAfter,
      hostDeltas: hostDelta(hostBefore, hostAfter),
      hostPolicyViolations,
      peakRssBytes: Number(peakRssMatch[1]),
      ...child,
      rustMetrics: parseRecords(result.stderr, 'rolldown-parallel-plugin-metrics'),
      lifecycleMetrics: parseRecords(result.stderr, 'rolldown-parallel-plugin-init-metrics'),
      moduleInitMetrics: parseRecords(
        result.stderr,
        'rolldown-parallel-plugin-module-init-metrics',
      ),
      createBundlerOptionsMetrics: parseRecords(
        result.stderr,
        'rolldown-create-bundler-options-metrics',
      ),
      nativePluginRegistrationMetrics: parseRecords(
        result.stderr,
        'rolldown-native-plugin-registration-metrics',
      ),
    };
    run.attributionSummary = deriveAttributionSummary(run);
    runs.push(run);
  }
}

const report = {
  schema: 1,
  evidenceKind: 'attribution',
  executionMode: 'current-evidence',
  measurementFieldsPresent: true,
  timingEligible: false,
  conclusionEligible: false,
  executionScope: 'local-only',
  startedAt,
  finishedAt: new Date().toISOString(),
  node: process.version,
  nodeBinary: process.execPath,
  runner,
  caseRunner,
  environment: {
    parentCiMarkers,
    childCiMarkersCleared: CI_MARKERS,
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
  matrix,
  correctnessOracle,
  hostAdmissionAttempts,
  hostPolicyViolations: [],
  validationErrors: [],
  rawOutputDifferences: rawOutputDifferences(runs),
  initializationComparison: deriveAttributionComparison(runs),
  runs,
};

await requireCurrentEvidenceProvenance(
  report.environment,
  report.runner,
  report.caseRunner,
  'run-attribution-matrix.mjs',
  'run-case.mjs',
);
validateAttributionReport(report, { correctnessOracle });
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) {
  await writeFileAtomic(outputPath, serialized);
  console.log(JSON.stringify({ outputPath, runs: runs.length, timingEligible: false }));
} else {
  process.stdout.write(serialized);
}

function attributionEnvironment(variant) {
  const environment = { ...process.env };
  for (const marker of CI_MARKERS) delete environment[marker];
  delete environment.RUN_LINK_CHECK;
  delete environment.ROLLDOWN_PARALLEL_PLUGIN_WORKERS;
  environment.ROLLDOWN_PARALLEL_PLUGIN_METRICS = 'json';
  applyPoolEnvironment(environment, poolEnvironment);
  const match = /^worker-(\d+)$/.exec(variant);
  if (match) environment.ROLLDOWN_PARALLEL_PLUGIN_WORKERS = match[1];
  return environment;
}

function parseRecords(stderr, prefix) {
  return [
    ...stderr.matchAll(new RegExp(`^\\[${escapeRegExp(prefix)}\\] (\\{.*\\})$`, 'gm')),
  ].map((match) => JSON.parse(match[1]));
}

async function readCorrectnessOracle(admission) {
  const descriptor = admission.gate.requiredArtifacts.fullCorpus;
  const path = nodePath.resolve(nodePath.dirname(admission.gatePath), descriptor.path);
  const source = await readFile(path);
  const sha256 = createHash('sha256').update(source).digest('hex');
  if (sha256 !== descriptor.sha256) throw new Error('Correctness oracle artifact hash changed');
  const artifact = JSON.parse(source);
  const fields = ['outputChunks', 'normalizedOutputBytes', 'normalizedOutputHash', 'outputNormalization'];
  const oracle = Object.fromEntries(fields.map((field) => [field, artifact.runs?.[0]?.[field]]));
  if (
    artifact.runs?.length !== 4 ||
    fields.some(
      (field) =>
        oracle[field] === undefined ||
        new Set(artifact.runs.map((run) => JSON.stringify(run[field]))).size !== 1,
    )
  ) {
    throw new Error('Correctness oracle lacks a unique four-run normalized output');
  }
  return { artifactPath: path, artifactSha256: sha256, ...oracle };
}

async function sourceRecord(path) {
  return {
    path,
    sha256: createHash('sha256').update(await readFile(path)).digest('hex'),
  };
}

function rawOutputDifferences(runs) {
  const differences = [];
  for (const field of ['outputBytes', 'outputHash']) {
    const values = [...new Set(runs.map((run) => run[field]))];
    if (values.length > 1) differences.push(`Attribution variants differ for raw ${field}: ${values}`);
  }
  return differences;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isActiveCiValue(value) {
  return value !== undefined && !['', '0', 'false'].includes(value.toLowerCase());
}
