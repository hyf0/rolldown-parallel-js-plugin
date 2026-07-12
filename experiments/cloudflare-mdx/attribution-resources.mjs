import { PerformanceObserver, performance } from 'node:perf_hooks';
import { getHeapStatistics } from 'node:v8';

export function startAttributionResourceCapture({ sampleIntervalMs = 100 } = {}) {
  if (!Number.isSafeInteger(sampleIntervalMs) || sampleIntervalMs < 10) {
    throw new Error(`Invalid attribution RSS sample interval: ${sampleIntervalMs}`);
  }
  if (typeof process.threadCpuUsage !== 'function') {
    throw new Error('Node.js process.threadCpuUsage() is required for attribution');
  }

  const gc = createGcCollector();
  const startedAt = captureSnapshot();
  const rssSamples = [captureRssSample()];
  const timer = setInterval(() => rssSamples.push(captureRssSample()), sampleIntervalMs);
  timer.unref();
  let finished = false;

  return {
    finish() {
      if (finished) throw new Error('Attribution resource capture was already finished');
      finished = true;
      clearInterval(timer);
      rssSamples.push(captureRssSample());
      const finishedAt = captureSnapshot();
      const processCpuDeltaMicros = subtractCpu(
        finishedAt.processCpuUsageMicros,
        startedAt.processCpuUsageMicros,
      );
      const mainThreadCpuDeltaMicros = subtractCpu(
        finishedAt.mainThreadCpuUsageMicros,
        startedAt.mainThreadCpuUsageMicros,
      );
      const residualProcessCpuDeltaMicros = subtractCpu(
        processCpuDeltaMicros,
        mainThreadCpuDeltaMicros,
      );
      const mainEventLoopUtilizationDelta = performance.eventLoopUtilization(
        finishedAt.mainEventLoopUtilization,
        startedAt.mainEventLoopUtilization,
      );
      const gcMetrics = gc.finish();
      return {
        schema: 1,
        scope: {
          processCpu: 'whole process, including JavaScript workers and native threads',
          mainThreadCpu: 'Node.js main thread only',
          residualCpu:
            'whole-process CPU minus Node.js main-thread CPU; worker runs are further decomposed by the lifecycle records',
          rss: 'whole process; samples are attribution instrumentation and are not benchmark timings',
          heap: 'main V8 isolate only',
          eventLoopUtilization: 'Node.js main event loop only; this is not CPU time',
          gc: 'GC performance entries observed in the main isolate during this capture',
        },
        sampleIntervalMs,
        startedAt,
        finishedAt,
        deltas: {
          processCpuDeltaMicros,
          mainThreadCpuDeltaMicros,
          residualProcessCpuDeltaMicros,
          mainEventLoopUtilization: mainEventLoopUtilizationDelta,
          mainHeap: subtractHeap(finishedAt.mainIsolateHeapStatistics, startedAt.mainIsolateHeapStatistics),
        },
        rss: {
          samples: rssSamples,
          minimumBytes: Math.min(...rssSamples.map(({ rssBytes }) => rssBytes)),
          maximumBytes: Math.max(...rssSamples.map(({ rssBytes }) => rssBytes)),
          retainedBytes: finishedAt.processMemoryUsageBytes.rss,
        },
        gc: gcMetrics,
      };
    },
  };
}

function captureSnapshot() {
  return {
    monotonicMs: performance.now(),
    epochMs: performance.timeOrigin + performance.now(),
    processCpuUsageMicros: process.cpuUsage(),
    mainThreadCpuUsageMicros: process.threadCpuUsage(),
    processMemoryUsageBytes: process.memoryUsage(),
    mainIsolateHeapStatistics: getHeapStatistics(),
    mainEventLoopUtilization: performance.eventLoopUtilization(),
  };
}

function captureRssSample() {
  const memory = process.memoryUsage();
  return {
    monotonicMs: performance.now(),
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    externalBytes: memory.external,
  };
}

function createGcCollector() {
  const totals = new Map();
  let count = 0;
  let durationMs = 0;
  let maxDurationMs = 0;
  const collect = (entries) => {
    for (const entry of entries) {
      const kind = entry.detail?.kind ?? entry.kind ?? 0;
      const current = totals.get(kind) ?? { count: 0, durationMs: 0, maxDurationMs: 0 };
      current.count += 1;
      current.durationMs += entry.duration;
      current.maxDurationMs = Math.max(current.maxDurationMs, entry.duration);
      totals.set(kind, current);
      count += 1;
      durationMs += entry.duration;
      maxDurationMs = Math.max(maxDurationMs, entry.duration);
    }
  };
  const observer = new PerformanceObserver((list) => collect(list.getEntries()));
  observer.observe({ entryTypes: ['gc'] });
  return {
    finish() {
      collect(observer.takeRecords());
      observer.disconnect();
      return {
        count,
        durationMs,
        maxDurationMs,
        byKind: Object.fromEntries(
          [...totals.entries()]
            .sort(([left], [right]) => left - right)
            .map(([kind, value]) => [String(kind), { kind, ...value }]),
        ),
      };
    },
  };
}

function subtractCpu(end, start) {
  return { user: end.user - start.user, system: end.system - start.system };
}

function subtractHeap(end, start) {
  return Object.fromEntries(
    Object.keys(end)
      .filter((key) => Number.isFinite(end[key]) && Number.isFinite(start[key]))
      .map((key) => [key, end[key] - start[key]]),
  );
}
