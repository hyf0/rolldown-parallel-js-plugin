import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { BASELINE_POOL_ENVIRONMENT } from './pool-environment.mjs';
import { BASE_SCALES, loadScaleManifest } from './scale-corpus.mjs';
import { planScaleFollowup, validateBaseScreenReport } from './scale-followup.mjs';
import { LIFECYCLE_FIXED_RUNTIME_PROFILE } from './runtime-profile.mjs';

const manifest = await loadScaleManifest();
const baseScreen = makeBaseScreen();
const screenRecord = { path: '/synthetic/base-screen.json', sha256: '1'.repeat(64), report: baseScreen };
validateBaseScreenReport(baseScreen, manifest);

const initialPlan = planScaleFollowup({ screenRecord, manifest });
assertPlan(initialPlan, 'initial-confirmation', [512, 1_024, 2_048, 9_157]);
await assertRunnerAccepted(initialPlan.matrix, 'initial-confirmation');
const initialRecord = makeRecord(
  initialPlan.matrix,
  '2'.repeat(64),
  new Map([
    [512, 0.95],
    [1_024, 1.25],
    [2_048, 1.3],
    [9_157, 1.4],
  ]),
);

const refinement768Plan = planScaleFollowup({
  screenRecord,
  followupRecords: [initialRecord],
  manifest,
});
assertPlan(refinement768Plan, 'refinement-screen', [768]);
await assertRunnerAccepted(refinement768Plan.matrix, 'refinement-screen');
const refinement768Screen = makeRecord(refinement768Plan.matrix, '3'.repeat(64));
const confirmation768Plan = planScaleFollowup({
  screenRecord,
  followupRecords: [initialRecord, refinement768Screen],
  manifest,
});
assertPlan(confirmation768Plan, 'refinement-confirmation', [768]);
await assertRunnerAccepted(confirmation768Plan.matrix, 'refinement-confirmation');
const confirmation768 = makeRecord(
  confirmation768Plan.matrix,
  '4'.repeat(64),
  new Map([[768, 1.2]]),
);

const refinement640Plan = planScaleFollowup({
  screenRecord,
  followupRecords: [initialRecord, refinement768Screen, confirmation768],
  manifest,
});
assertPlan(refinement640Plan, 'refinement-screen', [640]);
const refinement640Screen = makeRecord(refinement640Plan.matrix, '5'.repeat(64));
const confirmation640Plan = planScaleFollowup({
  screenRecord,
  followupRecords: [
    initialRecord,
    refinement768Screen,
    confirmation768,
    refinement640Screen,
  ],
  manifest,
});
assertPlan(confirmation640Plan, 'refinement-confirmation', [640]);
const confirmation640 = makeRecord(
  confirmation640Plan.matrix,
  '6'.repeat(64),
  new Map([[640, 0.98]]),
);

const refinement896Plan = planScaleFollowup({
  screenRecord,
  followupRecords: [
    initialRecord,
    refinement768Screen,
    confirmation768,
    refinement640Screen,
    confirmation640,
  ],
  manifest,
});
assertPlan(refinement896Plan, 'refinement-screen', [896]);
const refinement896Screen = makeRecord(refinement896Plan.matrix, '7'.repeat(64));
const confirmation896Plan = planScaleFollowup({
  screenRecord,
  followupRecords: [
    initialRecord,
    refinement768Screen,
    confirmation768,
    refinement640Screen,
    confirmation640,
    refinement896Screen,
  ],
  manifest,
});
assertPlan(confirmation896Plan, 'refinement-confirmation', [896]);
const confirmation896 = makeRecord(
  confirmation896Plan.matrix,
  '8'.repeat(64),
  new Map([[896, 1.22]]),
);
const complete = planScaleFollowup({
  screenRecord,
  followupRecords: [
    initialRecord,
    refinement768Screen,
    confirmation768,
    refinement640Screen,
    confirmation640,
    refinement896Screen,
    confirmation896,
  ],
  manifest,
});
if (
  complete.status !== 'complete' ||
  complete.decision.mechanical.status !== 'exact' ||
  complete.decision.mechanical.scale !== 768 ||
  complete.decision.resource.status !== 'exact' ||
  complete.decision.resource.scale !== 768
) {
  throw new Error(`Iterative crossover did not resolve exactly at 768: ${JSON.stringify(complete)}`);
}
for (const scale of ['512', '1024', '2048', '9157', '640', '768', '896']) {
  const evidence = complete.decision.policyEvidenceByScale[scale];
  if (
    !evidence ||
    !Object.hasOwn(evidence.variants, 'worker-4') ||
    !Object.hasOwn(evidence.variants, 'worker-8') ||
    !Number.isFinite(evidence.variants['worker-4'].pairedWallRatioBootstrap95Upper) ||
    !Object.hasOwn(evidence.variants['worker-4'], 'selectedOracleWorkerCount')
  ) {
    throw new Error(`Scale ${scale} lacks fixed worker-4/worker-8 policy evidence`);
  }
}
for (const point of complete.decision.points) {
  const worker4 = point.variants.find(({ variant }) => variant === 'worker-4');
  if (
    point.mechanical.worker.workerCount !== 3 ||
    !Number.isFinite(worker4?.wallMedianBootstrap95?.lower) ||
    !Number.isFinite(worker4?.wallMedianBootstrap95?.upper)
  ) {
    throw new Error(`Scale ${point.scale} did not apply the smaller-count wall-median interval tie rule`);
  }
}

const rejected = [];
expectRejected('missing-screen-worker', () => {
  const report = structuredClone(baseScreen);
  report.runs = report.runs.filter(
    (run) => !(run.selection.scale === 512 && run.variant === 'worker-8'),
  );
  validateBaseScreenReport(report, manifest);
});
expectRejected('active-ci-marker', () => {
  const report = structuredClone(baseScreen);
  report.environment.parentCiMarkers.CI = 'true';
  validateBaseScreenReport(report, manifest);
});
expectRejected('screen-output-drift', () => {
  const report = structuredClone(baseScreen);
  report.runs.find((run) => run.selection.scale === 512 && run.variant === 'worker-4').normalizedOutputHash = 'f'.repeat(64);
  validateBaseScreenReport(report, manifest);
});
expectRejected('non-monotonic-base-screen', () => {
  const report = structuredClone(baseScreen);
  for (const run of report.runs.filter(
    (candidate) => candidate.selection.scale === 2_048 && candidate.variant !== 'ordinary',
  )) {
    run.totalElapsedMs = 1_200 + Number(run.variant.slice('worker-'.length));
  }
  validateBaseScreenReport(report, manifest);
});
expectRejected('non-monotonic-repeated-direction', () => {
  const record = structuredClone(initialRecord);
  for (const run of record.report.runs.filter(
    (candidate) => candidate.selection.scale === 2_048 && candidate.variant !== 'ordinary',
  )) {
    run.totalElapsedMs = 1_200;
  }
  planScaleFollowup({ screenRecord, followupRecords: [record], manifest });
});
expectRejected('followup-chain-hash', () => {
  const record = structuredClone(refinement768Screen);
  record.report.matrix.followup.consumedArtifactSha256 = [];
  planScaleFollowup({ screenRecord, followupRecords: [initialRecord, record], manifest });
});
expectRejected('confirmation-not-screened-best', () => {
  const record = structuredClone(initialRecord);
  record.report.matrix.followup.workerSelectionByScale['512'].bestWorkerCount = 5;
  planScaleFollowup({ screenRecord, followupRecords: [record], manifest });
});
expectRejected('off-protocol-refinement-scale', () => {
  const record = structuredClone(refinement768Screen);
  record.report.matrix.cases[0].selectionScale = 896;
  record.report.matrix.cases[0].selectionPrefixSha256 = prefixHash(896);
  for (const run of record.report.runs) {
    run.transformedEntryCount = 896;
    run.selection.scale = 896;
    run.selection.prefixSha256 = prefixHash(896);
  }
  planScaleFollowup({ screenRecord, followupRecords: [initialRecord, record], manifest });
});
expectRejected('post-child-pageout', () => {
  const record = structuredClone(initialRecord);
  record.report.runs[0].hostAfter.virtualMemoryCounters.pageouts = 1;
  planScaleFollowup({ screenRecord, followupRecords: [record], manifest });
});

console.log(
  JSON.stringify({
    valid: {
      initialConfirmationScales: initialPlan.matrix.cases.map(({ selectionScale }) => selectionScale),
      refinementSequence: [768, 640, 896],
      exactMechanicalCrossover: complete.decision.mechanical.scale,
      exactResourceCrossover: complete.decision.resource.scale,
      fixedPolicyEvidenceScales: Object.keys(complete.decision.policyEvidenceByScale),
      bootstrap: complete.decision.bootstrap,
    },
    rejected,
  }),
);

function makeBaseScreen() {
  const matrix = {
    executionScope: 'local-only',
    evidenceKind: 'performance-screen',
    correctnessGate: 'scale-correctness-gate.json',
    runtimeProfile: LIFECYCLE_FIXED_RUNTIME_PROFILE,
    poolEnvironment: BASELINE_POOL_ENVIRONMENT,
    hostPolicy: hostPolicy(),
    cases: BASE_SCALES.map((scale, index) => ({
      name: `synthetic-${scale}-screen`,
      projectRoot: '/synthetic/cloudflare',
      rolldownPackageRoot: '/synthetic/rolldown/packages/rolldown',
      corpus: 'cloudflare-mdx-scale-v1',
      buildProfile: 'default',
      selectionScale: scale,
      selectionPrefixSha256: prefixHash(scale),
      instrumentation: false,
      variants: screenVariants(),
      warmups: 0,
      repeats: 1,
      startIndex: index,
    })),
  };
  const workerWinScales = new Set([1_024, 2_048, 4_096, 9_157]);
  return makePerformanceReport(
    matrix,
    new Map(BASE_SCALES.map((scale) => [scale, workerWinScales.has(scale) ? 1.2 : 0.95])),
  );
}

function makeRecord(matrix, sha256, speedupByScale = new Map()) {
  return {
    path: `/synthetic/${sha256.slice(0, 4)}.json`,
    sha256,
    report: makePerformanceReport(matrix, speedupByScale),
  };
}

function makePerformanceReport(matrix, speedupByScale) {
  const runs = [];
  let sequence = 0;
  for (const definition of matrix.cases) {
    const repeats = definition.repeats ?? 1;
    const screenedBest = 4;
    const targetSpeedup = speedupByScale.get(definition.selectionScale) ?? 1;
    for (let index = 0; index < repeats; index++) {
      const blockIndex = (definition.startIndex ?? 0) + index;
      const offset = blockIndex % definition.variants.length;
      const variants = [
        ...definition.variants.slice(offset),
        ...definition.variants.slice(0, offset),
      ];
      for (const variant of variants) {
        const workerCount = variant === 'ordinary' ? 0 : Number(variant.slice('worker-'.length));
        let elapsed = 1_000;
        if (workerCount > 0) {
          const selectedElapsed = 1_000 / targetSpeedup;
          if (repeats > 1 && workerCount === 4) {
            elapsed = selectedElapsed * (index < repeats / 2 ? 0.98 : 1.02);
          } else if (repeats > 1 && workerCount === 3) {
            elapsed = selectedElapsed * 1.01;
          } else {
            elapsed = selectedElapsed * (1 + Math.abs(workerCount - screenedBest) * 0.1);
          }
        }
        runs.push({
          name: definition.name,
          index: blockIndex,
          sequence: sequence++,
          variant,
          buildProfile: 'default',
          effectiveRunLinkCheck: false,
          measurementMode: 'measurement',
          runtimeProfile: LIFECYCLE_FIXED_RUNTIME_PROFILE,
          poolEnvironment: BASELINE_POOL_ENVIRONMENT,
          totalElapsedMs: elapsed,
          cpuUserMs: workerCount === 0 ? 900 : 1_300,
          cpuSystemMs: 100,
          peakRssBytes: workerCount === 0 ? 1_000_000_000 : 1_500_000_000,
          transformedEntryCount: definition.selectionScale,
          selection: {
            scale: definition.selectionScale,
            prefixSha256: definition.selectionPrefixSha256,
          },
          outputChunks: definition.selectionScale,
          normalizedOutputBytes: definition.selectionScale * 100,
          normalizedOutputHash: String(definition.selectionScale).padStart(64, '0'),
          outputNormalization: { kind: 'synthetic', playgroundUrls: 0, files: [] },
          hostBefore: admittedHost(),
          hostAfter: admittedHost(),
          hostPolicyViolations: [],
        });
      }
    }
  }
  return {
    schema: 1,
    evidenceKind: matrix.evidenceKind,
    measurementFieldsPresent: true,
    timingEligible: true,
    conclusionEligible: matrix.evidenceKind === 'performance-confirmation',
    executionScope: 'local-only',
    environment: {
      parentCiMarkers: { CI: null },
      runtimeProfile: LIFECYCLE_FIXED_RUNTIME_PROFILE,
      childPoolEnvironment: BASELINE_POOL_ENVIRONMENT,
      correctnessGate: { status: 'passed', sha256: 'a'.repeat(64) },
    },
    matrix,
    hostAdmissionAttempts: runs.map(() => ({})),
    hostPolicyViolations: [],
    validationErrors: [],
    runs,
  };
}

function assertPlan(plan, stage, scales) {
  if (
    plan.status !== 'matrix-required' ||
    plan.stage !== stage ||
    !same(plan.matrix.cases.map(({ selectionScale }) => selectionScale), scales)
  ) {
    throw new Error(`Expected ${stage} at ${scales}, got ${JSON.stringify(plan)}`);
  }
  for (const definition of plan.matrix.cases) {
    if (stage.endsWith('confirmation') && (definition.warmups !== 0 || definition.repeats !== 10)) {
      throw new Error(`${stage} is not ten no-warmup blocks`);
    }
  }
}

function expectRejected(name, operation) {
  try {
    operation();
  } catch {
    rejected.push(name);
    return;
  }
  throw new Error(`Invalid scale follow-up was accepted: ${name}`);
}

async function assertRunnerAccepted(matrix, name) {
  const directory = await mkdtemp(nodePath.join(tmpdir(), 'mdx-scale-followup-'));
  try {
    const path = nodePath.join(directory, `${name}.json`);
    await writeFile(path, `${JSON.stringify(matrix)}\n`);
    const result = spawnSync(
      process.execPath,
      [nodePath.join(import.meta.dirname, 'run-matrix.mjs'), '--check-config', path],
      { encoding: 'utf8' },
    );
    if (result.status !== 0) {
      throw new Error(`run-matrix rejected generated ${name}: ${result.stderr}`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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

function hostPolicy() {
  return {
    requiredPowerSource: 'AC Power',
    requireLowPowerModeOff: true,
    requireNoThermalOrPerformanceWarning: true,
    requireNoCompetingStudyProcesses: true,
    maxUptimeSeconds: 86_400,
    maxStartOneMinuteLoad: 2,
    maxStartTotalProcessCpuPercent: 150,
    maxStartSwapUsedBytes: 512 * 1024 * 1024,
    minStartMemoryFreePercent: 50,
    waitIntervalMs: 10_000,
    maxWaitMs: 300_000,
    maxSwapoutDeltaPages: 0,
    maxPageoutDeltaPages: 0,
    cooldownMs: 15_000,
  };
}

function screenVariants() {
  return ['ordinary', ...Array.from({ length: 8 }, (_, index) => `worker-${index + 1}`)];
}

function prefixHash(scale) {
  return manifest.prefixes[String(scale)].selectionSha256;
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
