import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { FROZEN_PERFORMANCE_HOST_POLICY } from './local-host-policy.mjs';
import { BASELINE_POOL_ENVIRONMENT } from './pool-environment.mjs';
import { LIFECYCLE_FIXED_RUNTIME_PROFILE } from './runtime-profile.mjs';
import {
  captureHarnessSourceManifest,
  EXPECTED_COMPILER_ENVIRONMENT,
} from './environment-provenance.mjs';

const runner = nodePath.join(import.meta.dirname, 'run-matrix.mjs');
const summarizer = nodePath.join(import.meta.dirname, 'summarize-matrix.mjs');
assertRejected(
  spawnSync(
    process.execPath,
    [
      nodePath.join(import.meta.dirname, 'run-case.mjs'),
      JSON.stringify({
        projectRoot:
          '/Users/yunfeihe/Documents/github-opensource/.worktrees/cloudflare-docs-rolldown-build',
        rolldownPackageRoot:
          '/Users/yunfeihe/Documents/github-opensource/.worktrees/rolldown-parallel-js-plugin-scale-baseline/packages/rolldown',
        variant: 'ordinary',
        measurementMode: 'correctness-only',
      }),
    ],
    { encoding: 'utf8' },
  ),
  'unclassified direct case',
);
assertRejected(
  spawnSync(
    process.execPath,
    [runner, '--check-config', nodePath.join(import.meta.dirname, 'smoke-matrix.json')],
    {
      encoding: 'utf8',
    },
  ),
  'unclassified legacy matrix',
);
assertRejected(
  spawnSync(
    process.execPath,
    [
      summarizer,
      nodePath.join(import.meta.dirname, 'data/2026-07-12-scale-v1-32-kernel-correctness.raw.json'),
    ],
    { encoding: 'utf8' },
  ),
  'correctness artifact summary',
);

const directory = await mkdtemp(nodePath.join(tmpdir(), 'mdx-report-policy-'));
try {
  const valid = await syntheticConfirmationReport();
  const validPath = await writeReport('valid.json', valid);
  const validResult = spawnSync(process.execPath, [summarizer, validPath], {
    encoding: 'utf8',
  });
  if (validResult.status !== 0) {
    throw new Error(`Synthetic valid confirmation was rejected: ${validResult.stderr}`);
  }
  const summary = JSON.parse(validResult.stdout);
  if (
    summary.benchmarkEligible !== true ||
    summary.conclusionEligible !== true ||
    summary.evidenceKind !== 'performance-confirmation'
  ) {
    throw new Error(`Valid confirmation was misclassified: ${validResult.stdout}`);
  }

  const cases = [
    [
      'screen',
      {
        ...valid,
        evidenceKind: 'performance-screen',
        conclusionEligible: false,
        matrix: { ...valid.matrix, evidenceKind: 'performance-screen' },
      },
    ],
    [
      'non-finite',
      {
        ...valid,
        runs: valid.runs.map((run, index) =>
          index === 0 ? { ...run, totalElapsedMs: null } : run,
        ),
      },
    ],
    [
      'host-failure',
      {
        ...valid,
        runs: valid.runs.map((run, index) =>
          index === 0
            ? {
                ...run,
                hostAfter: {
                  ...run.hostAfter,
                  virtualMemoryCounters: {
                    ...run.hostAfter.virtualMemoryCounters,
                    pageouts: 1,
                  },
                },
              }
            : run,
        ),
      },
    ],
    [
      'runtime-failure',
      {
        ...valid,
        environment: {
          ...valid.environment,
          runtimeProfile: {
            kind: 'historical-0aa-artifact',
            rolldownCommit: '0aa600b5721b852cdc4095c7122a929a8cb4a798',
            bindingSha256: 'deec0b2cb7a12e507ff223e12535c3280ab5fe8371f2fcc92f9db206163f1c5d',
            distSha256: 'e30311e764bae7fba9afe27665db741d556a7c3728eb67cfbe7ce0fed3135ebc',
          },
        },
      },
    ],
  ];
  for (const [name, report] of cases) {
    const path = await writeReport(`${name}.json`, report);
    assertRejected(
      spawnSync(process.execPath, [summarizer, path], { encoding: 'utf8' }),
      `${name} report`,
    );
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log(
  JSON.stringify({
    valid: true,
    rejected: [
      'unclassified-matrix',
      'unclassified-direct-case',
      'correctness-summary',
      'screen-summary',
      'non-finite-metrics',
      'failed-host-policy',
      'wrong-runtime-profile',
    ],
    accepted: 'synthetic-ten-block-performance-confirmation',
  }),
);

async function syntheticConfirmationReport() {
  const host = admittedHost();
  const variants = ['ordinary', 'worker-4'];
  const runs = [];
  for (let index = 0; index < 10; index++) {
    for (const variant of variants) {
      runs.push({
        name: 'synthetic-confirmation',
        index,
        variant,
        buildProfile: 'default',
        effectiveRunLinkCheck: false,
        measurementMode: 'measurement',
        runtimeProfile: LIFECYCLE_FIXED_RUNTIME_PROFILE,
        poolEnvironment: BASELINE_POOL_ENVIRONMENT,
        totalElapsedMs: variant === 'ordinary' ? 100 : 80,
        cpuUserMs: variant === 'ordinary' ? 90 : 130,
        cpuSystemMs: 10,
        peakRssBytes: variant === 'ordinary' ? 1_000_000 : 1_500_000,
        normalizedOutputHash: 'a'.repeat(64),
        hostBefore: structuredClone(host),
        hostAfter: structuredClone(host),
        hostPolicyViolations: [],
      });
    }
  }
  return {
    schema: 1,
    evidenceKind: 'performance-confirmation',
    measurementFieldsPresent: true,
    timingEligible: true,
    conclusionEligible: true,
    executionScope: 'local-only',
    runner: await currentSourceRecord('run-matrix.mjs'),
    caseRunner: await currentSourceRecord('run-case.mjs'),
    environment: {
      parentCiMarkers: { CI: null },
      childCiMarkersCleared: ['CI'],
      childInputRunLinkCheck: null,
      runCaseProfilePolicy: { default: false, 'ci-link-check': true },
      runtimeProfile: LIFECYCLE_FIXED_RUNTIME_PROFILE,
      compilerEnvironment: EXPECTED_COMPILER_ENVIRONMENT,
      harnessSourceManifest: await captureHarnessSourceManifest(),
      childPoolEnvironment: BASELINE_POOL_ENVIRONMENT,
      correctnessGate: {
        status: 'passed',
        sha256: 'd'.repeat(64),
      },
    },
    hostPolicyViolations: [],
    validationErrors: [],
    rawOutputDifferences: [],
    hostAdmissionAttempts: runs.map((run) => ({ snapshot: run.hostBefore })),
    matrix: {
      evidenceKind: 'performance-confirmation',
      runtimeProfile: LIFECYCLE_FIXED_RUNTIME_PROFILE,
      poolEnvironment: BASELINE_POOL_ENVIRONMENT,
      hostPolicy: { ...FROZEN_PERFORMANCE_HOST_POLICY, cooldownMs: 15_000 },
      cases: [
        {
          name: 'synthetic-confirmation',
          variants,
          warmups: 0,
          repeats: 10,
        },
      ],
    },
    runs,
  };
}

async function currentSourceRecord(name) {
  const path = nodePath.join(import.meta.dirname, name);
  return {
    path,
    sha256: createHash('sha256').update(await readFile(path)).digest('hex'),
  };
}

function admittedHost() {
  return {
    loadAverage: [1, 1, 1],
    uptimeSeconds: 60,
    totalProcessCpuPercent: 100,
    competingStudyProcesses: [],
    power: { available: true, source: 'AC Power', raw: '' },
    lowPowerMode: { available: true, enabled: false, raw: '' },
    thermal: {
      available: true,
      noThermalWarning: true,
      noPerformanceWarning: true,
      raw: '',
    },
    memoryPressure: { available: true, freePercentage: 75, raw: '' },
    swapUsage: { available: true, usedBytes: 0, raw: '' },
    virtualMemoryCounters: { pageouts: 0, swapouts: 0 },
  };
}

async function writeReport(name, report) {
  const path = nodePath.join(directory, name);
  await writeFile(path, `${JSON.stringify(report)}\n`);
  await readFile(path);
  return path;
}

function assertRejected(result, label) {
  if (result.status === 0) {
    throw new Error(`${label} was accepted:\n${result.stdout}`);
  }
}
