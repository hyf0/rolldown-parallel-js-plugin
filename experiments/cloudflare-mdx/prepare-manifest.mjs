import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { cpus, platform, release, totalmem } from 'node:os';
import nodePath from 'node:path';
import { spawnSync } from 'node:child_process';

const projectRoot = nodePath.resolve(process.argv[2] ?? '');
const rolldownPackageRoot = nodePath.resolve(process.argv[3] ?? '');
if (!projectRoot || !rolldownPackageRoot) {
  throw new Error('Expected Cloudflare project root and Rolldown package root');
}

const productionFiles = await listFiles(nodePath.join(projectRoot, 'src/content'), (path) =>
  path.endsWith('.mdx'),
);
const sourceHash = createHash('sha256');
const collections = {};
const largest = [];
let sourceBytes = 0;
let sourceLines = 0;
let fencedCodeBlocks = 0;
for (const path of productionFiles) {
  const source = await readFile(path);
  const relativePath = nodePath.relative(projectRoot, path).split(nodePath.sep).join('/');
  const collection = relativePath.split('/')[2];
  const text = source.toString('utf8');
  const lines = text.match(/\n/g)?.length ?? 0;
  const fences = [...text.matchAll(/^\s*(?:`{3,}|~{3,})/gm)].length;
  const summary = (collections[collection] ??= { files: 0, bytes: 0, lines: 0, fencedMarkers: 0 });
  summary.files++;
  summary.bytes += source.byteLength;
  summary.lines += lines;
  summary.fencedMarkers += fences;
  sourceBytes += source.byteLength;
  sourceLines += lines;
  fencedCodeBlocks += Math.floor(fences / 2);
  largest.push({ path: relativePath, bytes: source.byteLength, lines });
  sourceHash.update(relativePath);
  sourceHash.update('\0');
  sourceHash.update(source);
  sourceHash.update('\0');
}

const repositoryMdx = await listFiles(projectRoot, (path) =>
  path.endsWith('.mdx') && !path.includes(`${nodePath.sep}node_modules${nodePath.sep}`),
);
const productionSet = new Set(productionFiles);
const distDirectory = nodePath.join(rolldownPackageRoot, 'dist');
const distFiles = await listFiles(distDirectory, () => true);
const distHash = createHash('sha256');
let distBytes = 0;
for (const path of distFiles) {
  const source = await readFile(path);
  const relativePath = nodePath.relative(distDirectory, path).split(nodePath.sep).join('/');
  distBytes += source.byteLength;
  distHash.update(relativePath);
  distHash.update('\0');
  distHash.update(source);
  distHash.update('\0');
}

const projectCommit = git(projectRoot, ['rev-parse', 'HEAD']);
const projectStatus = git(projectRoot, ['status', '--short']);
const rolldownRoot = nodePath.resolve(rolldownPackageRoot, '../..');
const rolldownCommit = git(rolldownRoot, ['rev-parse', 'HEAD']);
const rolldownStatus = git(rolldownRoot, ['status', '--short']);
if (projectStatus !== '') throw new Error(`Cloudflare worktree is dirty:\n${projectStatus}`);
if (rolldownStatus !== '') throw new Error(`Rolldown worktree is dirty:\n${rolldownStatus}`);

const report = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  project: {
    commit: projectCommit,
    status: projectStatus,
    productionMdx: {
      files: productionFiles.length,
      bytes: sourceBytes,
      lines: sourceLines,
      approximateFencedCodeBlocks: fencedCodeBlocks,
      manifestSha256: sourceHash.digest('hex'),
      collections,
      largest: largest.sort((left, right) => right.bytes - left.bytes).slice(0, 20),
    },
    excludedRepositoryMdx: repositoryMdx
      .filter((path) => !productionSet.has(path))
      .map((path) => nodePath.relative(projectRoot, path).split(nodePath.sep).join('/'))
      .sort(),
    files: {
      packageJsonSha256: await sha256(nodePath.join(projectRoot, 'package.json')),
      lockfileSha256: await sha256(nodePath.join(projectRoot, 'pnpm-lock.yaml')),
      astroConfigSha256: await sha256(nodePath.join(projectRoot, 'astro.config.ts')),
      contentConfigSha256: await sha256(nodePath.join(projectRoot, 'src/content.config.ts')),
    },
  },
  rolldown: {
    commit: rolldownCommit,
    status: rolldownStatus,
    distFiles: distFiles.length,
    distBytes,
    distSha256: distHash.digest('hex'),
    bindingSha256: await sha256(
      nodePath.join(distDirectory, 'rolldown-binding.darwin-arm64.node'),
    ),
  },
  runtime: {
    node: process.version,
    nodeBinary: process.execPath,
    nodeBinarySha256: await sha256(process.execPath),
    platform: platform(),
    release: release(),
    architecture: process.arch,
    cpuModel: cpus()[0]?.model,
    logicalCpuCount: cpus().length,
    totalMemoryBytes: totalmem(),
  },
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

async function listFiles(directory, predicate) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist') continue;
    const path = nodePath.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(path, predicate)));
    else if (entry.isFile() && predicate(path)) files.push(path);
  }
  return files.sort();
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}
