import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import nodePath from 'node:path';

const EXPECTED_NODE = 'v24.18.0';
const EXPECTED_REPOSITORY = 'github.com/hyf0/rolldown-parallel-js-plugin';
const ROOT_PREFIX = 'research/artifacts/correctness/sha256';

if (process.version !== EXPECTED_NODE) {
  throw new Error(`correctness promotion requires ${EXPECTED_NODE}, got ${process.version}`);
}
const arguments_ = process.argv.slice(2);
if (arguments_.length < 2 || arguments_.length % 2 !== 0) {
  throw new Error('usage: node promote-independent-vue.mjs RAW SUMMARY [RAW SUMMARY ...]');
}

const repositoryRoot = git(process.cwd(), ['rev-parse', '--show-toplevel']);
if (normalizeRepository(git(repositoryRoot, ['remote', 'get-url', 'origin'])) !== EXPECTED_REPOSITORY) {
  throw new Error(`correctness promotion requires ${EXPECTED_REPOSITORY}`);
}
if (git(repositoryRoot, ['status', '--short'])) {
  throw new Error('correctness promotion requires a clean research repository');
}

const sources = [];
for (let index = 0; index < arguments_.length; index += 2) {
  const rawPath = nodePath.resolve(arguments_[index]);
  const summaryPath = nodePath.resolve(arguments_[index + 1]);
  const [rawBytes, summaryBytes] = await Promise.all([readFile(rawPath), readFile(summaryPath)]);
  const rawSha256 = sha256(rawBytes);
  const summarySha256 = sha256(summaryBytes);
  const raw = JSON.parse(rawBytes);
  const summary = JSON.parse(summaryBytes);
  if (
    raw.schema !== 1 ||
    summary.schema !== 1 ||
    summary.measurementClass !== 'correctness-only' ||
    summary.durableEligible !== true ||
    summary.rawArtifactSha256 !== rawSha256 ||
    summary.harness?.clean !== true ||
    summary.runtime?.sourceCommit !== 'b144106882fe244b19b738fc0acf3ffa07c7c9f3'
  ) {
    throw new Error(`correctness pair ${index / 2} is not durable or does not bind its raw input`);
  }
  sources.push({ rawBytes, summaryBytes, rawSha256, summarySha256 });
}

const records = sources
  .map(({ rawSha256, summarySha256 }) => `${rawSha256}\0${summarySha256}\n`)
  .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
if (new Set(records).size !== records.length) {
  throw new Error('correctness promotion contains a duplicate raw/summary pair');
}
const contentSha256 = sha256(records.join(''));
const relativeRoot = `${ROOT_PREFIX}/${contentSha256}`;
const artifactRoot = nodePath.join(repositoryRoot, ...relativeRoot.split('/'));
await Promise.all([
  mkdir(nodePath.join(artifactRoot, 'raw'), { recursive: true }),
  mkdir(nodePath.join(artifactRoot, 'summary'), { recursive: true }),
]);

for (const source of sources) {
  await Promise.all([
    writeFile(nodePath.join(artifactRoot, 'raw', `${source.rawSha256}.json`), source.rawBytes, {
      flag: 'wx',
    }),
    writeFile(
      nodePath.join(artifactRoot, 'summary', `${source.summarySha256}.json`),
      source.summaryBytes,
      { flag: 'wx' },
    ),
  ]);
}
const manifest = {
  schema: 2,
  artifactStore: {
    kind: 'git-head-content-addressed',
    repository: EXPECTED_REPOSITORY,
    root: relativeRoot,
    contentSha256,
  },
  artifacts: sources.map(({ rawSha256, summarySha256 }) => ({
    raw: `raw/${rawSha256}.json`,
    rawSha256,
    summary: `summary/${summarySha256}.json`,
    summarySha256,
  })),
};
await writeFile(
  nodePath.join(artifactRoot, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { flag: 'wx' },
);
console.log(JSON.stringify({ contentSha256, artifactRoot, artifacts: sources.length }));

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function git(cwd, args) {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function normalizeRepository(value) {
  return value
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/^ssh:\/\/git@/, '')
    .replace(/^git@([^:]+):/, '$1/')
    .replace(/\.git$/, '');
}
