import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import nodePath from 'node:path';

export const CPULIMIT_UPSTREAM_URL = 'https://github.com/opsengine/cpulimit.git';
export const CPULIMIT_UPSTREAM_COMMIT = 'f4d2682804931e7aea02a869137344bb5452a3cd';
export const CPULIMIT_SOURCE_TREE_SHA256 =
  'd7a8dccb84e90d854b146fb0b7363868e222c9f50469ebc11650f7165c76c21a';
export const CPULIMIT_PATCH_SHA256 =
  'de4c2800dbc1b4cbad8d280ec1aebecda7256dbf221fbb97daf83e7fa0a88060';
export const CPULIMIT_BINARY_SHA256 =
  '233531824804f4be5ef3b425b0903bd36a90c069fd44598da4fad77e90eb0bd9';

const repositoryRoot = nodePath.resolve(import.meta.dirname, '../..');
export const CPULIMIT_CHECKOUT = nodePath.join(repositoryRoot, 'tmp/bench/cpulimit-f4d2682');
export const CPULIMIT_BINARY = nodePath.join(CPULIMIT_CHECKOUT, 'src/cpulimit');
export const CPULIMIT_PATCH = nodePath.join(import.meta.dirname, 'cpulimit-apple.patch');

export async function captureCpulimitProvenance() {
  const [patch, binary, runCalibration, cpuLoad] = await Promise.all([
    readFile(CPULIMIT_PATCH),
    readFile(CPULIMIT_BINARY),
    readFile(nodePath.join(import.meta.dirname, 'run-calibration.mjs')),
    readFile(nodePath.join(import.meta.dirname, 'cpu-load.mjs')),
  ]);
  const head = git(['rev-parse', 'HEAD']);
  if (head !== CPULIMIT_UPSTREAM_COMMIT) {
    throw new Error(`cpulimit checkout changed: ${head}`);
  }
  const sourceTree = captureSourceTree();
  const value = {
    schema: 1,
    upstreamUrl: CPULIMIT_UPSTREAM_URL,
    upstreamCommit: CPULIMIT_UPSTREAM_COMMIT,
    sourceTree,
    patch: { path: CPULIMIT_PATCH, sha256: sha256(patch) },
    binary: { path: CPULIMIT_BINARY, sha256: sha256(binary) },
    calibrationHarness: {
      runCalibrationSha256: sha256(runCalibration),
      cpuLoadSha256: sha256(cpuLoad),
    },
  };
  if (
    value.sourceTree.sha256 !== CPULIMIT_SOURCE_TREE_SHA256 ||
    value.patch.sha256 !== CPULIMIT_PATCH_SHA256 ||
    value.binary.sha256 !== CPULIMIT_BINARY_SHA256
  ) {
    throw new Error(`cpulimit source, patch, or binary differs from the frozen controller: ${JSON.stringify(value)}`);
  }
  return value;
}

function captureSourceTree() {
  const listing = spawnSync(
    'git',
    ['-C', CPULIMIT_CHECKOUT, 'ls-tree', '-r', '--full-tree', '-z', CPULIMIT_UPSTREAM_COMMIT],
    { encoding: 'buffer' },
  );
  if (listing.status !== 0) throw new Error(listing.stderr.toString());
  const records = listing.stdout
    .toString()
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+) (\w+) ([a-f0-9]+)\t(.*)$/s);
      if (!match) throw new Error(`Cannot parse cpulimit tree record: ${line}`);
      return { type: match[2], object: match[3], path: match[4] };
    })
    .filter(({ type }) => type === 'blob')
    .sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
  const selection = createHash('sha256');
  let bytes = 0;
  for (const record of records) {
    const blob = spawnSync('git', ['-C', CPULIMIT_CHECKOUT, 'cat-file', 'blob', record.object], {
      encoding: 'buffer',
      maxBuffer: 16 * 1024 * 1024,
    });
    if (blob.status !== 0) throw new Error(blob.stderr.toString());
    const contentSha256 = sha256(blob.stdout);
    selection.update(record.path);
    selection.update('\0');
    selection.update(String(blob.stdout.length));
    selection.update('\0');
    selection.update(contentSha256);
    selection.update('\n');
    bytes += blob.stdout.length;
  }
  return {
    recordFormat: 'path + NUL + bytes + NUL + contentSha256 + LF',
    files: records.length,
    bytes,
    sha256: selection.digest('hex'),
  };
}

function git(args) {
  const result = spawnSync('git', ['-C', CPULIMIT_CHECKOUT, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
