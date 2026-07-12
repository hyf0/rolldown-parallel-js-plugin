import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { availableParallelism, cpus } from 'node:os';

if (process.version !== 'v24.18.0') {
  throw new Error(
    `machine topology requires Node.js v24.18.0, got ${process.version}`,
  );
}
if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error(
    `machine topology is frozen for Darwin arm64, got ${process.platform} ${process.arch}`,
  );
}
const levels = [0, 1].map((index) => ({
  name: sysctl(`hw.perflevel${index}.name`),
  logicalCpuCount: Number(sysctl(`hw.perflevel${index}.logicalcpu`)),
}));
if (
  levels[0].name !== 'Performance' ||
  levels[1].name !== 'Efficiency' ||
  levels.some(
    ({ logicalCpuCount }) =>
      !Number.isSafeInteger(logicalCpuCount) || logicalCpuCount <= 0,
  )
) {
  throw new Error(`unexpected Apple core topology: ${JSON.stringify(levels)}`);
}
const record = {
  schema: 1,
  kind: 'rolldown-fixed-worker-policy-machine-topology',
  executionScope: 'local-only',
  node: process.version,
  platform: process.platform,
  architecture: process.arch,
  cpuModel: cpus()[0]?.model,
  availableParallelism: availableParallelism(),
  logicalCpuCount: cpus().length,
  performanceCores: levels[0].logicalCpuCount,
  efficiencyCores: levels[1].logicalCpuCount,
  performanceLevels: levels,
};
if (
  record.cpuModel !== 'Apple M3 Pro' ||
  record.availableParallelism !== 12 ||
  record.logicalCpuCount !== 12 ||
  record.performanceCores !== 6 ||
  record.efficiencyCores !== 6 ||
  record.performanceCores + record.efficiencyCores !== record.logicalCpuCount
) {
  throw new Error(
    `machine topology differs from the frozen formal host: ${JSON.stringify(record)}`,
  );
}
const serialized = `${JSON.stringify(record, null, 2)}\n`;
if (process.argv[2]) await writeFile(process.argv[2], serialized);
else process.stdout.write(serialized);

function sysctl(name) {
  const result = spawnSync('/usr/sbin/sysctl', ['-n', name], {
    encoding: 'utf8',
  });
  if (result.status !== 0)
    throw new Error(`sysctl ${name} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}
