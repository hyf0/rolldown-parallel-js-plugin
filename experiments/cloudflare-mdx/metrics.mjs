import { performance } from 'node:perf_hooks';

const INDEX = {
  factoryCalls: 0,
  workerMask: 1,
  initializationNsTotal: 2,
  initializationNsMax: 3,
  handlerCalls: 4,
  inputBytes: 5,
  outputBytes: 6,
  serviceNsTotal: 7,
  serviceNsMax: 8,
  active: 9,
  maxActive: 10,
  unknownIdCalls: 11,
  nullMapResults: 12,
  nonNullMapResults: 13,
  perWorkerCalls: 14,
};
const MAX_WORKERS = 12;
const CLOCK_ANCHOR_EPOCH_BEFORE_NS = INDEX.perWorkerCalls + MAX_WORKERS;
const CLOCK_ANCHOR_MONOTONIC_NS = CLOCK_ANCHOR_EPOCH_BEFORE_NS + MAX_WORKERS;
const CLOCK_ANCHOR_EPOCH_AFTER_NS = CLOCK_ANCHOR_MONOTONIC_NS + MAX_WORKERS;
const FIXED_LENGTH = CLOCK_ANCHOR_EPOCH_AFTER_NS + MAX_WORKERS;

export function createMetricsBuffer(entryCount) {
  return new SharedArrayBuffer(
    BigInt64Array.BYTES_PER_ELEMENT * (FIXED_LENGTH + entryCount * 5),
  );
}

export function readMetrics(buffer, entryPaths) {
  if (!buffer) return undefined;
  const counters = new BigInt64Array(buffer);
  const hitOffset = FIXED_LENGTH;
  const durationOffset = hitOffset + entryPaths.length;
  const workerOffset = durationOffset + entryPaths.length;
  const kernelStartOffset = workerOffset + entryPaths.length;
  const kernelEndOffset = kernelStartOffset + entryPaths.length;
  const entries = entryPaths.map((id, index) => ({
    id,
    hits: Number(counters[hitOffset + index]),
    serviceMs: Number(counters[durationOffset + index]) / 1e6,
    worker: Number(counters[workerOffset + index]) - 1,
    kernelStartNs: counters[kernelStartOffset + index].toString(),
    kernelEndNs: counters[kernelEndOffset + index].toString(),
  }));
  const missingHandlerIds = entries.filter(({ hits }) => hits === 0).map(({ id }) => id);
  const duplicateHandlerIds = entries.filter(({ hits }) => hits > 1).map(({ id }) => id);
  const kernelTimeline = summarizeKernelTimeline(entries);
  const clockAnchors = Array.from({ length: MAX_WORKERS }, (_, worker) => {
    const epochBefore = counters[CLOCK_ANCHOR_EPOCH_BEFORE_NS + worker];
    const monotonic = counters[CLOCK_ANCHOR_MONOTONIC_NS + worker];
    const epochAfter = counters[CLOCK_ANCHOR_EPOCH_AFTER_NS + worker];
    if (epochBefore === 0n || monotonic === 0n || epochAfter === 0n) return undefined;
    if (epochAfter < epochBefore) {
      throw new Error(`Worker ${worker} emitted an inverted hrtime-to-epoch bracket`);
    }
    return {
      worker,
      monotonicNs: monotonic.toString(),
      epochLowerBoundNs: epochBefore.toString(),
      epochUpperBoundNs: epochAfter.toString(),
      epochLowerBoundMs: Number(epochBefore) / 1e6,
      epochUpperBoundMs: Number(epochAfter) / 1e6,
      uncertaintyMs: Number(epochAfter - epochBefore) / 1e6,
      epochSource:
        'performance.timeOrigin + performance.now bracket; unaffected by the fixed application Date',
    };
  }).filter(Boolean);
  return {
    schema: 2,
    factoryCalls: Number(counters[INDEX.factoryCalls]),
    workerMask: counters[INDEX.workerMask].toString(16),
    initializationMsTotal: Number(counters[INDEX.initializationNsTotal]) / 1e6,
    initializationMsMax: Number(counters[INDEX.initializationNsMax]) / 1e6,
    handlerCalls: Number(counters[INDEX.handlerCalls]),
    inputBytes: Number(counters[INDEX.inputBytes]),
    outputBytes: Number(counters[INDEX.outputBytes]),
    serviceMsTotal: Number(counters[INDEX.serviceNsTotal]) / 1e6,
    serviceMsMax: Number(counters[INDEX.serviceNsMax]) / 1e6,
    active: Number(counters[INDEX.active]),
    maxActive: Number(counters[INDEX.maxActive]),
    unknownIdCalls: Number(counters[INDEX.unknownIdCalls]),
    nullMapResults: Number(counters[INDEX.nullMapResults]),
    nonNullMapResults: Number(counters[INDEX.nonNullMapResults]),
    distinctHandlerIds: entries.length - missingHandlerIds.length,
    missingHandlerIds,
    duplicateHandlerIds,
    perWorkerCalls: Array.from(
      counters.slice(INDEX.perWorkerCalls, INDEX.perWorkerCalls + MAX_WORKERS),
      Number,
    ),
    kernelClock:
      'process.hrtime.bigint monotonic nanoseconds shared across Node worker threads, with per-isolate epoch brackets',
    clockAlignment:
      'For monotonic timestamp T and anchor (M, [L,U]), epoch nanoseconds are bounded by [L + (T-M), U + (T-M)]; U-L is the recorded uncertainty.',
    clockAnchors,
    perEntryColumns: [
      'hits',
      'serviceNanoseconds',
      'workerIndexPlusOne',
      'kernelStartMonotonicNanoseconds',
      'kernelEndMonotonicNanoseconds',
    ],
    kernelTimeline,
    timelineEntries: entries,
    slowestEntries: [...entries]
      .sort((left, right) => right.serviceMs - left.serviceMs)
      .slice(0, 50),
  };
}

export async function createInstrumentedKernel(options, threadNumber, createKernel) {
  if (!options.metricsBuffer) return createKernel(options);
  if (!Number.isInteger(threadNumber) || threadNumber < 0 || threadNumber >= MAX_WORKERS) {
    throw new Error(`Invalid Cloudflare MDX worker number: ${threadNumber}`);
  }
  const counters = new BigInt64Array(options.metricsBuffer);
  const entryPaths = options.entryPaths ?? [];
  const entryIndexes = new Map(entryPaths.map((id, index) => [id, index]));
  const hitOffset = FIXED_LENGTH;
  const durationOffset = hitOffset + entryPaths.length;
  const workerOffset = durationOffset + entryPaths.length;
  const kernelStartOffset = workerOffset + entryPaths.length;
  const kernelEndOffset = kernelStartOffset + entryPaths.length;
  const collectTiming = options.metricsMode !== 'correctness-only';
  const epochBefore = collectTiming ? performanceEpochNanoseconds() : undefined;
  const anchorMonotonic = collectTiming ? process.hrtime.bigint() : undefined;
  const epochAfter = collectTiming ? performanceEpochNanoseconds() : undefined;
  if (collectTiming) {
    Atomics.compareExchange(
      counters,
      CLOCK_ANCHOR_EPOCH_BEFORE_NS + threadNumber,
      0n,
      epochBefore,
    );
    Atomics.compareExchange(
      counters,
      CLOCK_ANCHOR_MONOTONIC_NS + threadNumber,
      0n,
      anchorMonotonic,
    );
    Atomics.compareExchange(
      counters,
      CLOCK_ANCHOR_EPOCH_AFTER_NS + threadNumber,
      0n,
      epochAfter,
    );
  }
  const initializationStartedAt = collectTiming ? process.hrtime.bigint() : undefined;
  const kernel = await createKernel(options);
  Atomics.add(counters, INDEX.factoryCalls, 1n);
  Atomics.or(counters, INDEX.workerMask, 1n << BigInt(threadNumber));
  if (collectTiming) {
    const initializationElapsed = process.hrtime.bigint() - initializationStartedAt;
    Atomics.add(counters, INDEX.initializationNsTotal, initializationElapsed);
    updateMax(counters, INDEX.initializationNsMax, initializationElapsed);
  }
  return {
    async transform(code, id) {
      const startedAt = collectTiming ? process.hrtime.bigint() : undefined;
      const entryIndex = entryIndexes.get(id);
      let firstHit = false;
      if (entryIndex === undefined) {
        Atomics.add(counters, INDEX.unknownIdCalls, 1n);
      } else {
        firstHit = Atomics.add(counters, hitOffset + entryIndex, 1n) === 0n;
        if (firstHit && collectTiming) {
          Atomics.store(counters, kernelStartOffset + entryIndex, startedAt);
        }
        Atomics.compareExchange(counters, workerOffset + entryIndex, 0n, BigInt(threadNumber + 1));
      }
      const active = Atomics.add(counters, INDEX.active, 1n) + 1n;
      if (collectTiming) updateMax(counters, INDEX.maxActive, active);
      Atomics.add(counters, INDEX.handlerCalls, 1n);
      Atomics.add(counters, INDEX.perWorkerCalls + threadNumber, 1n);
      Atomics.add(counters, INDEX.inputBytes, BigInt(Buffer.byteLength(code)));
      try {
        const result = await kernel.transform(code, id);
        Atomics.add(
          counters,
          result?.map == null ? INDEX.nullMapResults : INDEX.nonNullMapResults,
          1n,
        );
        Atomics.add(counters, INDEX.outputBytes, BigInt(Buffer.byteLength(result.code)));
        return result;
      } finally {
        if (collectTiming) {
          const finishedAt = process.hrtime.bigint();
          const elapsed = finishedAt - startedAt;
          if (entryIndex !== undefined) {
            Atomics.add(counters, durationOffset + entryIndex, elapsed);
            if (firstHit) {
              Atomics.store(counters, kernelEndOffset + entryIndex, finishedAt);
            }
          }
          Atomics.add(counters, INDEX.serviceNsTotal, elapsed);
          updateMax(counters, INDEX.serviceNsMax, elapsed);
        }
        Atomics.sub(counters, INDEX.active, 1n);
      }
    },
    buildEnd() {
      return kernel.buildEnd?.();
    },
  };
}

export function toCorrectnessCounters(metrics, entryPaths, projectRoot) {
  if (!metrics) return undefined;
  if (metrics.timelineEntries.length !== entryPaths.length) {
    throw new Error('Correctness counters and selected entry paths have different lengths');
  }
  const entries = metrics.timelineEntries.map(({ id, hits, worker }) => ({
    id: normalizeCounterId(id, projectRoot),
    hits,
    worker,
  }));
  return {
    schema: 1,
    factoryCalls: metrics.factoryCalls,
    workerMask: metrics.workerMask,
    handlerCalls: metrics.handlerCalls,
    nullMapResults: metrics.nullMapResults,
    nonNullMapResults: metrics.nonNullMapResults,
    active: metrics.active,
    unknownIdCalls: metrics.unknownIdCalls,
    distinctHandlerIds: metrics.distinctHandlerIds,
    missingHandlerIds: metrics.missingHandlerIds.map((id) => normalizeCounterId(id, projectRoot)),
    duplicateHandlerIds: metrics.duplicateHandlerIds.map((id) =>
      normalizeCounterId(id, projectRoot),
    ),
    perWorkerCalls: metrics.perWorkerCalls,
    entries,
  };
}

function normalizeCounterId(id, projectRoot) {
  if (!projectRoot || !id.startsWith(`${projectRoot}/`)) return id;
  return id.slice(projectRoot.length + 1);
}

function summarizeKernelTimeline(entries) {
  const completed = entries
    .filter(
      ({ hits, kernelStartNs, kernelEndNs }) =>
        hits === 1 && kernelStartNs !== '0' && kernelEndNs !== '0',
    )
    .map((entry) => ({
      ...entry,
      start: BigInt(entry.kernelStartNs),
      end: BigInt(entry.kernelEndNs),
    }));
  if (completed.length === 0) {
    return {
      completedEntries: 0,
      originNs: null,
      firstStartNs: null,
      lastStartNs: null,
      lastEndNs: null,
      spanMs: 0,
      lastStartToLastEndMs: 0,
      maxConcurrent: 0,
      perWorker: [],
    };
  }
  const firstStart = completed.reduce(
    (minimum, { start }) => (start < minimum ? start : minimum),
    completed[0].start,
  );
  const lastStart = completed.reduce(
    (maximum, { start }) => (start > maximum ? start : maximum),
    completed[0].start,
  );
  const lastEnd = completed.reduce(
    (maximum, { end }) => (end > maximum ? end : maximum),
    completed[0].end,
  );
  const events = completed
    .flatMap(({ start, end }) => [
      { at: start, delta: 1 },
      { at: end, delta: -1 },
    ])
    .sort((left, right) =>
      left.at < right.at
        ? -1
        : left.at > right.at
          ? 1
          : left.delta - right.delta,
    );
  let active = 0;
  let maxConcurrent = 0;
  for (const event of events) {
    active += event.delta;
    maxConcurrent = Math.max(maxConcurrent, active);
  }
  const perWorker = [...Map.groupBy(completed, ({ worker }) => worker)]
    .sort(([left], [right]) => left - right)
    .map(([worker, workerEntries]) => {
      const ordered = workerEntries.sort(
        (left, right) =>
          left.start < right.start ? -1 : left.start > right.start ? 1 : 0,
      );
      let serviceElapsedNsTotal = 0n;
      let busyNs = 0n;
      let idleGapNs = 0n;
      let maxIdleGapNs = 0n;
      let intervalStart;
      let intervalEnd;
      for (const entry of ordered) {
        serviceElapsedNsTotal += entry.end - entry.start;
        if (intervalStart === undefined) {
          intervalStart = entry.start;
          intervalEnd = entry.end;
        } else if (entry.start > intervalEnd) {
          busyNs += intervalEnd - intervalStart;
          const gap = entry.start - intervalEnd;
          idleGapNs += gap;
          if (gap > maxIdleGapNs) maxIdleGapNs = gap;
          intervalStart = entry.start;
          intervalEnd = entry.end;
        } else if (entry.end > intervalEnd) {
          intervalEnd = entry.end;
        }
      }
      busyNs += intervalEnd - intervalStart;
      const final = ordered.reduce((latest, entry) =>
        entry.end > latest.end ? entry : latest,
      );
      return {
        worker,
        calls: ordered.length,
        busyMs: nanosecondsToMilliseconds(busyNs),
        serviceElapsedMsTotal: nanosecondsToMilliseconds(serviceElapsedNsTotal),
        overlapMs: nanosecondsToMilliseconds(serviceElapsedNsTotal - busyNs),
        idleGapMs: nanosecondsToMilliseconds(idleGapNs),
        maxIdleGapMs: nanosecondsToMilliseconds(maxIdleGapNs),
        firstStartOffsetMs: nanosecondsToMilliseconds(ordered[0].start - firstStart),
        lastStartOffsetMs: nanosecondsToMilliseconds(ordered.at(-1).start - firstStart),
        lastEndOffsetMs: nanosecondsToMilliseconds(final.end - firstStart),
        finalEntryId: final.id,
      };
    });
  return {
    completedEntries: completed.length,
    originNs: firstStart.toString(),
    firstStartNs: firstStart.toString(),
    lastStartNs: lastStart.toString(),
    lastEndNs: lastEnd.toString(),
    spanMs: nanosecondsToMilliseconds(lastEnd - firstStart),
    lastStartToLastEndMs: nanosecondsToMilliseconds(lastEnd - lastStart),
    maxConcurrent,
    perWorker,
  };
}

function nanosecondsToMilliseconds(value) {
  return Number(value) / 1e6;
}

function performanceEpochNanoseconds() {
  return (
    BigInt(Math.floor(performance.timeOrigin * 1e6)) +
    BigInt(Math.floor(performance.now() * 1e6))
  );
}

function updateMax(counters, index, candidate) {
  let current = Atomics.load(counters, index);
  while (candidate > current) {
    const previous = Atomics.compareExchange(counters, index, current, candidate);
    if (previous === current) return;
    current = previous;
  }
}
