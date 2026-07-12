import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { cpus, freemem, loadavg, platform, release, totalmem, uptime } from 'node:os';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';

const CI_MARKERS = [
  'CI',
  'GITHUB_ACTIONS',
  'BUILDKITE',
  'CIRCLECI',
  'TF_BUILD',
  'JENKINS_URL',
];
const activeCiMarkers = CI_MARKERS.filter((name) =>
  isActiveCiValue(process.env[name]),
);
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

const matrixPath = nodePath.resolve(process.argv[2] ?? '');
const outputPath = process.argv[3] ? nodePath.resolve(process.argv[3]) : undefined;
const matrix = JSON.parse(await readFile(matrixPath, 'utf8'));
if (!Array.isArray(matrix.cases)) throw new Error('matrix.cases must be an array');

const runs = [];
const validationErrors = [];
const rawOutputDifferences = [];
let sequence = 0;
let executions = 0;
const startedAt = new Date().toISOString();
const hostAtStart = hostSnapshot();
const powerAtStart = powerStatus();
for (const definition of matrix.cases) {
  const {
    name,
    variants,
    warmups = 0,
    repeats = 1,
    startIndex = 0,
    ...caseOptions
  } = definition;
  if (!Array.isArray(variants) || variants.length === 0) throw new Error(`${name} has no variants`);
  const caseStart = runs.length;
  for (let index = 0; index < warmups; index++) {
    for (const variant of variants) execute(name, caseOptions, variant, index, true);
  }
  for (let index = 0; index < repeats; index++) {
    const blockIndex = startIndex + index;
    const offset = blockIndex % variants.length;
    const order = [...variants.slice(offset), ...variants.slice(0, offset)];
    for (const variant of order)
      execute(name, caseOptions, variant, blockIndex, false);
  }
  for (const field of [
    'transformedEntryCount',
    'outputChunks',
    'normalizedOutputBytes',
    'normalizedOutputHash',
  ]) {
    const values = new Set(runs.slice(caseStart).map((run) => run[field]));
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
    childCiMarkersCleared: CI_MARKERS,
    parentRunLinkCheck: process.env.RUN_LINK_CHECK ?? null,
    childInputRunLinkCheck: null,
    runCaseProfilePolicy: {
      default: false,
      'ci-link-check': true,
    },
  },
  host: {
    platform: platform(),
    release: release(),
    architecture: process.arch,
    cpuModel: cpus()[0]?.model,
    logicalCpuCount: cpus().length,
    totalMemoryBytes: totalmem(),
    power: powerAtStart,
    atStart: hostAtStart,
    atFinish: hostSnapshot(),
  },
  matrix,
  hostPolicyViolations:
    matrix.hostPolicy?.power && !powerAtStart?.includes(matrix.hostPolicy.power)
      ? [`power status did not contain ${matrix.hostPolicy.power}: ${powerAtStart}`]
      : [],
  validationErrors,
  rawOutputDifferences,
  runs,
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) {
  await writeFile(outputPath, serialized);
  console.log(JSON.stringify({ outputPath, runs: runs.length, startedAt, finishedAt: report.finishedAt }));
} else {
  process.stdout.write(serialized);
}

function execute(name, caseOptions, variant, index, warmup) {
  const workerMatch = /^worker-(\d+)$/.exec(variant);
  const managedMatch = /^managed-(\d+)$/.exec(variant);
  const environment = { ...process.env };
  for (const marker of CI_MARKERS) delete environment[marker];
  delete environment.RUN_LINK_CHECK;
  delete environment.ROLLDOWN_PARALLEL_PLUGIN_METRICS;
  delete environment.ROLLDOWN_PARALLEL_PLUGIN_WORKERS;
  if (workerMatch) environment.ROLLDOWN_PARALLEL_PLUGIN_WORKERS = workerMatch[1];
  if (caseOptions.instrumentation && workerMatch) {
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
  const options = { ...caseOptions, variant };
  const hostBefore = hostSnapshot();
  const result = spawnSync(
    '/usr/bin/time',
    [
      '-l',
      process.execPath,
      '--expose-gc',
      caseRunnerPath,
      JSON.stringify(options),
    ],
    { encoding: 'utf8', env: environment, maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(`${name}/${variant} exited ${result.status}:\n${result.stdout}\n${result.stderr}`);
  }
  if (warmup) return;
  const peakRssMatch = result.stderr.match(/(\d+)\s+maximum resident set size/);
  if (!peakRssMatch) throw new Error(`Could not parse peak RSS for ${name}/${variant}`);
  const child = JSON.parse(result.stdout.trim());
  const hostAfter = hostSnapshot();
  const hostPolicyViolations = evaluateHostPolicy(
    matrix.hostPolicy,
    hostBefore,
    hostAfter,
  );
  const rustMetrics = [
    ...result.stderr.matchAll(/^\[rolldown-parallel-plugin-metrics\] (\{.*\})$/gm),
  ].map((match) => JSON.parse(match[1]));
  const lifecycleMetrics = [
    ...result.stderr.matchAll(/^\[rolldown-parallel-plugin-init-metrics\] (\{.*\})$/gm),
  ].map((match) => JSON.parse(match[1]));
  if (caseOptions.instrumentation) {
    const expectedWorkerCount = workerMatch ? Number(workerMatch[1]) : 0;
    if (workerMatch) {
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
        child.metrics?.factoryCalls !== expectedWorkerCount ||
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
    } else if (child.metrics?.factoryCalls !== 1) {
      throw new Error(`${name}/${variant} did not initialize one ordinary plugin`);
    }
  }
  runs.push({
    name,
    index,
    sequence: sequence++,
    peakRssBytes: Number(peakRssMatch[1]),
    hostBefore,
    hostAfter,
    hostPolicyViolations,
    ...child,
    rustMetrics,
    lifecycleMetrics,
  });
}

function hostSnapshot() {
  return {
    at: new Date().toISOString(),
    loadAverage: loadavg(),
    freeMemoryBytes: freemem(),
    uptimeSeconds: uptime(),
    swapUsage: swapUsage(),
    virtualMemoryCounters: virtualMemoryCounters(),
    totalProcessCpuPercent: totalProcessCpuPercent(),
  };
}

function powerStatus() {
  if (platform() !== 'darwin') return undefined;
  const result = spawnSync('pmset', ['-g', 'batt'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

function swapUsage() {
  if (platform() !== 'darwin') return undefined;
  const result = spawnSync('sysctl', ['-n', 'vm.swapusage'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

function virtualMemoryCounters() {
  if (platform() !== 'darwin') return undefined;
  const result = spawnSync('vm_stat', [], { encoding: 'utf8' });
  if (result.status !== 0) return undefined;
  const counters = {};
  for (const line of result.stdout.split('\n')) {
    const match = line.match(/^\"?([^\":]+)\"?:\s+(\d+)\.$/);
    if (match) counters[match[1]] = Number(match[2]);
  }
  return {
    pageins: counters.Pageins,
    pageouts: counters.Pageouts,
    swapins: counters.Swapins,
    swapouts: counters.Swapouts,
    compressions: counters.Compressions,
    decompressions: counters.Decompressions,
  };
}

function evaluateHostPolicy(policy, before, after) {
  if (!policy) return [];
  const violations = [];
  if (
    Number.isFinite(policy.maxStartOneMinuteLoad) &&
    before.loadAverage[0] > policy.maxStartOneMinuteLoad
  ) {
    violations.push(
      `start one-minute load ${before.loadAverage[0]} exceeded ${policy.maxStartOneMinuteLoad}`,
    );
  }
  if (
    Number.isFinite(policy.maxStartExternalCpuPercent) &&
    before.totalProcessCpuPercent > policy.maxStartExternalCpuPercent
  ) {
    violations.push(
      `start process CPU ${before.totalProcessCpuPercent}% exceeded ${policy.maxStartExternalCpuPercent}%`,
    );
  }
  for (const [field, maximum] of [
    ['swapouts', policy.maxSwapoutDeltaPages],
    ['pageouts', policy.maxPageoutDeltaPages],
  ]) {
    const start = before.virtualMemoryCounters?.[field];
    const finish = after.virtualMemoryCounters?.[field];
    if (Number.isFinite(maximum) && Number.isFinite(start) && Number.isFinite(finish)) {
      const delta = finish - start;
      if (delta > maximum) violations.push(`${field} increased by ${delta} pages`);
    }
  }
  return violations;
}

function totalProcessCpuPercent() {
  const result = spawnSync('/bin/ps', ['-A', '-o', '%cpu='], { encoding: 'utf8' });
  if (result.status !== 0) return undefined;
  return result.stdout
    .trim()
    .split(/\s+/)
    .reduce((sum, value) => sum + Number(value), 0);
}

function isActiveCiValue(value) {
  return value !== undefined && !['', '0', 'false'].includes(value.toLowerCase());
}
