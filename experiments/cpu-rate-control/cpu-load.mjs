import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';

const durationMs = Number(process.argv[2] ?? 10_000);
const threadCount = Number(process.argv[3] ?? 8);
if (!Number.isFinite(durationMs) || durationMs < 1_000) throw new Error('duration must be at least 1000 ms');
if (!Number.isSafeInteger(threadCount) || threadCount < 1 || threadCount > 64) throw new Error('thread count must be 1..64');

const workerSource = `
  const { parentPort, workerData } = require('node:worker_threads');
  const { performance } = require('node:perf_hooks');
  const end = performance.now() + workerData.durationMs;
  let value = 1;
  while (performance.now() < end) value = (value * 48271) % 2147483647;
  parentPort.postMessage(value);
`;

const startedAt = performance.now();
const cpuStartedAt = process.cpuUsage();
await Promise.all(
  Array.from(
    { length: threadCount },
    () =>
      new Promise((resolve, reject) => {
        const worker = new Worker(workerSource, { eval: true, workerData: { durationMs } });
        worker.once('message', resolve);
        worker.once('error', reject);
      }),
  ),
);
const cpu = process.cpuUsage(cpuStartedAt);
const wallMs = performance.now() - startedAt;
process.stdout.write(
  `${JSON.stringify({ durationMs, threadCount, wallMs, cpuMs: (cpu.user + cpu.system) / 1000, averageCpuPercent: ((cpu.user + cpu.system) / 1000 / wallMs) * 100 })}\n`,
);
