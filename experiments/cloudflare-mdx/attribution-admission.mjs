import nodePath from 'node:path';
import {
  evaluateChildHostPolicy,
  evaluateStartAdmission,
  validateFrozenPerformanceHostPolicy,
} from './local-host-policy.mjs';
import { normalizePoolEnvironment, BASELINE_POOL_ENVIRONMENT } from './pool-environment.mjs';
import { ATTRIBUTION_RUNTIME_PROFILE, normalizeRuntimeProfile } from './runtime-profile.mjs';

export const ATTRIBUTION_SCALE = 9_157;
export const ATTRIBUTION_PREFIX_SHA256 =
  '1bd8358392d85b5f7791a43385565818d988b64151d92b263d7c2abfd8044673';
export const ATTRIBUTION_VARIANTS = Object.freeze(['ordinary', 'worker-4', 'worker-8']);
export const COLD_SERVICE_CHECKPOINTS = Object.freeze([1, 2, 4, 8, 16, 32]);
export const STEADY_SERVICE_WINDOW_CALLS = 256;

const CREATE_MEASUREMENT_CLASS =
  'research-only instrumented initialization attribution; elapsed values are not uninstrumented wall evidence';
const CREATE_RESOURCE_SCOPE =
  'process CPU/RSS cover the whole process; heap and GC cover the main V8 isolate only';
const NATIVE_BOUNDARY =
  'after BindingBundlerOptions destructuring, before registry transfer, through BundlerConfig construction, synchronously before ClassicBundler::create_bundle and Bundle::scan';
const NATIVE_SCOPE =
  'The total includes registry transfer, WorkerManager construction, all binding-option normalization, plugin conversion, and BundlerConfig construction. It excludes JavaScript bindingification, create_bundle, scan, hooks, and build time.';
const NATIVE_STAGE_RELATIONSHIPS = Object.freeze({
  registryTransfer: 'direct child of nativeNormalizationTotal',
  workerManagerConstruction: 'direct child of nativeNormalizationTotal',
  bindingOptionNormalization: 'direct child of nativeNormalizationTotal',
  pluginMaterialization: 'nested inside bindingOptionNormalization',
});
const PROCESS_METRICS_SCOPE = Object.freeze({
  cpuUsage: 'whole process, including JS workers and native threads',
  mainThreadCpuUsage: 'current Node.js thread only',
  memoryUsage: 'whole process; RSS is not assigned to an isolate or worker',
  heapStatistics: 'current V8 isolate only',
  eventLoopUtilization: 'current Node.js event loop only; this is not CPU time',
  gc: 'GC performance entries observed in this isolate after its metrics observer started',
});
const LAUNCHER_SCOPE =
  'research-only metrics entry before the dynamic import of the worker runtime graph; that graph statically imports binding.cjs';
const LAUNCHER_PROCESS_SCOPE = Object.freeze({
  cpuUsage: 'whole process, including JS workers and native threads',
  mainThreadCpuUsage: 'current Node.js worker thread only',
  memoryUsage: 'whole process; RSS is not assigned to an isolate or worker',
  heapStatistics: 'current worker V8 isolate only',
  eventLoopUtilization: 'current worker event loop only; this is not CPU time',
  gc: 'GC entries observed in this worker after the research metrics observer started',
});
const LIFECYCLE_RSS_SCOPE = 'whole process; the before/after delta is not worker ownership';
const LIFECYCLE_SNAPSHOT_SCOPE = 'whole process; RSS is not attributed to an isolate or worker';
const LIFECYCLE_PROCESS_SCOPE = Object.freeze({
  cpuUsage: 'whole process, including JS workers and native threads',
  memoryUsage: 'whole process; RSS is not assigned to a worker',
  heapStatistics: 'main V8 isolate only',
  eventLoopUtilization: 'Node.js main event loop only; this is not CPU time',
});
const WORKER_LOCAL_SCOPE = Object.freeze({
  cpuUsage: 'whole process; not this worker',
  threadCpuUsage: 'this Node.js worker thread',
  memoryUsage: 'whole process; RSS is not this worker',
  heapStatistics: 'this worker V8 isolate',
  eventLoopUtilization: 'this worker event loop; this is not CPU time',
  gc: 'GC performance entries observed in this worker after launcher instrumentation started',
});
const CPU_WINDOW_CLASS = 'asynchronous-bracketing-diagnostic; not exact CPU attribution';
const CPU_WINDOW_SCOPE =
  'process and main-thread deltas share exact process snapshot endpoints; worker CPU reads have different asynchronous endpoints, so they are reported independently and are never subtracted into a claimed Rust/native residual';
const RSS_OWNERSHIP = 'whole child process; never worker or V8-isolate ownership';
const INIT_CPU_SAMPLE_CLASS =
  'cumulative worker-thread CPU since an unknown point between constructor start and online, read asynchronously during the ready capture interval';
const INIT_CPU_RELATION =
  'the worker CPU interval is contained by the outer process window, but its exact start and read instants are not exposed by Node.js';
const TERM_CPU_SAMPLE_CLASS =
  'worker-thread CPU difference between two asynchronously completed capture intervals';
const TERM_CPU_RELATION =
  'the worker CPU interval is contained by the outer process window and contains the inner process window; it is neither an exact match for either process window nor exact plugin attribution';

export function validateAttributionMatrix(matrix) {
  if (
    matrix?.executionScope !== 'local-only' ||
    matrix.evidenceKind !== 'attribution' ||
    typeof matrix.correctnessGate !== 'string' ||
    matrix.correctnessGate.length === 0
  ) {
    throw new Error('Attribution matrix must be local-only, explicitly attributed, and gated');
  }
  if (!same(normalizeRuntimeProfile(matrix.runtimeProfile), ATTRIBUTION_RUNTIME_PROFILE)) {
    throw new Error('Attribution matrix does not use the exact frozen attribution runtime');
  }
  if (
    !same(
      normalizePoolEnvironment(matrix.poolEnvironment),
      normalizePoolEnvironment(BASELINE_POOL_ENVIRONMENT),
    )
  ) {
    throw new Error('Attribution matrix changed the frozen Rust pool allocation');
  }
  validateFrozenPerformanceHostPolicy(matrix.hostPolicy);
  if (!Array.isArray(matrix.cases) || matrix.cases.length !== 1) {
    throw new Error('Attribution matrix must contain exactly one full-corpus case');
  }
  const definition = matrix.cases[0];
  if (
    !nodePath.isAbsolute(definition.projectRoot ?? '') ||
    !nodePath.isAbsolute(definition.rolldownPackageRoot ?? '') ||
    definition.corpus !== 'cloudflare-mdx-scale-v1' ||
    definition.buildProfile !== 'default' ||
    definition.selectionScale !== ATTRIBUTION_SCALE ||
    definition.selectionPrefixSha256 !== ATTRIBUTION_PREFIX_SHA256 ||
    definition.instrumentation !== true ||
    definition.rustInstrumentation !== true ||
    definition.measurementMode !== 'measurement' ||
    definition.lifecycleClaim !== true ||
    !same(definition.variants, ATTRIBUTION_VARIANTS) ||
    definition.warmups !== 0 ||
    definition.repeats !== 1 ||
    definition.startIndex !== 0 ||
    (definition.limit ?? 0) !== 0
  ) {
    throw new Error('Attribution case must pin the exact 9,157-source ordinary/4/8 lane');
  }
  return matrix;
}

export function validateAttributionReport(report, { correctnessOracle } = {}) {
  validateAttributionMatrix(report?.matrix);
  if (
    report.schema !== 1 ||
    report.evidenceKind !== 'attribution' ||
    report.measurementFieldsPresent !== true ||
    report.timingEligible !== false ||
    report.conclusionEligible !== false ||
    report.executionScope !== 'local-only'
  ) {
    throw new Error('Attribution report has an invalid evidence classification');
  }
  if (
    report.environment?.correctnessGate?.status !== 'passed' ||
    !/^[a-f0-9]{64}$/.test(report.environment?.correctnessGate?.sha256 ?? '') ||
    !same(normalizeRuntimeProfile(report.environment?.runtimeProfile), ATTRIBUTION_RUNTIME_PROFILE) ||
    !same(
      normalizePoolEnvironment(report.environment?.childPoolEnvironment),
      normalizePoolEnvironment(BASELINE_POOL_ENVIRONMENT),
    )
  ) {
    throw new Error('Attribution report lacks exact runtime, pool, or correctness provenance');
  }
  if (
    !Array.isArray(report.runs) ||
    report.runs.length !== ATTRIBUTION_VARIANTS.length ||
    !same(report.runs.map(({ variant }) => variant), ATTRIBUTION_VARIANTS) ||
    !same(report.runs.map(({ index }) => index), [0, 0, 0]) ||
    !same(report.runs.map(({ sequence }) => sequence), [0, 1, 2]) ||
    (report.validationErrors ?? []).length !== 0 ||
    (report.hostPolicyViolations ?? []).length !== 0 ||
    (report.hostAdmissionAttempts ?? []).length < ATTRIBUTION_VARIANTS.length
  ) {
    throw new Error('Attribution report is incomplete or contains an admission failure');
  }
  if (Object.values(report.environment?.parentCiMarkers ?? {}).some(isActiveCiValue)) {
    throw new Error('Attribution report recorded an active CI marker');
  }
  if (!correctnessOracle) throw new Error('Attribution validation requires the pinned correctness oracle');
  for (const run of report.runs) validateAttributionRun(run, correctnessOracle);
  for (const field of [
    'transformedEntryCount',
    'selection',
    'outputChunks',
    'normalizedOutputBytes',
    'normalizedOutputHash',
    'outputNormalization',
  ]) {
    if (new Set(report.runs.map((run) => JSON.stringify(run[field]))).size !== 1) {
      throw new Error(`Attribution variants differ for ${field}`);
    }
  }
  return report;
}

export function validateAttributionRun(run, correctnessOracle) {
  const workerCount = run.variant === 'ordinary' ? 0 : Number(/^worker-(\d+)$/.exec(run.variant)?.[1]);
  if (!Number.isInteger(workerCount) || !ATTRIBUTION_VARIANTS.includes(run.variant)) {
    throw new Error(`Invalid attribution variant: ${run.variant}`);
  }
  if (
    run.evidenceKind !== 'attribution' ||
    run.measurementMode !== 'measurement' ||
    run.instrumentation !== true ||
    run.rustInstrumentation !== true ||
    run.lifecycleClaim !== true ||
    run.corpus !== 'cloudflare-mdx-scale-v1' ||
    run.transformedEntryCount !== ATTRIBUTION_SCALE ||
    run.selection?.scale !== ATTRIBUTION_SCALE ||
    run.selection?.prefixSha256 !== ATTRIBUTION_PREFIX_SHA256 ||
    !same(normalizeRuntimeProfile(run.runtimeProfile), ATTRIBUTION_RUNTIME_PROFILE) ||
    !same(
      normalizePoolEnvironment(run.poolEnvironment),
      normalizePoolEnvironment(BASELINE_POOL_ENVIRONMENT),
    )
  ) {
    throw new Error(`${run.variant} changed attribution inputs or provenance`);
  }
  validateOutputOracle(run, correctnessOracle);
  validateHost(run);
  validateModuleInitialization(run.moduleInitMetrics);
  validateMainResources(run.attributionResources);
  const metrics = validateJsMetrics(run.metrics, workerCount || 1);
  const initializationMetrics = validateAttributionInitializationRecords({
    workerCount,
    createBundlerOptionsMetrics: run.createBundlerOptionsMetrics,
    nativePluginRegistrationMetrics: run.nativePluginRegistrationMetrics,
    lifecycleMetrics: run.lifecycleMetrics,
  });
  if (workerCount === 0) {
    if ((run.rustMetrics ?? []).length !== 0 || (run.lifecycleMetrics ?? []).length !== 0) {
      throw new Error('Ordinary attribution unexpectedly emitted worker metrics');
    }
  } else {
    const rust = only(run.rustMetrics, `${run.variant} Rust transform record`);
    const lifecycle = initializationMetrics.lifecycle;
    validateRustTransform(rust, metrics, workerCount);
    validatePermitThreadBijection(rust, metrics, lifecycle, workerCount);
  }
  const derived = deriveAttributionSummary(run);
  if (!same(run.attributionSummary, derived)) {
    throw new Error(`${run.variant} attribution summary is absent or not derived from raw records`);
  }
  return run;
}

export function validateAttributionInitializationRecords({
  workerCount,
  createBundlerOptionsMetrics,
  nativePluginRegistrationMetrics,
  lifecycleMetrics,
}) {
  if (!Number.isSafeInteger(workerCount) || workerCount < 0) {
    throw new Error(`Invalid initialization worker count: ${workerCount}`);
  }
  const createBundlerOptions = validateCreateBundlerOptionsMetrics(
    createBundlerOptionsMetrics,
    workerCount,
  );
  const nativeRegistration = validateNativePluginRegistrationMetrics(
    nativePluginRegistrationMetrics,
    workerCount,
  );
  if (createBundlerOptions.metricsId !== nativeRegistration.metricsId) {
    throw new Error('createBundlerOptions/native metrics identities disagree');
  }
  const lifecycle = workerCount
    ? validateLifecycle(lifecycleMetrics, workerCount, createBundlerOptions.metricsId)
    : undefined;
  if (!workerCount && (lifecycleMetrics ?? []).length !== 0) {
    throw new Error('Ordinary initialization unexpectedly emitted worker lifecycle metrics');
  }
  validatePluginIndexCorrelation(createBundlerOptions, nativeRegistration, lifecycle);
  return { createBundlerOptions, nativeRegistration, lifecycle };
}

export function deriveAttributionSummary(run) {
  const workerCount = run.variant === 'ordinary' ? 0 : Number(/^worker-(\d+)$/.exec(run.variant)?.[1]);
  const resources = run.attributionResources;
  const processCpu = resources.deltas.processCpuDeltaMicros;
  const mainCpu = resources.deltas.mainThreadCpuDeltaMicros;
  const nonMainCpu = subtractCpu(processCpu, mainCpu);
  const createBundlerOptions = run.createBundlerOptionsMetrics?.[0];
  const nativeRegistration = run.nativePluginRegistrationMetrics?.[0];
  const initialization = (run.lifecycleMetrics ?? []).find(
    ({ kind }) => kind === 'rolldown_parallel_plugin_init_metrics',
  );
  const termination = (run.lifecycleMetrics ?? []).find(
    ({ kind }) => kind === 'rolldown_parallel_plugin_termination_metrics',
  );
  const rust = run.rustMetrics?.[0];
  const widths = rust?.timeline?.timeWeightedWidths;
  const completion = rust?.timeline?.completionRateInputs;
  return {
    schema: 2,
    workerCount,
    cpuMicros: {
      process: processCpu,
      mainThread: mainCpu,
      nonMainProcess: nonMainCpu,
      nonMainMeaning:
        'whole-process CPU minus main-thread CPU over the same case-wide endpoints; includes JavaScript workers, Rust, native-addon and Node runtime threads, and cannot be split further by this interval',
      workerLifecycleWindows: initialization
        ? {
            initialization: summarizeCpuWindow(initialization.cpuWindows),
            lifetimeThroughPreTerminationSnapshot: summarizeCpuWindow(termination.cpuWindows),
            interpretation:
              'worker CPU samples have asynchronous bounded endpoints; they are diagnostics and are never subtracted from either process interval to claim a Rust/native residual',
          }
        : null,
    },
    rssBytes: {
      ownership: RSS_OWNERSHIP,
      sampledPeak: {
        bytes: resources.rss.maximumBytes,
        scope: 'whole child process sampled in-process during attribution',
        ownership: RSS_OWNERSHIP,
      },
      retained: {
        bytes: resources.rss.retainedBytes,
        scope: 'whole child process at attribution resource-capture finish',
        ownership: RSS_OWNERSHIP,
      },
      externalPeak: {
        bytes: run.peakRssBytes,
        scope: 'whole child process peak reported by /usr/bin/time -l around the Node child',
        ownership: RSS_OWNERSHIP,
      },
      lifecycle: initialization
        ? {
            ownership: RSS_OWNERSHIP,
            initialization: {
              beforeBytes: initialization.rssBeforeBytes,
              afterBytes: initialization.rssAfterBytes,
              scope: 'whole child process before and after parallel-plugin pool initialization',
              runtimeScope: initialization.rssScope,
              ownership: RSS_OWNERSHIP,
            },
            termination: {
              beforeBytes: termination.rssBeforeBytes,
              afterBytes: termination.rssAfterBytes,
              scope: 'whole child process before worker snapshots and after pool termination',
              runtimeScope: termination.rssScope,
              ownership: RSS_OWNERSHIP,
            },
          }
        : null,
    },
    mainIsolate: {
      heapAtStart: resources.startedAt.mainIsolateHeapStatistics,
      heapAtEnd: resources.finishedAt.mainIsolateHeapStatistics,
      eventLoopUtilization: resources.deltas.mainEventLoopUtilization,
      gc: resources.gc,
    },
    initialization: {
      metricsId: createBundlerOptions.metricsId,
      createBundlerOptions: {
        elapsedMs: durationBetween(
          createBundlerOptions.timeline.createBundlerOptionsStartedAt,
          createBundlerOptions.timeline.createBundlerOptionsFinishedAt,
        ),
        stages: stageDurations(createBundlerOptions.stages),
        pluginCounts: createBundlerOptions.pluginCounts,
        pluginBinding: createBundlerOptions.pluginBinding.map(
          ({ pluginIndex, pluginName, pluginKind, stage }) => ({
            pluginIndex,
            pluginName,
            pluginKind,
            durationMs: stage.durationMs,
          }),
        ),
      },
      nativeRegistration: {
        elapsedMs: nativeRegistration.nativeNormalizationTotalMs,
        stages: nativeRegistration.stages,
        plugins: nativeRegistration.plugins,
        workerManagerWorkerCount: nativeRegistration.workerManagerWorkerCount,
      },
      workerPool: initialization ? summarizeWorkerPoolInitialization(initialization) : null,
      correlation: {
        createBundlerOptionsMetricsId: createBundlerOptions.metricsId,
        nativeRegistrationMetricsId: nativeRegistration.metricsId,
        lifecycleMetricsId: initialization?.metricsId ?? null,
        pluginIndexes: createBundlerOptions.pluginBinding.map(({ pluginIndex }) => pluginIndex),
        rustTransformMetricsIdentity:
          'the Rust transform record has no metricsId; this fresh process requires exactly one such record and correlates it by the sole worker lane plus exact module and worker-index bijections',
      },
    },
    workers: (termination?.workers ?? []).map((worker) => ({
      threadNumber: worker.threadNumber,
      readyMs: initialization.workers.find(
        ({ threadNumber }) => threadNumber === worker.threadNumber,
      ).mainReadyMs,
      calls: run.metrics.kernelTimeline.perWorker.find(
        ({ worker: index }) => index === worker.threadNumber,
      ).calls,
      busyMs: run.metrics.kernelTimeline.perWorker.find(
        ({ worker: index }) => index === worker.threadNumber,
      ).busyMs,
      serviceElapsedMsTotal: run.metrics.kernelTimeline.perWorker.find(
        ({ worker: index }) => index === worker.threadNumber,
      ).serviceElapsedMsTotal,
      cpuDiagnostics: {
        initialization: initialization.cpuWindows.workerSamples.find(
          ({ threadNumber }) => threadNumber === worker.threadNumber,
        ),
        lifetimeThroughPreTerminationSnapshot: termination.cpuWindows.workerSamples.find(
          ({ threadNumber }) => threadNumber === worker.threadNumber,
        ),
      },
      heapAtReady: worker.resourcesAtPoolReady.snapshot.heapStatistics,
      heapBeforeTermination: worker.resourcesBeforeTermination.snapshot.heapStatistics,
      eventLoopUtilizationBeforeTermination:
        worker.resourcesBeforeTermination.snapshot.eventLoopUtilization,
      gc: worker.workerLocalBeforeTermination.gc,
    })),
    throughput: rust
      ? {
          rustCompletedCallsPerSecond:
            completion.completedCalls / (completion.activitySpanNs / 1e9),
          jsCompletedCallsPerSecond:
            run.metrics.handlerCalls / (run.metrics.kernelTimeline.spanMs / 1e3),
        }
      : {
          rustCompletedCallsPerSecond: null,
          jsCompletedCallsPerSecond:
            run.metrics.handlerCalls / (run.metrics.kernelTimeline.spanMs / 1e3),
        },
    averageWidths: rust
      ? {
          pending: widths.pendingWidthNs / widths.observationNs,
          outstanding: widths.outstandingWidthNs / widths.observationNs,
          inFlight: widths.inFlightWidthNs / widths.observationNs,
        }
      : null,
    workerServiceNs: rust?.timeline.workerServiceNs ?? [],
    serviceProfile: deriveServiceProfile(run.metrics),
  };
}

function summarizeWorkerPoolInitialization(initialization) {
  return {
    elapsedMs: initialization.poolInitializationMs,
    cpuWindow: summarizeCpuWindow(initialization.cpuWindows),
    workers: initialization.workers.map(({ threadNumber, mainReadyMs, workerBootstrap }) => ({
      threadNumber,
      mainReadyMs,
      launcher: {
        elapsedMs: durationBetween(
          workerBootstrap.timeline.launcherEntryAt,
          workerBootstrap.timeline.runtimeAndBindingImportFinishedAt,
        ),
        stages: stageDurations(workerBootstrap.launcher.stages),
      },
      bootstrap: {
        launcherEntryThroughRegistrationMs: workerBootstrap.measuredBootstrapMs,
        registerPluginsMs: workerBootstrap.registerPluginsMs,
        stages: {
          launcherToBootstrapStartMs: durationBetween(
            workerBootstrap.timeline.launcherEntryAt,
            workerBootstrap.timeline.bootstrapStartedAt,
          ),
          bootstrapStartToRegisterStartMs: durationBetween(
            workerBootstrap.timeline.bootstrapStartedAt,
            workerBootstrap.timeline.registerStartedAt,
          ),
          registerPluginsMs: workerBootstrap.registerPluginsMs,
          registerFinishToReadyMs: durationBetween(
            workerBootstrap.timeline.registerFinishedAt,
            workerBootstrap.timeline.readyAt,
          ),
        },
        plugins: workerBootstrap.plugins.map((plugin) => ({
          pluginIndex: plugin.pluginIndex,
          implementationImportMs: plugin.implementationImportMs,
          factoryMs: plugin.factoryMs,
          bindingifyMs: plugin.bindingifyMs,
        })),
      },
    })),
    nesting:
      'launcher stages are contained by launcherEntryThroughRegistrationMs; plugin import, factory, bindingification, and registration are bootstrap sub-stages and must not be added to the launcher total as independent elapsed time',
  };
}

function summarizeCpuWindow(cpuWindows) {
  return {
    measurementClass: cpuWindows.measurementClass,
    outerProcessWindow: cpuWindows.outerProcessWindow,
    innerProcessWindow: cpuWindows.innerProcessWindow ?? null,
    observedWorkerThreads: cpuWindows.summedObservedWorkerThreadCpuMicros,
    workerSamples: cpuWindows.workerSamples,
    scope: cpuWindows.scope,
  };
}

function stageDurations(stages) {
  return Object.fromEntries(
    Object.entries(stages).map(([name, stage]) => [name, stage.durationMs]),
  );
}

function durationBetween(start, end) {
  return end.monotonicMs - start.monotonicMs;
}

function deriveServiceProfile(metrics) {
  const grouped = [...Map.groupBy(metrics.timelineEntries, ({ worker }) => worker)]
    .sort(([left], [right]) => left - right)
    .map(([worker, entries]) => {
      const ordered = [...entries].sort((left, right) => {
        const leftStart = BigInt(left.kernelStartNs);
        const rightStart = BigInt(right.kernelStartNs);
        return leftStart < rightStart ? -1 : leftStart > rightStart ? 1 : left.id < right.id ? -1 : 1;
      });
      if (ordered.length < STEADY_SERVICE_WINDOW_CALLS) {
        throw new Error(`Worker ${worker} lacks ${STEADY_SERVICE_WINDOW_CALLS} calls for steady service`);
      }
      const origin = BigInt(ordered[0].kernelStartNs);
      const checkpoints = COLD_SERVICE_CHECKPOINTS.map((callOrdinal) => {
        const entry = ordered[callOrdinal - 1];
        if (!entry) throw new Error(`Worker ${worker} lacks cold service checkpoint ${callOrdinal}`);
        return {
          callOrdinal,
          serviceMs: entry.serviceMs,
          startOffsetMs: Number(BigInt(entry.kernelStartNs) - origin) / 1e6,
        };
      });
      const steadyEntries = ordered.slice(-STEADY_SERVICE_WINDOW_CALLS);
      return {
        worker,
        completedCalls: ordered.length,
        coldCheckpoints: checkpoints,
        steadyWindow: {
          definition: `last-${STEADY_SERVICE_WINDOW_CALLS}-worker-local-completed-calls`,
          startCallOrdinal: ordered.length - STEADY_SERVICE_WINDOW_CALLS + 1,
          endCallOrdinal: ordered.length,
          ...serviceStats(steadyEntries.map(({ serviceMs }) => serviceMs)),
        },
      };
    });
  return {
    schema: 1,
    checkpointOrdinals: COLD_SERVICE_CHECKPOINTS,
    steadyWindowCalls: STEADY_SERVICE_WINDOW_CALLS,
    perWorker: grouped,
  };
}

function serviceStats(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    calls: values.length,
    totalServiceMs: values.reduce((sum, value) => sum + value, 0),
    meanServiceMs: values.reduce((sum, value) => sum + value, 0) / values.length,
    minServiceMs: sorted[0],
    p50ServiceMs: percentile(sorted, 0.5),
    p95ServiceMs: percentile(sorted, 0.95),
    maxServiceMs: sorted.at(-1),
  };
}

function percentile(sorted, probability) {
  const index = Math.ceil(sorted.length * probability) - 1;
  return sorted[Math.max(0, index)];
}

function validateOutputOracle(run, oracle) {
  for (const field of ['outputChunks', 'normalizedOutputBytes', 'normalizedOutputHash']) {
    if (run[field] !== oracle[field]) {
      throw new Error(`${run.variant} differs from the correctness oracle for ${field}`);
    }
  }
  if (!same(run.outputNormalization, oracle.outputNormalization)) {
    throw new Error(`${run.variant} differs from the correctness oracle after normalization`);
  }
}

function validateHost(run) {
  if (!run.hostBefore || !run.hostAfter) {
    throw new Error(`${run.variant} lacks pre/post child host snapshots`);
  }
  const start = evaluateStartAdmission(run.hostPolicy, run.hostBefore);
  if (
    start.immediate.length !== 0 ||
    start.transient.length !== 0 ||
    (run.hostPolicyViolations ?? []).length !== 0 ||
    evaluateChildHostPolicy(run.hostPolicy, run.hostBefore, run.hostAfter).length !== 0 ||
    !positive(run.peakRssBytes)
  ) {
    throw new Error(`${run.variant} failed its post-child host or RSS gate`);
  }
}

function validateModuleInitialization(records) {
  const record = only(records, 'process-level binding module initialization record');
  if (
    record.kind !== 'rolldown_binding_module_init_metrics' ||
    record.version !== 1 ||
    record.invocationOrdinal !== 1 ||
    record.configuredTokioWorkerThreads !== 18 ||
    record.configuredTokioMaxBlockingThreads !== 4 ||
    !positive(record.runtimeBuildMs) ||
    !nonNegative(record.customRuntimeRegistrationMs) ||
    !positive(record.totalMs)
  ) {
    throw new Error('Binding module initialization record is incomplete or duplicated');
  }
  for (const field of [
    'threadsStartedAfterBuild',
    'threadsStoppedAfterBuild',
    'threadsStartedAfterRegistration',
    'threadsStoppedAfterRegistration',
  ]) {
    if (!Number.isSafeInteger(record[field]) || record[field] < 0) {
      throw new Error(`Binding module initialization has invalid ${field}`);
    }
  }
}

function validateCreateBundlerOptionsMetrics(records, workerCount) {
  const record = only(records, 'createBundlerOptions metrics record');
  if (
    record.kind !== 'rolldown_create_bundler_options_metrics' ||
    record.version !== 1 ||
    !positiveInteger(record.metricsId) ||
    record.measurementClass !== CREATE_MEASUREMENT_CLASS
  ) {
    throw new Error('createBundlerOptions metrics header is invalid');
  }
  const expectedCounts = workerCount
    ? { ordinaryJs: 0, parallelPlaceholders: 1, builtin: 0 }
    : { ordinaryJs: 1, parallelPlaceholders: 0, builtin: 0 };
  if (
    record.pluginCounts?.inputBeforeOutputOptionsHook !== 1 ||
    record.pluginCounts?.outputBeforeOutputOptionsHook !== 0 ||
    Object.entries(expectedCounts).some(([name, count]) => record.pluginCounts?.[name] !== count) ||
    !Array.isArray(record.pluginBinding) ||
    record.pluginBinding.length !== 1
  ) {
    throw new Error('createBundlerOptions plugin counts are not the one-plugin MDX lane');
  }
  const orderedStages = validateOrderedStages(
    record.timeline?.createBundlerOptionsStartedAt,
    record.timeline?.createBundlerOptionsFinishedAt,
    record.stages,
    [
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
    ],
    'createBundlerOptions',
  );
  const plugin = record.pluginBinding[0];
  if (
    plugin.pluginIndex !== 0 ||
    plugin.pluginName !== (workerCount ? 'anonymous-0' : 'cloudflare-mdx') ||
    plugin.pluginKind !== (workerCount ? 'parallel-placeholder' : 'ordinary-js')
  ) {
    throw new Error('createBundlerOptions plugin identity is invalid');
  }
  const pluginStage = validateStage(plugin.stage, 'createBundlerOptions plugin binding');
  const inputBindingStage = orderedStages.get('bindingifyInputOptions');
  if (
    pluginStage.startedAt.monotonicMs < inputBindingStage.startedAt.monotonicMs ||
    pluginStage.finishedAt.monotonicMs > inputBindingStage.finishedAt.monotonicMs
  ) {
    throw new Error('createBundlerOptions plugin binding is outside bindingifyInputOptions');
  }
  if (record.resources?.scope !== CREATE_RESOURCE_SCOPE) {
    throw new Error('createBundlerOptions whole-process resource scope changed');
  }
  const resourceNames = [
    'afterMetricsRuntimeSetupAtCreateBundlerOptionsStart',
    'afterPluginNormalization',
    'afterParallelPoolInitialization',
    'afterInputBindingification',
    'afterOutputBindingification',
    'atCreateBundlerOptionsFinish',
  ];
  const resources = new Map();
  let previousResourceTime = record.timeline.createBundlerOptionsStartedAt.monotonicMs;
  const createClockOrigin = timestampClockOrigin(record.timeline.createBundlerOptionsStartedAt);
  for (const name of resourceNames) {
    const snapshot = validateProcessMetricsSnapshot(
      record.resources?.[name],
      `createBundlerOptions ${name}`,
      PROCESS_METRICS_SCOPE,
    );
    assertTimestampClockOrigin(snapshot.capturedAt, createClockOrigin, `createBundlerOptions ${name}`);
    if (
      snapshot.capturedAt.monotonicMs < previousResourceTime ||
      snapshot.capturedAt.monotonicMs >
        record.timeline.createBundlerOptionsFinishedAt.monotonicMs
    ) {
      throw new Error(`createBundlerOptions resource order is invalid at ${name}`);
    }
    previousResourceTime = snapshot.capturedAt.monotonicMs;
    resources.set(name, snapshot);
  }
  for (const [resourceName, precedingStageName, followingStageName] of [
    [
      'afterMetricsRuntimeSetupAtCreateBundlerOptionsStart',
      'metricsRuntimeSetup',
      'normalizeInputPluginOption',
    ],
    ['afterPluginNormalization', 'normalizePluginObjects', 'parallelPoolInitialization'],
    ['afterParallelPoolInitialization', 'parallelPoolInitialization', 'pluginContextConstruction'],
    ['afterInputBindingification', 'bindingifyInputOptions', 'bindingifyOutputOptions'],
    ['afterOutputBindingification', 'bindingifyOutputOptions', undefined],
    ['atCreateBundlerOptionsFinish', 'bindingifyOutputOptions', undefined],
  ]) {
    const capturedAt = resources.get(resourceName).capturedAt.monotonicMs;
    if (
      capturedAt < orderedStages.get(precedingStageName).finishedAt.monotonicMs ||
      (followingStageName !== undefined &&
        capturedAt > orderedStages.get(followingStageName).startedAt.monotonicMs)
    ) {
      throw new Error(`createBundlerOptions resource containment is invalid at ${resourceName}`);
    }
  }
  if (
    !Array.isArray(record.isolationLimits) ||
    record.isolationLimits.length !== 5 ||
    record.isolationLimits.some((value) => typeof value !== 'string' || value.length === 0)
  ) {
    throw new Error('createBundlerOptions isolation limits are missing');
  }
  return record;
}

function validateNativePluginRegistrationMetrics(records, workerCount) {
  const record = only(records, 'native plugin registration metrics record');
  if (
    record.kind !== 'rolldown_native_plugin_registration_metrics' ||
    record.version !== 1 ||
    !positiveInteger(record.metricsId) ||
    record.boundary !== NATIVE_BOUNDARY ||
    record.scope !== NATIVE_SCOPE ||
    !sameObject(record.stageRelationships, NATIVE_STAGE_RELATIONSHIPS) ||
    !nonNegative(record.nativeNormalizationTotalMs) ||
    !nonNegative(record.nativePluginMaterializationMs) ||
    record.parallelRegistryPresent !== Boolean(workerCount) ||
    record.workerManagerWorkerCount !== workerCount ||
    record.ordinaryJsPluginCount !== (workerCount ? 0 : 1) ||
    record.parallelJsPluginCount !== (workerCount ? 1 : 0) ||
    record.builtinPluginCount !== 0 ||
    !Array.isArray(record.plugins) ||
    record.plugins.length !== 1
  ) {
    throw new Error('Native plugin registration metrics are invalid');
  }
  for (const name of [
    'registryTransferMs',
    'workerManagerConstructionMs',
    'bindingOptionNormalizationMs',
    'pluginMaterializationMs',
  ]) {
    if (!nonNegative(record.stages?.[name])) {
      throw new Error(`Native plugin registration stage ${name} is invalid`);
    }
  }
  if (
    record.stages.pluginMaterializationMs !== record.nativePluginMaterializationMs ||
    record.stages.pluginMaterializationMs > record.stages.bindingOptionNormalizationMs ||
    record.stages.registryTransferMs +
        record.stages.workerManagerConstructionMs +
        record.stages.bindingOptionNormalizationMs >
      record.nativeNormalizationTotalMs + 1e-3
  ) {
    throw new Error('Native plugin registration stage containment is invalid');
  }
  const plugin = record.plugins[0];
  if (
    plugin.index !== 0 ||
    plugin.name !== 'cloudflare-mdx' ||
    plugin.kind !== (workerCount ? 'parallel-js' : 'ordinary-js') ||
    !nonNegative(plugin.materializationMs)
  ) {
    throw new Error('Native plugin registration identity is invalid');
  }
  const pluginMaterializationSum = record.plugins.reduce(
    (sum, value) => sum + value.materializationMs,
    0,
  );
  if (
    plugin.materializationMs > record.nativePluginMaterializationMs + 1e-3 ||
    pluginMaterializationSum > record.nativePluginMaterializationMs + 1e-3
  ) {
    throw new Error('Native per-plugin materialization is outside its measured container');
  }
  return record;
}

function validatePluginIndexCorrelation(createMetrics, nativeMetrics, lifecycle) {
  const createIndexes = createMetrics.pluginBinding.map(({ pluginIndex }) => pluginIndex);
  const nativeIndexes = nativeMetrics.plugins.map(({ index }) => index);
  if (!same(createIndexes, nativeIndexes)) {
    throw new Error('JavaScript binding and native materialization plugin indexes disagree');
  }
  if (lifecycle) {
    for (const record of [lifecycle.initialization, lifecycle.termination]) {
      if (
        record.metricsId !== createMetrics.metricsId ||
        !same(record.parallelPluginIndexes, createIndexes)
      ) {
        throw new Error('createBundlerOptions/native/lifecycle metrics correlation failed');
      }
    }
  }
}

function validateMainResources(resources) {
  if (
    resources?.schema !== 1 ||
    !Array.isArray(resources.rss?.samples) ||
    resources.rss.samples.length < 2 ||
    !positive(resources.rss.maximumBytes) ||
    !positive(resources.rss.retainedBytes) ||
    !resources.startedAt?.mainIsolateHeapStatistics ||
    !resources.finishedAt?.mainIsolateHeapStatistics ||
    !resources.deltas?.mainEventLoopUtilization ||
    !resources.gc ||
    !Number.isSafeInteger(resources.gc.count) ||
    resources.gc.count < 0
  ) {
    throw new Error('Main CPU/RSS/heap/ELU/GC attribution is missing or empty');
  }
  validateCpu(resources.deltas.processCpuDeltaMicros, 'process CPU');
  validateCpu(resources.deltas.mainThreadCpuDeltaMicros, 'main-thread CPU');
  validateCpu(resources.deltas.residualProcessCpuDeltaMicros, 'process-minus-main CPU');
  if (!positive(sumCpu(resources.deltas.processCpuDeltaMicros))) {
    throw new Error('Attribution process CPU delta is empty');
  }
}

function validateJsMetrics(metrics, expectedWorkers) {
  if (
    metrics?.schema !== 2 ||
    metrics.factoryCalls !== expectedWorkers ||
    metrics.handlerCalls !== ATTRIBUTION_SCALE ||
    metrics.distinctHandlerIds !== ATTRIBUTION_SCALE ||
    metrics.active !== 0 ||
    metrics.unknownIdCalls !== 0 ||
    metrics.missingHandlerIds?.length !== 0 ||
    metrics.duplicateHandlerIds?.length !== 0 ||
    metrics.clockAnchors?.length !== expectedWorkers ||
    metrics.kernelTimeline?.completedEntries !== ATTRIBUTION_SCALE ||
    !positive(metrics.kernelTimeline.spanMs) ||
    metrics.timelineEntries?.length !== ATTRIBUTION_SCALE ||
    metrics.kernelTimeline.perWorker?.length !== expectedWorkers
  ) {
    throw new Error('JavaScript transform attribution is missing, duplicated, or empty');
  }
  const expectedIndexes = range(expectedWorkers);
  if (
    !same(metrics.clockAnchors.map(({ worker }) => worker).sort((a, b) => a - b), expectedIndexes) ||
    !same(metrics.kernelTimeline.perWorker.map(({ worker }) => worker).sort((a, b) => a - b), expectedIndexes)
  ) {
    throw new Error('JavaScript worker records are not a complete worker-index set');
  }
  const ids = new Set();
  for (const entry of metrics.timelineEntries) {
    if (
      typeof entry.id !== 'string' ||
      entry.id.length === 0 ||
      entry.hits !== 1 ||
      !nonNegative(entry.serviceMs) ||
      !expectedIndexes.includes(entry.worker) ||
      BigInt(entry.kernelStartNs) <= 0n ||
      BigInt(entry.kernelEndNs) < BigInt(entry.kernelStartNs) ||
      ids.has(entry.id)
    ) {
      throw new Error('JavaScript per-module attribution contains an invalid or duplicate entry');
    }
    ids.add(entry.id);
  }
  for (const worker of metrics.kernelTimeline.perWorker) {
    if (!Number.isSafeInteger(worker.calls) || worker.calls <= 0 || !positive(worker.busyMs)) {
      throw new Error(`JavaScript worker ${worker.worker} has no sustained service record`);
    }
  }
  return metrics;
}

function validateLifecycle(records, workerCount, metricsId) {
  if (!Array.isArray(records) || records.length !== 2) {
    throw new Error(`worker-${workerCount} needs exactly initialization and termination records`);
  }
  const initialization = records.find(
    ({ kind }) => kind === 'rolldown_parallel_plugin_init_metrics',
  );
  const termination = records.find(
    ({ kind }) => kind === 'rolldown_parallel_plugin_termination_metrics',
  );
  if (!initialization || !termination) throw new Error('Worker lifecycle records are incomplete');
  const lifecycleSnapshots = {};
  for (const [label, record] of [
    ['initialization', initialization],
    ['termination', termination],
  ]) {
    if (
      record.version !== 1 ||
      record.metricsId !== metricsId ||
      record.workerCount !== workerCount ||
      record.pluginCount !== 1 ||
      !same(record.parallelPluginIndexes, [0]) ||
      !nonNegative(
        label === 'initialization' ? record.poolInitializationMs : record.poolTerminationMs,
      ) ||
      !positive(record.rssBeforeBytes) ||
      !positive(record.rssAfterBytes) ||
      record.rssScope !== LIFECYCLE_RSS_SCOPE ||
      !Array.isArray(record.workers) ||
      record.workers.length !== workerCount
    ) {
      throw new Error(`Worker ${label} lifecycle record is missing or empty`);
    }
    if (!same(record.workers.map(({ threadNumber }) => threadNumber).sort((a, b) => a - b), range(workerCount))) {
      throw new Error(`Worker ${label} thread-number set is incomplete`);
    }
    lifecycleSnapshots[label] = validateLifecycleProcessSnapshots(record.processSnapshots, label);
  }
  if (
    !same(
      lifecycleSnapshots.initialization.get('allWorkersReady').raw,
      lifecycleSnapshots.termination.get('allWorkersReady').raw,
    ) ||
    !same(
      lifecycleSnapshots.initialization.get('resourceBaselineBeforeBuild').raw,
      lifecycleSnapshots.termination.get('resourceBaselineBeforeBuild').raw,
    )
  ) {
    throw new Error('Initialization and termination lifecycle baselines disagree');
  }
  const initSnapshots = lifecycleSnapshots.initialization;
  const termSnapshots = lifecycleSnapshots.termination;
  if (
    initialization.rssBeforeBytes !==
      initSnapshots.get('beforeWorkerPool').raw.processMemoryUsageBytes.rss ||
    initialization.rssAfterBytes !==
      initSnapshots.get('resourceBaselineBeforeBuild').raw.processMemoryUsageBytes.rss ||
    termination.rssBeforeBytes !==
      termSnapshots.get('beforeWorkerSnapshots').raw.processMemoryUsageBytes.rss ||
    termination.rssAfterBytes !==
      termSnapshots.get('afterTermination').raw.processMemoryUsageBytes.rss
  ) {
    throw new Error('Lifecycle RSS totals do not match their whole-process snapshots');
  }
  const mainClockOrigin = timestampClockOrigin(
    initSnapshots.get('beforeWorkerPool').capturedAt,
  );
  const initWorkers = new Map();
  for (const worker of initialization.workers) {
    if (
      !positive(worker.mainReadyMs) ||
      !worker.mainTimeline ||
      worker.workerBootstrap?.kind !== 'rolldown_parallel_plugin_worker_bootstrap_metrics' ||
      worker.workerBootstrap?.version !== 1 ||
      worker.workerBootstrap?.metricsId !== metricsId ||
      worker.workerBootstrap?.threadNumber !== worker.threadNumber ||
      !worker.workerBootstrap?.timeline ||
      worker.workerBootstrap?.launcher?.kind !==
        'rolldown_parallel_plugin_worker_launcher_metrics' ||
      worker.workerBootstrap?.launcher?.version !== 1 ||
      worker.workerBootstrap?.launcher?.metricsId !== metricsId ||
      worker.workerBootstrap.plugins?.length !== 1 ||
      !worker.workerBootstrap.workerLocalAtReady?.heapStatistics ||
      !worker.workerBootstrap.workerLocalAtReady?.eventLoopUtilization ||
      !worker.workerBootstrap.workerLocalAtReady?.gc
    ) {
      throw new Error(`Worker ${worker.threadNumber} readiness attribution is incomplete`);
    }
    const mainTimeline = validateMainWorkerTimeline(
      worker.mainTimeline,
      worker.mainReadyMs,
      mainClockOrigin,
      initSnapshots,
      worker.threadNumber,
    );
    const bootstrap = validateWorkerBootstrap(worker.workerBootstrap, worker.threadNumber);
    if (
      Math.abs(bootstrap.mainTimeOriginEpochMs - mainClockOrigin) > 1e-3 ||
      bootstrap.launcherEntryAt.epochMs < mainTimeline.constructorStartedAt.epochMs ||
      bootstrap.readyAt.epochMs > mainTimeline.readyMessageAt.epochMs
    ) {
      throw new Error(`Worker ${worker.threadNumber} bootstrap is outside its main ready window`);
    }
    const resourcesAtPoolReady = validateWorkerResource(
      worker.resourcesAtPoolReady,
      `worker ${worker.threadNumber} ready`,
      mainClockOrigin,
    );
    if (
      resourcesAtPoolReady.startedAt.monotonicMs <
        initSnapshots.get('allWorkersReady').capturedAt.monotonicMs ||
      resourcesAtPoolReady.finishedAt.monotonicMs >
        initSnapshots.get('resourceBaselineBeforeBuild').capturedAt.monotonicMs
    ) {
      throw new Error(`Worker ${worker.threadNumber} pool-ready capture is outside lifecycle snapshots`);
    }
    initWorkers.set(worker.threadNumber, {
      raw: worker,
      mainTimeline,
      bootstrap,
      resourcesAtPoolReady,
    });
  }
  const termWorkers = new Map();
  for (const worker of termination.workers) {
    const initialized = initWorkers.get(worker.threadNumber);
    if (!initialized || !same(worker.resourcesAtPoolReady, initialized.raw.resourcesAtPoolReady)) {
      throw new Error(`Worker ${worker.threadNumber} changed its pool-ready baseline`);
    }
    const resourcesAtPoolReady = validateWorkerResource(
      worker.resourcesAtPoolReady,
      `worker ${worker.threadNumber} baseline`,
      mainClockOrigin,
    );
    const resourcesBeforeTermination = validateWorkerResource(
      worker.resourcesBeforeTermination,
      `worker ${worker.threadNumber} pre-termination`,
      mainClockOrigin,
    );
    if (
      resourcesBeforeTermination.startedAt.monotonicMs <
        termSnapshots.get('beforeWorkerSnapshots').capturedAt.monotonicMs ||
      resourcesBeforeTermination.finishedAt.monotonicMs >
        termSnapshots.get('afterWorkerSnapshots').capturedAt.monotonicMs
    ) {
      throw new Error(`Worker ${worker.threadNumber} pre-termination capture is outside lifecycle snapshots`);
    }
    validateWorkerLocalMetrics(
      worker.workerLocalBeforeTermination,
      `worker ${worker.threadNumber} local pre-termination`,
    );
    termWorkers.set(worker.threadNumber, {
      resourcesAtPoolReady,
      resourcesBeforeTermination,
    });
  }
  validateCpuWindow(
    initialization.cpuWindows,
    'initialization CPU',
    workerCount,
    false,
    initSnapshots,
    initWorkers,
  );
  validateCpuWindow(
    termination.cpuWindows,
    'termination CPU',
    workerCount,
    true,
    termSnapshots,
    initWorkers,
    termWorkers,
  );
  return { initialization, termination };
}

function validateCpuWindow(
  cpu,
  label,
  workerCount,
  needsInner,
  lifecycleSnapshots,
  initializationWorkers,
  terminationWorkers,
) {
  const expectedPhase = needsInner
    ? 'lifetime-through-pre-termination-snapshot'
    : 'initialization';
  if (
    cpu?.measurementClass !== CPU_WINDOW_CLASS ||
    cpu.phase !== expectedPhase ||
    cpu.completeWorkerCoverage !== true ||
    !Array.isArray(cpu.workerSamples) ||
    cpu.workerSamples.length !== workerCount ||
    cpu.scope !== CPU_WINDOW_SCOPE
  ) {
    throw new Error(`${label} lacks honest asynchronous CPU bounds`);
  }
  const outer = validateCpuProcessWindow(cpu.outerProcessWindow, `${label} outer process`);
  const inner = needsInner
    ? validateCpuProcessWindow(cpu.innerProcessWindow, `${label} inner process`)
    : undefined;
  if (!needsInner && cpu.innerProcessWindow !== undefined) {
    throw new Error(`${label} unexpectedly has an inner window`);
  }
  const expectedOuterStart = lifecycleSnapshots.get(
    needsInner ? 'allWorkersReady' : 'beforeWorkerPool',
  ).capturedAt;
  const expectedOuterFinish = lifecycleSnapshots.get(
    needsInner ? 'afterWorkerSnapshots' : 'resourceBaselineBeforeBuild',
  ).capturedAt;
  if (
    !sameTimestamp(outer.startedAt, expectedOuterStart) ||
    !sameTimestamp(outer.finishedAt, expectedOuterFinish) ||
    (inner &&
      (!sameTimestamp(
        inner.startedAt,
        lifecycleSnapshots.get('resourceBaselineBeforeBuild').capturedAt,
      ) ||
        !sameTimestamp(
          inner.finishedAt,
          lifecycleSnapshots.get('beforeWorkerSnapshots').capturedAt,
        )))
  ) {
    throw new Error(`${label} process windows do not match lifecycle snapshots`);
  }
  if (
    inner &&
    (inner.startedAt.monotonicMs < outer.startedAt.monotonicMs ||
      inner.finishedAt.monotonicMs > outer.finishedAt.monotonicMs)
  ) {
    throw new Error(`${label} inner process window is outside the outer window`);
  }
  const mainClockOrigin = timestampClockOrigin(outer.startedAt);
  const seen = new Set();
  const sum = { user: 0, system: 0 };
  for (const sample of cpu.workerSamples) {
    const initialized = initializationWorkers.get(sample.threadNumber);
    const terminated = terminationWorkers?.get(sample.threadNumber);
    if (
      sample.ok !== true ||
      !Number.isSafeInteger(sample.threadNumber) ||
      sample.threadNumber < 0 ||
      sample.threadNumber >= workerCount ||
      seen.has(sample.threadNumber) ||
      sample.measurementClass !== (needsInner ? TERM_CPU_SAMPLE_CLASS : INIT_CPU_SAMPLE_CLASS) ||
      sample.relationToProcessWindows !== (needsInner ? TERM_CPU_RELATION : INIT_CPU_RELATION) ||
      !initialized ||
      (needsInner && !terminated)
    ) {
      throw new Error(`${label} has an invalid worker CPU bound`);
    }
    seen.add(sample.threadNumber);
    const startBounds = validateTimestampBounds(sample.startBounds, `${label} worker start`);
    const endBounds = validateTimestampBounds(sample.endBounds, `${label} worker end`);
    for (const [name, timestamp] of [
      ['start earliest', startBounds.earliestAt],
      ['start latest', startBounds.latestAt],
      ['end earliest', endBounds.earliestAt],
      ['end latest', endBounds.latestAt],
    ]) {
      assertTimestampClockOrigin(timestamp, mainClockOrigin, `${label} worker ${name}`);
    }
    if (
      startBounds.earliestAt.monotonicMs < outer.startedAt.monotonicMs ||
      endBounds.latestAt.monotonicMs > outer.finishedAt.monotonicMs ||
      endBounds.earliestAt.monotonicMs < startBounds.latestAt.monotonicMs ||
      (inner &&
        (startBounds.latestAt.monotonicMs > inner.startedAt.monotonicMs ||
          endBounds.earliestAt.monotonicMs < inner.finishedAt.monotonicMs))
    ) {
      throw new Error(`${label} worker CPU bounds violate their declared process windows`);
    }
    const expectedStart = needsInner
      ? terminated.resourcesAtPoolReady
      : {
          startedAt: initialized.mainTimeline.constructorStartedAt,
          finishedAt: initialized.mainTimeline.onlineAt,
        };
    const expectedEnd = needsInner
      ? terminated.resourcesBeforeTermination
      : initialized.resourcesAtPoolReady;
    if (
      !sameTimestamp(startBounds.earliestAt, expectedStart.startedAt) ||
      !sameTimestamp(startBounds.latestAt, expectedStart.finishedAt) ||
      !sameTimestamp(endBounds.earliestAt, expectedEnd.startedAt) ||
      !sameTimestamp(endBounds.latestAt, expectedEnd.finishedAt) ||
      startBounds.meaning !==
        (needsInner
          ? 'the first asynchronous Worker.cpuUsage read completes within these bounds'
          : 'Node.js does not expose the exact Worker.cpuUsage counter start instant') ||
      endBounds.meaning !== 'the asynchronous Worker.cpuUsage read completes within these bounds'
    ) {
      throw new Error(`${label} worker CPU bounds do not match resource captures`);
    }
    validateCpu(sample.cpuDeltaMicros, `${label} worker CPU`);
    const expectedCpu = needsInner
      ? subtractCpuUsage(
          terminated.resourcesBeforeTermination.cpuUsageMicros,
          terminated.resourcesAtPoolReady.cpuUsageMicros,
        )
      : initialized.resourcesAtPoolReady.cpuUsageMicros;
    if (!same(sample.cpuDeltaMicros, expectedCpu)) {
      throw new Error(`${label} worker CPU delta disagrees with its bounded captures`);
    }
    sum.user += sample.cpuDeltaMicros.user;
    sum.system += sample.cpuDeltaMicros.system;
  }
  validateCpu(cpu.summedObservedWorkerThreadCpuMicros, `${label} worker sum`);
  if (!same(sum, cpu.summedObservedWorkerThreadCpuMicros)) {
    throw new Error(`${label} worker CPU sum is inconsistent`);
  }
}

function validateLifecycleProcessSnapshots(processSnapshots, label) {
  if (processSnapshots?.scope !== LIFECYCLE_SNAPSHOT_SCOPE) {
    throw new Error(`${label} lifecycle process snapshot scope changed`);
  }
  const names =
    label === 'initialization'
      ? ['beforeWorkerPool', 'allWorkersReady', 'resourceBaselineBeforeBuild']
      : [
          'allWorkersReady',
          'resourceBaselineBeforeBuild',
          'beforeWorkerSnapshots',
          'afterWorkerSnapshots',
          'afterTermination',
        ];
  assertExactKeys(processSnapshots, ['scope', ...names], `${label} lifecycle process snapshots`);
  const validated = new Map();
  let previous = -Infinity;
  let clockOrigin;
  for (const name of names) {
    const snapshot = validateLifecycleProcessSnapshot(
      processSnapshots[name],
      `${label} lifecycle ${name}`,
    );
    clockOrigin ??= timestampClockOrigin(snapshot.capturedAt);
    assertTimestampClockOrigin(snapshot.capturedAt, clockOrigin, `${label} lifecycle ${name}`);
    if (snapshot.capturedAt.monotonicMs < previous) {
      throw new Error(`${label} lifecycle process snapshots regress at ${name}`);
    }
    previous = snapshot.capturedAt.monotonicMs;
    validated.set(name, snapshot);
  }
  return validated;
}

function validateLifecycleProcessSnapshot(snapshot, label) {
  if (!sameObject(snapshot?.scope, LIFECYCLE_PROCESS_SCOPE)) {
    throw new Error(`${label} whole-process RSS scope changed`);
  }
  const capturedAt = validateTimestamp(snapshot.capturedAt, `${label} capture`);
  validateCpu(snapshot.processCpuUsageMicros, `${label} process CPU`);
  validateCpu(snapshot.mainThreadCpuUsageMicros, `${label} main CPU`);
  if (
    !isRecord(snapshot.processResourceUsage) ||
    !positive(snapshot.processMemoryUsageBytes?.rss) ||
    !positive(snapshot.mainIsolateHeapStatistics?.heap_size_limit) ||
    !isRecord(snapshot.mainEventLoopUtilization)
  ) {
    throw new Error(`${label} process resource snapshot is incomplete`);
  }
  validateGc(snapshot.mainIsolateGc, `${label} main GC`);
  return { raw: snapshot, capturedAt };
}

function validateMainWorkerTimeline(timeline, mainReadyMs, clockOrigin, snapshots, threadNumber) {
  assertExactKeys(
    timeline,
    ['constructorStartedAt', 'constructorReturnedAt', 'onlineAt', 'readyMessageAt'],
    `worker ${threadNumber} main timeline`,
  );
  const values = Object.fromEntries(
    Object.keys(timeline).map((name) => [
      name,
      validateTimestamp(timeline[name], `worker ${threadNumber} main ${name}`),
    ]),
  );
  const ordered = [
    values.constructorStartedAt,
    values.constructorReturnedAt,
    values.onlineAt,
    values.readyMessageAt,
  ];
  for (const value of ordered) {
    assertTimestampClockOrigin(value, clockOrigin, `worker ${threadNumber} main timeline`);
  }
  if (
    ordered.some((value, index) => index > 0 && value.monotonicMs < ordered[index - 1].monotonicMs) ||
    Math.abs(
      mainReadyMs -
        (values.readyMessageAt.monotonicMs - values.constructorStartedAt.monotonicMs),
    ) > 1e-6 ||
    values.constructorStartedAt.monotonicMs <
      snapshots.get('beforeWorkerPool').capturedAt.monotonicMs ||
    values.readyMessageAt.monotonicMs >
      snapshots.get('allWorkersReady').capturedAt.monotonicMs
  ) {
    throw new Error(`Worker ${threadNumber} main ready timeline is invalid`);
  }
  return values;
}

function validateWorkerResource(resource, label, clockOrigin) {
  if (
    resource?.ok !== true ||
    !resource.snapshot?.captureStartedAt ||
    !resource.snapshot?.captureFinishedAt ||
    !resource.snapshot?.heapStatistics ||
    !resource.snapshot?.eventLoopUtilization
  ) {
    throw new Error(`${label} CPU/heap/ELU capture failed`);
  }
  const startedAt = validateTimestamp(resource.snapshot.captureStartedAt, `${label} start`);
  const finishedAt = validateTimestamp(resource.snapshot.captureFinishedAt, `${label} finish`);
  assertTimestampClockOrigin(startedAt, clockOrigin, `${label} start`);
  assertTimestampClockOrigin(finishedAt, clockOrigin, `${label} finish`);
  if (
    finishedAt.monotonicMs < startedAt.monotonicMs ||
    !positive(resource.snapshot.heapStatistics.heap_size_limit) ||
    !isRecord(resource.snapshot.eventLoopUtilization)
  ) {
    throw new Error(`${label} resource capture ordering or content is invalid`);
  }
  validateCpu(resource.snapshot.cpuUsageMicros, `${label} CPU`);
  return {
    startedAt,
    finishedAt,
    cpuUsageMicros: resource.snapshot.cpuUsageMicros,
  };
}

function validateWorkerBootstrap(bootstrap, threadNumber) {
  const launcher = bootstrap.launcher;
  if (launcher.scope !== LAUNCHER_SCOPE) {
    throw new Error(`Worker ${threadNumber} launcher scope changed`);
  }
  const launcherTimelineNames = [
    'launcherEntryAt',
    'metricsRuntimeImportStartedAt',
    'metricsRuntimeImportFinishedAt',
    'runtimeAndBindingImportStartedAt',
    'runtimeAndBindingImportFinishedAt',
  ];
  assertExactKeys(launcher.timeline, launcherTimelineNames, `worker ${threadNumber} launcher timeline`);
  const launcherStages = validateOrderedStages(
    launcher.timeline.launcherEntryAt,
    launcher.timeline.runtimeAndBindingImportFinishedAt,
    launcher.stages,
    ['metricsRuntimeImport', 'runtimeAndBindingImport'],
    `worker ${threadNumber} launcher`,
  );
  if (
    !sameTimestamp(
      launcherStages.get('metricsRuntimeImport').startedAt,
      launcher.timeline.metricsRuntimeImportStartedAt,
    ) ||
    !sameTimestamp(
      launcherStages.get('metricsRuntimeImport').finishedAt,
      launcher.timeline.metricsRuntimeImportFinishedAt,
    ) ||
    !sameTimestamp(
      launcherStages.get('runtimeAndBindingImport').startedAt,
      launcher.timeline.runtimeAndBindingImportStartedAt,
    ) ||
    !sameTimestamp(
      launcherStages.get('runtimeAndBindingImport').finishedAt,
      launcher.timeline.runtimeAndBindingImportFinishedAt,
    )
  ) {
    throw new Error(`Worker ${threadNumber} launcher stages disagree with its timeline`);
  }
  const launcherOrigin = timestampClockOrigin(launcher.timeline.launcherEntryAt);
  for (const name of launcherTimelineNames) {
    assertTimestampClockOrigin(
      launcher.timeline[name],
      launcherOrigin,
      `worker ${threadNumber} launcher ${name}`,
    );
  }
  const launcherBefore = validateProcessMetricsSnapshot(
    launcher.resources?.afterMetricsRuntimeImportBeforeRuntimeAndBindingImport,
    `worker ${threadNumber} launcher pre-runtime`,
    LAUNCHER_PROCESS_SCOPE,
  );
  const launcherAfter = validateProcessMetricsSnapshot(
    launcher.resources?.afterRuntimeAndBindingImport,
    `worker ${threadNumber} launcher post-runtime`,
    LAUNCHER_PROCESS_SCOPE,
  );
  for (const [label, value] of [
    ['pre-runtime', launcherBefore],
    ['post-runtime', launcherAfter],
  ]) {
    assertTimestampClockOrigin(
      value.capturedAt,
      launcherOrigin,
      `worker ${threadNumber} launcher ${label}`,
    );
  }
  if (
    launcherBefore.capturedAt.monotonicMs <
      launcher.timeline.metricsRuntimeImportFinishedAt.monotonicMs ||
    launcherBefore.capturedAt.monotonicMs >
      launcher.timeline.runtimeAndBindingImportStartedAt.monotonicMs ||
    launcherAfter.capturedAt.monotonicMs <
      launcher.timeline.runtimeAndBindingImportFinishedAt.monotonicMs
  ) {
    throw new Error(`Worker ${threadNumber} launcher resources are outside import stages`);
  }
  if (
    !nonNegative(bootstrap.measuredBootstrapMs) ||
    !nonNegative(bootstrap.registerPluginsMs) ||
    !bootstrap.workerLocalBeforePluginInitialization ||
    !bootstrap.workerLocalAtReady ||
    !Array.isArray(bootstrap.isolationLimits) ||
    bootstrap.isolationLimits.length !== 3 ||
    !bootstrap.isolationLimits.includes(
      'process RSS is shared by the main isolate, every worker isolate, native addon state, and runtime threads; it is not worker ownership',
    )
  ) {
    throw new Error(`Worker ${threadNumber} bootstrap aggregate is incomplete`);
  }
  const clock = bootstrap.clockAlignment;
  if (
    !positive(clock?.workerTimeOriginEpochMs) ||
    !positive(clock?.mainTimeOriginEpochMs) ||
    !Number.isFinite(clock?.workerMinusMainTimeOriginMs) ||
    Math.abs(
      clock.workerMinusMainTimeOriginMs -
        (clock.workerTimeOriginEpochMs - clock.mainTimeOriginEpochMs),
    ) > 1e-6
  ) {
    throw new Error(`Worker ${threadNumber} bootstrap clock alignment is invalid`);
  }
  const timelineNames = [
    'entryAt',
    'launcherEntryAt',
    'runtimeAndBindingImportStartedAt',
    'runtimeAndBindingImportFinishedAt',
    'runtimeEntryAt',
    'bootstrapStartedAt',
    'registerStartedAt',
    'registerFinishedAt',
    'readyAt',
  ];
  assertExactKeys(bootstrap.timeline, timelineNames, `worker ${threadNumber} bootstrap timeline`);
  const timeline = Object.fromEntries(
    timelineNames.map((name) => [
      name,
      validateTimestamp(bootstrap.timeline[name], `worker ${threadNumber} bootstrap ${name}`),
    ]),
  );
  const orderedTimelineNames = timelineNames.slice(1);
  if (
    orderedTimelineNames.some(
      (name, index) =>
        index > 0 &&
        timeline[name].monotonicMs < timeline[orderedTimelineNames[index - 1]].monotonicMs,
    ) ||
    !sameTimestamp(timeline.entryAt, timeline.launcherEntryAt) ||
    Math.abs(
      bootstrap.measuredBootstrapMs -
        (timeline.registerFinishedAt.monotonicMs - timeline.launcherEntryAt.monotonicMs),
    ) > 1e-6 ||
    Math.abs(
      bootstrap.registerPluginsMs -
        (timeline.registerFinishedAt.monotonicMs - timeline.registerStartedAt.monotonicMs),
    ) > 1e-6
  ) {
    throw new Error(`Worker ${threadNumber} bootstrap timeline or aggregate durations are invalid`);
  }
  for (const name of timelineNames) {
    assertTimestampClockOrigin(
      timeline[name],
      clock.workerTimeOriginEpochMs,
      `worker ${threadNumber} bootstrap ${name}`,
    );
  }
  for (const [launcherName, bootstrapName] of [
    ['launcherEntryAt', 'launcherEntryAt'],
    ['runtimeAndBindingImportStartedAt', 'runtimeAndBindingImportStartedAt'],
    ['runtimeAndBindingImportFinishedAt', 'runtimeAndBindingImportFinishedAt'],
  ]) {
    if (!sameTimestamp(launcher.timeline[launcherName], timeline[bootstrapName])) {
      throw new Error(`Worker ${threadNumber} launcher/bootstrap clocks disagree`);
    }
  }
  const plugin = bootstrap.plugins[0];
  if (
    plugin.pluginIndex !== 0 ||
    !nonNegative(plugin.implementationImportMs) ||
    !nonNegative(plugin.factoryMs) ||
    !nonNegative(plugin.bindingifyMs)
  ) {
    throw new Error(`Worker ${threadNumber} bootstrap plugin identity is invalid`);
  }
  const pluginTimelineNames = [
    'importStartedAt',
    'importFinishedAt',
    'factoryStartedAt',
    'factoryFinishedAt',
    'bindingStartedAt',
    'bindingFinishedAt',
  ];
  assertExactKeys(plugin.timeline, pluginTimelineNames, `worker ${threadNumber} plugin timeline`);
  const pluginTimeline = pluginTimelineNames.map((name) =>
    validateTimestamp(plugin.timeline[name], `worker ${threadNumber} plugin ${name}`),
  );
  for (const value of pluginTimeline) {
    assertTimestampClockOrigin(
      value,
      clock.workerTimeOriginEpochMs,
      `worker ${threadNumber} plugin timeline`,
    );
  }
  if (
    pluginTimeline.some(
      (value, index) => index > 0 && value.monotonicMs < pluginTimeline[index - 1].monotonicMs,
    ) ||
    pluginTimeline[0].monotonicMs < timeline.bootstrapStartedAt.monotonicMs ||
    pluginTimeline.at(-1).monotonicMs > timeline.registerStartedAt.monotonicMs
  ) {
    throw new Error(`Worker ${threadNumber} plugin timeline is outside bootstrap registration`);
  }
  for (const [name, durationField] of [
    ['implementationImport', 'implementationImportMs'],
    ['factory', 'factoryMs'],
    ['bindingifyPlugin', 'bindingifyMs'],
  ]) {
    const stage = validateStage(plugin.stages?.[name], `worker ${threadNumber} ${name}`);
    if (Math.abs(stage.durationMs - plugin[durationField]) > 1e-6) {
      throw new Error(`Worker ${threadNumber} ${name} duration disagrees`);
    }
  }
  const stageEndpointPairs = [
    ['implementationImport', 0, 1],
    ['factory', 2, 3],
    ['bindingifyPlugin', 4, 5],
  ];
  for (const [name, startIndex, finishIndex] of stageEndpointPairs) {
    const stage = plugin.stages[name];
    if (
      !sameTimestamp(stage.startedAt, pluginTimeline[startIndex]) ||
      !sameTimestamp(stage.finishedAt, pluginTimeline[finishIndex])
    ) {
      throw new Error(`Worker ${threadNumber} ${name} stage endpoints disagree`);
    }
  }
  const workerLocalBefore = validateWorkerLocalMetrics(
    bootstrap.workerLocalBeforePluginInitialization,
    `worker ${threadNumber} local before plugin initialization`,
  );
  const workerLocalReady = validateWorkerLocalMetrics(
    bootstrap.workerLocalAtReady,
    `worker ${threadNumber} local at ready`,
  );
  for (const [name, value] of [
    ['before plugin initialization', workerLocalBefore],
    ['at ready', workerLocalReady],
  ]) {
    assertTimestampClockOrigin(
      value.capturedAt,
      clock.workerTimeOriginEpochMs,
      `worker ${threadNumber} local ${name}`,
    );
  }
  if (
    workerLocalBefore.capturedAt.monotonicMs < timeline.bootstrapStartedAt.monotonicMs ||
    workerLocalBefore.capturedAt.monotonicMs > pluginTimeline[0].monotonicMs ||
    workerLocalReady.capturedAt.monotonicMs < timeline.registerFinishedAt.monotonicMs ||
    workerLocalReady.capturedAt.monotonicMs > timeline.readyAt.monotonicMs ||
    workerLocalReady.capturedAt.monotonicMs < workerLocalBefore.capturedAt.monotonicMs
  ) {
    throw new Error(`Worker ${threadNumber} local resource snapshots are outside bootstrap`);
  }
  return {
    launcherEntryAt: timeline.launcherEntryAt,
    readyAt: timeline.readyAt,
    mainTimeOriginEpochMs: clock.mainTimeOriginEpochMs,
  };
}

function validateOrderedStages(start, finish, stages, names, label) {
  const outerStart = validateTimestamp(start, `${label} start`);
  const outerFinish = validateTimestamp(finish, `${label} finish`);
  const clockOrigin = timestampClockOrigin(outerStart);
  assertTimestampClockOrigin(outerFinish, clockOrigin, `${label} finish`);
  assertExactKeys(stages, names, `${label} stages`);
  let previous = outerStart.monotonicMs;
  const validated = new Map();
  for (const name of names) {
    const stage = validateStage(stages?.[name], `${label} ${name}`);
    if (
      stage.startedAt.monotonicMs < previous ||
      stage.finishedAt.monotonicMs > outerFinish.monotonicMs
    ) {
      throw new Error(`${label} stage ${name} is outside its ordered window`);
    }
    assertTimestampClockOrigin(stage.startedAt, clockOrigin, `${label} ${name} start`);
    assertTimestampClockOrigin(stage.finishedAt, clockOrigin, `${label} ${name} finish`);
    previous = stage.finishedAt.monotonicMs;
    validated.set(name, stage);
  }
  return validated;
}

function validateStage(stage, label) {
  const startedAt = validateTimestamp(stage?.startedAt, `${label} start`);
  const finishedAt = validateTimestamp(stage?.finishedAt, `${label} finish`);
  if (
    finishedAt.monotonicMs < startedAt.monotonicMs ||
    !nonNegative(stage?.durationMs) ||
    Math.abs(stage.durationMs - (finishedAt.monotonicMs - startedAt.monotonicMs)) > 1e-6
  ) {
    throw new Error(`${label} duration is invalid`);
  }
  return { startedAt, finishedAt, durationMs: stage.durationMs };
}

function validateTimestamp(timestamp, label) {
  if (!nonNegative(timestamp?.monotonicMs) || !nonNegative(timestamp?.epochMs)) {
    throw new Error(`${label} timestamp is invalid`);
  }
  return timestamp;
}

function validateTimestampBounds(bounds, label) {
  const earliest = validateTimestamp(bounds?.earliestAt, `${label} earliest`);
  const latest = validateTimestamp(bounds?.latestAt, `${label} latest`);
  if (latest.monotonicMs < earliest.monotonicMs || typeof bounds?.meaning !== 'string') {
    throw new Error(`${label} bounds are invalid`);
  }
  return { earliestAt: earliest, latestAt: latest, meaning: bounds.meaning };
}

function validateCpuProcessWindow(window, label) {
  const startedAt = validateTimestamp(window?.startedAt, `${label} start`);
  const finishedAt = validateTimestamp(window?.finishedAt, `${label} finish`);
  if (finishedAt.monotonicMs < startedAt.monotonicMs) {
    throw new Error(`${label} regresses`);
  }
  validateCpu(window.processCpuDeltaMicros, `${label} process CPU`);
  validateCpu(window.mainThreadCpuDeltaMicros, `${label} main CPU`);
  return { startedAt, finishedAt };
}

function validateProcessMetricsSnapshot(snapshot, label, expectedScope) {
  if (!sameObject(snapshot?.scope, expectedScope)) {
    throw new Error(`${label} whole-process RSS/isolate scope changed`);
  }
  const capturedAt = validateTimestamp(snapshot?.capturedAt, `${label} capture`);
  validateCpu(snapshot?.processCpuUsageMicros, `${label} process CPU`);
  validateCpu(snapshot?.mainThreadCpuUsageMicros, `${label} main CPU`);
  if (
    !isRecord(snapshot?.processResourceUsage) ||
    !positive(snapshot?.processMemoryUsageBytes?.rss) ||
    !positive(snapshot?.isolateHeapStatistics?.heap_size_limit) ||
    !isRecord(snapshot?.isolateEventLoopUtilization)
  ) {
    throw new Error(`${label} process snapshot is incomplete`);
  }
  validateGc(snapshot.isolateGc, `${label} GC`);
  return { capturedAt };
}

function validateWorkerLocalMetrics(snapshot, label) {
  if (!sameObject(snapshot?.scope, WORKER_LOCAL_SCOPE)) {
    throw new Error(`${label} whole-process RSS/worker-isolate scope changed`);
  }
  const capturedAt = validateTimestamp(snapshot.capturedAt, `${label} capture`);
  validateCpu(snapshot.processCpuUsageMicros, `${label} process CPU`);
  validateCpu(snapshot.threadCpuUsageMicros, `${label} worker CPU`);
  if (
    !positive(snapshot.processMemoryUsageBytes?.rss) ||
    !positive(snapshot.heapStatistics?.heap_size_limit) ||
    !isRecord(snapshot.eventLoopUtilization)
  ) {
    throw new Error(`${label} worker-local resource snapshot is incomplete`);
  }
  validateGc(snapshot.gc, `${label} GC`);
  return { capturedAt };
}

function validateRustTransform(rust, metrics, workerCount) {
  const timeline = rust?.timeline;
  if (
    rust?.kind !== 'rolldown_parallel_plugin_transform_metrics' ||
    rust.version !== 1 ||
    rust.workerCount !== workerCount ||
    rust.wrapperCalls !== ATTRIBUTION_SCALE ||
    rust.permitAcquiredCalls !== ATTRIBUTION_SCALE ||
    rust.completedWrapperCalls !== ATTRIBUTION_SCALE ||
    rust.valueResults !== ATTRIBUTION_SCALE ||
    rust.nullResults !== 0 ||
    rust.errorResults !== 0 ||
    rust.cancelledBeforeAcquire !== 0 ||
    rust.cancelledDuringService !== 0 ||
    rust.permitQueuePending?.current !== 0 ||
    rust.wrapperOutstanding?.current !== 0 ||
    rust.permitInFlight?.current !== 0 ||
    timeline?.calls?.length !== ATTRIBUTION_SCALE ||
    timeline.events?.length !== ATTRIBUTION_SCALE * 3 ||
    timeline.workerServiceNs?.length !== workerCount
  ) {
    throw new Error(`worker-${workerCount} Rust transform record is incomplete`);
  }
  const ids = new Set(metrics.timelineEntries.map(({ id }) => id));
  const calls = new Map();
  for (const [index, call] of timeline.calls.entries()) {
    if (call.ordinal !== index + 1 || !ids.has(call.moduleId) || calls.has(call.ordinal)) {
      throw new Error('Rust call table is reordered, unknown, or duplicated');
    }
    calls.set(call.ordinal, { moduleId: call.moduleId, events: [] });
  }
  let previousAt = -1;
  for (const [index, event] of timeline.events.entries()) {
    if (
      event.sequence !== index ||
      !calls.has(event.callOrdinal) ||
      !Number.isSafeInteger(event.atNs) ||
      event.atNs < previousAt
    ) {
      throw new Error('Rust raw event sequence is missing or non-monotonic');
    }
    previousAt = event.atNs;
    calls.get(event.callOrdinal).events.push(event);
  }
  const jsById = new Map(metrics.timelineEntries.map((entry) => [entry.id, entry]));
  for (const call of calls.values()) {
    const phases = call.events.map(({ phase }) => phase);
    if (!same(phases, ['arrival', 'acquire', 'complete'])) {
      throw new Error(`Rust call ${call.moduleId} lacks arrival/acquire/complete`);
    }
    const [, acquire, complete] = call.events;
    const jsWorker = jsById.get(call.moduleId).worker;
    if (
      acquire.workerIndex !== jsWorker ||
      complete.workerIndex !== jsWorker ||
      !range(workerCount).includes(jsWorker)
    ) {
      throw new Error(`Rust permit and JavaScript thread disagree for ${call.moduleId}`);
    }
  }
  const widths = timeline.timeWeightedWidths;
  if (
    !positive(widths?.observationNs) ||
    !positive(widths.pendingWidthNs) ||
    !positive(widths.outstandingWidthNs) ||
    !positive(widths.inFlightWidthNs)
  ) {
    throw new Error('Rust ready/in-flight width attribution is empty');
  }
  const rate = timeline.completionRateInputs;
  if (
    rate?.completedCalls !== ATTRIBUTION_SCALE ||
    !positive(rate.activitySpanNs) ||
    !positive(rate.completionSpanNs)
  ) {
    throw new Error('Rust completion-throughput inputs are incomplete');
  }
  let serviceCalls = 0;
  for (const worker of timeline.workerServiceNs) {
    if (
      !range(workerCount).includes(worker.workerIndex) ||
      !Number.isSafeInteger(worker.completedCalls) ||
      worker.completedCalls <= 0 ||
      !positive(worker.total) ||
      !positive(worker.min) ||
      !positive(worker.p50) ||
      !positive(worker.p95) ||
      !positive(worker.max)
    ) {
      throw new Error(`Rust worker ${worker.workerIndex} has no service distribution`);
    }
    serviceCalls += worker.completedCalls;
  }
  if (serviceCalls !== ATTRIBUTION_SCALE) throw new Error('Rust worker service calls do not sum to 9,157');
}

function validatePermitThreadBijection(rust, metrics, lifecycle, workerCount) {
  const expected = range(workerCount);
  const permitWorkers = [...new Set(
    rust.timeline.events
      .filter(({ phase }) => phase === 'acquire')
      .map(({ workerIndex }) => workerIndex),
  )].sort((a, b) => a - b);
  const jsWorkers = [...new Set(metrics.timelineEntries.map(({ worker }) => worker))].sort(
    (a, b) => a - b,
  );
  const lifecycleThreads = lifecycle.initialization.workers
    .map(({ threadNumber }) => threadNumber)
    .sort((a, b) => a - b);
  if (!same(permitWorkers, expected) || !same(jsWorkers, expected) || !same(lifecycleThreads, expected)) {
    throw new Error('Rust permit indices and Node.js worker thread numbers are not a bijection');
  }
}

function validateCpu(value, label) {
  if (!nonNegative(value?.user) || !nonNegative(value?.system)) {
    throw new Error(`${label} is missing or negative`);
  }
}

function validateGc(value, label) {
  if (
    !Number.isSafeInteger(value?.count) ||
    value.count < 0 ||
    !nonNegative(value.durationMs) ||
    !nonNegative(value.maxDurationMs) ||
    !isRecord(value.byKind)
  ) {
    throw new Error(`${label} is invalid`);
  }
}

function assertExactKeys(value, expected, label) {
  if (!isRecord(value) || !same([...Object.keys(value)].sort(), [...expected].sort())) {
    throw new Error(`${label} fields do not match the pinned schema`);
  }
}

function sameObject(left, right) {
  return (
    isRecord(left) &&
    isRecord(right) &&
    same(
      Object.fromEntries(Object.entries(left).sort(([a], [b]) => a.localeCompare(b))),
      Object.fromEntries(Object.entries(right).sort(([a], [b]) => a.localeCompare(b))),
    )
  );
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function timestampClockOrigin(timestamp) {
  return timestamp.epochMs - timestamp.monotonicMs;
}

function assertTimestampClockOrigin(timestamp, expected, label) {
  if (Math.abs(timestampClockOrigin(timestamp) - expected) > 1e-3) {
    throw new Error(`${label} clock origin is inconsistent`);
  }
}

function sameTimestamp(left, right) {
  return left?.monotonicMs === right?.monotonicMs && left?.epochMs === right?.epochMs;
}

function subtractCpuUsage(end, start) {
  return { user: end.user - start.user, system: end.system - start.system };
}

function only(values, label) {
  if (!Array.isArray(values) || values.length !== 1 || !values[0]) {
    throw new Error(`Expected exactly one ${label}`);
  }
  return values[0];
}

function sumCpu(value) {
  return value.user + value.system;
}

function subtractCpu(end, start) {
  return { user: end.user - start.user, system: end.system - start.system };
}

function range(length) {
  return Array.from({ length }, (_, index) => index);
}

function positive(value) {
  return Number.isFinite(value) && value > 0;
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function nonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isActiveCiValue(value) {
  return value !== null && value !== undefined && !['', '0', 'false'].includes(String(value).toLowerCase());
}
