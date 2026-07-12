import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { cpus, platform, release, totalmem } from 'node:os';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
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
import {
  loadAndRequireCrossoverReference,
  planAllocationPolicy,
  planQuotaPolicy,
  readArtifactRecord,
  requirePassedCpulimitCalibration,
  validatePolicyMatrix,
  validatePolicyReport,
} from './mdx-policy.mjs';
import { applyPoolEnvironment, readPoolEnvironment } from './pool-environment.mjs';
import { loadScaleManifest } from './scale-corpus.mjs';
import { normalizeRuntimeProfile } from './runtime-profile.mjs';

const CI_MARKERS = ['CI', 'GITHUB_ACTIONS', 'BUILDKITE', 'CIRCLECI', 'TF_BUILD', 'JENKINS_URL'];
const QUOTA_READY_TIMEOUT_MS = 30_000;
const QUOTA_ATTACH_TIMEOUT_MS = 30_000;
const QUOTA_RUN_TIMEOUT_MS = 4 * 60 * 60 * 1_000;
const QUOTA_CLEANUP_GRACE_MS = 2_000;
if (process.argv[2] === '--verify-process-control') {
  await verifyProcessControl();
  process.exit(0);
}
const checkOnly = process.argv[2] === '--check-config';
const matrixPath = nodePath.resolve(process.argv[checkOnly ? 3 : 2] ?? '');
const outputArgument = process.argv[checkOnly ? 4 : 3];
const outputPath = outputArgument ? nodePath.resolve(outputArgument) : undefined;
const manifest = await loadScaleManifest();
const matrix = validatePolicyMatrix(JSON.parse(await readFile(matrixPath, 'utf8')), manifest);
if (checkOnly) {
  console.log(
    JSON.stringify({
      valid: true,
      stage: matrix.policy.stage,
      executionEnabled: matrix.executionEnabled ?? true,
      cases: matrix.cases.length,
      runs: matrix.cases.reduce(
        (sum, definition) => sum + definition.variants.length * definition.repeats,
        0,
      ),
      quotaControlled: matrix.policy.stage.startsWith('quota-'),
    }),
  );
  process.exit(0);
}
if (matrix.executionEnabled === false) {
  throw new Error(`Policy matrix is disabled: ${matrix.blockedBy ?? 'no gate recorded'}`);
}
const activeCiMarkers = CI_MARKERS.filter((name) => isActiveCiValue(process.env[name]));
if (activeCiMarkers.length > 0) {
  throw new Error(`Policy timing is local-only; active CI markers: ${activeCiMarkers.join(', ')}`);
}

const crossoverContext = await loadAndRequireCrossoverReference(matrix.policy.crossover);
for (const record of [crossoverContext.screenRecord, ...crossoverContext.crossoverRecords]) {
  await requireCurrentEvidenceProvenance(
    record.report.environment,
    record.report.runner,
    record.report.caseRunner,
    'run-matrix.mjs',
    'run-case.mjs',
  );
}
const policyRecords = await Promise.all(
  matrix.policy.consumedPolicyArtifacts.map(async (reference) => {
    const record = await readArtifactRecord(reference.path);
    if (record.sha256 !== reference.sha256) throw new Error(`Policy artifact changed: ${reference.path}`);
    await requireCurrentEvidenceProvenance(
      record.report.environment,
      record.report.runner,
      record.report.caseRunner,
      'run-policy-matrix.mjs',
      'run-case.mjs',
      [[record.report.launcher, 'policy-node-launcher.mjs']],
    );
    return record;
  }),
);
let calibration;
if (matrix.policy.stage.startsWith('quota-')) {
  const reference = matrix.policy.calibration;
  const record = await readArtifactRecord(reference.path);
  if (record.sha256 !== reference.sha256) throw new Error('CPU-rate calibration artifact changed');
  calibration = await requirePassedCpulimitCalibration(record);
  if (JSON.stringify(reference.controllerProvenance) !== JSON.stringify(calibration.controllerProvenance)) {
    throw new Error('CPU-rate controller provenance changed after matrix generation');
  }
}
const template = crossoverContext.crossover.executionTemplate;
const expectedPlan = matrix.policy.stage.startsWith('allocation-')
  ? planAllocationPolicy({
      crossover: crossoverContext.crossover,
      policyRecords,
      template,
      manifest,
    })
  : planQuotaPolicy({
      crossover: crossoverContext.crossover,
      policyRecords,
      template,
      manifest,
      calibration,
    });
if (expectedPlan.status !== 'matrix-required' || JSON.stringify(expectedPlan.matrix) !== JSON.stringify(matrix)) {
  throw new Error('Policy matrix is not the deterministic next artifact in its exact chain');
}

const gateAdmission = await requirePassedScaleCorrectnessGate(
  nodePath.resolve(nodePath.dirname(matrixPath), matrix.correctnessGate),
);
const fullOracle = await readFullOracle(gateAdmission);
assertOutputOracle(
  crossoverContext.crossover.outputOraclesByScale['9157'],
  fullOracle,
  'Crossover full-scale oracle',
);
const projectRoots = [...new Set(matrix.cases.map(({ projectRoot }) => projectRoot))];
if (projectRoots.length !== 1 || !nodePath.isAbsolute(projectRoots[0])) {
  throw new Error('Policy matrix must use one absolute Cloudflare project root');
}
const compilerEnvironment = await requirePinnedCompilerEnvironment(projectRoots[0]);
const harnessSourceManifest = await captureHarnessSourceManifest();
const runnerPath = fileURLToPath(import.meta.url);
const caseRunnerPath = nodePath.join(import.meta.dirname, 'run-case.mjs');
const launcherPath = nodePath.join(import.meta.dirname, 'policy-node-launcher.mjs');
const runner = await sourceRecord(runnerPath);
const caseRunner = await sourceRecord(caseRunnerPath);
const launcher = await sourceRecord(launcherPath);
const parentCiMarkers = Object.fromEntries(CI_MARKERS.map((name) => [name, process.env[name] ?? null]));
const runs = [];
const hostAdmissionAttempts = [];
let sequence = 0;
const startedAt = new Date().toISOString();
const hostAtStart = captureHostSnapshot();

for (const definition of matrix.cases) {
  const caseStart = runs.length;
  for (let index = 0; index < definition.repeats; index++) {
    const blockIndex = definition.startIndex + index;
    const offset = blockIndex % definition.variants.length;
    const order = [
      ...definition.variants.slice(offset),
      ...definition.variants.slice(0, offset),
    ];
    for (const variant of order) {
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
      const environment = childEnvironment(definition, variant);
      const options = childOptions(definition, variant);
      const result = definition.quotaPercent
        ? await runQuotaChild(definition, options, environment)
        : runDirectChild(options, environment);
      assertChildCaptureComplete(result, `${definition.name}/${variant}`);
      const hostAfter = captureHostSnapshot();
      const hostPolicyViolations = evaluateChildHostPolicy(
        matrix.hostPolicy,
        hostBefore,
        hostAfter,
      );
      if (hostPolicyViolations.length > 0) {
        throw new Error(`${definition.name}/${variant} violated host policy: ${hostPolicyViolations.join('; ')}`);
      }
      if (result.status !== 0) {
        throw new Error(`${definition.name}/${variant} exited ${result.status}:\n${result.stdout}\n${result.stderr}`);
      }
      const peakRssMatch = result.stderr.match(/(\d+)\s+maximum resident set size/);
      if (!peakRssMatch) throw new Error(`Missing /usr/bin/time peak RSS for ${definition.name}/${variant}`);
      const externalTiming = parseDarwinTime(result.stderr);
      const child = parseChildJson(result.stdout);
      const peakRssBytes = Number(peakRssMatch[1]);
      if (!Number.isSafeInteger(child.processId) || child.processId <= 1 || peakRssBytes < child.finalRssBytes) {
        throw new Error(`${definition.name}/${variant} lacks direct Node PID/RSS measurement`);
      }
      const scaleOracle = matrix.policy.crossover.outputOraclesByScale[String(definition.selectionScale)];
      assertOutputOracle(child, scaleOracle, `${definition.name}/${variant}`);
      runs.push({
        name: definition.name,
        index: blockIndex,
        sequence: sequence++,
        peakRssBytes,
        externalTiming,
        policyWallMs: externalTiming.realMs,
        hostBefore,
        hostAfter,
        hostDeltas: hostDelta(hostBefore, hostAfter),
        hostPolicyViolations,
        ...child,
        controller: result.controller,
      });
    }
  }
  assertCaseParity(definition.name, runs.slice(caseStart));
}

const report = {
  schema: 1,
  evidenceKind: matrix.evidenceKind,
  executionMode: 'current-evidence',
  measurementFieldsPresent: true,
  timingEligible: true,
  conclusionEligible: false,
  executionScope: 'local-only',
  startedAt,
  finishedAt: new Date().toISOString(),
  node: process.version,
  nodeBinary: process.execPath,
  runner,
  caseRunner,
  launcher,
  environment: {
    parentCiMarkers,
    childCiMarkersCleared: CI_MARKERS,
    parentRunLinkCheck: process.env.RUN_LINK_CHECK ?? null,
    parentPoolEnvironment: readPoolEnvironment(),
    runtimeProfile: normalizeRuntimeProfile(matrix.runtimeProfile),
    compilerEnvironment,
    harnessSourceManifest,
    correctnessGate: {
      path: gateAdmission.gatePath,
      sha256: gateAdmission.gateSha256,
      status: gateAdmission.gate.status,
      requiredArtifacts: gateAdmission.gate.requiredArtifacts,
      sourceMapCapability: gateAdmission.gate.sourceMapCapability,
    },
    perCasePoolEnvironment: true,
    childMaxBufferBytes: CHILD_MAX_BUFFER_BYTES,
    controllerProvenance: calibration?.controllerProvenance ?? null,
    externalMeasurement: {
      command: '/usr/bin/time',
      arguments: ['-l'],
      timedExecutable: process.execPath,
      allocationTimedScript: caseRunnerPath,
      quotaTimedScript: launcherPath,
      quotaControllerOutsideTimedProcess: true,
    },
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
  hostAdmissionAttempts,
  hostPolicyViolations: [],
  validationErrors: [],
  runs,
};
validatePolicyReport(report, manifest);
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) {
  await writeFile(outputPath, serialized);
  console.log(JSON.stringify({ outputPath, stage: matrix.policy.stage, runs: runs.length }));
} else {
  process.stdout.write(serialized);
}

function childOptions(definition, variant) {
  return {
    projectRoot: definition.projectRoot,
    rolldownPackageRoot: definition.rolldownPackageRoot,
    corpus: definition.corpus,
    buildProfile: definition.buildProfile,
    selectionScale: definition.selectionScale,
    selectionPrefixSha256: definition.selectionPrefixSha256,
    instrumentation: false,
    rustInstrumentation: false,
    measurementMode: 'measurement',
    variant,
    expectedPoolEnvironment: definition.poolEnvironment,
    runtimeProfile: matrix.runtimeProfile,
    evidenceKind: matrix.evidenceKind,
  };
}

function childEnvironment(definition, variant) {
  const environment = { ...process.env };
  for (const marker of CI_MARKERS) delete environment[marker];
  delete environment.RUN_LINK_CHECK;
  delete environment.ROLLDOWN_PARALLEL_PLUGIN_METRICS;
  delete environment.ROLLDOWN_PARALLEL_PLUGIN_WORKERS;
  delete environment.CPULIMIT_REPORT;
  applyPoolEnvironment(environment, definition.poolEnvironment);
  const worker = /^worker-(\d+)$/.exec(variant);
  if (worker) environment.ROLLDOWN_PARALLEL_PLUGIN_WORKERS = worker[1];
  return environment;
}

function runDirectChild(options, environment) {
  return spawnSync(
    '/usr/bin/time',
    ['-l', process.execPath, '--expose-gc', caseRunnerPath, JSON.stringify(options)],
    { encoding: 'utf8', env: environment, maxBuffer: CHILD_MAX_BUFFER_BYTES },
  );
}

async function runQuotaChild(definition, options, environment) {
  const timed = spawn(
    '/usr/bin/time',
    [
      '-l',
      process.execPath,
      '--expose-gc',
      launcherPath,
      caseRunnerPath,
      JSON.stringify(options),
    ],
    { detached: true, env: environment, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const timedCapture = captureProcess(timed, `${definition.name} timed Node`, () =>
    signalProcessGroup(timed, 'SIGKILL'),
  );
  let readyPid;
  let controller;
  let controllerCapture;
  try {
    readyPid = await withDeadline(
      waitForReadyPid(timedCapture),
      QUOTA_READY_TIMEOUT_MS,
      `${definition.name} Node ready marker`,
    );
    const stoppedState = readProcessState(readyPid);
    if (!stoppedState?.startsWith('T')) {
      throw new Error(`Quota Node ${readyPid} was not stopped before controller attachment: ${stoppedState}`);
    }
    const controllerEnvironment = { ...environment, CPULIMIT_REPORT: '1' };
    controller = spawn(
      matrix.policy.calibration.controllerProvenance.binary.path,
      ['--limit', String(definition.quotaPercent), '--pid', String(readyPid)],
      { detached: true, env: controllerEnvironment, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    controllerCapture = captureProcess(controller, `${definition.name} cpulimit`, () =>
      signalProcessGroup(controller, 'SIGKILL'),
    );
    await withDeadline(
      waitForTargetResume(readyPid, controllerCapture),
      QUOTA_ATTACH_TIMEOUT_MS,
      `${definition.name} cpulimit attachment`,
    );
    const [timedResult, controllerResult] = await withDeadline(
      Promise.all([timedCapture.completed, controllerCapture.completed]),
      QUOTA_RUN_TIMEOUT_MS,
      `${definition.name} quota-controlled Node completion`,
    );
    if (controllerResult.status !== 0) {
      throw new Error(`cpulimit exited ${controllerResult.status}: ${controllerResult.stderr}`);
    }
    const controllerRecord = parseController(controllerResult.stderr);
    if (controllerRecord.targetPid !== readyPid) {
      throw new Error(`cpulimit targeted ${controllerRecord.targetPid}, not Node ${readyPid}`);
    }
    return { ...timedResult, controller: controllerRecord };
  } finally {
    await cleanupQuotaProcesses({ timed, timedCapture, readyPid, controller, controllerCapture });
  }
}

function captureProcess(child, label, killOnOverflow = () => child.kill('SIGKILL')) {
  const capture = { stdout: '', stderr: '', error: undefined, status: undefined };
  let resolveCompleted;
  const completed = new Promise((resolve) => {
    resolveCompleted = resolve;
  });
  const append = (field, chunk) => {
    capture[field] += chunk.toString();
    if (Buffer.byteLength(capture.stdout) + Buffer.byteLength(capture.stderr) > CHILD_MAX_BUFFER_BYTES) {
      capture.error = Object.assign(new Error(`${label} exceeded the child capture limit`), {
        code: 'ENOBUFS',
      });
      killOnOverflow();
    }
  };
  child.stdout.on('data', (chunk) => append('stdout', chunk));
  child.stderr.on('data', (chunk) => append('stderr', chunk));
  child.once('error', (error) => {
    capture.error = error;
  });
  child.once('close', (status, signal) => {
    capture.status = status;
    capture.signal = signal;
    resolveCompleted(capture);
  });
  return { capture, completed };
}

async function waitForReadyPid(capture) {
  while (true) {
    const match = capture.capture.stderr.match(/^\[mdx-policy-node-ready\] (\d+)$/m);
    if (match) return Number(match[1]);
    if (capture.capture.error) throw capture.capture.error;
    if (capture.capture.status !== undefined) {
      throw new Error(`Timed Node exited before quota attachment: ${capture.capture.stderr}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function waitForTargetResume(pid, controllerCapture) {
  while (true) {
    if (controllerCapture.capture.error) throw controllerCapture.capture.error;
    if (controllerCapture.capture.status !== undefined) {
      throw new Error(
        `cpulimit exited before resuming Node ${pid}: ${controllerCapture.capture.stderr}`,
      );
    }
    const state = readProcessState(pid);
    if (state && !state.startsWith('T')) return;
    if (!state) throw new Error(`Quota Node ${pid} disappeared during controller attachment`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function readProcessState(pid) {
  const result = spawnSync('/bin/ps', ['-o', 'state=', '-p', String(pid)], { encoding: 'utf8' });
  if (result.status !== 0) return undefined;
  return result.stdout.trim();
}

function withDeadline(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs);
    timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function cleanupQuotaProcesses({ timed, timedCapture, readyPid, controller, controllerCapture }) {
  const timedRunning = timedCapture.capture.status === undefined;
  const controllerRunning = controllerCapture?.capture.status === undefined;
  if (!timedRunning && !controllerRunning) return;
  if (readyPid) signalPid(readyPid, 'SIGCONT');
  if (timedRunning) signalProcessGroup(timed, 'SIGCONT');
  if (controllerRunning) signalProcessGroup(controller, 'SIGTERM');
  if (timedRunning) signalProcessGroup(timed, 'SIGTERM');
  await waitForCaptures([timedCapture, controllerCapture], QUOTA_CLEANUP_GRACE_MS);
  if (controllerCapture?.capture.status === undefined) signalProcessGroup(controller, 'SIGKILL');
  if (timedCapture.capture.status === undefined) signalProcessGroup(timed, 'SIGKILL');
  await waitForCaptures([timedCapture, controllerCapture], QUOTA_CLEANUP_GRACE_MS);
}

async function waitForCaptures(captures, timeoutMs) {
  const pending = captures.filter(Boolean).filter(({ capture }) => capture.status === undefined);
  if (pending.length === 0) return;
  await Promise.race([
    Promise.all(pending.map(({ completed }) => completed)),
    new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      timer.unref();
    }),
  ]);
}

function signalPid(pid, signal) {
  try {
    process.kill(pid, signal);
  } catch {
    // The exact child already exited.
  }
}

function signalProcessGroup(child, signal) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // The exact spawned process group already exited.
  }
}

function parseController(stderr) {
  const records = [
    ...stderr.matchAll(/^\[cpulimit-report\] (\{.*\})$/gm),
  ].map((match) => JSON.parse(match[1]));
  if (records.length !== 1) throw new Error(`Expected one cpulimit report, got ${records.length}`);
  return records[0];
}

function parseChildJson(stdout) {
  const lines = stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  const candidates = lines.filter((line) => line.startsWith('{') && line.endsWith('}'));
  if (candidates.length !== 1) throw new Error(`Expected one child JSON object, got ${candidates.length}`);
  return JSON.parse(candidates[0]);
}

function assertCaseParity(name, runs) {
  for (const field of [
    'transformedEntryCount',
    'selection',
    'outputChunks',
    'normalizedOutputBytes',
    'normalizedOutputHash',
    'outputNormalization',
  ]) {
    if (new Set(runs.map((run) => JSON.stringify(run[field]))).size !== 1) {
      throw new Error(`${name} differs for ${field}`);
    }
  }
}

function assertOutputOracle(run, oracle, label) {
  for (const field of ['outputChunks', 'normalizedOutputBytes', 'normalizedOutputHash']) {
    if (run?.[field] !== oracle?.[field]) throw new Error(`${label} differs from oracle for ${field}`);
  }
  if (JSON.stringify(run?.outputNormalization) !== JSON.stringify(oracle?.outputNormalization)) {
    throw new Error(`${label} differs from oracle for outputNormalization`);
  }
}

function parseDarwinTime(stderr) {
  const records = [...stderr.matchAll(/^\s*(\d+(?:\.\d+)?) real\s+(\d+(?:\.\d+)?) user\s+(\d+(?:\.\d+)?) sys\s*$/gm)];
  if (records.length !== 1) {
    throw new Error(`Expected one Darwin /usr/bin/time timing line, got ${records.length}`);
  }
  const [match, realToken, userToken, systemToken] = records[0];
  const decimalPlaces = realToken.includes('.') ? realToken.length - realToken.indexOf('.') - 1 : 0;
  return {
    schema: 1,
    source: '/usr/bin/time -l',
    timedProcess: 'node',
    raw: match.trim().replace(/\s+/g, ' '),
    realToken,
    decimalPlaces,
    resolutionMs: 10 ** (3 - decimalPlaces),
    realMs: Number(realToken) * 1_000,
    userMs: Number(userToken) * 1_000,
    systemMs: Number(systemToken) * 1_000,
  };
}

async function readFullOracle(admission) {
  const descriptor = admission.gate.requiredArtifacts.fullCorpus;
  const path = nodePath.resolve(nodePath.dirname(admission.gatePath), descriptor.path);
  const source = await readFile(path);
  if (createHash('sha256').update(source).digest('hex') !== descriptor.sha256) {
    throw new Error('Full correctness oracle hash changed');
  }
  const report = JSON.parse(source);
  const run = report.runs?.[0];
  return Object.fromEntries(
    ['outputChunks', 'normalizedOutputBytes', 'normalizedOutputHash', 'outputNormalization'].map(
      (field) => [field, run?.[field]],
    ),
  );
}

async function sourceRecord(path) {
  return { path, sha256: createHash('sha256').update(await readFile(path)).digest('hex') };
}

function isActiveCiValue(value) {
  return value !== undefined && !['', '0', 'false'].includes(String(value).toLowerCase());
}

async function verifyProcessControl() {
  const smokePath = nodePath.join(import.meta.dirname, 'policy-launcher-smoke-case.mjs');
  const timed = spawn(
    '/usr/bin/time',
    ['-l', process.execPath, launcherPathForSelfTest(), smokePath, '{}'],
    { detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const timedCapture = captureProcess(timed, 'launcher smoke', () =>
    signalProcessGroup(timed, 'SIGKILL'),
  );
  let smokePid;
  try {
    smokePid = await withDeadline(waitForReadyPid(timedCapture), 5_000, 'launcher smoke ready');
    if (!readProcessState(smokePid)?.startsWith('T')) {
      throw new Error('Launcher smoke Node did not stop before import');
    }
    signalPid(smokePid, 'SIGCONT');
    const result = await withDeadline(timedCapture.completed, 5_000, 'launcher smoke completion');
    if (result.status !== 0) throw new Error(`Launcher smoke failed: ${result.stderr}`);
    const child = parseChildJson(result.stdout);
    const timing = parseDarwinTime(result.stderr);
    if (child.processId !== smokePid || timing.timedProcess !== 'node') {
      throw new Error('Launcher smoke did not time and resume the exact Node PID');
    }
  } finally {
    await cleanupQuotaProcesses({ timed, timedCapture, readyPid: smokePid });
  }

  const noReady = spawn(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1000)'],
    { detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const noReadyCapture = captureProcess(noReady, 'missing-ready smoke', () =>
    signalProcessGroup(noReady, 'SIGKILL'),
  );
  let readyTimedOut = false;
  try {
    await withDeadline(waitForReadyPid(noReadyCapture), 200, 'synthetic missing ready');
  } catch (error) {
    readyTimedOut = /timed out/.test(error.message);
  } finally {
    await cleanupQuotaProcesses({ timed: noReady, timedCapture: noReadyCapture });
  }
  if (!readyTimedOut || noReadyCapture.capture.status === undefined) {
    throw new Error('Ready-timeout cleanup did not reap its exact process group');
  }

  const stopped = spawn(
    process.execPath,
    [
      '-e',
      "process.stderr.write('[mdx-policy-node-ready] ' + process.pid + '\\n'); process.kill(process.pid, 'SIGSTOP')",
    ],
    { detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const stoppedCapture = captureProcess(stopped, 'attach-timeout Node', () =>
    signalProcessGroup(stopped, 'SIGKILL'),
  );
  const stoppedPid = await withDeadline(waitForReadyPid(stoppedCapture), 5_000, 'attach smoke ready');
  const inertController = spawn(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1000)'],
    { detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const inertCapture = captureProcess(inertController, 'inert controller', () =>
    signalProcessGroup(inertController, 'SIGKILL'),
  );
  let attachTimedOut = false;
  try {
    await withDeadline(
      waitForTargetResume(stoppedPid, inertCapture),
      200,
      'synthetic attach',
    );
  } catch (error) {
    attachTimedOut = /timed out/.test(error.message);
  } finally {
    await cleanupQuotaProcesses({
      timed: stopped,
      timedCapture: stoppedCapture,
      readyPid: stoppedPid,
      controller: inertController,
      controllerCapture: inertCapture,
    });
  }
  if (
    !attachTimedOut ||
    stoppedCapture.capture.status === undefined ||
    inertCapture.capture.status === undefined
  ) {
    throw new Error('Attach-timeout cleanup did not resume, terminate, and reap both groups');
  }

  const hungTimed = spawn(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1000)'],
    { detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const hungTimedCapture = captureProcess(hungTimed, 'overall-timeout Node', () =>
    signalProcessGroup(hungTimed, 'SIGKILL'),
  );
  const hungController = spawn(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1000)'],
    { detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const hungControllerCapture = captureProcess(hungController, 'overall-timeout controller', () =>
    signalProcessGroup(hungController, 'SIGKILL'),
  );
  let overallTimedOut = false;
  try {
    await withDeadline(
      Promise.all([hungTimedCapture.completed, hungControllerCapture.completed]),
      200,
      'synthetic overall run',
    );
  } catch (error) {
    overallTimedOut = /timed out/.test(error.message);
  } finally {
    await cleanupQuotaProcesses({
      timed: hungTimed,
      timedCapture: hungTimedCapture,
      readyPid: hungTimed.pid,
      controller: hungController,
      controllerCapture: hungControllerCapture,
    });
  }
  if (
    !overallTimedOut ||
    hungTimedCapture.capture.status === undefined ||
    hungControllerCapture.capture.status === undefined
  ) {
    throw new Error('Overall-timeout cleanup did not terminate and reap both groups');
  }
  console.log(
    JSON.stringify({
      valid: true,
      directTimeWrapsStoppedNode: true,
      readyTimeoutReaped: true,
      attachTimeoutReaped: true,
      overallTimeoutReaped: true,
    }),
  );
}

function launcherPathForSelfTest() {
  return nodePath.join(import.meta.dirname, 'policy-node-launcher.mjs');
}
