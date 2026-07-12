import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import nodePath from 'node:path';
import { spawnSync } from 'node:child_process';

const upstreamUrl = 'https://github.com/opsengine/cpulimit.git';
const upstreamCommit = 'f4d2682804931e7aea02a869137344bb5452a3cd';
const repositoryRoot = nodePath.resolve(import.meta.dirname, '../..');
const checkout = nodePath.join(repositoryRoot, 'tmp/bench/cpulimit-f4d2682');
const patchPath = nodePath.join(import.meta.dirname, 'cpulimit-apple.patch');
await mkdir(nodePath.dirname(checkout), { recursive: true });

if (!run('git', ['-C', checkout, 'rev-parse', '--git-dir'], { allowFailure: true }).ok) {
  run('git', ['clone', '--filter=blob:none', '--no-checkout', upstreamUrl, checkout]);
}
if (!run('git', ['-C', checkout, 'cat-file', '-e', `${upstreamCommit}^{commit}`], { allowFailure: true }).ok) {
  run('git', ['-C', checkout, 'fetch', '--depth=1', 'origin', upstreamCommit]);
}
run('git', ['-C', checkout, 'checkout', '--detach', upstreamCommit]);
run('git', ['-C', checkout, 'reset', '--hard', upstreamCommit]);
run('git', ['-C', checkout, 'clean', '-fdx']);
const patch = await readFile(patchPath);
const patchHash = sha256(patch);
run('git', ['-C', checkout, 'apply', '--check', patchPath]);
run('git', ['-C', checkout, 'apply', patchPath]);
run('make', ['clean'], { cwd: checkout });
const cflags = '-Wall -Wextra -Wno-unused-parameter -O2';
run('make', [`CFLAGS=${cflags}`], { cwd: checkout });
const unitTest = run(nodePath.join(checkout, 'tests/process_iterator_test'), [], {
  allowFailure: true,
});
const binaryPath = nodePath.join(checkout, 'src/cpulimit');
const binary = await readFile(binaryPath);
const compiler = run('cc', ['--version']).stdout.split('\n')[0];
process.stdout.write(
  `${JSON.stringify(
    {
      upstreamUrl,
      upstreamCommit,
      checkout,
      patchPath,
      patchSha256: patchHash,
      compiler,
      cflags,
      unitTestPassed: unitTest.ok,
      unitTestExitCode: unitTest.status,
      unitTestStdout: unitTest.stdout,
      unitTestStderr: unitTest.stderr,
      binaryPath,
      binarySha256: sha256(binary),
    },
    null,
    2,
  )}\n`,
);
if (!unitTest.ok) process.exitCode = 1;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  const value = {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
  if (!value.ok && !options.allowFailure) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.status}):\n${value.stdout}\n${value.stderr}`);
  }
  return value;
}
