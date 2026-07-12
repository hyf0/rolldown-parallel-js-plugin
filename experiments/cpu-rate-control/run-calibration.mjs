import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import nodePath from 'node:path';

const repositoryRoot = nodePath.resolve(import.meta.dirname, '../..');
const binaryPath = nodePath.join(repositoryRoot, 'tmp/bench/cpulimit-f4d2682/src/cpulimit');
const patchPath = nodePath.join(import.meta.dirname, 'cpulimit-apple.patch');
const loadPath = nodePath.join(import.meta.dirname, 'cpu-load.mjs');
const options = parseOptions(process.argv.slice(2));
await access(binaryPath);
const [binary, patch] = await Promise.all([readFile(binaryPath), readFile(patchPath)]);

const samples = [];
for (let repetition = 0; repetition < options.repetitions; repetition++) {
  const levels = repetition % 2 === 0 ? options.levels : [...options.levels].reverse();
  for (const limitPercent of levels) {
    samples.push(runControlled({ limitPercent, repetition }));
  }
}

const equivalence = [];
for (let block = 0; block < options.equivalenceBlocks; block++) {
  const order = block % 2 === 0 ? ['direct', 'controlled'] : ['controlled', 'direct'];
  const pair = { block, order };
  for (const mode of order) {
    pair[mode] = mode === 'direct' ? runDirect({ block }) : runControlled({ limitPercent: 1_200, block });
  }
  pair.wallRatio = pair.controlled.load.wallMs / pair.direct.load.wallMs;
  pair.cpuRatio = pair.controlled.load.cpuMs / pair.direct.load.cpuMs;
  equivalence.push(pair);
}

const levelSummary = options.levels.map((limitPercent) => {
  const selected = samples.filter((sample) => sample.limitPercent === limitPercent);
  const achieved = selected.map((sample) => sample.load.averageCpuPercent);
  const ratios = achieved.map((value) => value / limitPercent);
  return {
    limitPercent,
    sampleCount: selected.length,
    achievedCpuPercent: achieved,
    achievedToTargetRatio: ratios,
    medianAchievedToTargetRatio: median(ratios),
    withinFivePercent: ratios.every((ratio) => ratio >= 0.95 && ratio <= 1.05),
    controllerStopCycles: selected.map((sample) => sample.controller.stopCycles),
    controllerStoppedMs: selected.map((sample) => sample.controller.stoppedUs / 1_000),
  };
});
const equivalenceWallRatios = equivalence.map((pair) => pair.wallRatio);
const equivalenceCpuRatios = equivalence.map((pair) => pair.cpuRatio);
const equivalenceSummary = {
  blocks: equivalence.length,
  medianWallRatio: median(equivalenceWallRatios),
  medianCpuRatio: median(equivalenceCpuRatios),
  wallWithinTwoPercent: Math.abs(median(equivalenceWallRatios) - 1) <= 0.02,
  cpuWithinTwoPercent: Math.abs(median(equivalenceCpuRatios) - 1) <= 0.02,
  noControllerStops: equivalence.every((pair) => pair.controlled.controller.stopCycles === 0),
};
const result = {
  schemaVersion: 1,
  kind: 'cpulimit-apple-calibration',
  createdAt: new Date().toISOString(),
  command: process.argv,
  options,
  binaryPath,
  binarySha256: sha256(binary),
  patchPath,
  patchSha256: sha256(patch),
  levelSummary,
  equivalenceSummary,
  passed:
    levelSummary.every((summary) => summary.withinFivePercent) &&
    equivalenceSummary.wallWithinTwoPercent &&
    equivalenceSummary.cpuWithinTwoPercent &&
    equivalenceSummary.noControllerStops,
  samples,
  equivalence,
};
const serialized = `${JSON.stringify(result, null, 2)}\n`;
if (options.outputPath) await writeFile(nodePath.resolve(options.outputPath), serialized);
process.stdout.write(serialized);
if (!result.passed) process.exitCode = 1;

function runControlled(metadata) {
  const limitPercent = metadata.limitPercent;
  const result = run(
    binaryPath,
    ['--limit', String(limitPercent), process.execPath, loadPath, String(options.durationMs), String(options.threadCount)],
    { CPULIMIT_REPORT: '1' },
  );
  return {
    mode: 'controlled',
    ...metadata,
    load: parseLoad(result.stdout),
    controller: parseControllerReport(result.stderr),
  };
}

function runDirect(metadata) {
  const result = run(process.execPath, [loadPath, String(options.durationMs), String(options.threadCount)]);
  return { mode: 'direct', ...metadata, load: parseLoad(result.stdout) };
}

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.status}):\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  }
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function parseLoad(stdout) {
  const line = stdout
    .split('\n')
    .map((value) => value.trim())
    .find((value) => value.startsWith('{') && value.endsWith('}'));
  if (!line) throw new Error(`CPU load result missing from stdout:\n${stdout}`);
  return JSON.parse(line);
}

function parseControllerReport(stderr) {
  const prefix = '[cpulimit-report] ';
  const line = stderr
    .split('\n')
    .map((value) => value.trim())
    .find((value) => value.startsWith(prefix));
  if (!line) throw new Error(`controller report missing from stderr:\n${stderr}`);
  return JSON.parse(line.slice(prefix.length));
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function parseOptions(args) {
  const parsed = {
    durationMs: 10_000,
    threadCount: 8,
    repetitions: 3,
    equivalenceBlocks: 5,
    levels: [200, 400, 600, 800],
    outputPath: undefined,
  };
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (value === '--duration-ms') parsed.durationMs = Number(args[++index]);
    else if (value === '--threads') parsed.threadCount = Number(args[++index]);
    else if (value === '--repetitions') parsed.repetitions = Number(args[++index]);
    else if (value === '--equivalence-blocks') parsed.equivalenceBlocks = Number(args[++index]);
    else if (value === '--levels') parsed.levels = args[++index].split(',').map(Number);
    else if (value === '--output') parsed.outputPath = args[++index];
    else throw new Error(`unknown option: ${value}`);
  }
  if (!Number.isSafeInteger(parsed.durationMs) || parsed.durationMs < 1_000) throw new Error('--duration-ms must be an integer of at least 1000');
  if (!Number.isSafeInteger(parsed.threadCount) || parsed.threadCount < 1 || parsed.threadCount > 64) throw new Error('--threads must be an integer from 1 through 64');
  if (!Number.isSafeInteger(parsed.repetitions) || parsed.repetitions < 1) throw new Error('--repetitions must be a positive integer');
  if (!Number.isSafeInteger(parsed.equivalenceBlocks) || parsed.equivalenceBlocks < 1) throw new Error('--equivalence-blocks must be a positive integer');
  if (parsed.levels.length === 0 || parsed.levels.some((level) => !Number.isSafeInteger(level) || level < 1 || level > 1_200)) {
    throw new Error('--levels must contain comma-separated integers from 1 through 1200');
  }
  return parsed;
}
