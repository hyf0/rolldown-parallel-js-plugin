import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import {
  cpus,
  freemem,
  loadavg,
  platform,
  release,
  totalmem,
  uptime,
} from 'node:os';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';

const checkOnly = process.argv[2] === '--check-config';
const configArgument = process.argv[checkOnly ? 3 : 2];
const outputArgument = process.argv[checkOnly ? 4 : 3];
const configPath = nodePath.resolve(
  configArgument ?? nodePath.join(import.meta.dirname, 'graph-formal-matrix.json'),
);
const outputPath = outputArgument
  ? nodePath.resolve(outputArgument)
  : undefined;
const config = JSON.parse(await readFile(configPath, 'utf8'));
validateConfig(config);

if (checkOnly) {
  console.log(
    JSON.stringify({
      valid: true,
      configPath,
      executionScope: config.executionScope,
      blocks: config.cases.reduce((sum, definition) => sum + definition.repeats, 0),
      measuredRuns: config.cases.reduce(
        (sum, definition) => sum + definition.repeats * definition.variants.length,
        0,
      ),
    }),
  );
  process.exit(0);
}

const ciMarkerNames = [
  'CI',
  'GITHUB_ACTIONS',
  'BUILDKITE',
  'CIRCLECI',
  'TF_BUILD',
  'JENKINS_URL',
];
const activeCiMarkers = ciMarkerNames.filter((name) =>
  isCiEnvironment(process.env[name]),
);
if (activeCiMarkers.length > 0) {
  throw new Error(
    `This benchmark is local-only; refuse to run with active CI markers: ${activeCiMarkers.join(', ')}`,
  );
}

const runnerPath = fileURLToPath(import.meta.url);
const caseRunnerPath = nodePath.join(import.meta.dirname, 'run-graph-case.mjs');
const runnerHash = createHash('sha256')
  .update(await readFile(runnerPath))
  .digest('hex');
const caseRunnerHash = createHash('sha256')
  .update(await readFile(caseRunnerPath))
  .digest('hex');
const parentCiMarkers = Object.fromEntries(
  ciMarkerNames.map((name) => [name, process.env[name] ?? null]),
);

const comparableFields = [
  'graphProfile',
  'instrumentation',
  'transformedEntryCount',
  'codeModuleCount',
  'codeOnlyModules',
  'graphWithoutObservedCode',
  'graphModuleCount',
  'graphStaticEdges',
  'graphDynamicEdges',
  'graphProjectStaticEdges',
  'graphExternalStaticEdges',
  'graphNonProjectInternalStaticEdges',
  'graphNonProjectInternalIds',
  'graphHash',
  'moduleKindCounts',
  'boundaryHash',
  'boundary',
  'outputChunks',
  'outputAssets',
  'normalizedOutputBytes',
  'normalizedOutputHash',
  'outputNormalization',
];
const rawFields = ['codeHash', 'outputBytes', 'outputHash'];
const startedAt = new Date().toISOString();
const hostAtStart = hostSnapshot();
const powerAtStart = powerStatus();
const runs = [];
const rawDifferences = [];
const caseParity = [];
let executions = 0;
let sequence = 0;

for (const definition of config.cases) {
  const {
    name,
    variants,
    warmups = 0,
    repeats,
    startIndex = 0,
    rawParityRequired: _rawParityRequired,
    ...caseOptions
  } = definition;
  const firstRun = runs.length;

  for (let warmup = 0; warmup < warmups; warmup++) {
    for (const variant of variants) {
      execute(name, caseOptions, variant, startIndex + warmup, true);
    }
  }

  for (let offset = 0; offset < repeats; offset++) {
    const blockIndex = startIndex + offset;
    const rotation = blockIndex % variants.length;
    const order = [
      ...variants.slice(rotation),
      ...variants.slice(0, rotation),
    ];
    for (const variant of order) {
      execute(name, caseOptions, variant, blockIndex, false);
    }
  }

  const selected = runs.slice(firstRun);
  const parity = validateParity(name, selected, variants, repeats);
  caseParity.push(parity);
  rawDifferences.push(...parity.rawDifferences);
}

const report = {
  schema: 1,
  kind: 'local-graph-formal-matrix',
  executionScope: 'local-only',
  startedAt,
  finishedAt: new Date().toISOString(),
  node: process.version,
  nodeBinary: process.execPath,
  runner: {
    path: runnerPath,
    sha256: runnerHash,
  },
  caseRunner: {
    path: caseRunnerPath,
    sha256: caseRunnerHash,
  },
  environment: {
    parentCiMarkers,
    childCiMarkersCleared: ciMarkerNames,
    parentRunLinkCheck: process.env.RUN_LINK_CHECK ?? null,
    childInputRunLinkCheck: null,
    runCaseRunLinkCheck: false,
  },
  host: {
    platform: platform(),
    release: release(),
    architecture: process.arch,
    cpuModel: cpus()[0]?.model,
    logicalCpuCount: cpus().length,
    totalMemoryBytes: totalmem(),
    power: powerAtStart,
    atStart: hostAtStart,
    atFinish: hostSnapshot(),
  },
  config,
  hostPolicyViolations:
    config.hostPolicy?.power && !powerAtStart?.includes(config.hostPolicy.power)
      ? [
          `power status did not contain ${config.hostPolicy.power}: ${powerAtStart}`,
        ]
      : [],
  validationErrors: [],
  rawDifferences,
  parity: caseParity,
  runs,
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) {
  await writeFile(outputPath, serialized);
  console.log(
    JSON.stringify({
      outputPath,
      runs: runs.length,
      startedAt,
      finishedAt: report.finishedAt,
    }),
  );
} else {
  process.stdout.write(serialized);
}

function execute(name, caseOptions, variant, index, warmup) {
  if (executions++ > 0) cooldown(config.hostPolicy.cooldownMs);

  const environment = { ...process.env };
  for (const marker of ciMarkerNames) {
    delete environment[marker];
  }
  delete environment.RUN_LINK_CHECK;
  delete environment.ROLLDOWN_PARALLEL_PLUGIN_METRICS;
  delete environment.ROLLDOWN_PARALLEL_PLUGIN_WORKERS;
  const options = { ...caseOptions, variant };
  const hostBefore = hostSnapshot();
  const result = spawnSync(
    '/usr/bin/time',
    [
      '-l',
      process.execPath,
      '--expose-gc',
      caseRunnerPath,
      JSON.stringify(options),
    ],
    {
      encoding: 'utf8',
      env: environment,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `${name}/${variant} exited ${result.status}:\n${result.stdout}\n${result.stderr}`,
    );
  }
  if (warmup) return;

  const peakRssMatch = result.stderr.match(
    /(\d+)\s+maximum resident set size/,
  );
  if (!peakRssMatch) {
    throw new Error(
      `Could not parse peak RSS for ${name}/${variant}:\n${result.stderr}`,
    );
  }
  const child = JSON.parse(result.stdout.trim());
  const expectedMetaModules = variant.startsWith('worker-')
    ? 0
    : child.transformedEntryCount;
  if (child.mdxAstroMetaModules !== expectedMetaModules) {
    throw new Error(
      `${name}/${variant} meta.astro coverage was ${child.mdxAstroMetaModules}; expected ${expectedMetaModules}`,
    );
  }
  const hostAfter = hostSnapshot();
  const hostDeltas = hostDelta(hostBefore, hostAfter);
  runs.push({
    name,
    index,
    sequence: sequence++,
    peakRssBytes: Number(peakRssMatch[1]),
    hostBefore,
    hostAfter,
    hostDeltas,
    hostPolicyViolations: evaluateHostPolicy(
      config.hostPolicy,
      hostBefore,
      hostAfter,
    ),
    ...child,
  });
}

function validateParity(name, selected, variants, repeats) {
  for (const variant of variants) {
    const count = selected.filter((run) => run.variant === variant).length;
    if (count !== repeats) {
      throw new Error(
        `${name}/${variant} produced ${count} runs; expected ${repeats}`,
      );
    }
  }
  for (const index of new Set(selected.map((run) => run.index))) {
    const block = selected.filter((run) => run.index === index);
    if (
      block.length !== variants.length ||
      new Set(block.map((run) => run.variant)).size !== variants.length
    ) {
      throw new Error(
        `${name} block ${index} does not contain every variant once`,
      );
    }
  }
  for (const field of comparableFields) {
    const values = selected.map((run) => JSON.stringify(run[field]));
    if (new Set(values).size !== 1) {
      throw new Error(
        `${name} graph parity failed for ${field}: ${values.join(' != ')}`,
      );
    }
  }
  const differences = rawFields.flatMap((field) => {
    const values = Object.fromEntries(
      variants.map((variant) => [
        variant,
        [
          ...new Set(
            selected
              .filter((run) => run.variant === variant)
              .map((run) => JSON.stringify(run[field])),
          ),
        ],
      ]),
    );
    return new Set(Object.values(values).flat()).size === 1
      ? []
      : [{ name, field, values }];
  });
  return {
    name,
    graph: true,
    boundary: true,
    normalizedOutput: true,
    moduleMetadataPattern: true,
    rawParityRequired: false,
    fields: comparableFields,
    mdxAstroMetaModules: Object.fromEntries(
      variants.map((variant) => [
        variant,
        [
          ...new Set(
            selected
              .filter((run) => run.variant === variant)
              .map((run) => run.mdxAstroMetaModules),
          ),
        ],
      ]),
    ),
    rawDifferences: differences,
  };
}

function validateConfig(value) {
  if (value.executionScope !== 'local-only') {
    throw new Error('executionScope must be local-only');
  }
  if (!Array.isArray(value.cases) || value.cases.length === 0) {
    throw new Error('cases must be a non-empty array');
  }
  if (value.hostPolicy?.cooldownMs !== 15_000) {
    throw new Error('hostPolicy.cooldownMs must be 15000');
  }
  for (const definition of value.cases) {
    if (typeof definition.name !== 'string' || definition.name.length === 0) {
      throw new Error('Every case must have a name');
    }
    if (
      JSON.stringify(definition.variants) !==
      JSON.stringify(['ordinary', 'managed-4', 'worker-4'])
    ) {
      throw new Error(
        `${definition.name} variants must be ordinary, managed-4, worker-4`,
      );
    }
    if (definition.repeats !== 5) {
      throw new Error(`${definition.name} repeats must be 5`);
    }
    if ((definition.warmups ?? 0) !== 0) {
      throw new Error(`${definition.name} warmups must be 0`);
    }
    if (definition.instrumentation !== false) {
      throw new Error(`${definition.name} instrumentation must be false`);
    }
    if (definition.runLinkCheck !== false) {
      throw new Error(`${definition.name} runLinkCheck must be false`);
    }
    if (definition.rawParityRequired !== false) {
      throw new Error(`${definition.name} rawParityRequired must be false`);
    }
    if (definition.corpus !== 'production-mdx') {
      throw new Error(`${definition.name} corpus must be production-mdx`);
    }
    if (
      !nodePath.isAbsolute(definition.projectRoot) ||
      !nodePath.isAbsolute(definition.rolldownPackageRoot)
    ) {
      throw new Error(`${definition.name} roots must be absolute paths`);
    }
  }
}

function cooldown(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return;
  Atomics.wait(
    new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)),
    0,
    0,
    milliseconds,
  );
}

function isCiEnvironment(value) {
  return value !== undefined && !['', '0', 'false'].includes(value.toLowerCase());
}

function hostSnapshot() {
  return {
    at: new Date().toISOString(),
    loadAverage: loadavg(),
    freeMemoryBytes: freemem(),
    uptimeSeconds: uptime(),
    swapUsage: swapUsage(),
    virtualMemoryCounters: virtualMemoryCounters(),
    totalProcessCpuPercent: totalProcessCpuPercent(),
  };
}

function powerStatus() {
  if (platform() !== 'darwin') return undefined;
  const result = spawnSync('pmset', ['-g', 'batt'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

function swapUsage() {
  if (platform() !== 'darwin') return undefined;
  const result = spawnSync('sysctl', ['-n', 'vm.swapusage'], {
    encoding: 'utf8',
  });
  if (result.status !== 0) return undefined;
  const raw = result.stdout.trim();
  const fields = Object.fromEntries(
    [...raw.matchAll(/(total|used|free) = ([0-9.]+)([KMGTP])/g)].map(
      ([, name, amount, unit]) => [name, toBytes(Number(amount), unit)],
    ),
  );
  return {
    raw,
    totalBytes: fields.total,
    usedBytes: fields.used,
    freeBytes: fields.free,
  };
}

function toBytes(amount, unit) {
  const power = ['K', 'M', 'G', 'T', 'P'].indexOf(unit) + 1;
  return amount * 1024 ** power;
}

function virtualMemoryCounters() {
  if (platform() !== 'darwin') return undefined;
  const result = spawnSync('vm_stat', [], { encoding: 'utf8' });
  if (result.status !== 0) return undefined;
  const counters = {};
  for (const line of result.stdout.split('\n')) {
    const match = line.match(/^"?([^":]+)"?:\s+(\d+)\.$/);
    if (match) counters[match[1]] = Number(match[2]);
  }
  return {
    pageins: counters.Pageins,
    pageouts: counters.Pageouts,
    swapins: counters.Swapins,
    swapouts: counters.Swapouts,
    compressions: counters.Compressions,
    decompressions: counters.Decompressions,
  };
}

function totalProcessCpuPercent() {
  const result = spawnSync('/bin/ps', ['-A', '-o', '%cpu='], {
    encoding: 'utf8',
  });
  if (result.status !== 0) return undefined;
  return result.stdout
    .trim()
    .split(/\s+/)
    .reduce((sum, value) => sum + Number(value), 0);
}

function hostDelta(before, after) {
  const counters = {};
  for (const field of [
    'pageins',
    'pageouts',
    'swapins',
    'swapouts',
    'compressions',
    'decompressions',
  ]) {
    const start = before.virtualMemoryCounters?.[field];
    const finish = after.virtualMemoryCounters?.[field];
    counters[field] =
      Number.isFinite(start) && Number.isFinite(finish)
        ? finish - start
        : undefined;
  }
  return {
    virtualMemoryCounters: counters,
    swapUsedBytes:
      Number.isFinite(before.swapUsage?.usedBytes) &&
      Number.isFinite(after.swapUsage?.usedBytes)
        ? after.swapUsage.usedBytes - before.swapUsage.usedBytes
        : undefined,
  };
}

function evaluateHostPolicy(policy, before, after) {
  if (!policy) return [];
  const violations = [];
  if (
    Number.isFinite(policy.maxStartOneMinuteLoad) &&
    before.loadAverage[0] > policy.maxStartOneMinuteLoad
  ) {
    violations.push(
      `start one-minute load ${before.loadAverage[0]} exceeded ${policy.maxStartOneMinuteLoad}`,
    );
  }
  if (
    Number.isFinite(policy.maxStartExternalCpuPercent) &&
    before.totalProcessCpuPercent > policy.maxStartExternalCpuPercent
  ) {
    violations.push(
      `start process CPU ${before.totalProcessCpuPercent}% exceeded ${policy.maxStartExternalCpuPercent}%`,
    );
  }
  for (const [field, maximum] of [
    ['swapouts', policy.maxSwapoutDeltaPages],
    ['pageouts', policy.maxPageoutDeltaPages],
  ]) {
    const delta = hostDelta(before, after).virtualMemoryCounters[field];
    if (Number.isFinite(maximum) && Number.isFinite(delta) && delta > maximum) {
      violations.push(`${field} increased by ${delta} pages`);
    }
  }
  return violations;
}
