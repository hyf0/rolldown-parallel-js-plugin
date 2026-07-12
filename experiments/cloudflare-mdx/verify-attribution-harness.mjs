import { readFile } from 'node:fs/promises';
import nodePath from 'node:path';
import {
  ATTRIBUTION_PREFIX_SHA256,
  ATTRIBUTION_SCALE,
  deriveAttributionSummary,
  validateAttributionReport,
} from './attribution-admission.mjs';
import { BASELINE_POOL_ENVIRONMENT } from './pool-environment.mjs';
import { ATTRIBUTION_RUNTIME_PROFILE } from './runtime-profile.mjs';
import { startAttributionResourceCapture } from './attribution-resources.mjs';

const liveCapture = startAttributionResourceCapture({ sampleIntervalMs: 10 });
await new Promise((resolve) => setImmediate(resolve));
const liveResources = liveCapture.finish();
if (
  liveResources.schema !== 1 ||
  liveResources.rss.samples.length < 2 ||
  !liveResources.startedAt.mainIsolateHeapStatistics ||
  !liveResources.finishedAt.mainIsolateHeapStatistics ||
  !liveResources.deltas.mainEventLoopUtilization ||
  !liveResources.gc
) {
  throw new Error('Live main-thread resource capture smoke is incomplete');
}

const matrix = JSON.parse(
  await readFile(nodePath.join(import.meta.dirname, 'scale-attribution-matrix.json'), 'utf8'),
);
const correctnessOracle = {
  artifactPath: '/synthetic/correctness.raw.json',
  artifactSha256: 'a'.repeat(64),
  outputChunks: ATTRIBUTION_SCALE,
  normalizedOutputBytes: 123_456_789,
  normalizedOutputHash: 'b'.repeat(64),
  outputNormalization: { kind: 'undici-formdata-boundary', playgroundUrls: 0, files: [] },
};
const runs = [makeRun('ordinary', 0), makeRun('worker-4', 4), makeRun('worker-8', 8)];
const valid = {
  schema: 1,
  evidenceKind: 'attribution',
  measurementFieldsPresent: true,
  timingEligible: false,
  conclusionEligible: false,
  executionScope: 'local-only',
  environment: {
    parentCiMarkers: { CI: null },
    correctnessGate: { status: 'passed', sha256: 'c'.repeat(64) },
    runtimeProfile: ATTRIBUTION_RUNTIME_PROFILE,
    childPoolEnvironment: BASELINE_POOL_ENVIRONMENT,
  },
  matrix,
  hostAdmissionAttempts: [{}, {}, {}],
  hostPolicyViolations: [],
  validationErrors: [],
  runs,
};
validateAttributionReport(valid, { correctnessOracle });

const rejected = [];
expectRejected('missing-rust-events', (report) => {
  report.runs[1].rustMetrics[0].timeline.events = [];
});
expectRejected('duplicate-module-initialization', (report) => {
  report.runs[0].moduleInitMetrics.push(structuredClone(report.runs[0].moduleInitMetrics[0]));
});
expectRejected('permit-thread-mismatch', (report) => {
  report.runs[1].rustMetrics[0].timeline.events.find(({ phase }) => phase === 'acquire').workerIndex = 3;
});
expectRejected('missing-worker-gc', (report) => {
  delete report.runs[1].lifecycleMetrics[1].workers[0].workerLocalBeforeTermination.gc;
});
expectRejected('missing-main-elu', (report) => {
  delete report.runs[0].attributionResources.deltas.mainEventLoopUtilization;
});
expectRejected('missing-main-cpu', (report) => {
  delete report.runs[0].attributionResources.deltas.mainThreadCpuDeltaMicros;
});
expectRejected('empty-rss-samples', (report) => {
  report.runs[0].attributionResources.rss.samples = [];
});
expectRejected('correctness-output-drift', (report) => {
  report.runs[2].normalizedOutputHash = 'd'.repeat(64);
});
expectRejected('post-child-host-failure', (report) => {
  report.runs[0].hostPolicyViolations = ['synthetic pageout'];
});
expectRejected('stale-derived-summary', (report) => {
  report.runs[1].attributionSummary.workerCount = 7;
});
expectRejected('missing-cold-service-checkpoint', (report) => {
  report.runs[1].attributionSummary.serviceProfile.perWorker[0].coldCheckpoints.pop();
});
expectRejected('changed-steady-service-window', (report) => {
  report.runs[2].attributionSummary.serviceProfile.perWorker[0].steadyWindow.calls = 255;
});

console.log(
  JSON.stringify({
    valid: 'synthetic-ordinary-worker4-worker8-attribution',
    liveResourceCapture: 'process/main CPU, RSS, heap, ELU, and GC shape',
    rejected,
  }),
);

function expectRejected(name, mutate) {
  const report = structuredClone(valid);
  mutate(report);
  try {
    validateAttributionReport(report, { correctnessOracle });
  } catch {
    rejected.push(name);
    return;
  }
  throw new Error(`Invalid attribution artifact was accepted: ${name}`);
}

function makeRun(variant, workerCount) {
  const effectiveWorkers = workerCount || 1;
  const ids = Array.from({ length: ATTRIBUTION_SCALE }, (_, index) => `/synthetic/${index}.mdx`);
  const perWorkerCalls = range(effectiveWorkers).map(
    (worker) => ids.filter((_id, index) => index % effectiveWorkers === worker).length,
  );
  const timelineEntries = ids.map((id, index) => ({
    id,
    hits: 1,
    serviceMs: 0.01,
    worker: index % effectiveWorkers,
    kernelStartNs: String(index * 30 + 3),
    kernelEndNs: String(index * 30 + 20),
  }));
  const metrics = {
    schema: 2,
    factoryCalls: effectiveWorkers,
    handlerCalls: ATTRIBUTION_SCALE,
    distinctHandlerIds: ATTRIBUTION_SCALE,
    active: 0,
    unknownIdCalls: 0,
    missingHandlerIds: [],
    duplicateHandlerIds: [],
    clockAnchors: range(effectiveWorkers).map((worker) => ({ worker })),
    kernelTimeline: {
      completedEntries: ATTRIBUTION_SCALE,
      spanMs: 275,
      perWorker: range(effectiveWorkers).map((worker) => ({
        worker,
        calls: perWorkerCalls[worker],
        busyMs: 20,
        serviceElapsedMsTotal: 25,
      })),
    },
    timelineEntries,
  };
  const attributionResources = mainResources();
  const run = {
    name: 'cloudflare-mdx-scale-v1-9157-attribution',
    index: 0,
    sequence: workerCount === 0 ? 0 : workerCount === 4 ? 1 : 2,
    variant,
    evidenceKind: 'attribution',
    measurementMode: 'measurement',
    instrumentation: true,
    rustInstrumentation: true,
    lifecycleClaim: true,
    corpus: 'cloudflare-mdx-scale-v1',
    transformedEntryCount: ATTRIBUTION_SCALE,
    selection: { scale: ATTRIBUTION_SCALE, prefixSha256: ATTRIBUTION_PREFIX_SHA256 },
    runtimeProfile: ATTRIBUTION_RUNTIME_PROFILE,
    poolEnvironment: BASELINE_POOL_ENVIRONMENT,
    hostPolicy: matrix.hostPolicy,
    hostBefore: hostSnapshot(0),
    hostAfter: hostSnapshot(0),
    hostPolicyViolations: [],
    peakRssBytes: 2_000_000_000,
    outputChunks: correctnessOracle.outputChunks,
    normalizedOutputBytes: correctnessOracle.normalizedOutputBytes,
    normalizedOutputHash: correctnessOracle.normalizedOutputHash,
    outputNormalization: correctnessOracle.outputNormalization,
    metrics,
    attributionResources,
    moduleInitMetrics: [moduleInit()],
    rustMetrics: workerCount ? [rustMetrics(ids, workerCount)] : [],
    lifecycleMetrics: workerCount ? lifecycleMetrics(workerCount) : [],
  };
  run.attributionSummary = deriveAttributionSummary(run);
  return run;
}

function rustMetrics(ids, workerCount) {
  const calls = ids.map((moduleId, index) => ({ ordinal: index + 1, moduleId }));
  const events = calls.flatMap((call, index) => {
    const workerIndex = index % workerCount;
    const at = index * 30 + 1;
    return [
      { sequence: index * 3, callOrdinal: call.ordinal, phase: 'arrival', atNs: at, workerIndex: null },
      { sequence: index * 3 + 1, callOrdinal: call.ordinal, phase: 'acquire', atNs: at + 1, workerIndex },
      { sequence: index * 3 + 2, callOrdinal: call.ordinal, phase: 'complete', atNs: at + 18, workerIndex },
    ];
  });
  return {
    kind: 'rolldown_parallel_plugin_transform_metrics',
    version: 1,
    workerCount,
    wrapperCalls: ATTRIBUTION_SCALE,
    permitAcquiredCalls: ATTRIBUTION_SCALE,
    completedWrapperCalls: ATTRIBUTION_SCALE,
    valueResults: ATTRIBUTION_SCALE,
    nullResults: 0,
    errorResults: 0,
    cancelledBeforeAcquire: 0,
    cancelledDuringService: 0,
    permitQueuePending: { current: 0 },
    wrapperOutstanding: { current: 0 },
    permitInFlight: { current: 0 },
    timeline: {
      calls,
      events,
      timeWeightedWidths: {
        observationNs: 300_000,
        pendingWidthNs: 600_000,
        outstandingWidthNs: 900_000,
        inFlightWidthNs: 450_000,
      },
      completionRateInputs: {
        completedCalls: ATTRIBUTION_SCALE,
        activitySpanNs: 300_000,
        completionSpanNs: 299_000,
      },
      workerServiceNs: range(workerCount).map((workerIndex) => {
        const completedCalls = ids.filter((_id, index) => index % workerCount === workerIndex).length;
        return {
          workerIndex,
          completedCalls,
          total: completedCalls * 17,
          min: 17,
          p50: 17,
          p95: 17,
          max: 17,
        };
      }),
    },
  };
}

function lifecycleMetrics(workerCount) {
  const workersAtReady = range(workerCount).map((threadNumber) => ({
    threadNumber,
    mainReadyMs: 100 + threadNumber,
    mainTimeline: {},
    workerBootstrap: {
      timeline: {},
      plugins: [{}],
      workerLocalAtReady: { heapStatistics: {}, eventLoopUtilization: {}, gc: { count: 0 } },
    },
    resourcesAtPoolReady: workerResource(100 + threadNumber),
  }));
  const workersBeforeTermination = workersAtReady.map(({ threadNumber, resourcesAtPoolReady }) => ({
    threadNumber,
    resourcesAtPoolReady,
    resourcesBeforeTermination: workerResource(1_000 + threadNumber),
    workerLocalBeforeTermination: {
      heapStatistics: {},
      eventLoopUtilization: {},
      gc: { count: 1, durationMs: 1, byKind: { 1: { kind: 1, count: 1 } } },
    },
  }));
  return [
    {
      kind: 'rolldown_parallel_plugin_init_metrics',
      version: 1,
      workerCount,
      pluginCount: 1,
      poolInitializationMs: 200,
      rssBeforeBytes: 100,
      rssAfterBytes: 200,
      processSnapshots: {},
      cpuAttribution: lifecycleCpu(),
      workers: workersAtReady,
    },
    {
      kind: 'rolldown_parallel_plugin_termination_metrics',
      version: 1,
      workerCount,
      poolTerminationMs: 20,
      rssBeforeBytes: 200,
      rssAfterBytes: 100,
      processSnapshots: {},
      cpuAttribution: lifecycleCpu(),
      workers: workersBeforeTermination,
    },
  ];
}

function lifecycleCpu() {
  return {
    completeWorkerCoverage: true,
    processCpuDeltaMicros: { user: 10_000, system: 1_000 },
    mainThreadCpuDeltaMicros: { user: 1_000, system: 100 },
    measuredWorkerThreadCpuDeltaMicros: { user: 5_000, system: 500 },
    residualProcessCpuDeltaMicros: { user: 4_000, system: 400 },
  };
}

function workerResource(cpu) {
  return {
    ok: true,
    snapshot: {
      cpuUsageMicros: { user: cpu, system: 10 },
      heapStatistics: {},
      eventLoopUtilization: {},
    },
  };
}

function mainResources() {
  const heap = { total_heap_size: 1_000, used_heap_size: 500 };
  return {
    schema: 1,
    startedAt: { mainIsolateHeapStatistics: heap },
    finishedAt: { mainIsolateHeapStatistics: { total_heap_size: 2_000, used_heap_size: 1_000 } },
    deltas: {
      processCpuDeltaMicros: { user: 100_000, system: 10_000 },
      mainThreadCpuDeltaMicros: { user: 10_000, system: 1_000 },
      residualProcessCpuDeltaMicros: { user: 90_000, system: 9_000 },
      mainEventLoopUtilization: { idle: 1, active: 2, utilization: 2 / 3 },
    },
    rss: {
      samples: [
        { monotonicMs: 0, rssBytes: 100, heapUsedBytes: 50 },
        { monotonicMs: 1, rssBytes: 200, heapUsedBytes: 100 },
      ],
      maximumBytes: 200,
      retainedBytes: 150,
    },
    gc: { count: 1, durationMs: 1, maxDurationMs: 1, byKind: { 1: { kind: 1, count: 1 } } },
  };
}

function moduleInit() {
  return {
    kind: 'rolldown_binding_module_init_metrics',
    version: 1,
    invocationOrdinal: 1,
    configuredTokioWorkerThreads: 18,
    configuredTokioMaxBlockingThreads: 4,
    runtimeBuildMs: 1,
    customRuntimeRegistrationMs: 1,
    totalMs: 2,
    threadsStartedAfterBuild: 0,
    threadsStoppedAfterBuild: 0,
    threadsStartedAfterRegistration: 18,
    threadsStoppedAfterRegistration: 0,
  };
}

function hostSnapshot(counter) {
  return {
    loadAverage: [1, 1, 1],
    uptimeSeconds: 60,
    totalProcessCpuPercent: 100,
    competingStudyProcesses: [],
    power: { available: true, source: 'AC Power', raw: '' },
    lowPowerMode: { available: true, enabled: false, raw: '' },
    thermal: {
      available: true,
      noThermalWarning: true,
      noPerformanceWarning: true,
      raw: '',
    },
    memoryPressure: { available: true, freePercentage: 75, raw: '' },
    virtualMemoryCounters: { pageouts: counter, swapouts: counter },
    swapUsage: { available: true, usedBytes: 0, raw: '' },
  };
}

function range(length) {
  return Array.from({ length }, (_, index) => index);
}
