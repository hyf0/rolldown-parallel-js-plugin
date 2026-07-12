import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import nodePath from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import {
  expectedPins,
  graphProfile,
  graphSmokeEntries,
} from './graph-config.mjs';
import { createCloudflareGraphLoaderPlugin } from './graph-loader-plugin.mjs';
import { createManagedWorkerCloudflareMdxPlugin } from './managed-worker-plugin.mjs';
import { createMetricsBuffer, readMetrics } from './metrics.mjs';
import { createCloudflareOutputNormalizer } from './normalize-output.mjs';
import { createOrdinaryCloudflareMdxPlugin } from './ordinary-plugin.mjs';
import { createParallelCloudflareMdxPlugin } from './parallel-plugin.mjs';

const options = JSON.parse(process.argv[2] ?? 'null');
if (!options) throw new Error('Expected a JSON options object');
const {
  projectRoot,
  rolldownPackageRoot,
  variant,
  corpus = 'graph-smoke',
  entries,
  runLinkCheck = false,
  instrumentation = false,
  fixedNow = '2026-07-12T00:00:00.000Z',
} = options;
if (
  variant !== 'ordinary' &&
  !/^(?:worker|managed)-(?:[1-9]|1[0-2])$/.test(variant)
) {
  throw new Error(`Invalid variant: ${variant}`);
}
if (typeof instrumentation !== 'boolean') {
  throw new Error('instrumentation must be boolean');
}
if (corpus !== 'graph-smoke' && corpus !== 'production-mdx') {
  throw new Error(`Invalid graph corpus: ${corpus}`);
}
if (
  entries !== undefined &&
  (!Array.isArray(entries) || entries.length === 0)
) {
  throw new Error('entries must be a non-empty array when provided');
}
if (corpus === 'production-mdx' && entries !== undefined) {
  throw new Error(
    'production-mdx selects the pinned manifest and does not accept explicit entries',
  );
}
if (runLinkCheck !== false) {
  throw new Error('The MDX/server graph profile requires RUN_LINK_CHECK=false');
}
if (
  !nodePath.isAbsolute(projectRoot) ||
  !nodePath.isAbsolute(rolldownPackageRoot)
) {
  throw new Error('projectRoot and rolldownPackageRoot must be absolute paths');
}

const workerMatch = /^worker-(\d+)$/.exec(variant);
const managedMatch = /^managed-(\d+)$/.exec(variant);
const workerCount = workerMatch
  ? Number(workerMatch[1])
  : managedMatch
    ? Number(managedMatch[1])
    : 0;
const workerModel = workerMatch
  ? 'rolldown'
  : managedMatch
    ? 'plugin-managed'
    : 'ordinary';
if (instrumentation && managedMatch) {
  throw new Error(
    'Managed worker instrumentation is not implemented; use instrumentation:false',
  );
}
if (workerMatch)
  process.env.ROLLDOWN_PARALLEL_PLUGIN_WORKERS = String(workerCount);
else delete process.env.ROLLDOWN_PARALLEL_PLUGIN_WORKERS;

const runtime = await verifyRuntime(projectRoot, rolldownPackageRoot);
process.env.ROLLDOWN_RESEARCH_PACKAGE_ROOT = rolldownPackageRoot;
delete process.env.ASTRO_PERFORMANCE_BENCHMARK;
delete process.env.BUILD_TARGET;
delete process.env.RUN_LINK_CHECK;
process.env.NODE_ENV = 'production';
process.chdir(projectRoot);
installFixedDate(fixedNow);

const productionEntries = await listMdxFiles(
  nodePath.join(projectRoot, 'src/content'),
);
const sourceManifestHash = await hashFiles(productionEntries, projectRoot);
if (sourceManifestHash !== expectedPins.sourceManifestHash) {
  throw new Error(`Cloudflare MDX manifest changed: ${sourceManifestHash}`);
}
const productionEntrySet = new Set(productionEntries);
const selectedEntries =
  corpus === 'production-mdx'
    ? productionEntries
    : (entries ?? graphSmokeEntries);
const entryPaths = selectedEntries.map((entry) =>
  nodePath.isAbsolute(entry) ? entry : nodePath.resolve(projectRoot, entry),
);
for (const path of entryPaths) {
  if (!productionEntrySet.has(path))
    throw new Error(`Graph entry is not production MDX: ${path}`);
}
const generatedPlaygroundOutputFiles = new Set();
for (const path of entryPaths) {
  if (/^```[^\n]*\bplayground\b/m.test(await readFile(path, 'utf8'))) {
    generatedPlaygroundOutputFiles.add(
      nodePath.relative(projectRoot, path).replace(/\.mdx$/, '.js'),
    );
  }
}

const { rolldown } = await import(
  pathToFileURL(nodePath.join(rolldownPackageRoot, 'dist/index.mjs'))
);
const normalizeOutput = await createCloudflareOutputNormalizer(projectRoot);
globalThis.gc?.();
const cpuStartedAt = process.cpuUsage();
const totalStartedAt = performance.now();
const metricsBuffer = instrumentation
  ? createMetricsBuffer(entryPaths.length)
  : undefined;
const pluginOptions = {
  projectRoot,
  metricsBuffer,
  fixedNow,
  entryPaths: instrumentation ? entryPaths : undefined,
};
const mdxPlugin =
  variant === 'ordinary'
    ? await createOrdinaryCloudflareMdxPlugin(pluginOptions)
    : managedMatch
      ? await createManagedWorkerCloudflareMdxPlugin({
          ...pluginOptions,
          managedWorkerCount: workerCount,
        })
      : await createParallelCloudflareMdxPlugin(pluginOptions);
const graphLoader = await createCloudflareGraphLoaderPlugin({ projectRoot });
const pluginSetupFinishedAt = performance.now();

let build;
try {
  const input = Object.fromEntries(
    entryPaths.map((path) => [
      nodePath.relative(projectRoot, path).replace(/\.mdx$/, ''),
      path,
    ]),
  );
  const buildStartedAt = performance.now();
  build = await rolldown({
    cwd: projectRoot,
    input,
    logLevel: 'silent',
    moduleTypes: { mdx: 'ts' },
    plugins: [mdxPlugin, graphLoader.plugin],
    treeshake: false,
  });
  const generateStartedAt = performance.now();
  const result = await build.generate({
    format: 'esm',
    entryFileNames: '[name].js',
    chunkFileNames: 'chunks/[name]-[hash].js',
  });
  const generateFinishedAt = performance.now();
  await build.close();
  build = undefined;
  const totalFinishedAt = performance.now();

  const metrics = readMetrics(metricsBuffer, entryPaths);
  if (metrics) {
    if (
      metrics.handlerCalls !== entryPaths.length ||
      metrics.distinctHandlerIds !== entryPaths.length ||
      metrics.missingHandlerIds.length !== 0 ||
      metrics.duplicateHandlerIds.length !== 0 ||
      metrics.unknownIdCalls !== 0 ||
      metrics.active !== 0
    ) {
      throw new Error(
        `Unexpected graph MDX transform coverage: ${JSON.stringify(metrics)}`,
      );
    }
  }

  const output = hashOutput(
    result.output,
    normalizeOutput,
    generatedPlaygroundOutputFiles,
  );
  const graph = graphLoader.report();
  if (graph.boundary.unresolvedLocalEdges !== 0) {
    throw new Error('Graph completed after observing an unresolved local edge');
  }
  if (
    graph.codeOnlyModules.length !== 0 ||
    graph.graphWithoutObservedCode.length !== 0
  ) {
    throw new Error(
      'Project graph and observed post-transform code modules do not match',
    );
  }
  if (
    graph.graphProjectStaticEdges +
      graph.graphExternalStaticEdges +
      graph.graphNonProjectInternalStaticEdges !==
    graph.graphStaticEdges
  ) {
    throw new Error(
      'Static graph edge classification does not cover every edge',
    );
  }
  if (graph.moduleKindCounts.mdx !== entryPaths.length) {
    throw new Error(
      `Expected ${entryPaths.length} parsed MDX modules, got ${graph.moduleKindCounts.mdx ?? 0}`,
    );
  }
  const cpu = process.cpuUsage(cpuStartedAt);
  console.log(
    JSON.stringify({
      variant,
      workerCount,
      workerModel,
      corpus,
      entries: corpus === 'graph-smoke' ? selectedEntries : undefined,
      fixedNow,
      graphProfile,
      instrumentation,
      runLinkCheck,
      transformedEntryCount: entryPaths.length,
      discoveredProductionMdxFiles: productionEntries.length,
      ...runtime,
      sourceManifestHash,
      totalElapsedMs: totalFinishedAt - totalStartedAt,
      pluginSetupElapsedMs: pluginSetupFinishedAt - totalStartedAt,
      rolldownCreateElapsedMs: generateStartedAt - buildStartedAt,
      generateAndWorkerLifecycleElapsedMs:
        generateFinishedAt - generateStartedAt,
      closeElapsedMs: totalFinishedAt - generateFinishedAt,
      cpuUserMs: cpu.user / 1000,
      cpuSystemMs: cpu.system / 1000,
      finalRssBytes: process.memoryUsage.rss(),
      ...output,
      ...graph,
      metrics,
    }),
  );
} finally {
  await build?.close();
}

async function verifyRuntime(projectRoot, rolldownPackageRoot) {
  if (process.version !== expectedPins.node) {
    throw new Error(
      `Expected Node ${expectedPins.node}, got ${process.version}`,
    );
  }
  const projectCommit = git(projectRoot, ['rev-parse', 'HEAD']);
  const projectStatus = git(projectRoot, ['status', '--short']);
  if (projectCommit !== expectedPins.projectCommit || projectStatus !== '') {
    throw new Error(
      `Cloudflare source is not the clean pin: ${projectCommit}\n${projectStatus}`,
    );
  }
  const rolldownRoot = nodePath.resolve(rolldownPackageRoot, '../..');
  const rolldownCommit = git(rolldownRoot, ['rev-parse', 'HEAD']);
  const rolldownStatus = git(rolldownRoot, ['status', '--short']);
  const distDirectory = nodePath.join(rolldownPackageRoot, 'dist');
  const bindingHash = createHash('sha256')
    .update(
      await readFile(
        nodePath.join(distDirectory, 'rolldown-binding.darwin-arm64.node'),
      ),
    )
    .digest('hex');
  const distHash = await hashFiles(
    await listFiles(distDirectory),
    distDirectory,
  );
  if (
    rolldownCommit !== expectedPins.rolldownCommit ||
    rolldownStatus !== '' ||
    bindingHash !== expectedPins.bindingHash ||
    distHash !== expectedPins.distHash
  ) {
    throw new Error(
      `Rolldown runtime is not the clean pin: ${rolldownCommit} ${bindingHash} ${distHash}\n${rolldownStatus}`,
    );
  }
  return { projectCommit, rolldownCommit, bindingHash, distHash };
}

function hashOutput(outputs, normalizeOutput, generatedPlaygroundOutputFiles) {
  const outputHash = createHash('sha256');
  const normalizedOutputHash = createHash('sha256');
  let outputBytes = 0;
  let normalizedOutputBytes = 0;
  let outputChunks = 0;
  let outputAssets = 0;
  let normalizedPlaygroundUrls = 0;
  const normalizedFiles = [];
  for (const output of [...outputs].sort((left, right) =>
    left.fileName.localeCompare(right.fileName),
  )) {
    const source =
      output.type === 'chunk' ? output.code : String(output.source);
    const normalized = normalizeOutput(
      source,
      generatedPlaygroundOutputFiles.has(output.fileName),
    );
    outputBytes += Buffer.byteLength(source);
    normalizedOutputBytes += Buffer.byteLength(normalized.code);
    normalizedPlaygroundUrls += normalized.playgroundUrls;
    if (normalized.playgroundUrls > 0) normalizedFiles.push(output.fileName);
    if (output.type === 'chunk') outputChunks++;
    else outputAssets++;
    outputHash.update(output.type);
    outputHash.update('\0');
    outputHash.update(output.fileName);
    outputHash.update('\0');
    outputHash.update(source);
    outputHash.update('\0');
    normalizedOutputHash.update(output.type);
    normalizedOutputHash.update('\0');
    normalizedOutputHash.update(output.fileName);
    normalizedOutputHash.update('\0');
    normalizedOutputHash.update(normalized.code);
    normalizedOutputHash.update('\0');
  }
  return {
    outputBytes,
    outputChunks,
    outputAssets,
    outputHash: outputHash.digest('hex'),
    normalizedOutputBytes,
    normalizedOutputHash: normalizedOutputHash.digest('hex'),
    outputNormalization: {
      kind: 'undici-formdata-boundary',
      eligibleSourceEntries: generatedPlaygroundOutputFiles.size,
      eligibleOutputFiles: [...generatedPlaygroundOutputFiles].sort(),
      playgroundUrls: normalizedPlaygroundUrls,
      files: normalizedFiles,
    },
  };
}

async function listMdxFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = nodePath.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listMdxFiles(path)));
    else if (entry.isFile() && entry.name.endsWith('.mdx')) files.push(path);
  }
  return files.sort();
}

async function listFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = nodePath.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}

async function hashFiles(paths, root) {
  const hash = createHash('sha256');
  for (const path of paths) {
    const relativePath = nodePath
      .relative(root, path)
      .split(nodePath.sep)
      .join('/');
    hash.update(relativePath);
    hash.update('\0');
    hash.update(await readFile(path));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  if (result.status !== 0)
    throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

function installFixedDate(fixedNow) {
  const installedKey = Symbol.for('rolldown-cloudflare-mdx-fixed-date');
  if (globalThis[installedKey]) {
    if (globalThis[installedKey] !== fixedNow) {
      throw new Error(
        `A different fixed Date is already installed: ${globalThis[installedKey]}`,
      );
    }
    return;
  }
  const NativeDate = globalThis.Date;
  const fixedTime = NativeDate.parse(fixedNow);
  if (!Number.isFinite(fixedTime))
    throw new Error(`Invalid fixedNow value: ${fixedNow}`);
  function FixedDate(...args) {
    if (!new.target) return new NativeDate(fixedTime).toString();
    return Reflect.construct(
      NativeDate,
      args.length === 0 ? [fixedTime] : args,
      new.target,
    );
  }
  Object.setPrototypeOf(FixedDate, NativeDate);
  FixedDate.prototype = NativeDate.prototype;
  FixedDate.now = () => fixedTime;
  globalThis.Date = FixedDate;
  globalThis[installedKey] = fixedNow;
}
