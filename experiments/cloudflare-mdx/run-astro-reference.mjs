import { createHash } from 'node:crypto';
import { spawn, spawnSync, execFile } from 'node:child_process';
import {
  constants as fsConstants,
  createReadStream,
  createWriteStream,
} from 'node:fs';
import {
  access,
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises';
import { cpus, constants as osConstants, platform, release, totalmem } from 'node:os';
import nodePath from 'node:path';
import { finished } from 'node:stream/promises';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const PINNED_NODE = 'v24.18.0';
const PINNED_PROJECT_COMMIT = '2b08a67a41da1a521aecbcf465893abae1e9a6df';
const PINNED_ASTRO = '6.4.7';
const PINNED_MDX = '6.0.3';
const PINNED_MDX_TRANSFORM_SHA256 =
  '35c1e5496f3ea29671bdad54e607aec07280e3fcf5cd4a162e52484d32f2e932';
const PINNED_INSTRUMENTED_MDX_TRANSFORM_SHA256 =
  'eb8f67c3bfca0dc8880a150b89145d23415ffa87946c87d9380ed8587bff8990';
const PROFILES = new Set(['ci-link-check', 'default']);
const FORMAL_UNSET_ENV = [
  'ASTRO_MDX_COUNTER_PATH',
  'ASTRO_PERFORMANCE_BENCHMARK',
  'ASTRO_TIMER_PATH',
  'BUILD_TARGET',
  'NODE_ENV',
  'NODE_OPTIONS',
];
const SAMPLE_INTERVAL_MS = 2_000;
const execFileAsync = promisify(execFile);
const runnerPath = fileURLToPath(import.meta.url);

const [candidateArgument, outputArgument, profile, instrumentationMode, ...extraArguments] =
  process.argv.slice(2);
if (
  !candidateArgument ||
  !outputArgument ||
  !profile ||
  (instrumentationMode && instrumentationMode !== 'mdx-counter') ||
  extraArguments.length > 0
) {
  fail(
    'Usage: node run-astro-reference.mjs <candidate-root> <output-dir> <ci-link-check|default> [mdx-counter]',
  );
}
if (!PROFILES.has(profile)) fail(`Unknown profile: ${profile}`);
const counterEnabled = instrumentationMode === 'mdx-counter';
if (process.version !== PINNED_NODE) {
  fail(`Expected Node ${PINNED_NODE}; received ${process.version} from ${process.execPath}`);
}
if (process.platform !== 'darwin') {
  fail('This runner requires Darwin /usr/bin/time -l output');
}

const candidateRoot = await realpath(nodePath.resolve(candidateArgument));
const outputDirectory = nodePath.resolve(outputArgument);
assertOutsideCandidate(candidateRoot, outputDirectory);
await validateCandidate(candidateRoot);
await createEmptyOutputDirectory(outputDirectory);

const counterPath = counterEnabled
  ? nodePath.join(outputDirectory, 'mdx-transform-counter.json')
  : undefined;
const childEnvironment = createChildEnvironment(profile, counterPath);
const childNodePath = await resolveExecutable('node', childEnvironment.PATH);
const childNodeVersion = runChecked(childNodePath, ['--version'], candidateRoot, childEnvironment);
if (childNodeVersion !== PINNED_NODE) {
  fail(`Build PATH resolved Node ${childNodeVersion} at ${childNodePath}; expected ${PINNED_NODE}`);
}
const corepackPath = nodePath.join(nodePath.dirname(childNodePath), 'corepack');
await access(corepackPath, fsConstants.X_OK);
const pnpmVersion = runChecked(
  corepackPath,
  ['pnpm', '--version'],
  candidateRoot,
  childEnvironment,
);
const timePath = '/usr/bin/time';
await access(timePath, fsConstants.X_OK);

const packageJsonPath = nodePath.join(candidateRoot, 'package.json');
const lockfilePath = nodePath.join(candidateRoot, 'pnpm-lock.yaml');
const astroConfigPath = nodePath.join(candidateRoot, 'astro.config.ts');
const contentConfigPath = nodePath.join(candidateRoot, 'src/content.config.ts');
const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
const installedAstroPackagePath = nodePath.join(candidateRoot, 'node_modules/astro/package.json');
const installedMdxPackagePath = nodePath.join(
  candidateRoot,
  'node_modules/@astrojs/mdx/package.json',
);
const installedMdxTransformPath = nodePath.join(
  candidateRoot,
  'node_modules/@astrojs/mdx/dist/vite-plugin-mdx.js',
);
const installedAstroPackage = JSON.parse(await readFile(installedAstroPackagePath, 'utf8'));
const installedMdxPackage = JSON.parse(await readFile(installedMdxPackagePath, 'utf8'));
if (installedAstroPackage.version !== PINNED_ASTRO) {
  fail(`Installed Astro is ${installedAstroPackage.version}; expected ${PINNED_ASTRO}`);
}
if (installedMdxPackage.version !== PINNED_MDX) {
  fail(`Installed @astrojs/mdx is ${installedMdxPackage.version}; expected ${PINNED_MDX}`);
}
const installedMdxTransformSha256 = await sha256(installedMdxTransformPath);
const expectedMdxTransformSha256 = counterEnabled
  ? PINNED_INSTRUMENTED_MDX_TRANSFORM_SHA256
  : PINNED_MDX_TRANSFORM_SHA256;
if (installedMdxTransformSha256 !== expectedMdxTransformSha256) {
  fail(
    `Installed MDX transform has SHA-256 ${installedMdxTransformSha256}; expected ${expectedMdxTransformSha256}`,
  );
}
const startedAt = new Date().toISOString();
const startedAtMs = Date.now();
const command = [
  timePath,
  '-l',
  '-o',
  '<output-dir>/resources.txt',
  corepackPath,
  'pnpm',
  'run',
  'build',
];

const provenance = {
  schema: 1,
  kind: counterEnabled
    ? 'cloudflare_docs_instrumented_mdx_count'
    : profile === 'ci-link-check'
      ? 'cloudflare_docs_link_check_semantic_probe'
      : 'cloudflare_docs_uninstrumented_astro_reference',
  startedAt,
  formal: profile === 'default' && !counterEnabled,
  benchmarkEligible: profile === 'default' && !counterEnabled,
  instrumentationMode: instrumentationMode ?? null,
  profile,
  command,
  project: {
    root: candidateRoot,
    commit: PINNED_PROJECT_COMMIT,
    status: '',
    packageName: packageJson.name,
    packageVersion: packageJson.version ?? null,
    scripts: {
      prebuild: packageJson.scripts?.prebuild ?? null,
      build: packageJson.scripts?.build ?? null,
    },
    dependencies: {
      astro: packageJson.devDependencies?.astro ?? packageJson.dependencies?.astro ?? null,
      mdx:
        packageJson.devDependencies?.['@astrojs/mdx'] ??
        packageJson.dependencies?.['@astrojs/mdx'] ??
        null,
      vite: packageJson.devDependencies?.vite ?? packageJson.dependencies?.vite ?? null,
    },
    files: {
      packageJsonSha256: await sha256(packageJsonPath),
      lockfileSha256: await sha256(lockfilePath),
      astroConfigSha256: await sha256(astroConfigPath),
      contentConfigSha256: await sha256(contentConfigPath),
    },
    installed: {
      astroVersion: installedAstroPackage.version,
      astroPackageSha256: await sha256(installedAstroPackagePath),
      mdxVersion: installedMdxPackage.version,
      mdxPackageSha256: await sha256(installedMdxPackagePath),
      mdxTransformPath: await realpath(installedMdxTransformPath),
      mdxTransformSha256: installedMdxTransformSha256,
      expectedMdxTransformSha256,
    },
  },
  runtime: {
    node: childNodeVersion,
    nodeBinary: childNodePath,
    nodeBinarySha256: await sha256(childNodePath),
    pnpm: pnpmVersion,
    packageManagerLauncher: corepackPath,
    platform: platform(),
    release: release(),
    architecture: process.arch,
    cpuModel: cpus()[0]?.model ?? null,
    logicalCpuCount: cpus().length,
    totalMemoryBytes: totalmem(),
  },
  runner: {
    path: runnerPath,
    sha256: await sha256(runnerPath),
    sampleIntervalMs: SAMPLE_INTERVAL_MS,
  },
  environment: {
    formalUnset: FORMAL_UNSET_ENV,
    runLinkCheck: profile === 'ci-link-check',
    ci: profile === 'ci-link-check',
    effective: {
      ASTRO_MDX_COUNTER_PATH: childEnvironment.ASTRO_MDX_COUNTER_PATH ?? null,
      ASTRO_PERFORMANCE_BENCHMARK:
        childEnvironment.ASTRO_PERFORMANCE_BENCHMARK ?? null,
      ASTRO_TIMER_PATH: childEnvironment.ASTRO_TIMER_PATH ?? null,
      BUILD_TARGET: childEnvironment.BUILD_TARGET ?? null,
      CI: childEnvironment.CI ?? null,
      NODE_ENV: childEnvironment.NODE_ENV ?? null,
      NODE_OPTIONS: childEnvironment.NODE_OPTIONS ?? null,
      RUN_LINK_CHECK: childEnvironment.RUN_LINK_CHECK ?? null,
    },
    githubTokenPresent: Boolean(childEnvironment.GITHUB_TOKEN),
  },
  preRunState: {
    astroCache: await optionalPathState(nodePath.join(candidateRoot, '.astro-cache')),
    dist: await optionalPathState(nodePath.join(candidateRoot, 'dist')),
    skills: await optionalPathState(nodePath.join(candidateRoot, 'skills')),
  },
};
await writeJson(nodePath.join(outputDirectory, 'provenance.json'), provenance);

const resourcesPath = nodePath.join(outputDirectory, 'resources.txt');
const rawStdoutPath = nodePath.join(outputDirectory, 'build.stdout.log');
const rawStderrPath = nodePath.join(outputDirectory, 'build.stderr.log');
const timestampedPath = nodePath.join(outputDirectory, 'build.timestamped.jsonl');
const processTreePath = nodePath.join(outputDirectory, 'process-tree.tsv');
const timestampedStream = createWriteStream(timestampedPath, { flags: 'wx' });
const processTreeStream = createWriteStream(processTreePath, { flags: 'wx' });
processTreeStream.write(
  'epoch_ms\tpid\tppid\tetime\tcpu_time\tcpu_percent\trss_kib\tvsz_kib\tstate\tcommand\n',
);

const timeProcess = spawn(
  timePath,
  ['-l', '-o', resourcesPath, corepackPath, 'pnpm', 'run', 'build'],
  {
    cwd: candidateRoot,
    detached: true,
    env: childEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

if (!timeProcess.stdout || !timeProcess.stderr) {
  fail('Failed to create stdout/stderr pipes for the build');
}

const stdoutCapture = captureOutput(
  timeProcess.stdout,
  rawStdoutPath,
  'stdout',
  timestampedStream,
  process.stdout,
);
const stderrCapture = captureOutput(
  timeProcess.stderr,
  rawStderrPath,
  'stderr',
  timestampedStream,
  process.stderr,
);

let forwardedSignal;
let signalCount = 0;
let escalationTimer;
let stopSampling = false;

const forwardSignal = (signal) => {
  signalCount++;
  forwardedSignal ??= signal;
  if (!timeProcess.pid) return;
  const signalToSend = signalCount > 1 ? 'SIGKILL' : signal;
  killProcessGroup(timeProcess.pid, signalToSend);
  if (signalCount === 1) {
    escalationTimer = setTimeout(() => {
      if (timeProcess.exitCode === null && timeProcess.signalCode === null) {
        killProcessGroup(timeProcess.pid, 'SIGKILL');
      }
    }, 10_000);
    escalationTimer.unref();
  }
};
const onSigint = () => forwardSignal('SIGINT');
const onSigterm = () => forwardSignal('SIGTERM');
const onRunnerExit = () => {
  if (timeProcess.exitCode === null && timeProcess.signalCode === null && timeProcess.pid) {
    killProcessGroup(timeProcess.pid, 'SIGKILL');
  }
};
process.on('SIGINT', onSigint);
process.on('SIGTERM', onSigterm);
process.on('exit', onRunnerExit);

const samplerPromise = sampleProcessTreeUntilStopped(
  () => stopSampling,
  timeProcess.pid,
  processTreeStream,
);
const outcome = await waitForProcess(timeProcess);
stopSampling = true;
if (escalationTimer) clearTimeout(escalationTimer);
await samplerPromise;
processTreeStream.end();
await Promise.allSettled([stdoutCapture, stderrCapture]);
timestampedStream.end();
await Promise.all([finished(processTreeStream), finished(timestampedStream)]);

process.off('SIGINT', onSigint);
process.off('SIGTERM', onSigterm);
process.off('exit', onRunnerExit);

const finishedAtMs = Date.now();
const exitCode = forwardedSignal
  ? signalExitCode(forwardedSignal)
  : outcome.code ?? signalExitCode(outcome.signal);
const result = {
  schema: 1,
  startedAt,
  finishedAt: new Date(finishedAtMs).toISOString(),
  elapsedMs: finishedAtMs - startedAtMs,
  profile,
  exitCode,
  buildExitCode: outcome.code,
  buildSignal: outcome.signal,
  forwardedSignal: forwardedSignal ?? null,
  spawnError: outcome.error ? String(outcome.error.stack ?? outcome.error) : null,
  artifacts: {
    provenance: 'provenance.json',
    resources: 'resources.txt',
    stdout: 'build.stdout.log',
    stderr: 'build.stderr.log',
    timestamped: 'build.timestamped.jsonl',
    processTree: 'process-tree.tsv',
    mdxTransformCounter: counterEnabled ? 'mdx-transform-counter.json' : null,
  },
};
await writeFile(nodePath.join(outputDirectory, 'exit-code.txt'), `${exitCode}\n`);
await writeJson(nodePath.join(outputDirectory, 'run-result.json'), result);
process.exitCode = exitCode;

function createChildEnvironment(selectedProfile, selectedCounterPath) {
  const environment = { ...process.env };
  for (const name of FORMAL_UNSET_ENV) delete environment[name];
  environment.PATH = [nodePath.dirname(process.execPath), environment.PATH]
    .filter(Boolean)
    .join(nodePath.delimiter);
  if (selectedProfile === 'ci-link-check') {
    environment.CI = 'true';
    environment.RUN_LINK_CHECK = 'true';
  } else {
    delete environment.CI;
    delete environment.RUN_LINK_CHECK;
  }
  if (selectedCounterPath) environment.ASTRO_MDX_COUNTER_PATH = selectedCounterPath;
  return environment;
}

async function validateCandidate(root) {
  const topLevel = await realpath(runChecked('git', ['-C', root, 'rev-parse', '--show-toplevel']));
  if (topLevel !== root) fail(`Candidate root is not the worktree root: ${root}`);
  const commit = runChecked('git', ['-C', root, 'rev-parse', 'HEAD']);
  if (commit !== PINNED_PROJECT_COMMIT) {
    fail(`Expected Cloudflare Docs ${PINNED_PROJECT_COMMIT}; received ${commit}`);
  }
  const status = runChecked('git', [
    '-C',
    root,
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
  ]);
  if (status) fail(`Cloudflare Docs worktree must be clean:\n${status}`);
  for (const relativePath of [
    'package.json',
    'pnpm-lock.yaml',
    'astro.config.ts',
    'src/content.config.ts',
    'node_modules/astro/bin/astro.mjs',
  ]) {
    await access(nodePath.join(root, relativePath), fsConstants.R_OK);
  }
}

function assertOutsideCandidate(root, output) {
  const relative = nodePath.relative(root, output);
  if (
    relative === '' ||
    (!relative.startsWith(`..${nodePath.sep}`) &&
      relative !== '..' &&
      !nodePath.isAbsolute(relative))
  ) {
    fail('Output directory must be outside the candidate worktree');
  }
}

async function createEmptyOutputDirectory(directory) {
  try {
    const entries = await readdir(directory);
    if (entries.length > 0) fail(`Output directory is not empty: ${directory}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await mkdir(directory, { recursive: true });
  }
}

async function resolveExecutable(command, searchPath) {
  if (command.includes(nodePath.sep)) {
    await access(command, fsConstants.X_OK);
    return command;
  }
  for (const directory of (searchPath ?? '').split(nodePath.delimiter)) {
    if (!directory) continue;
    const candidate = nodePath.join(directory, command);
    try {
      await access(candidate, fsConstants.X_OK);
      return await realpath(candidate);
    } catch {}
  }
  fail(`Could not resolve executable ${command}`);
}

function runChecked(command, args, cwd, environment = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: environment,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    fail(`${command} ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function captureOutput(source, rawPath, streamName, timestampedStream, mirror) {
  const rawStream = createWriteStream(rawPath, { flags: 'wx' });
  const decoder = new StringDecoder('utf8');
  let buffered = '';
  source.on('data', (chunk) => {
    mirror.write(chunk);
    buffered += decoder.write(chunk);
    let newlineIndex;
    while ((newlineIndex = buffered.indexOf('\n')) !== -1) {
      writeTimestampedLine(
        timestampedStream,
        streamName,
        buffered.slice(0, newlineIndex),
      );
      buffered = buffered.slice(newlineIndex + 1);
    }
  });
  source.on('end', () => {
    buffered += decoder.end();
    if (buffered.length > 0) writeTimestampedLine(timestampedStream, streamName, buffered);
  });
  source.pipe(rawStream);
  return finished(rawStream);
}

function writeTimestampedLine(stream, streamName, line) {
  stream.write(`${JSON.stringify({ epochMs: Date.now(), stream: streamName, line })}\n`);
}

async function sampleProcessTreeUntilStopped(shouldStop, rootPid, output) {
  while (!shouldStop()) {
    await sampleProcessTree(rootPid, output);
    if (!shouldStop()) await delay(SAMPLE_INTERVAL_MS);
  }
}

async function sampleProcessTree(rootPid, output) {
  if (!rootPid) return;
  try {
    const { stdout } = await execFileAsync(
      '/bin/ps',
      [
        '-axo',
        'pid=,ppid=,etime=,time=,%cpu=,rss=,vsz=,state=,command=',
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    const rows = stdout
      .split('\n')
      .map(parseProcessRow)
      .filter(Boolean);
    const byPid = new Map(rows.map((row) => [row.pid, row]));
    const included = new Set([rootPid]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of rows) {
        if (!included.has(row.pid) && included.has(row.ppid)) {
          included.add(row.pid);
          changed = true;
        }
      }
    }
    const epochMs = Date.now();
    for (const pid of [...included].sort((left, right) => left - right)) {
      const row = byPid.get(pid);
      if (!row) continue;
      output.write(
        [
          epochMs,
          row.pid,
          row.ppid,
          row.etime,
          row.cpuTime,
          row.cpuPercent,
          row.rssKib,
          row.vszKib,
          row.state,
          escapeTsv(row.command),
        ].join('\t') + '\n',
      );
    }
  } catch (error) {
    output.write(`# ${Date.now()}\t${escapeTsv(String(error.message ?? error))}\n`);
  }
}

function parseProcessRow(line) {
  const match = line
    .trim()
    .match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+([\d.]+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
  if (!match) return undefined;
  return {
    pid: Number(match[1]),
    ppid: Number(match[2]),
    etime: match[3],
    cpuTime: match[4],
    cpuPercent: Number(match[5]),
    rssKib: Number(match[6]),
    vszKib: Number(match[7]),
    state: match[8],
    command: match[9],
  };
}

function waitForProcess(child) {
  return new Promise((resolve) => {
    let settled = false;
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      resolve({ code: 1, signal: null, error });
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      resolve({ code, signal, error: null });
    });
  });
}

function killProcessGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

function signalExitCode(signal) {
  if (!signal) return 1;
  return 128 + (osConstants.signals[signal] ?? 1);
}

async function optionalPathState(path) {
  try {
    const info = await stat(path);
    return {
      exists: true,
      kind: info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other',
      sizeBytes: info.size,
      modifiedAt: info.mtime.toISOString(),
    };
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false };
    throw error;
  }
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function writeJson(path, value) {
  return writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function escapeTsv(value) {
  return value.replaceAll('\\', '\\\\').replaceAll('\t', '\\t').replaceAll('\n', '\\n');
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function fail(message) {
  throw new Error(message);
}
