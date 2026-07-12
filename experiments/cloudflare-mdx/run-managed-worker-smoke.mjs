import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import nodePath from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { createManagedWorkerCloudflareMdxPlugin } from './managed-worker-plugin.mjs';
import { createOrdinaryCloudflareMdxPlugin } from './ordinary-plugin.mjs';
import {
  assertChildCaptureComplete,
  CHILD_MAX_BUFFER_BYTES,
} from './child-buffer-policy.mjs';

if (process.argv[2] === '--child') {
  await runChild(JSON.parse(process.argv[3] ?? 'null'));
} else {
  await runParent();
}

async function runParent() {
  const projectRoot = nodePath.resolve(process.argv[2] ?? '');
  const rolldownPackageRoot = nodePath.resolve(process.argv[3] ?? '');
  const managedWorkerCount = Number(process.argv[4] ?? 2);
  if (!projectRoot || !rolldownPackageRoot) {
    throw new Error('Expected project root and Rolldown package root');
  }
  if (!Number.isSafeInteger(managedWorkerCount) || managedWorkerCount < 1) {
    throw new Error('Expected a positive managed worker count');
  }

  const results = [];
  for (const limit of [1, 32]) {
    for (const variant of ['ordinary', 'managed']) {
      const child = spawnSync(
        process.execPath,
        [
          '--expose-gc',
          import.meta.filename,
          '--child',
          JSON.stringify({
            projectRoot,
            rolldownPackageRoot,
            managedWorkerCount,
            variant,
            limit,
            fixedNow: '2026-07-12T00:00:00.000Z',
          }),
        ],
        {
          encoding: 'utf8',
          env: sanitizedEnvironment(),
          maxBuffer: CHILD_MAX_BUFFER_BYTES,
        },
      );
      assertChildCaptureComplete(child, 'managed worker smoke');
      if (child.status !== 0) {
        throw new Error(
          'Managed worker smoke failed for ' +
            limit +
            '/' +
            variant +
            ':\n' +
            child.stdout +
            '\n' +
            child.stderr,
        );
      }
      results.push(JSON.parse(child.stdout));
    }
    const pair = results.filter((result) => result.limit === limit);
    for (const field of ['entryCount', 'outputChunks', 'outputBytes', 'outputHash']) {
      const values = new Set(pair.map((result) => result[field]));
      if (values.size !== 1) {
        throw new Error('Managed worker smoke parity failed for ' + limit + '/' + field);
      }
    }
  }
  process.stdout.write(
    JSON.stringify({ schema: 1, managedWorkerCount, fixedNow: results[0].fixedNow, results }, null, 2) +
      '\n',
  );
}

async function runChild(options) {
  const {
    projectRoot,
    rolldownPackageRoot,
    managedWorkerCount,
    variant,
    limit,
    fixedNow,
  } = options ?? {};
  if (variant !== 'ordinary' && variant !== 'managed') {
    throw new Error('Invalid managed worker smoke variant: ' + variant);
  }
  if (process.version !== 'v24.18.0') {
    throw new Error('Expected Node v24.18.0, got ' + process.version);
  }

  delete process.env.ASTRO_PERFORMANCE_BENCHMARK;
  delete process.env.BUILD_TARGET;
  delete process.env.RUN_LINK_CHECK;
  process.env.NODE_ENV = 'production';
  process.chdir(projectRoot);
  const entries = (
    await listMdxFiles(nodePath.join(projectRoot, 'src/content/docs'))
  ).slice(0, limit);
  if (entries.length !== limit) throw new Error('Could not select ' + limit + ' MDX entries');

  const { rolldown } = await import(
    pathToFileURL(nodePath.join(rolldownPackageRoot, 'dist/index.mjs'))
  );
  globalThis.gc?.();
  const cpuStartedAt = process.cpuUsage();
  const startedAt = performance.now();
  const pluginOptions = { projectRoot, fixedNow, managedWorkerCount };
  const plugin =
    variant === 'ordinary'
      ? await createOrdinaryCloudflareMdxPlugin(pluginOptions)
      : await createManagedWorkerCloudflareMdxPlugin(pluginOptions);
  const pluginReadyAt = performance.now();
  let build;
  try {
    const input = Object.fromEntries(
      entries.map((path) => [nodePath.relative(projectRoot, path).replace(/\.mdx$/, ''), path]),
    );
    build = await rolldown({
      cwd: projectRoot,
      input,
      external(_source, importer) {
        return Boolean(importer?.endsWith('.mdx'));
      },
      logLevel: 'silent',
      moduleTypes: { mdx: 'ts' },
      plugins: [plugin],
      treeshake: false,
    });
    const result = await build.generate({
      format: 'esm',
      entryFileNames: '[name].js',
      chunkFileNames: 'chunks/[name]-[hash].js',
    });
    await build.close();
    build = undefined;
    const finishedAt = performance.now();
    const cpu = process.cpuUsage(cpuStartedAt);
    const outputHash = createHash('sha256');
    let outputBytes = 0;
    let outputChunks = 0;
    for (const output of [...result.output].sort((left, right) =>
      left.fileName.localeCompare(right.fileName),
    )) {
      const source = output.type === 'chunk' ? output.code : String(output.source);
      outputBytes += Buffer.byteLength(source);
      if (output.type === 'chunk') outputChunks++;
      outputHash.update(output.type);
      outputHash.update('\0');
      outputHash.update(output.fileName);
      outputHash.update('\0');
      outputHash.update(source);
      outputHash.update('\0');
    }
    process.stdout.write(
      JSON.stringify({
        variant,
        managedWorkerCount: variant === 'managed' ? managedWorkerCount : 0,
        limit,
        entryCount: entries.length,
        fixedNow,
        totalElapsedMs: finishedAt - startedAt,
        pluginSetupElapsedMs: pluginReadyAt - startedAt,
        cpuUserMs: cpu.user / 1000,
        cpuSystemMs: cpu.system / 1000,
        outputChunks,
        outputBytes,
        outputHash: outputHash.digest('hex'),
      }) + '\n',
    );
  } finally {
    await build?.close();
  }
}

function sanitizedEnvironment() {
  const environment = { ...process.env };
  delete environment.ROLLDOWN_PARALLEL_PLUGIN_WORKERS;
  delete environment.ROLLDOWN_PARALLEL_PLUGIN_METRICS;
  delete environment.ASTRO_PERFORMANCE_BENCHMARK;
  delete environment.BUILD_TARGET;
  delete environment.RUN_LINK_CHECK;
  environment.NODE_ENV = 'production';
  return environment;
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
