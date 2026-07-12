import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import nodePath from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { createOrdinaryCloudflareMdxPlugin } from './ordinary-plugin.mjs';
import { createParallelCloudflareMdxPlugin } from './parallel-plugin.mjs';
import { createManagedWorkerCloudflareMdxPlugin } from './managed-worker-plugin.mjs';
import { createMetricsBuffer, readMetrics } from './metrics.mjs';
import { createCloudflareOutputNormalizer } from './normalize-output.mjs';

const options = JSON.parse(process.argv[2] ?? 'null');
if (!options) throw new Error('Expected a JSON options object');
const {
  projectRoot,
  rolldownPackageRoot,
  variant,
  corpus = 'production-mdx',
  buildProfile = 'default',
  limit = 0,
  instrumentation = false,
  captureOutputManifest = false,
  fixedNow = '2026-07-12T00:00:00.000Z',
} = options;
if (
  variant !== 'ordinary' &&
  !/^(?:worker|managed)-(?:[1-9]|1[0-2])$/.test(variant)
) {
  throw new Error(`Invalid variant: ${variant}`);
}
const workerMatch = /^worker-(\d+)$/.exec(variant);
const managedMatch = /^managed-(\d+)$/.exec(variant);
const workerCount = workerMatch
  ? Number(workerMatch[1])
  : managedMatch
    ? Number(managedMatch[1])
    : 0;
const workerModel = workerMatch ? 'rolldown' : managedMatch ? 'plugin-managed' : 'ordinary';
if (instrumentation && managedMatch) {
  throw new Error('Managed worker instrumentation is not implemented; use an uninstrumented case');
}
if (workerMatch) process.env.ROLLDOWN_PARALLEL_PLUGIN_WORKERS = String(workerCount);
else delete process.env.ROLLDOWN_PARALLEL_PLUGIN_WORKERS;
if (!nodePath.isAbsolute(projectRoot) || !nodePath.isAbsolute(rolldownPackageRoot)) {
  throw new Error('projectRoot and rolldownPackageRoot must be absolute paths');
}
if (corpus !== 'production-mdx' && corpus !== 'docs') throw new Error(`Invalid corpus: ${corpus}`);
if (buildProfile !== 'default' && buildProfile !== 'ci-link-check') {
  throw new Error(`Invalid buildProfile: ${buildProfile}`);
}

const expectedProjectCommit = '2b08a67a41da1a521aecbcf465893abae1e9a6df';
const expectedRolldownCommit = '0aa600b5721b852cdc4095c7122a929a8cb4a798';
const expectedBindingHash = 'deec0b2cb7a12e507ff223e12535c3280ab5fe8371f2fcc92f9db206163f1c5d';
const expectedDistHash = 'e30311e764bae7fba9afe27665db741d556a7c3728eb67cfbe7ce0fed3135ebc';
const expectedSourceManifestHash = '84077a08f660782274d5502be25f0ec9297cec9c52508e2c5e9e2a3e8bedc12b';
if (process.version !== 'v24.18.0') throw new Error(`Expected Node v24.18.0, got ${process.version}`);
const projectCommit = git(projectRoot, ['rev-parse', 'HEAD']);
const projectStatus = git(projectRoot, ['status', '--short']);
const rolldownRoot = nodePath.resolve(rolldownPackageRoot, '../..');
const rolldownCommit = git(rolldownRoot, ['rev-parse', 'HEAD']);
const rolldownStatus = git(rolldownRoot, ['status', '--short']);
const bindingHash = createHash('sha256')
  .update(
    await readFile(
      nodePath.join(rolldownPackageRoot, 'dist/rolldown-binding.darwin-arm64.node'),
    ),
  )
  .digest('hex');
const distDirectory = nodePath.join(rolldownPackageRoot, 'dist');
const distHash = await hashFiles(await listFiles(distDirectory), distDirectory);
if (projectCommit !== expectedProjectCommit || projectStatus !== '') {
  throw new Error(`Cloudflare source is not the clean pin: ${projectCommit}\n${projectStatus}`);
}
if (
  rolldownCommit !== expectedRolldownCommit ||
  rolldownStatus !== '' ||
  bindingHash !== expectedBindingHash ||
  distHash !== expectedDistHash
) {
  throw new Error(
    `Rolldown runtime is not the pinned clean build: ${rolldownCommit} ${bindingHash} ${distHash}\n${rolldownStatus}`,
  );
}

process.env.ROLLDOWN_RESEARCH_PACKAGE_ROOT = rolldownPackageRoot;
delete process.env.ASTRO_PERFORMANCE_BENCHMARK;
delete process.env.BUILD_TARGET;
if (buildProfile === 'ci-link-check') process.env.RUN_LINK_CHECK = 'true';
else delete process.env.RUN_LINK_CHECK;
process.env.NODE_ENV = 'production';
process.chdir(projectRoot);
const productionEntries = await listMdxFiles(nodePath.join(projectRoot, 'src/content'));
const sourceManifestHash = await hashFiles(productionEntries, projectRoot);
if (sourceManifestHash !== expectedSourceManifestHash) {
  throw new Error(`Cloudflare MDX manifest changed: ${sourceManifestHash}`);
}
const docsEntries = productionEntries.filter((path) =>
  path.startsWith(`${nodePath.join(projectRoot, 'src/content/docs')}${nodePath.sep}`),
);
const allEntries = corpus === 'docs' ? docsEntries : productionEntries;
const entryPaths = limit > 0 ? allEntries.slice(0, limit) : allEntries;
if (entryPaths.length === 0) throw new Error('No MDX entries selected');
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
const metricsBuffer = instrumentation ? createMetricsBuffer(entryPaths.length) : undefined;
const pluginOptions = {
  projectRoot,
  metricsBuffer,
  fixedNow,
  entryPaths: instrumentation ? entryPaths : undefined,
};
const plugin =
  variant === 'ordinary'
    ? await createOrdinaryCloudflareMdxPlugin(pluginOptions)
    : managedMatch
      ? await createManagedWorkerCloudflareMdxPlugin({
          ...pluginOptions,
          managedWorkerCount: workerCount,
        })
      : await createParallelCloudflareMdxPlugin(pluginOptions);
const pluginSetupFinishedAt = performance.now();

let build;
try {
  const input = Object.fromEntries(
    entryPaths.map((path) => [nodePath.relative(projectRoot, path).replace(/\.mdx$/, ''), path]),
  );
  const buildStartedAt = performance.now();
  build = await rolldown({
    cwd: projectRoot,
    input,
    external(source, importer) {
      return Boolean(importer?.endsWith('.mdx'));
    },
    logLevel: 'silent',
    moduleTypes: { mdx: 'ts' },
    plugins: [plugin],
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
  const cpu = process.cpuUsage(cpuStartedAt);
  const metrics = readMetrics(metricsBuffer, entryPaths);
  if (metrics && metrics.handlerCalls !== entryPaths.length) {
    throw new Error(`Expected ${entryPaths.length} MDX transforms, observed ${metrics.handlerCalls}`);
  }
  if (metrics && metrics.active !== 0) throw new Error('MDX handler activity did not return to zero');
  if (
    metrics &&
    (metrics.distinctHandlerIds !== entryPaths.length ||
      metrics.missingHandlerIds.length !== 0 ||
      metrics.duplicateHandlerIds.length !== 0 ||
      metrics.unknownIdCalls !== 0)
  ) {
    throw new Error('MDX handler IDs were missing, duplicated, or outside the selected corpus');
  }
  const outputHash = createHash('sha256');
  const normalizedOutputHash = createHash('sha256');
  const outputManifest = captureOutputManifest ? [] : undefined;
  let outputBytes = 0;
  let normalizedOutputBytes = 0;
  let outputChunks = 0;
  let normalizedPlaygroundUrls = 0;
  const normalizedFiles = [];
  for (const output of [...result.output].sort((left, right) =>
    left.fileName.localeCompare(right.fileName),
  )) {
    const source = output.type === 'chunk' ? output.code : String(output.source);
    const normalized = normalizeOutput(
      source,
      generatedPlaygroundOutputFiles.has(output.fileName),
    );
    outputBytes += Buffer.byteLength(source);
    normalizedOutputBytes += Buffer.byteLength(normalized.code);
    normalizedPlaygroundUrls += normalized.playgroundUrls;
    if (normalized.playgroundUrls > 0) normalizedFiles.push(output.fileName);
    if (output.type === 'chunk') outputChunks++;
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
    outputManifest?.push({
      type: output.type,
      fileName: output.fileName,
      bytes: Buffer.byteLength(source),
      hash: createHash('sha256').update(source).digest('hex'),
      normalizedBytes: Buffer.byteLength(normalized.code),
      normalizedHash: createHash('sha256').update(normalized.code).digest('hex'),
      normalizedPlaygroundUrls: normalized.playgroundUrls,
    });
  }
  console.log(
    JSON.stringify({
      variant,
      workerCount,
      workerModel,
      corpus,
      buildProfile,
      effectiveRunLinkCheck: process.env.RUN_LINK_CHECK === 'true',
      limit,
      instrumentation,
      fixedNow,
      discoveredProductionMdxFiles: productionEntries.length,
      discoveredDocsMdxFiles: docsEntries.length,
      transformedEntryCount: entryPaths.length,
      projectCommit,
      rolldownCommit,
      bindingHash,
      distHash,
      sourceManifestHash,
      totalElapsedMs: totalFinishedAt - totalStartedAt,
      mainPluginConstructionElapsedMs: pluginSetupFinishedAt - totalStartedAt,
      rolldownCreateElapsedMs: generateStartedAt - buildStartedAt,
      generateAndWorkerLifecycleElapsedMs: generateFinishedAt - generateStartedAt,
      closeElapsedMs: totalFinishedAt - generateFinishedAt,
      cpuUserMs: cpu.user / 1000,
      cpuSystemMs: cpu.system / 1000,
      finalRssBytes: process.memoryUsage.rss(),
      outputBytes,
      outputChunks,
      outputHash: outputHash.digest('hex'),
      normalizedOutputBytes,
      normalizedOutputHash: normalizedOutputHash.digest('hex'),
      outputNormalization: {
        kind: 'undici-formdata-boundary',
        playgroundUrls: normalizedPlaygroundUrls,
        files: normalizedFiles,
      },
      linkValidationMainStoreEntries:
        buildProfile === 'ci-link-check'
          ? (globalThis._starlightLinksValidatorValidationData?.size ?? 0)
          : undefined,
      outputManifest,
      metrics,
    }),
  );
} finally {
  await build?.close();
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
    const relativePath = nodePath.relative(root, path).split(nodePath.sep).join('/');
    hash.update(relativePath);
    hash.update('\0');
    hash.update(await readFile(path));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}
