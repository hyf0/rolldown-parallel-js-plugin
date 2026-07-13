#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
} from 'node:fs/promises';
import nodePath from 'node:path';

const handoffRoot = import.meta.dirname;
const repositoryRoot = nodePath.resolve(handoffRoot, '../..');
const manifest = JSON.parse(await readFile(nodePath.join(handoffRoot, 'manifest.json'), 'utf8'));
const action = process.argv[2] ?? '--verify';

if (
  ![
    '--verify',
    '--restore-runtimes',
    '--restore-cpulimit',
    '--restore-dependency-metadata',
    '--restore-all',
  ].includes(action)
) {
  throw new Error(
    'Usage: node experiments/handoff/restore-artifacts.mjs [--verify|--restore-runtimes|--restore-cpulimit|--restore-dependency-metadata|--restore-all]',
  );
}

await verifyBundledArtifacts();
if (action === '--restore-runtimes' || action === '--restore-all') {
  for (const artifact of manifest.runtimeArtifacts) await restoreRuntime(artifact);
}
if (action === '--restore-cpulimit' || action === '--restore-all') await restoreCpulimit();
if (action === '--restore-dependency-metadata' || action === '--restore-all') {
  await restoreDependencyMetadata();
}
await verifyDestinations({
  runtimes: ['--verify', '--restore-runtimes', '--restore-all'].includes(action),
  cpulimit: ['--verify', '--restore-cpulimit', '--restore-all'].includes(action),
  dependencyMetadata: ['--verify', '--restore-dependency-metadata', '--restore-all'].includes(action),
});

async function verifyBundledArtifacts() {
  for (const artifact of manifest.runtimeArtifacts) {
    await requireFileHash(nodePath.join(handoffRoot, artifact.archive), artifact.archiveSha256);
  }
  const controller = manifest.cpuRateController;
  await requireFileHash(nodePath.join(handoffRoot, controller.bundle), controller.bundleSha256);
  await requireFileHash(nodePath.join(handoffRoot, controller.binary), controller.binarySha256);
  await requireFileHash(nodePath.resolve(handoffRoot, controller.patch), controller.patchSha256);
  for (const repository of manifest.repositories.filter(({ installedDependencies }) => installedDependencies)) {
    await requireFileHash(
      nodePath.join(handoffRoot, repository.installedDependencies.artifact),
      repository.installedDependencies.sha256,
    );
  }
}

async function restoreRuntime(artifact) {
  const repository = repositoryById(artifact.repositoryId);
  await requireCheckout(repository);
  const archive = nodePath.join(handoffRoot, artifact.archive);
  const listing = run('tar', ['-tzf', archive]).stdout
    .split('\n')
    .filter(Boolean);
  const prefix = `${artifact.destination}/`;
  const unsafePath = listing.find((entry) => {
    const withoutSlash = entry.endsWith('/') ? entry.slice(0, -1) : entry;
    return (
      nodePath.posix.isAbsolute(entry) ||
      withoutSlash.split('/').includes('..') ||
      nodePath.posix.normalize(withoutSlash) !== withoutSlash ||
      (entry !== prefix && !entry.startsWith(prefix))
    );
  });
  const unsafeType = run('tar', ['-tvzf', archive]).stdout
    .split('\n')
    .filter(Boolean)
    .find((entry) => !['-', 'd'].includes(entry[0]));
  if (listing.length === 0 || unsafePath || unsafeType) {
    throw new Error(`${artifact.id} archive contains an unexpected path`);
  }
  await rm(nodePath.join(repository.path, artifact.destination), { recursive: true, force: true });
  run('tar', ['-xzf', archive, '-C', repository.path]);
  await requireRuntimeArtifact(artifact, repository);
  process.stdout.write(`restored ${artifact.id} at ${repository.path}\n`);
}

async function restoreCpulimit() {
  const controller = manifest.cpuRateController;
  const destination = nodePath.join(repositoryRoot, controller.destination);
  await rm(destination, { recursive: true, force: true });
  await mkdir(nodePath.dirname(destination), { recursive: true });
  run('git', ['clone', nodePath.join(handoffRoot, controller.bundle), destination]);
  run('git', ['-C', destination, 'checkout', '--detach', controller.commit]);
  run('git', ['-C', destination, 'apply', nodePath.resolve(handoffRoot, controller.patch)]);
  const binaryDestination = nodePath.join(destination, 'src/cpulimit');
  await copyFile(nodePath.join(handoffRoot, controller.binary), binaryDestination);
  await chmod(binaryDestination, 0o755);
  const { captureCpulimitProvenance } = await import('../cpu-rate-control/cpulimit-provenance.mjs');
  await captureCpulimitProvenance();
  process.stdout.write(`restored cpulimit at ${destination}\n`);
}

async function restoreDependencyMetadata() {
  for (const repository of manifest.repositories.filter(({ installedDependencies }) => installedDependencies)) {
    await requireCheckout(repository);
    const dependency = repository.installedDependencies;
    const destination = nodePath.join(repository.path, dependency.path);
    if (!(await exists(nodePath.dirname(destination)))) {
      throw new Error(
        `${repository.id} dependencies are not installed; run ${dependency.rebuild} before restoring metadata`,
      );
    }
    await copyFile(nodePath.join(handoffRoot, dependency.artifact), destination);
    await requireFileHash(destination, dependency.sha256);
    process.stdout.write(`restored ${repository.id} dependency metadata\n`);
  }
}

async function verifyDestinations(scope) {
  if (scope.runtimes) {
    for (const artifact of manifest.runtimeArtifacts) {
      const repository = repositoryById(artifact.repositoryId);
      if (!(await exists(repository.path))) {
        throw new Error(`missing required checkout: ${repository.path}`);
      }
      await requireCheckout(repository);
      const destination = nodePath.join(repository.path, artifact.destination);
      if (!(await exists(destination))) {
        throw new Error(`missing required generated artifact: ${destination}`);
      }
      await requireRuntimeArtifact(artifact, repository);
      process.stdout.write(`verified ${artifact.id}\n`);
    }
  }
  if (scope.cpulimit) {
    const controller = manifest.cpuRateController;
    const controllerBinary = nodePath.join(repositoryRoot, controller.destination, 'src/cpulimit');
    if (!(await exists(controllerBinary))) {
      throw new Error(`missing required generated artifact: ${controllerBinary}`);
    }
    await requireFileHash(controllerBinary, controller.binarySha256);
    process.stdout.write('verified cpulimit binary\n');
  }
  if (scope.dependencyMetadata) {
    for (const repository of manifest.repositories.filter(({ installedDependencies }) => installedDependencies)) {
      if (!(await exists(repository.path))) {
        throw new Error(`missing required checkout: ${repository.path}`);
      }
      const dependency = repository.installedDependencies;
      const destination = nodePath.join(repository.path, dependency.path);
      if (!(await exists(destination))) {
        throw new Error(`missing required generated artifact: ${destination}`);
      }
      await requireFileHash(destination, dependency.sha256);
      process.stdout.write(`verified ${repository.id} dependency metadata\n`);
    }
  }
}

async function requireRuntimeArtifact(artifact, repository) {
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
}

async function requireCheckout(repository) {
  const head = run('git', ['-C', repository.path, 'rev-parse', 'HEAD']).stdout.trim();
  const status = run('git', ['-C', repository.path, 'status', '--short']).stdout.trim();
  const remote = normalizeRemote(run('git', ['-C', repository.path, 'remote', 'get-url', 'origin']).stdout);
  if (head !== repository.requiredCommit || status !== '' || remote !== normalizeRemote(repository.remote)) {
    throw new Error(
      `${repository.id} is not the required clean checkout: ${JSON.stringify({ head, status, remote })}`,
    );
  }
}

function repositoryById(id) {
  const repository = manifest.repositories.find((entry) => entry.id === id);
  if (!repository) throw new Error(`Unknown repository ${id}`);
  return repository;
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

async function requireFileHash(path, expected) {
  const actual = await fileHash(path);
  if (actual !== expected) throw new Error(`${path} SHA-256 mismatch: ${actual} != ${expected}`);
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

function run(command, arguments_) {
  const result = spawnSync(command, arguments_, {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${arguments_.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}
