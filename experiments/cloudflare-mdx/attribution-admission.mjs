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
  if (workerCount === 0) {
    if ((run.rustMetrics ?? []).length !== 0 || (run.lifecycleMetrics ?? []).length !== 0) {
      throw new Error('Ordinary attribution unexpectedly emitted worker metrics');
    }
  } else {
    const rust = only(run.rustMetrics, `${run.variant} Rust transform record`);
    const lifecycle = validateLifecycle(run.lifecycleMetrics, workerCount);
    validateRustTransform(rust, metrics, workerCount);
    validatePermitThreadBijection(rust, metrics, lifecycle, workerCount);
  }
  const derived = deriveAttributionSummary(run);
  if (!same(run.attributionSummary, derived)) {
    throw new Error(`${run.variant} attribution summary is absent or not derived from raw records`);
  }
  return run;
}

export function deriveAttributionSummary(run) {
  const workerCount = run.variant === 'ordinary' ? 0 : Number(/^worker-(\d+)$/.exec(run.variant)?.[1]);
  const resources = run.attributionResources;
  const processCpu = resources.deltas.processCpuDeltaMicros;
  const mainCpu = resources.deltas.mainThreadCpuDeltaMicros;
  const termination = (run.lifecycleMetrics ?? []).find(
    ({ kind }) => kind === 'rolldown_parallel_plugin_termination_metrics',
  );
  const workerCpu = (termination?.workers ?? []).map(({ threadNumber, resourcesBeforeTermination }) => ({
    threadNumber,
    ...resourcesBeforeTermination.snapshot.cpuUsageMicros,
  }));
  const measuredWorkerCpu = workerCpu.reduce(
    (sum, value) => ({ user: sum.user + value.user, system: sum.system + value.system }),
    { user: 0, system: 0 },
  );
  const residualCpu = subtractCpu(subtractCpu(processCpu, mainCpu), measuredWorkerCpu);
  const initialization = (run.lifecycleMetrics ?? []).find(
    ({ kind }) => kind === 'rolldown_parallel_plugin_init_metrics',
  );
  const rust = run.rustMetrics?.[0];
  const widths = rust?.timeline?.timeWeightedWidths;
  const completion = rust?.timeline?.completionRateInputs;
  return {
    schema: 1,
    workerCount,
    cpuMicros: {
      process: processCpu,
      mainThread: mainCpu,
      workers: workerCpu,
      measuredWorkersTotal: measuredWorkerCpu,
      residualNativeRuntime: residualCpu,
      residualMeaning:
        'whole-process CPU minus measured Node.js main and worker threads; includes Rust/native/runtime helpers and measurement skew, not Rolldown-only CPU',
    },
    rssBytes: {
      sampledPeak: resources.rss.maximumBytes,
      retained: resources.rss.retainedBytes,
      externalPeak: run.peakRssBytes,
    },
    mainIsolate: {
      heapAtStart: resources.startedAt.mainIsolateHeapStatistics,
      heapAtEnd: resources.finishedAt.mainIsolateHeapStatistics,
      eventLoopUtilization: resources.deltas.mainEventLoopUtilization,
      gc: resources.gc,
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
      cpuUsageMicros: worker.resourcesBeforeTermination.snapshot.cpuUsageMicros,
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

function validateLifecycle(records, workerCount) {
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
  for (const [label, record] of [
    ['initialization', initialization],
    ['termination', termination],
  ]) {
    if (
      record.version !== 1 ||
      record.workerCount !== workerCount ||
      (label === 'initialization' && record.pluginCount !== 1) ||
      !positive(label === 'initialization' ? record.poolInitializationMs : record.poolTerminationMs) ||
      !positive(record.rssBeforeBytes) ||
      !positive(record.rssAfterBytes) ||
      !record.processSnapshots ||
      !Array.isArray(record.workers) ||
      record.workers.length !== workerCount
    ) {
      throw new Error(`Worker ${label} lifecycle record is missing or empty`);
    }
    validateLifecycleCpu(record.cpuAttribution, `${label} CPU`, workerCount);
    if (!same(record.workers.map(({ threadNumber }) => threadNumber).sort((a, b) => a - b), range(workerCount))) {
      throw new Error(`Worker ${label} thread-number set is incomplete`);
    }
  }
  for (const worker of initialization.workers) {
    if (
      !positive(worker.mainReadyMs) ||
      !worker.mainTimeline ||
      !worker.workerBootstrap?.timeline ||
      worker.workerBootstrap.plugins?.length !== 1 ||
      !worker.workerBootstrap.workerLocalAtReady?.heapStatistics ||
      !worker.workerBootstrap.workerLocalAtReady?.eventLoopUtilization ||
      !worker.workerBootstrap.workerLocalAtReady?.gc
    ) {
      throw new Error(`Worker ${worker.threadNumber} readiness attribution is incomplete`);
    }
    validateWorkerResource(worker.resourcesAtPoolReady, `worker ${worker.threadNumber} ready`);
  }
  for (const worker of termination.workers) {
    validateWorkerResource(worker.resourcesAtPoolReady, `worker ${worker.threadNumber} baseline`);
    validateWorkerResource(
      worker.resourcesBeforeTermination,
      `worker ${worker.threadNumber} pre-termination`,
    );
    if (
      !worker.workerLocalBeforeTermination?.heapStatistics ||
      !worker.workerLocalBeforeTermination?.eventLoopUtilization ||
      !worker.workerLocalBeforeTermination?.gc ||
      !Number.isSafeInteger(worker.workerLocalBeforeTermination.gc.count) ||
      worker.workerLocalBeforeTermination.gc.count < 0
    ) {
      throw new Error(`Worker ${worker.threadNumber} local heap/ELU/GC record is incomplete`);
    }
  }
  return { initialization, termination };
}

function validateLifecycleCpu(cpu, label, workerCount) {
  if (cpu?.completeWorkerCoverage !== true) throw new Error(`${label} lacks all ${workerCount} workers`);
  for (const [name, value] of Object.entries({
    process: cpu.processCpuDeltaMicros,
    main: cpu.mainThreadCpuDeltaMicros,
    workers: cpu.measuredWorkerThreadCpuDeltaMicros,
    residual: cpu.residualProcessCpuDeltaMicros,
  })) validateCpu(value, `${label} ${name}`);
}

function validateWorkerResource(resource, label) {
  if (
    resource?.ok !== true ||
    !resource.snapshot?.heapStatistics ||
    !resource.snapshot?.eventLoopUtilization
  ) {
    throw new Error(`${label} CPU/heap/ELU capture failed`);
  }
  validateCpu(resource.snapshot.cpuUsageMicros, `${label} CPU`);
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

function nonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isActiveCiValue(value) {
  return value !== null && value !== undefined && !['', '0', 'false'].includes(String(value).toLowerCase());
}
