import { readFile } from 'node:fs/promises';
import nodePath from 'node:path';
import {
  ATTRIBUTION_PREFIX_SHA256,
  ATTRIBUTION_SCALE,
  deriveAttributionComparison,
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
valid.initializationComparison = deriveAttributionComparison(runs);
validateAttributionReport(valid, { correctnessOracle });

const rejected = [];
expectRejected('disabled-attribution-matrix', (report) => {
  report.matrix.executionEnabled = false;
});
expectRejected('missing-main-plugin-construction', (report) => {
  delete report.runs[0].mainPluginConstructionElapsedMs;
});
expectRejected('missing-factory-initialization-total', (report) => {
  delete report.runs[1].metrics.initializationMsTotal;
});
expectRejected('factory-initialization-max-exceeds-total', (report) => {
  report.runs[2].metrics.initializationMsMax =
    report.runs[2].metrics.initializationMsTotal + 1;
});
expectRejected('stale-initialization-comparison', (report) => {
  report.initializationComparison.workerPools[0].readySkewMs += 1;
});
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
expectRejected('create-native-metrics-id-mismatch', (report) => {
  report.runs[1].nativePluginRegistrationMetrics[0].metricsId = 2;
});
expectRejected('plugin-index-mismatch', (report) => {
  report.runs[1].nativePluginRegistrationMetrics[0].plugins[0].index = 1;
});
expectRejected('bootstrap-launcher-metrics-id-mismatch', (report) => {
  report.runs[1].lifecycleMetrics[0].workers[0].workerBootstrap.launcher.metricsId = 2;
});
expectRejected('missing-cpu-endpoint-bounds', (report) => {
  delete report.runs[1].lifecycleMetrics[1].cpuWindows.workerSamples[0].endBounds;
});
expectRejected('create-resource-scope-drift', (report) => {
  report.runs[0].createBundlerOptionsMetrics[0].resources.scope = 'main isolate';
});
expectRejected('create-snapshot-rss-scope-drift', (report) => {
  report.runs[0].createBundlerOptionsMetrics[0].resources.afterPluginNormalization.scope.memoryUsage =
    'this isolate';
});
expectRejected('plugin-binding-outside-input-binding', (report) => {
  report.runs[0].createBundlerOptionsMetrics[0].pluginBinding[0].stage = stage(7, 8);
});
expectRejected('native-boundary-drift', (report) => {
  report.runs[0].nativePluginRegistrationMetrics[0].boundary = 'after scan';
});
expectRejected('native-scope-drift', (report) => {
  report.runs[0].nativePluginRegistrationMetrics[0].scope = 'includes build';
});
expectRejected('native-stage-relationship-drift', (report) => {
  report.runs[0].nativePluginRegistrationMetrics[0].stageRelationships.pluginMaterialization =
    'sibling';
});
expectRejected('native-stage-sum-outside-total', (report) => {
  report.runs[0].nativePluginRegistrationMetrics[0].nativeNormalizationTotalMs = 0.1;
});
expectRejected('native-materialization-outside-normalization', (report) => {
  report.runs[0].nativePluginRegistrationMetrics[0].stages.bindingOptionNormalizationMs = 0.4;
});
expectRejected('bootstrap-clock-origin-drift', (report) => {
  report.runs[1].lifecycleMetrics[0].workers[0].workerBootstrap.clockAlignment.workerMinusMainTimeOriginMs =
    1;
});
expectRejected('bootstrap-timeline-regression', (report) => {
  report.runs[1].lifecycleMetrics[0].workers[0].workerBootstrap.timeline.runtimeEntryAt =
    timestamp(29);
});
expectRejected('bootstrap-ready-before-registration', (report) => {
  report.runs[1].lifecycleMetrics[0].workers[0].workerBootstrap.timeline.readyAt =
    timestamp(47.5);
});
expectRejected('bootstrap-plugin-outside-registration', (report) => {
  const plugin = report.runs[1].lifecycleMetrics[0].workers[0].workerBootstrap.plugins[0];
  plugin.timeline.bindingFinishedAt = timestamp(48);
  plugin.stages.bindingifyPlugin = stage(45.1, 48);
  plugin.bindingifyMs = 2.9;
});
expectRejected('empty-lifecycle-process-snapshots', (report) => {
  report.runs[1].lifecycleMetrics[0].processSnapshots = {};
});
expectRejected('lifecycle-process-snapshot-rss-scope-drift', (report) => {
  report.runs[1].lifecycleMetrics[0].processSnapshots.beforeWorkerPool.scope.memoryUsage =
    'this worker';
});
expectRejected('lifecycle-process-snapshot-order-regression', (report) => {
  report.runs[1].lifecycleMetrics[0].processSnapshots.allWorkersReady.capturedAt = timestamp(-1);
});
expectRejected('worker-cpu-bound-outside-process-window', (report) => {
  report.runs[1].lifecycleMetrics[0].cpuWindows.workerSamples[0].endBounds.latestAt =
    timestamp(80);
});
expectRejected('worker-cpu-bound-does-not-contain-inner-window', (report) => {
  report.runs[1].lifecycleMetrics[1].cpuWindows.workerSamples[0].startBounds.latestAt =
    timestamp(71);
});
expectRejected('main-ready-duration-mismatch', (report) => {
  report.runs[1].lifecycleMetrics[0].workers[0].mainReadyMs += 1;
});
expectRejected('worker-resource-capture-regression', (report) => {
  report.runs[1].lifecycleMetrics[0].workers[0].resourcesAtPoolReady.snapshot.captureFinishedAt =
    timestamp(60);
});
expectRejected('worker-resource-capture-outside-lifecycle', (report) => {
  report.runs[1].lifecycleMetrics[1].workers[0].resourcesBeforeTermination.snapshot.captureFinishedAt =
    timestamp(111);
});
expectRejected('lifecycle-rss-ownership-drift', (report) => {
  report.runs[1].lifecycleMetrics[0].rssScope = 'one worker';
});
expectRejected('worker-local-rss-ownership-drift', (report) => {
  report.runs[1].lifecycleMetrics[1].workers[0].workerLocalBeforeTermination.scope.memoryUsage =
    'this worker';
});
expectRejected('launcher-rss-ownership-drift', (report) => {
  report.runs[1].lifecycleMetrics[0].workers[0].workerBootstrap.launcher.resources.afterRuntimeAndBindingImport.scope.memoryUsage =
    'this worker';
});
expectRejected('launcher-resource-outside-import', (report) => {
  report.runs[1].lifecycleMetrics[0].workers[0].workerBootstrap.launcher.resources.afterRuntimeAndBindingImport.capturedAt =
    timestamp(29);
});
expectRejected('missing-summary-rss-scope', (report) => {
  delete report.runs[1].attributionSummary.rssBytes.sampledPeak.scope;
});
expectRejected('stale-summary-rss-ownership', (report) => {
  report.runs[1].attributionSummary.rssBytes.externalPeak.ownership = 'worker-owned';
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
    initializationMsTotal: effectiveWorkers * 10,
    initializationMsMax: 10,
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
    mainPluginConstructionElapsedMs: workerCount === 0 ? 12 : 1,
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
    createBundlerOptionsMetrics: [createBundlerOptionsMetrics(workerCount)],
    nativePluginRegistrationMetrics: [nativePluginRegistrationMetrics(workerCount)],
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
    mainReadyMs: 40 + threadNumber,
    mainTimeline: {
      constructorStartedAt: timestamp(10),
      constructorReturnedAt: timestamp(11),
      onlineAt: timestamp(20),
      readyMessageAt: timestamp(50 + threadNumber),
    },
    workerBootstrap: workerBootstrap(threadNumber),
    resourcesAtPoolReady: workerResource(61, 62, { user: 100 + threadNumber, system: 10 }),
  }));
  const workersBeforeTermination = workersAtReady.map(({ threadNumber, resourcesAtPoolReady }) => ({
    threadNumber,
    resourcesAtPoolReady,
    resourcesBeforeTermination: workerResource(101, 102, {
      user: 1_000 + threadNumber,
      system: 20,
    }),
    workerLocalBeforeTermination: workerLocalSnapshot(101.5),
  }));
  const allWorkersReady = lifecycleProcessSnapshot(60, 180);
  const resourceBaselineBeforeBuild = lifecycleProcessSnapshot(70, 200);
  const beforeWorkerSnapshots = lifecycleProcessSnapshot(100, 250);
  const afterWorkerSnapshots = lifecycleProcessSnapshot(110, 260);
  const afterTermination = lifecycleProcessSnapshot(120, 180);
  return [
    {
      kind: 'rolldown_parallel_plugin_init_metrics',
      version: 1,
      metricsId: 1,
      workerCount,
      pluginCount: 1,
      parallelPluginIndexes: [0],
      poolInitializationMs: 200,
      rssBeforeBytes: 100,
      rssAfterBytes: 200,
      rssScope: 'whole process; the before/after delta is not worker ownership',
      processSnapshots: {
        scope: 'whole process; RSS is not attributed to an isolate or worker',
        beforeWorkerPool: lifecycleProcessSnapshot(0, 100),
        allWorkersReady,
        resourceBaselineBeforeBuild,
      },
      cpuWindows: cpuWindow(workerCount, false, {
        allWorkersReady,
        resourceBaselineBeforeBuild,
      }),
      workers: workersAtReady,
    },
    {
      kind: 'rolldown_parallel_plugin_termination_metrics',
      version: 1,
      metricsId: 1,
      workerCount,
      pluginCount: 1,
      parallelPluginIndexes: [0],
      poolTerminationMs: 20,
      rssBeforeBytes: 250,
      rssAfterBytes: 180,
      rssScope: 'whole process; the before/after delta is not worker ownership',
      processSnapshots: {
        scope: 'whole process; RSS is not attributed to an isolate or worker',
        allWorkersReady,
        resourceBaselineBeforeBuild,
        beforeWorkerSnapshots,
        afterWorkerSnapshots,
        afterTermination,
      },
      cpuWindows: cpuWindow(workerCount, true, {
        allWorkersReady,
        resourceBaselineBeforeBuild,
        beforeWorkerSnapshots,
        afterWorkerSnapshots,
      }),
      workers: workersBeforeTermination,
    },
  ];
}

function cpuWindow(workerCount, includeInner, snapshots) {
  const workerSamples = range(workerCount).map((threadNumber) => ({
    threadNumber,
    ok: true,
    measurementClass: includeInner
      ? 'worker-thread CPU difference between two asynchronously completed capture intervals'
      : 'cumulative worker-thread CPU since an unknown point between constructor start and online, read asynchronously during the ready capture interval',
    relationToProcessWindows: includeInner
      ? 'the worker CPU interval is contained by the outer process window and contains the inner process window; it is neither an exact match for either process window nor exact plugin attribution'
      : 'the worker CPU interval is contained by the outer process window, but its exact start and read instants are not exposed by Node.js',
    startBounds: includeInner
      ? {
          earliestAt: timestamp(61),
          latestAt: timestamp(62),
          meaning: 'the first asynchronous Worker.cpuUsage read completes within these bounds',
        }
      : {
          earliestAt: timestamp(10),
          latestAt: timestamp(20),
          meaning: 'Node.js does not expose the exact Worker.cpuUsage counter start instant',
        },
    endBounds: includeInner
      ? {
          earliestAt: timestamp(101),
          latestAt: timestamp(102),
          meaning: 'the asynchronous Worker.cpuUsage read completes within these bounds',
        }
      : {
          earliestAt: timestamp(61),
          latestAt: timestamp(62),
          meaning: 'the asynchronous Worker.cpuUsage read completes within these bounds',
        },
    cpuDeltaMicros: includeInner
      ? { user: 900, system: 10 }
      : { user: 100 + threadNumber, system: 10 },
  }));
  return {
    measurementClass: 'asynchronous-bracketing-diagnostic; not exact CPU attribution',
    phase: includeInner ? 'lifetime-through-pre-termination-snapshot' : 'initialization',
    outerProcessWindow: includeInner
      ? processCpuWindow(snapshots.allWorkersReady, snapshots.afterWorkerSnapshots)
      : processCpuWindow(lifecycleProcessSnapshot(0, 100), snapshots.resourceBaselineBeforeBuild),
    ...(includeInner
      ? {
          innerProcessWindow: processCpuWindow(
            snapshots.resourceBaselineBeforeBuild,
            snapshots.beforeWorkerSnapshots,
          ),
        }
      : {}),
    workerSamples,
    summedObservedWorkerThreadCpuMicros: workerSamples.reduce(
      (sum, sample) => ({
        user: sum.user + sample.cpuDeltaMicros.user,
        system: sum.system + sample.cpuDeltaMicros.system,
      }),
      { user: 0, system: 0 },
    ),
    completeWorkerCoverage: true,
    scope:
      'process and main-thread deltas share exact process snapshot endpoints; worker CPU reads have different asynchronous endpoints, so they are reported independently and are never subtracted into a claimed Rust/native residual',
  };
}

function processCpuWindow(start, end) {
  return {
    startedAt: start.capturedAt,
    finishedAt: end.capturedAt,
    processCpuDeltaMicros: { user: 10_000, system: 1_000 },
    mainThreadCpuDeltaMicros: { user: 1_000, system: 100 },
  };
}

function workerBootstrap(threadNumber) {
  const launcherStages = {
    metricsRuntimeImport: stage(26, 27),
    runtimeAndBindingImport: stage(28, 30),
  };
  return {
    kind: 'rolldown_parallel_plugin_worker_bootstrap_metrics',
    version: 1,
    metricsId: 1,
    threadNumber,
    clockAlignment: {
      workerTimeOriginEpochMs: 1_000,
      mainTimeOriginEpochMs: 1_000,
      workerMinusMainTimeOriginMs: 0,
    },
    timeline: {
      entryAt: timestamp(25),
      launcherEntryAt: timestamp(25),
      runtimeAndBindingImportStartedAt: timestamp(28),
      runtimeAndBindingImportFinishedAt: timestamp(30),
      runtimeEntryAt: timestamp(31),
      bootstrapStartedAt: timestamp(32),
      registerStartedAt: timestamp(47),
      registerFinishedAt: timestamp(48),
      readyAt: timestamp(49),
    },
    launcher: {
      kind: 'rolldown_parallel_plugin_worker_launcher_metrics',
      version: 1,
      metricsId: 1,
      scope:
        'research-only metrics entry before the dynamic import of the worker runtime graph; that graph statically imports binding.cjs',
      timeline: {
        launcherEntryAt: timestamp(25),
        metricsRuntimeImportStartedAt: timestamp(26),
        metricsRuntimeImportFinishedAt: timestamp(27),
        runtimeAndBindingImportStartedAt: timestamp(28),
        runtimeAndBindingImportFinishedAt: timestamp(30),
      },
      stages: launcherStages,
      resources: {
        afterMetricsRuntimeImportBeforeRuntimeAndBindingImport: launcherProcessSnapshot(27.5),
        afterRuntimeAndBindingImport: launcherProcessSnapshot(30.5),
      },
    },
    measuredBootstrapMs: 23,
    registerPluginsMs: 1,
    plugins: [
      {
        pluginIndex: 0,
        implementationImportMs: 2,
        factoryMs: 9.9,
        bindingifyMs: 0.9,
        timeline: {
          importStartedAt: timestamp(33),
          importFinishedAt: timestamp(35),
          factoryStartedAt: timestamp(35.1),
          factoryFinishedAt: timestamp(45),
          bindingStartedAt: timestamp(45.1),
          bindingFinishedAt: timestamp(46),
        },
        stages: {
          implementationImport: stage(33, 35),
          factory: stage(35.1, 45),
          bindingifyPlugin: stage(45.1, 46),
        },
      },
    ],
    workerLocalBeforePluginInitialization: workerLocalSnapshot(32.5),
    workerLocalAtReady: workerLocalSnapshot(48.5),
    isolationLimits: [
      'runtimeAndBindingImport is the dynamic import of the compiled worker-runtime graph; that graph statically imports binding.cjs, so JavaScript graph evaluation and native-addon loading cannot be separated without changing production module boundaries',
      'the GC observer starts after the lightweight launcher dynamically imports node:perf_hooks; GC before that observer exists cannot be recovered',
      'process RSS is shared by the main isolate, every worker isolate, native addon state, and runtime threads; it is not worker ownership',
    ],
  };
}

function workerResource(start, finish, cpu) {
  return {
    ok: true,
    snapshot: {
      captureStartedAt: timestamp(start),
      captureFinishedAt: timestamp(finish),
      cpuUsageMicros: cpu,
      heapStatistics: { heap_size_limit: 1_000 },
      eventLoopUtilization: {},
    },
  };
}

function createBundlerOptionsMetrics(workerCount) {
  const stageNames = [
    'metricsRuntimeSetup',
    'normalizeInputPluginOption',
    'normalizeOutputPluginOption',
    'outputOptionsHook',
    'normalizeHookOutputPluginOption',
    'normalizePluginObjects',
    'parallelPoolInitialization',
    'pluginContextConstruction',
    'bindingifyInputOptions',
    'bindingifyOutputOptions',
  ];
  const stages = Object.fromEntries(stageNames.map((name, index) => [name, stage(index, index + 1)]));
  return {
    kind: 'rolldown_create_bundler_options_metrics',
    version: 1,
    metricsId: 1,
    measurementClass:
      'research-only instrumented initialization attribution; elapsed values are not uninstrumented wall evidence',
    pluginCounts: {
      inputBeforeOutputOptionsHook: 1,
      outputBeforeOutputOptionsHook: 0,
      ordinaryJs: workerCount ? 0 : 1,
      parallelPlaceholders: workerCount ? 1 : 0,
      builtin: 0,
    },
    timeline: {
      createBundlerOptionsStartedAt: timestamp(0),
      createBundlerOptionsFinishedAt: timestamp(10),
    },
    stages,
    pluginBinding: [
      {
        pluginIndex: 0,
        pluginName: workerCount ? 'anonymous-0' : 'cloudflare-mdx',
        pluginKind: workerCount ? 'parallel-placeholder' : 'ordinary-js',
        stage: stage(8, 9),
      },
    ],
    resources: {
      scope:
        'process CPU/RSS cover the whole process; heap and GC cover the main V8 isolate only',
      afterMetricsRuntimeSetupAtCreateBundlerOptionsStart: processSnapshot(1),
      afterPluginNormalization: processSnapshot(6),
      afterParallelPoolInitialization: processSnapshot(7),
      afterInputBindingification: processSnapshot(9),
      afterOutputBindingification: processSnapshot(10),
      atCreateBundlerOptionsFinish: processSnapshot(10),
    },
    isolationLimits: ['one', 'two', 'three', 'four', 'five'],
  };
}

function nativePluginRegistrationMetrics(workerCount) {
  return {
    kind: 'rolldown_native_plugin_registration_metrics',
    version: 1,
    metricsId: 1,
    boundary:
      'after BindingBundlerOptions destructuring, before registry transfer, through BundlerConfig construction, synchronously before ClassicBundler::create_bundle and Bundle::scan',
    nativeNormalizationTotalMs: 1,
    nativePluginMaterializationMs: 0.5,
    stages: {
      registryTransferMs: 0.1,
      workerManagerConstructionMs: 0.1,
      bindingOptionNormalizationMs: 0.7,
      pluginMaterializationMs: 0.5,
    },
    stageRelationships: {
      registryTransfer: 'direct child of nativeNormalizationTotal',
      workerManagerConstruction: 'direct child of nativeNormalizationTotal',
      bindingOptionNormalization: 'direct child of nativeNormalizationTotal',
      pluginMaterialization: 'nested inside bindingOptionNormalization',
    },
    parallelRegistryPresent: Boolean(workerCount),
    workerManagerWorkerCount: workerCount,
    ordinaryJsPluginCount: workerCount ? 0 : 1,
    parallelJsPluginCount: workerCount ? 1 : 0,
    builtinPluginCount: 0,
    plugins: [
      {
        index: 0,
        name: 'cloudflare-mdx',
        kind: workerCount ? 'parallel-js' : 'ordinary-js',
        materializationMs: 0.5,
      },
    ],
    scope:
      'The total includes registry transfer, WorkerManager construction, all binding-option normalization, plugin conversion, and BundlerConfig construction. It excludes JavaScript bindingification, create_bundle, scan, hooks, and build time.',
  };
}

function processSnapshot(at) {
  return {
    capturedAt: timestamp(at),
    scope: {
      cpuUsage: 'whole process, including JS workers and native threads',
      mainThreadCpuUsage: 'current Node.js thread only',
      memoryUsage: 'whole process; RSS is not assigned to an isolate or worker',
      heapStatistics: 'current V8 isolate only',
      eventLoopUtilization: 'current Node.js event loop only; this is not CPU time',
      gc: 'GC performance entries observed in this isolate after its metrics observer started',
    },
    processCpuUsageMicros: { user: 1, system: 1 },
    mainThreadCpuUsageMicros: { user: 1, system: 0 },
    processResourceUsage: {},
    processMemoryUsageBytes: { rss: 100 },
    isolateHeapStatistics: { heap_size_limit: 1_000 },
    isolateEventLoopUtilization: {},
    isolateGc: gcMetrics(),
  };
}

function launcherProcessSnapshot(at) {
  const value = processSnapshot(at);
  value.scope = {
    cpuUsage: 'whole process, including JS workers and native threads',
    mainThreadCpuUsage: 'current Node.js worker thread only',
    memoryUsage: 'whole process; RSS is not assigned to an isolate or worker',
    heapStatistics: 'current worker V8 isolate only',
    eventLoopUtilization: 'current worker event loop only; this is not CPU time',
    gc: 'GC entries observed in this worker after the research metrics observer started',
  };
  return value;
}

function lifecycleProcessSnapshot(at, rss) {
  return {
    capturedAt: timestamp(at),
    scope: {
      cpuUsage: 'whole process, including JS workers and native threads',
      memoryUsage: 'whole process; RSS is not assigned to a worker',
      heapStatistics: 'main V8 isolate only',
      eventLoopUtilization: 'Node.js main event loop only; this is not CPU time',
    },
    processCpuUsageMicros: { user: at * 10 + 10, system: at + 1 },
    mainThreadCpuUsageMicros: { user: at + 10, system: 1 },
    processResourceUsage: {},
    processMemoryUsageBytes: { rss },
    mainIsolateHeapStatistics: { heap_size_limit: 1_000 },
    mainEventLoopUtilization: {},
    mainIsolateGc: gcMetrics(),
  };
}

function workerLocalSnapshot(at) {
  return {
    capturedAt: timestamp(at),
    scope: {
      cpuUsage: 'whole process; not this worker',
      threadCpuUsage: 'this Node.js worker thread',
      memoryUsage: 'whole process; RSS is not this worker',
      heapStatistics: 'this worker V8 isolate',
      eventLoopUtilization: 'this worker event loop; this is not CPU time',
      gc: 'GC performance entries observed in this worker after launcher instrumentation started',
    },
    processCpuUsageMicros: { user: 100, system: 10 },
    threadCpuUsageMicros: { user: 50, system: 5 },
    processMemoryUsageBytes: { rss: 200 },
    heapStatistics: { heap_size_limit: 1_000 },
    eventLoopUtilization: {},
    gc: gcMetrics(),
  };
}

function gcMetrics() {
  return { count: 0, durationMs: 0, maxDurationMs: 0, byKind: {} };
}

function stage(startedAt, finishedAt) {
  return {
    startedAt: timestamp(startedAt),
    finishedAt: timestamp(finishedAt),
    durationMs: finishedAt - startedAt,
  };
}

function timestamp(monotonicMs) {
  return { monotonicMs, epochMs: 1_000 + monotonicMs };
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
