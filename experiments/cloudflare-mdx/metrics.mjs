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
  perWorkerCalls: 12,
};
const MAX_WORKERS = 12;
const FIXED_LENGTH = INDEX.perWorkerCalls + MAX_WORKERS;

export function createMetricsBuffer(entryCount) {
  return new SharedArrayBuffer(
    BigInt64Array.BYTES_PER_ELEMENT * (FIXED_LENGTH + entryCount * 3),
  );
}

export function readMetrics(buffer, entryPaths) {
  if (!buffer) return undefined;
  const counters = new BigInt64Array(buffer);
  const hitOffset = FIXED_LENGTH;
  const durationOffset = hitOffset + entryPaths.length;
  const workerOffset = durationOffset + entryPaths.length;
  const entries = entryPaths.map((id, index) => ({
    id,
    hits: Number(counters[hitOffset + index]),
    serviceMs: Number(counters[durationOffset + index]) / 1e6,
    worker: Number(counters[workerOffset + index]) - 1,
  }));
  const missingHandlerIds = entries.filter(({ hits }) => hits === 0).map(({ id }) => id);
  const duplicateHandlerIds = entries.filter(({ hits }) => hits > 1).map(({ id }) => id);
  return {
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
    distinctHandlerIds: entries.length - missingHandlerIds.length,
    missingHandlerIds,
    duplicateHandlerIds,
    perWorkerCalls: Array.from(
      counters.slice(INDEX.perWorkerCalls, INDEX.perWorkerCalls + MAX_WORKERS),
      Number,
    ),
    slowestEntries: entries
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
  const initializationStartedAt = process.hrtime.bigint();
  const kernel = await createKernel(options);
  const initializationElapsed = process.hrtime.bigint() - initializationStartedAt;
  Atomics.add(counters, INDEX.factoryCalls, 1n);
  Atomics.or(counters, INDEX.workerMask, 1n << BigInt(threadNumber));
  Atomics.add(counters, INDEX.initializationNsTotal, initializationElapsed);
  updateMax(counters, INDEX.initializationNsMax, initializationElapsed);
  return {
    async transform(code, id) {
      const startedAt = process.hrtime.bigint();
      const entryIndex = entryIndexes.get(id);
      if (entryIndex === undefined) {
        Atomics.add(counters, INDEX.unknownIdCalls, 1n);
      } else {
        Atomics.add(counters, hitOffset + entryIndex, 1n);
        Atomics.compareExchange(counters, workerOffset + entryIndex, 0n, BigInt(threadNumber + 1));
      }
      const active = Atomics.add(counters, INDEX.active, 1n) + 1n;
      updateMax(counters, INDEX.maxActive, active);
      Atomics.add(counters, INDEX.handlerCalls, 1n);
      Atomics.add(counters, INDEX.perWorkerCalls + threadNumber, 1n);
      Atomics.add(counters, INDEX.inputBytes, BigInt(Buffer.byteLength(code)));
      try {
        const result = await kernel.transform(code, id);
        Atomics.add(counters, INDEX.outputBytes, BigInt(Buffer.byteLength(result.code)));
        return result;
      } finally {
        const elapsed = process.hrtime.bigint() - startedAt;
        if (entryIndex !== undefined) Atomics.add(counters, durationOffset + entryIndex, elapsed);
        Atomics.add(counters, INDEX.serviceNsTotal, elapsed);
        updateMax(counters, INDEX.serviceNsMax, elapsed);
        Atomics.sub(counters, INDEX.active, 1n);
      }
    },
    buildEnd() {
      return kernel.buildEnd?.();
    },
  };
}

function updateMax(counters, index, candidate) {
  let current = Atomics.load(counters, index);
  while (candidate > current) {
    const previous = Atomics.compareExchange(counters, index, current, candidate);
    if (previous === current) return;
    current = previous;
  }
}
