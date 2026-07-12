import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import nodePath from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { createOrdinaryCloudflareMdxPlugin } from './ordinary-plugin.mjs';
import { createParallelCloudflareMdxPlugin } from './parallel-plugin.mjs';
import { createManagedWorkerCloudflareMdxPlugin } from './managed-worker-plugin.mjs';
import { createMetricsBuffer, readMetrics, toCorrectnessCounters } from './metrics.mjs';
import { createCloudflareOutputNormalizer } from './normalize-output.mjs';
import { assertPoolEnvironment, readPoolEnvironment } from './pool-environment.mjs';
import { selectScalePrefix } from './scale-corpus.mjs';
import { normalizeRuntimeProfile, validateRuntimeLane } from './runtime-profile.mjs';
import { startAttributionResourceCapture } from './attribution-resources.mjs';

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
  selectionScale,
  selectionPrefixSha256,
  expectedPoolEnvironment,
  runtimeProfile,
  rustInstrumentation = false,
  measurementMode = 'measurement',
  lifecycleClaim = false,
  evidenceKind,
} = options;
if (variant !== 'ordinary' && !/^(?:worker|managed)-(?:[1-9]|1[0-2])$/.test(variant)) {
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
if (
  corpus !== 'production-mdx' &&
  corpus !== 'docs' &&
  corpus !== 'cloudflare-mdx-scale-v1' &&
  corpus !== 'semantic-diagnostic'
) {
  throw new Error(`Invalid corpus: ${corpus}`);
}
if (corpus === 'cloudflare-mdx-scale-v1' && limit !== 0) {
  throw new Error('cloudflare-mdx-scale-v1 forbids the legacy lexicographic limit');
}
if (
  corpus === 'semantic-diagnostic' &&
  (limit !== 0 || selectionScale !== undefined || selectionPrefixSha256 !== undefined)
) {
  throw new Error('semantic-diagnostic uses only the pinned invalid fixture');
}
if (buildProfile !== 'default' && buildProfile !== 'ci-link-check') {
  throw new Error(`Invalid buildProfile: ${buildProfile}`);
}
if (measurementMode !== 'measurement' && measurementMode !== 'correctness-only') {
  throw new Error(`Invalid measurementMode: ${measurementMode}`);
}
const recordMeasurements = measurementMode === 'measurement';
const policyEvidenceKinds = new Set([
  'allocation-tokio-screen',
  'allocation-tokio-confirmation',
  'allocation-rayon-screen',
  'allocation-rayon-confirmation',
  'quota-screen',
  'quota-confirmation',
]);
if (
  evidenceKind !== 'correctness-only' &&
  evidenceKind !== 'historical-replay' &&
  evidenceKind !== 'attribution' &&
  !policyEvidenceKinds.has(evidenceKind) &&
  !evidenceKind?.startsWith('performance-')
) {
  throw new Error(`run-case requires an explicit evidenceKind, got ${evidenceKind}`);
}
const poolEnvironment = expectedPoolEnvironment
  ? assertPoolEnvironment(expectedPoolEnvironment)
  : readPoolEnvironment();
const expectedRuntime = normalizeRuntimeProfile(runtimeProfile);
validateRuntimeLane({
  runtimeProfile: expectedRuntime,
  instrumentation,
  rustInstrumentation,
  evidenceKind,
  lifecycleClaim,
});
if (expectedRuntime.kind === 'historical-0aa-artifact' && measurementMode !== 'correctness-only') {
  throw new Error('Historical replay must use measurementMode=correctness-only');
}

const expectedProjectCommit = '2b08a67a41da1a521aecbcf465893abae1e9a6df';
const expectedSourceManifestHash =
  '84077a08f660782274d5502be25f0ec9297cec9c52508e2c5e9e2a3e8bedc12b';
if (process.version !== 'v24.18.0')
  throw new Error(`Expected Node v24.18.0, got ${process.version}`);
const projectCommit = git(projectRoot, ['rev-parse', 'HEAD']);
const projectStatus = git(projectRoot, ['status', '--short']);
const rolldownRoot = nodePath.resolve(rolldownPackageRoot, '../..');
const rolldownCommit = git(rolldownRoot, ['rev-parse', 'HEAD']);
const rolldownStatus = git(rolldownRoot, ['status', '--short']);
const bindingHash = createHash('sha256')
  .update(
    await readFile(nodePath.join(rolldownPackageRoot, 'dist/rolldown-binding.darwin-arm64.node')),
  )
  .digest('hex');
const distDirectory = nodePath.join(rolldownPackageRoot, 'dist');
const distHash = await hashFiles(await listFiles(distDirectory), distDirectory);
if (projectCommit !== expectedProjectCommit || projectStatus !== '') {
  throw new Error(`Cloudflare source is not the clean pin: ${projectCommit}\n${projectStatus}`);
}
if (
  rolldownCommit !== expectedRuntime.rolldownCommit ||
  rolldownStatus !== '' ||
  bindingHash !== expectedRuntime.bindingSha256 ||
  distHash !== expectedRuntime.distSha256
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
const scaleSelection =
  corpus === 'cloudflare-mdx-scale-v1'
    ? await selectScalePrefix({
        projectRoot,
        scale: selectionScale,
        expectedPrefixSha256: selectionPrefixSha256,
      })
    : undefined;
const allEntries = corpus === 'docs' ? docsEntries : productionEntries;
const diagnosticFixturePath = nodePath.resolve(
  import.meta.dirname,
  'fixtures/invalid-diagnostic.mdx',
);
const entryPaths =
  corpus === 'semantic-diagnostic'
    ? [diagnosticFixturePath]
    : scaleSelection
      ? scaleSelection.absolutePaths
      : limit > 0
        ? allEntries.slice(0, limit)
        : allEntries;
if (entryPaths.length === 0) throw new Error('No MDX entries selected');
const generatedPlaygroundOutputFiles = new Set();
for (const path of entryPaths) {
  if (/^```[^\n]*\bplayground\b/m.test(await readFile(path, 'utf8'))) {
    generatedPlaygroundOutputFiles.add(
      nodePath.relative(projectRoot, path).replace(/\.mdx$/, '.js'),
    );
  }
}

const attributionResourceCapture =
  evidenceKind === 'attribution' ? startAttributionResourceCapture() : undefined;
const { rolldown } = await import(
  pathToFileURL(nodePath.join(rolldownPackageRoot, 'dist/index.mjs'))
);
const normalizeOutput = await createCloudflareOutputNormalizer(projectRoot);
globalThis.gc?.();
const cpuStartedAt = recordMeasurements ? process.cpuUsage() : undefined;
const totalStartedAt = recordMeasurements ? performance.now() : undefined;
const metricsBuffer = instrumentation ? createMetricsBuffer(entryPaths.length) : undefined;
const pluginOptions = {
  projectRoot,
  metricsBuffer,
  metricsMode: recordMeasurements ? 'attribution' : 'correctness-only',
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
const pluginSetupFinishedAt = recordMeasurements ? performance.now() : undefined;

let build;
if (corpus === 'semantic-diagnostic') {
  await runSemanticDiagnostic();
} else {
  try {
    const input = Object.fromEntries(
      entryPaths.map((path) => [nodePath.relative(projectRoot, path).replace(/\.mdx$/, ''), path]),
    );
    const buildStartedAt = recordMeasurements ? performance.now() : undefined;
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
    const generateStartedAt = recordMeasurements ? performance.now() : undefined;
    const result = await build.generate({
      format: 'esm',
      entryFileNames: '[name].js',
      chunkFileNames: 'chunks/[name]-[hash].js',
    });
    const generateFinishedAt = recordMeasurements ? performance.now() : undefined;
    await build.close();
    build = undefined;
    const totalFinishedAt = recordMeasurements ? performance.now() : undefined;
    const cpu = recordMeasurements ? process.cpuUsage(cpuStartedAt) : undefined;
    const attributionResources = attributionResourceCapture?.finish();
    const metrics = readMetrics(metricsBuffer, entryPaths);
    if (metrics && metrics.handlerCalls !== entryPaths.length) {
      throw new Error(
        `Expected ${entryPaths.length} MDX transforms, observed ${metrics.handlerCalls}`,
      );
    }
    if (metrics && metrics.active !== 0)
      throw new Error('MDX handler activity did not return to zero');
    if (
      metrics &&
      (metrics.distinctHandlerIds !== entryPaths.length ||
        metrics.missingHandlerIds.length !== 0 ||
        metrics.duplicateHandlerIds.length !== 0 ||
        metrics.unknownIdCalls !== 0 ||
        (recordMeasurements && metrics.clockAnchors.length !== metrics.factoryCalls) ||
        (recordMeasurements && metrics.kernelTimeline.completedEntries !== entryPaths.length) ||
        (!recordMeasurements && metrics.clockAnchors.length !== 0) ||
        (!recordMeasurements && metrics.kernelTimeline.completedEntries !== 0) ||
        (!recordMeasurements &&
          (metrics.initializationMsTotal !== 0 || metrics.serviceMsTotal !== 0)))
    ) {
      throw new Error(
        'MDX handler IDs or monotonic kernel intervals were incomplete, duplicated, or outside the selected corpus',
      );
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
        selection: scaleSelection
          ? {
              algorithm: scaleSelection.algorithm,
              scale: scaleSelection.scale,
              prefixSha256: scaleSelection.prefixSha256,
              prefixSummary: scaleSelection.prefixSummary,
              manifestFullSelectionSha256: scaleSelection.manifestFullSelectionSha256,
            }
          : undefined,
        buildProfile,
        effectiveRunLinkCheck: process.env.RUN_LINK_CHECK === 'true',
        limit,
        instrumentation,
        rustInstrumentation,
        measurementMode,
        lifecycleClaim,
        evidenceKind,
        processId: recordMeasurements ? process.pid : undefined,
        fixedNow,
        discoveredProductionMdxFiles: productionEntries.length,
        discoveredDocsMdxFiles: docsEntries.length,
        transformedEntryCount: entryPaths.length,
        projectCommit,
        rolldownCommit,
        bindingHash,
        distHash,
        sourceManifestHash,
        poolEnvironment,
        runtimeProfile: expectedRuntime,
        totalElapsedMs: recordMeasurements ? totalFinishedAt - totalStartedAt : undefined,
        mainPluginConstructionElapsedMs: recordMeasurements
          ? pluginSetupFinishedAt - totalStartedAt
          : undefined,
        rolldownCreateElapsedMs: recordMeasurements
          ? generateStartedAt - buildStartedAt
          : undefined,
        generateAndWorkerLifecycleElapsedMs: recordMeasurements
          ? generateFinishedAt - generateStartedAt
          : undefined,
        closeElapsedMs: recordMeasurements ? totalFinishedAt - generateFinishedAt : undefined,
        cpuUserMs: recordMeasurements ? cpu.user / 1000 : undefined,
        cpuSystemMs: recordMeasurements ? cpu.system / 1000 : undefined,
        finalRssBytes: recordMeasurements ? process.memoryUsage.rss() : undefined,
        attributionResources,
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
        metrics: recordMeasurements ? metrics : undefined,
        correctnessCounters: recordMeasurements
          ? undefined
          : toCorrectnessCounters(metrics, entryPaths, projectRoot),
      }),
    );
  } finally {
    await build?.close();
  }
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

async function runSemanticDiagnostic() {
  const input = { 'invalid-diagnostic': diagnosticFixturePath };
  let diagnosticBuild;
  let diagnostic;
  try {
    diagnosticBuild = await rolldown({
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
    await diagnosticBuild.generate({
      format: 'esm',
      entryFileNames: '[name].js',
      chunkFileNames: 'chunks/[name]-[hash].js',
    });
  } catch (error) {
    diagnostic = serializeDiagnostic(error);
  } finally {
    await diagnosticBuild?.close();
  }
  if (!diagnostic) {
    throw new Error('The pinned invalid MDX fixture compiled successfully');
  }
  if (!diagnostic.message || diagnostic.name.length === 0) {
    throw new Error(`The invalid MDX failure was not structured: ${JSON.stringify(diagnostic)}`);
  }
  console.log(
    JSON.stringify({
      variant,
      workerCount,
      workerModel,
      corpus,
      measurementMode,
      evidenceKind,
      timingEligible: false,
      projectCommit,
      rolldownCommit,
      bindingHash,
      distHash,
      sourceManifestHash,
      poolEnvironment,
      runtimeProfile: expectedRuntime,
      fixture: {
        path: nodePath.relative(import.meta.dirname, diagnosticFixturePath),
        sourceSha256: createHash('sha256')
          .update(await readFile(diagnosticFixturePath))
          .digest('hex'),
      },
      diagnostic,
    }),
  );
}

function serializeDiagnostic(error) {
  const value = error && typeof error === 'object' ? error : { message: String(error) };
  const stack = typeof value.stack === 'string' ? value.stack : undefined;
  return {
    name: typeof value.name === 'string' ? value.name : 'Error',
    message: typeof value.message === 'string' ? value.message : String(error),
    code: serializableField(value.code) ?? null,
    pluginCode: serializableField(value.pluginCode ?? value.cause?.pluginCode) ?? null,
    plugin: serializableField(value.plugin) ?? null,
    hook: serializableField(value.hook) ?? null,
    id: serializableField(value.id) ?? null,
    loc: serializableField(value.loc) ?? null,
    frame: serializableField(value.frame) ?? null,
    causeName:
      value.cause && typeof value.cause === 'object' && typeof value.cause.name === 'string'
        ? value.cause.name
        : null,
    causeMessage:
      value.cause && typeof value.cause === 'object' && typeof value.cause.message === 'string'
        ? value.cause.message
        : null,
    stackHasFixture: stack?.includes('invalid-diagnostic.mdx') ?? false,
    stackHasPluginName: stack?.includes('cloudflare-mdx') ?? false,
    line: diagnosticCoordinate(value, 'line'),
    column: diagnosticCoordinate(value, 'column'),
  };
}

function diagnosticCoordinate(value, name) {
  const candidate = value[name] ?? value.loc?.[name] ?? value.cause?.[name] ?? value.cause?.loc?.[name];
  return Number.isInteger(candidate) && candidate >= 0 ? candidate : null;
}

function serializableField(value) {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}
