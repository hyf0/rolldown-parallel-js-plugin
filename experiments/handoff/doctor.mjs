#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { availableParallelism, cpus, platform, release, totalmem } from 'node:os';
import { readFile, stat } from 'node:fs/promises';
import nodePath from 'node:path';
import {
  FROZEN_PERFORMANCE_HOST_POLICY,
  captureHostSnapshot,
  evaluateStartAdmission,
} from '../cloudflare-mdx/local-host-policy.mjs';

const handoffRoot = import.meta.dirname;
const repositoryRoot = nodePath.resolve(handoffRoot, '../..');
const manifest = JSON.parse(await readFile(nodePath.join(handoffRoot, 'manifest.json'), 'utf8'));
const checkpointOnly = process.argv.includes('--checkpoint-only');
const deep = process.argv.includes('--deep');
const checks = [];

await check('manifest', 'checkpoint', async () => {
  if (
    manifest.schema !== 1 ||
    manifest.kind !== 'rolldown-parallel-js-plugin-scale-crossover-handoff' ||
    manifest.protocol !== 'scale-crossover-v1-amended-8'
  ) {
    throw new Error('handoff manifest identity is invalid');
  }
  return manifest.protocol;
});

await check('research-checkout', 'checkpoint', async () => {
  const repository = repositoryById('research');
  const actualRoot = await realGitRoot(repositoryRoot);
  if (actualRoot !== repositoryRoot) throw new Error(`research checkout root is ${actualRoot}`);
  await requireRemote(repositoryRoot, repository.remote);
  const head = git(repositoryRoot, ['rev-parse', 'HEAD']);
  const tag = git(repositoryRoot, ['rev-parse', `${manifest.resumeTag}^{commit}`]);
  if (!isAncestor(repositoryRoot, tag, head)) throw new Error(`${manifest.resumeTag} is not an ancestor of HEAD`);
  const status = git(repositoryRoot, ['status', '--short']);
  if (status) throw new Error(`research checkout is dirty: ${status}`);
  return { head, resumeTagCommit: tag };
});

for (const artifact of manifest.runtimeArtifacts) {
  await check(`bundle-${artifact.id}`, 'checkpoint', async () => {
    const path = nodePath.join(handoffRoot, artifact.archive);
    await requireHash(path, artifact.archiveSha256);
    return { path: nodePath.relative(repositoryRoot, path), bytes: (await stat(path)).size };
  });
}

for (const [id, relativePath, sha256] of [
  ['cpulimit-bundle', manifest.cpuRateController.bundle, manifest.cpuRateController.bundleSha256],
  ['cpulimit-binary', manifest.cpuRateController.binary, manifest.cpuRateController.binarySha256],
  ['cpulimit-patch', manifest.cpuRateController.patch, manifest.cpuRateController.patchSha256],
]) {
  await check(id, 'checkpoint', async () => {
    const path = nodePath.resolve(handoffRoot, relativePath);
    await requireHash(path, sha256);
    return { path: nodePath.relative(repositoryRoot, path), bytes: (await stat(path)).size };
  });
}

for (const repository of manifest.repositories.filter(({ installedDependencies }) => installedDependencies)) {
  await check(`dependency-metadata-bundle-${repository.id}`, 'checkpoint', async () => {
    const dependency = repository.installedDependencies;
    const path = nodePath.join(handoffRoot, dependency.artifact);
    await requireHash(path, dependency.sha256);
    return { path: nodePath.relative(repositoryRoot, path), bytes: (await stat(path)).size };
  });
}

if (!checkpointOnly) {
  await check('canonical-workspace', 'setup', async () => {
    if (repositoryRoot !== repositoryById('research').path) {
      throw new Error(`current research root ${repositoryRoot} differs from the frozen canonical path`);
    }
    return manifest.canonicalWorkspaceRoot;
  });

  await check('node', 'setup', async () => {
    const actual = {
      version: process.version,
      canonicalPath: process.execPath,
      bytes: (await stat(process.execPath)).size,
      sha256: await fileHash(process.execPath),
    };
    if (JSON.stringify(actual) !== JSON.stringify(manifest.node)) {
      throw new Error(`Node differs from the frozen binary: ${JSON.stringify(actual)}`);
    }
    return actual;
  });

  for (const repository of manifest.repositories.filter(({ id }) => id !== 'research')) {
    await check(`checkout-${repository.id}`, 'setup', async () => {
      if (!(await exists(repository.path))) {
        if (repository.requiredForResume === false) return { optional: true, present: false };
        throw new Error(`missing ${repository.path}`);
      }
      await requireRemote(repository.path, repository.remote);
      const head = git(repository.path, ['rev-parse', 'HEAD']);
      const status = git(repository.path, ['status', '--short']);
      if (head !== repository.requiredCommit || status) {
        throw new Error(`${repository.id} differs: ${JSON.stringify({ head, status })}`);
      }
      if (repository.installedDependencies) {
        const installed = nodePath.join(repository.path, repository.installedDependencies.path);
        await requireHash(installed, repository.installedDependencies.sha256);
        const source = await readFile(installed, 'utf8');
        if (!source.includes(`\"packageManager\": \"${repository.installedDependencies.packageManager}\"`)) {
          throw new Error(
            `${repository.id} dependencies were not installed by ${repository.installedDependencies.packageManager}`,
          );
        }
      }
      return { head, optional: repository.requiredForResume === false };
    });
  }

  for (const artifact of manifest.runtimeArtifacts) {
    await check(`runtime-${artifact.id}`, 'setup', async () => {
      const repository = repositoryById(artifact.repositoryId);
      const root = nodePath.join(repository.path, artifact.destination);
      const files = await listFiles(root);
      const sizes = await Promise.all(files.map((path) => stat(path)));
      const actual = {
        files: files.length,
        bytes: sizes.reduce((sum, value) => sum + value.size, 0),
        distributionSha256: await hashFiles(files, root),
        bindingSha256: await fileHash(nodePath.join(root, 'rolldown-binding.darwin-arm64.node')),
        packageEntrySha256: await fileHash(nodePath.join(root, 'index.mjs')),
      };
      for (const key of Object.keys(actual)) {
        if (actual[key] !== artifact[key]) {
          throw new Error(`${artifact.id} ${key} mismatch: ${actual[key]} != ${artifact[key]}`);
        }
      }
      return actual;
    });
  }

  await check('cpulimit-restored', 'setup', async () => {
    const binary = nodePath.join(
      repositoryRoot,
      manifest.cpuRateController.destination,
      'src/cpulimit',
    );
    await requireHash(binary, manifest.cpuRateController.binarySha256);
    const head = git(nodePath.dirname(nodePath.dirname(binary)), ['rev-parse', 'HEAD']);
    if (head !== manifest.cpuRateController.commit) throw new Error(`cpulimit HEAD is ${head}`);
    return { head, binary };
  });

  for (const input of manifest.generatedInputs) {
    await check(`generated-${input.id}`, 'setup', async () => {
      const repository = repositoryById(input.repositoryId);
      const path = nodePath.join(repository.path, input.path);
      if (!(await exists(path))) throw new Error(`missing ${path}; ${input.rebuild}`);
      if (input.sha256) await requireHash(path, input.sha256);
      return path;
    });
  }

  for (const project of manifest.independentVueFormalProjects) {
    await check(`generated-independent-vue-${project.id}`, 'setup', async () => {
      const repository = repositoryById(project.repositoryId);
      const root = nodePath.join(repository.path, project.path);
      const head = git(root, ['rev-parse', 'HEAD']);
      const status = git(root, ['status', '--short']);
      if (head !== project.commit || status) {
        throw new Error(`${project.id} differs: ${JSON.stringify({ head, status })}`);
      }
      for (const file of project.criticalFiles) {
        await requireHash(nodePath.join(root, file.path), file.sha256);
      }
      return { head, criticalFiles: project.criticalFiles.length };
    });
  }

  await check('formal-host-topology', 'timing', async () => {
    const levels = [0, 1].map((index) => Number(sysctl(`hw.perflevel${index}.logicalcpu`)));
    const actual = {
      platform: platform(),
      architecture: process.arch,
      cpuModel: cpus()[0]?.model,
      availableParallelism: availableParallelism(),
      logicalCpuCount: cpus().length,
      performanceCores: levels[0],
      efficiencyCores: levels[1],
      totalMemoryBytes: totalmem(),
    };
    for (const key of Object.keys(actual)) {
      if (actual[key] !== manifest.formalHost[key]) {
        throw new Error(
          `${key}=${actual[key]} differs from frozen ${manifest.formalHost[key]}; ${manifest.formalHost.differentMachineDisposition}`,
        );
      }
    }
    return { ...actual, osRelease: release() };
  });

  await check('formal-host-admission-now', 'timing', async () => {
    const snapshot = captureHostSnapshot();
    const violations = evaluateStartAdmission(FROZEN_PERFORMANCE_HOST_POLICY, snapshot);
    if (violations.immediate.length || violations.transient.length) {
      throw new Error(JSON.stringify(violations));
    }
    return {
      uptimeSeconds: snapshot.uptimeSeconds,
      swapUsedBytes: snapshot.swapUsage.usedBytes,
      oneMinuteLoad: snapshot.loadAverage[0],
      totalProcessCpuPercent: snapshot.totalProcessCpuPercent,
      memoryFreePercentage: snapshot.memoryPressure.freePercentage,
    };
  });

  if (deep) await runDeepChecks();
}

const phases = Object.fromEntries(
  ['checkpoint', 'setup', 'timing'].map((phase) => {
    const selected = checks.filter((entry) => entry.phase === phase);
    return [
      phase,
      {
        ready: selected.length > 0 && selected.every(({ status }) => status === 'pass'),
        passed: selected.filter(({ status }) => status === 'pass').length,
        total: selected.length,
      },
    ];
  }),
);
const report = {
  schema: 1,
  kind: 'rolldown-parallel-js-plugin-handoff-doctor',
  protocol: manifest.protocol,
  checkpointOnly,
  deep,
  phases,
  readyForFormalTiming:
    deep && phases.checkpoint.ready && phases.setup.ready && phases.timing.ready,
  checks,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = checkpointOnly
  ? phases.checkpoint.ready
    ? 0
    : 1
  : report.readyForFormalTiming
    ? 0
    : 1;

async function runDeepChecks() {
  const cloudflareRoot = repositoryById('cloudflare-docs').path;
  const vueRoot = repositoryById('rolldown-vue-harness').path;
  const initializationRoot = repositoryById('rolldown-scale-lineage').path;
  const baselinePackageRoot = nodePath.join(
    repositoryById('rolldown-lifecycle').path,
    'packages/rolldown',
  );
  const attributionPackageRoot = nodePath.join(
    repositoryById('rolldown-attribution').path,
    'packages/rolldown',
  );
  const independentEvidence = nodePath.join(
    repositoryRoot,
    'research/artifacts/correctness/sha256',
    manifest.durableEvidence.independentVueContentAddress,
    'manifest.json',
  );
  const commands = [
    {
      id: 'mdx-scale-harness',
      arguments: ['experiments/cloudflare-mdx/verify-scale-harness.mjs', cloudflareRoot],
    },
    { id: 'mdx-correctness-gate', arguments: ['experiments/cloudflare-mdx/verify-correctness-gate.mjs'] },
    { id: 'mdx-attribution', arguments: ['experiments/cloudflare-mdx/verify-attribution-harness.mjs'] },
    { id: 'mdx-policy', arguments: ['experiments/cloudflare-mdx/verify-mdx-policy.mjs'] },
    {
      id: 'cpulimit-process-control',
      arguments: ['experiments/cloudflare-mdx/run-policy-matrix.mjs', '--verify-process-control'],
    },
    { id: 'evidence-store', arguments: ['experiments/evidence-store/verify-evidence-store.mjs'] },
    { id: 'product-ledger', arguments: ['experiments/product-capabilities/verify-product-capability-ledger.mjs'] },
    { id: 'fixed-policy-evaluator', arguments: ['experiments/worker-policy/verify-evaluator.mjs'] },
    { id: 'fixed-policy-artifacts', arguments: ['experiments/worker-policy/verify-evidence-artifacts.mjs'] },
    {
      id: 'vue-verification-contracts',
      cwd: nodePath.join(vueRoot, 'examples/par-plugin/cases/vue-projects'),
      arguments: ['test-verification.mjs'],
    },
    {
      id: 'vue-performance-contracts',
      cwd: nodePath.join(vueRoot, 'examples/par-plugin/cases/vue-projects'),
      arguments: ['test-performance-verification.mjs'],
    },
    {
      id: 'controlled-vue-admission-config',
      cwd: nodePath.join(vueRoot, 'examples/par-plugin/cases/vue-scale'),
      arguments: [
        'run-admission-audit.mjs',
        '/dev/null',
        '/dev/null',
        baselinePackageRoot,
        '--validate-only',
      ],
    },
    {
      id: 'controlled-vue-wall-config',
      cwd: nodePath.join(vueRoot, 'examples/par-plugin/cases/vue-scale'),
      arguments: [
        'run-matrix.mjs',
        'wall-screen-matrix.json',
        '/dev/null',
        baselinePackageRoot,
        '--validate-only',
      ],
    },
    {
      id: 'controlled-vue-attribution-config',
      cwd: nodePath.join(vueRoot, 'examples/par-plugin/cases/vue-scale'),
      arguments: [
        'run-matrix.mjs',
        'instrumented-matrix.json',
        '/dev/null',
        attributionPackageRoot,
        '--validate-only',
      ],
    },
    {
      id: 'independent-vue-wall-config',
      cwd: nodePath.join(vueRoot, 'examples/par-plugin/cases/vue-projects'),
      arguments: [
        'run-performance.mjs',
        'performance-wall-screen-matrix.json',
        '/dev/null',
        baselinePackageRoot,
        '--correctness-evidence',
        independentEvidence,
        '--validate-only',
      ],
    },
    {
      id: 'generic-initialization-contracts',
      cwd: nodePath.join(initializationRoot, 'examples/par-plugin/cases/runtime-initialization'),
      arguments: ['verify-summary.mjs'],
      environment: { ROLLDOWN_RESEARCH_PACKAGE_ROOT: attributionPackageRoot },
    },
    {
      id: 'generic-initialization-config',
      cwd: nodePath.join(initializationRoot, 'examples/par-plugin/cases/runtime-initialization'),
      arguments: ['run-matrix.mjs', 'formal-matrix.json', '--validate-only'],
      environment: { ROLLDOWN_RESEARCH_PACKAGE_ROOT: attributionPackageRoot },
    },
  ];
  for (const command of commands) {
    await check(`deep-${command.id}`, 'setup', async () => {
      const result = spawnSync(process.execPath, command.arguments, {
        cwd: command.cwd ?? repositoryRoot,
        env: { ...process.env, ...command.environment },
        encoding: 'utf8',
        maxBuffer: 128 * 1024 * 1024,
      });
      if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`.trim());
      return result.stdout.trim().split('\n').at(-1);
    });
  }
}

async function check(id, phase, operation) {
  try {
    checks.push({ id, phase, status: 'pass', detail: await operation() });
  } catch (error) {
    checks.push({ id, phase, status: 'fail', detail: error.message });
  }
}

function repositoryById(id) {
  const repository = manifest.repositories.find((entry) => entry.id === id);
  if (!repository) throw new Error(`Unknown repository ${id}`);
  return repository;
}

async function requireRemote(root, expected) {
  const actual = normalizeRemote(git(root, ['remote', 'get-url', 'origin']));
  if (actual !== normalizeRemote(expected)) throw new Error(`origin is ${actual}, expected ${expected}`);
}

async function realGitRoot(root) {
  return nodePath.resolve(git(root, ['rev-parse', '--show-toplevel']));
}

function isAncestor(root, ancestor, descendant) {
  const result = spawnSync('git', ['-C', root, 'merge-base', '--is-ancestor', ancestor, descendant]);
  return result.status === 0;
}

function git(root, arguments_) {
  const result = spawnSync('git', ['-C', root, ...arguments_], {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(result.stderr || `git ${arguments_.join(' ')} failed`);
  return result.stdout.trim();
}

function sysctl(name) {
  const result = spawnSync('sysctl', ['-n', name], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `sysctl ${name} failed`);
  return result.stdout.trim();
}

async function listFiles(directory) {
  const files = [];
  for (const entry of await (await import('node:fs/promises')).readdir(directory, {
    withFileTypes: true,
  })) {
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

async function requireHash(path, expected) {
  const actual = await fileHash(path);
  if (actual !== expected) throw new Error(`${path} SHA-256 ${actual} != ${expected}`);
}

async function fileHash(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function normalizeRemote(value) {
  return value
    .trim()
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/\.git$/, '')
    .toLowerCase();
}
