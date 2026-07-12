import {
  createInstrumentedKernel,
  createMetricsBuffer,
  readMetrics,
  toCorrectnessCounters,
} from './metrics.mjs';

const entryPaths = ['/fixture/a.mdx', '/fixture/b.mdx'];
const metricsBuffer = createMetricsBuffer(entryPaths.length);
let started = 0;
let release;
const bothStarted = new Promise((resolve) => {
  release = resolve;
});
const createKernel = async () => ({
  async transform(code) {
    started++;
    if (started === 2) release();
    await bothStarted;
    return { code: `${code}:compiled`, map: null };
  },
});
const options = { metricsBuffer, entryPaths };
const [workerZero, workerOne] = await Promise.all([
  createInstrumentedKernel(options, 0, createKernel),
  createInstrumentedKernel(options, 1, createKernel),
]);
await Promise.all([
  workerZero.transform('a', entryPaths[0]),
  workerOne.transform('b', entryPaths[1]),
]);
const metrics = readMetrics(metricsBuffer, entryPaths);
if (
  metrics.schema !== 2 ||
  metrics.handlerCalls !== 2 ||
  metrics.nullMapResults !== 2 ||
  metrics.nonNullMapResults !== 0 ||
  metrics.distinctHandlerIds !== 2 ||
  metrics.duplicateHandlerIds.length !== 0 ||
  metrics.missingHandlerIds.length !== 0 ||
  metrics.kernelTimeline.completedEntries !== 2 ||
  metrics.kernelTimeline.maxConcurrent !== 2 ||
  metrics.kernelTimeline.perWorker.length !== 2 ||
  metrics.timelineEntries.length !== 2 ||
  metrics.clockAnchors.length !== 2
) {
  throw new Error(`Timeline coverage failed: ${JSON.stringify(metrics)}`);
}
const correctnessCounters = toCorrectnessCounters(metrics, entryPaths, '/fixture');
if (
  correctnessCounters.handlerCalls !== 2 ||
  correctnessCounters.nullMapResults !== 2 ||
  correctnessCounters.nonNullMapResults !== 0 ||
  JSON.stringify(correctnessCounters.entries) !==
    JSON.stringify([
      { id: 'a.mdx', hits: 1, worker: 0 },
      { id: 'b.mdx', hits: 1, worker: 1 },
    ]) ||
  /(?:clock|duration|elapsed|serviceMs|kernelStart|kernelEnd)/i.test(
    JSON.stringify(correctnessCounters),
  )
) {
  throw new Error(`Correctness counter projection failed: ${JSON.stringify(correctnessCounters)}`);
}
for (const anchor of metrics.clockAnchors) {
  const lower = BigInt(anchor.epochLowerBoundNs);
  const upper = BigInt(anchor.epochUpperBoundNs);
  const monotonic = BigInt(anchor.monotonicNs);
  if (
    lower <= 0n ||
    upper < lower ||
    monotonic <= 0n ||
    Math.abs(Number(upper - lower) / 1e6 - anchor.uncertaintyMs) > 1e-9
  ) {
    throw new Error(`Invalid hrtime-to-epoch bracket: ${JSON.stringify(anchor)}`);
  }
}
for (const entry of metrics.timelineEntries) {
  const start = BigInt(entry.kernelStartNs);
  const end = BigInt(entry.kernelEndNs);
  if (start <= 0n || end <= start || Math.abs(Number(end - start) / 1e6 - entry.serviceMs) > 1e-9) {
    throw new Error(`Invalid monotonic interval: ${JSON.stringify(entry)}`);
  }
}

let uninstrumentedFactoryCalls = 0;
const uninstrumented = await createInstrumentedKernel({}, 0, async () => {
  uninstrumentedFactoryCalls++;
  return { transform: async (code) => ({ code, map: null }) };
});
await uninstrumented.transform('plain', '/fixture/plain.mdx');
if (uninstrumentedFactoryCalls !== 1 || readMetrics(undefined, []) !== undefined) {
  throw new Error('The wall lane did not remain metrics-free');
}

const correctnessEntryPaths = ['/fixture/correctness.mdx'];
const correctnessBuffer = createMetricsBuffer(1);
const correctnessKernel = await createInstrumentedKernel(
  {
    metricsBuffer: correctnessBuffer,
    entryPaths: correctnessEntryPaths,
    metricsMode: 'correctness-only',
  },
  0,
  createKernel,
);
await correctnessKernel.transform('correctness', correctnessEntryPaths[0]);
const correctnessMetrics = readMetrics(correctnessBuffer, correctnessEntryPaths);
if (
  correctnessMetrics.handlerCalls !== 1 ||
  correctnessMetrics.nullMapResults !== 1 ||
  correctnessMetrics.clockAnchors.length !== 0 ||
  correctnessMetrics.kernelTimeline.completedEntries !== 0 ||
  correctnessMetrics.initializationMsTotal !== 0 ||
  correctnessMetrics.serviceMsTotal !== 0
) {
  throw new Error(`Correctness-only instrumentation sampled clocks: ${JSON.stringify(correctnessMetrics)}`);
}

console.log(
  JSON.stringify({
    valid: true,
    clock: metrics.kernelClock,
    maxConcurrent: metrics.kernelTimeline.maxConcurrent,
    clockAnchorUncertaintyMs: metrics.clockAnchors.map(({ worker, uncertaintyMs }) => ({
      worker,
      uncertaintyMs,
    })),
    workers: metrics.kernelTimeline.perWorker.map(({ worker, calls }) => ({ worker, calls })),
    wallLaneMetrics: false,
    correctnessLaneClockSamples: 0,
  }),
);
