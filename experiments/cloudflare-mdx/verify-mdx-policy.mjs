import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { captureCpulimitProvenance } from '../cpu-rate-control/cpulimit-provenance.mjs';
import {
  planAllocationPolicy,
  planQuotaPolicy,
  requirePassedCpulimitCalibration,
  summarizePolicyReport,
  validatePolicyMatrix,
  validatePolicyReport,
} from './mdx-policy.mjs';
import { BASELINE_POOL_ENVIRONMENT } from './pool-environment.mjs';
import { loadScaleManifest } from './scale-corpus.mjs';
import { LIFECYCLE_FIXED_RUNTIME_PROFILE } from './runtime-profile.mjs';

const manifest = await loadScaleManifest();
const controllerProvenance = await captureCpulimitProvenance();
const sourceRecords = {
  runner: await sourceRecord('run-policy-matrix.mjs'),
  caseRunner: await sourceRecord('run-case.mjs'),
  launcher: await sourceRecord('policy-node-launcher.mjs'),
};
const template = {
  projectRoot: '/synthetic/cloudflare',
  rolldownPackageRoot: '/synthetic/rolldown/packages/rolldown',
  correctnessGate: '/synthetic/scale-correctness-gate.json',
  hostPolicy: hostPolicy(),
};
const crossover = syntheticCrossover();

const allocationRecords = [];
const tokioScreenPlan = planAllocationPolicy({ crossover, policyRecords: [], template, manifest });
assertPlan(tokioScreenPlan, 'allocation-tokio-screen', 16);
await assertRunnerAccepted(tokioScreenPlan.matrix, 'tokio-screen');
allocationRecords.push(makeRecord(tokioScreenPlan.matrix, '1'.repeat(64)));
const tokioScreenSummary = summarizePolicyReport(allocationRecords[0].report, manifest);
for (const entry of tokioScreenSummary.cases) {
  const selected = entry.policyEvidence.selectedOracleWorkerCount;
  if (
    selected !== entry.selection.workerCount ||
    entry.policyEvidence.variants[`worker-${selected}`]?.resourceEligible !== true
  ) {
    throw new Error('One-shot policyEvidence does not explain its actual resource selection');
  }
}
const tokioConfirmationPlan = planAllocationPolicy({
  crossover,
  policyRecords: allocationRecords,
  template,
  manifest,
});
assertPlan(tokioConfirmationPlan, 'allocation-tokio-confirmation', 8);
allocationRecords.push(makeRecord(tokioConfirmationPlan.matrix, '2'.repeat(64)));
const rayonScreenPlan = planAllocationPolicy({
  crossover,
  policyRecords: allocationRecords,
  template,
  manifest,
});
assertPlan(rayonScreenPlan, 'allocation-rayon-screen', 12);
await assertRunnerAccepted(rayonScreenPlan.matrix, 'rayon-screen');
allocationRecords.push(makeRecord(rayonScreenPlan.matrix, '3'.repeat(64)));
const rayonConfirmationPlan = planAllocationPolicy({
  crossover,
  policyRecords: allocationRecords,
  template,
  manifest,
});
assertPlan(rayonConfirmationPlan, 'allocation-rayon-confirmation', 8);
allocationRecords.push(makeRecord(rayonConfirmationPlan.matrix, '4'.repeat(64)));
const allocationComplete = planAllocationPolicy({
  crossover,
  policyRecords: allocationRecords,
  template,
  manifest,
});
if (allocationComplete.status !== 'complete') throw new Error('Allocation chain did not complete');

const calibration = await requirePassedCpulimitCalibration(syntheticCalibration());
const quotaRecords = [];
const quotaScreenPlan = planQuotaPolicy({
  crossover,
  policyRecords: [],
  template,
  manifest,
  calibration,
});
assertPlan(quotaScreenPlan, 'quota-screen', 6);
await assertRunnerAccepted(quotaScreenPlan.matrix, 'quota-screen');
quotaRecords.push(makeRecord(quotaScreenPlan.matrix, '5'.repeat(64)));
const quotaConfirmationPlan = planQuotaPolicy({
  crossover,
  policyRecords: quotaRecords,
  template,
  manifest,
  calibration,
});
assertPlan(quotaConfirmationPlan, 'quota-confirmation', 6);
await assertRunnerAccepted(quotaConfirmationPlan.matrix, 'quota-confirmation');
quotaRecords.push(makeRecord(quotaConfirmationPlan.matrix, '6'.repeat(64)));
const quotaComplete = planQuotaPolicy({
  crossover,
  policyRecords: quotaRecords,
  template,
  manifest,
  calibration,
});
if (quotaComplete.status !== 'complete') throw new Error('Quota chain did not complete');

for (const summary of [
  allocationComplete.tokioConfirmation,
  allocationComplete.rayonConfirmation,
  quotaComplete.confirmation,
]) {
  for (const evidence of Object.values(summary.policyEvidenceByCase)) {
    for (const fixed of ['worker-4', 'worker-8']) {
      const value = evidence.variants[fixed];
      if (
        !value ||
        !Number.isFinite(value.wallMedianMs) ||
        !Number.isFinite(value.cpuMedianMs) ||
        !Number.isFinite(value.peakRssMedianBytes) ||
        typeof value.resourceEligible !== 'boolean' ||
        !Number.isFinite(value.pairedWallRatioBootstrap95Upper) ||
        !Number.isSafeInteger(value.selectedOracleWorkerCount)
      ) {
        throw new Error(`Standard policyEvidence is incomplete for ${fixed}`);
      }
    }
  }
}

const rejected = [];
expectRejected('missing-ordinary-pool-setting', () => {
  const matrix = structuredClone(tokioScreenPlan.matrix);
  matrix.cases.splice(0, 1);
  validatePolicyMatrix(matrix, manifest);
});
expectRejected('changed-blocking-pool', () => {
  const matrix = structuredClone(tokioScreenPlan.matrix);
  matrix.cases[0].poolEnvironment.ROLLDOWN_MAX_BLOCKING_THREADS = '8';
  validatePolicyMatrix(matrix, manifest);
});
expectRejected('quota-instrumentation', () => {
  const matrix = structuredClone(quotaScreenPlan.matrix);
  matrix.cases[0].instrumentation = true;
  validatePolicyMatrix(matrix, manifest);
});
expectRejected('missing-fixed-worker-eight', () => {
  const matrix = structuredClone(tokioConfirmationPlan.matrix);
  matrix.cases[0].variants = matrix.cases[0].variants.filter((variant) => variant !== 'worker-8');
  validatePolicyMatrix(matrix, manifest);
});
expectRejected('single-rust-pool-confirmation', () => {
  const matrix = structuredClone(tokioConfirmationPlan.matrix);
  matrix.cases.splice(1, 1);
  validatePolicyMatrix(matrix, manifest);
});
expectRejected('changed-crossover-execution-template', () => {
  const matrix = structuredClone(tokioScreenPlan.matrix);
  matrix.hostPolicy.cooldownMs += 1;
  validatePolicyMatrix(matrix, manifest);
});
expectRejected('controller-target-mismatch', () => {
  const report = structuredClone(quotaRecords[0].report);
  report.runs[0].controller.targetPid += 1;
  validatePolicyReport(report, manifest);
});
expectRejected('controller-missing-stops', () => {
  const report = structuredClone(quotaRecords[0].report);
  const run = report.runs.find((candidate) => candidate.controller.limitPercent === 400);
  run.controller.stopCycles = 0;
  run.controller.stoppedUs = 0;
  validatePolicyReport(report, manifest);
});
expectRejected('quota-attribution-contamination', () => {
  const report = structuredClone(quotaRecords[0].report);
  report.runs[0].metrics = { service: true };
  validatePolicyReport(report, manifest);
});
expectRejected('allocation-empty-attribution-payload', () => {
  const report = structuredClone(allocationRecords[0].report);
  report.runs[0].metrics = {};
  validatePolicyReport(report, manifest);
});
expectRejected('quota-cpu-ceiling', () => {
  const report = structuredClone(quotaRecords[0].report);
  const run = report.runs.find((candidate) => candidate.controller.limitPercent === 400);
  run.cpuUserMs = run.totalElapsedMs * 5;
  validatePolicyReport(report, manifest);
});
expectRejected('cross-pool-output-drift', () => {
  const report = structuredClone(allocationRecords[0].report);
  report.runs.find((run) => run.name.includes('tokio-18')).normalizedOutputHash = 'f'.repeat(64);
  validatePolicyReport(report, manifest);
});
expectRejected('uniform-wrong-scale-oracle', () => {
  const report = structuredClone(allocationRecords[0].report);
  const scale = report.runs[0].transformedEntryCount;
  for (const run of report.runs.filter((candidate) => candidate.transformedEntryCount === scale)) {
    run.normalizedOutputHash = 'f'.repeat(64);
  }
  validatePolicyReport(report, manifest);
});
expectRejected('missing-output-fields', () => {
  const report = structuredClone(allocationRecords[0].report);
  delete report.runs[0].normalizedOutputHash;
  validatePolicyReport(report, manifest);
});
expectRejected('external-rss-not-node', () => {
  const report = structuredClone(quotaRecords[0].report);
  report.runs[0].peakRssBytes = report.runs[0].finalRssBytes - 1;
  validatePolicyReport(report, manifest);
});
expectRejected('external-time-does-not-nest-child', () => {
  const report = structuredClone(quotaRecords[0].report);
  report.runs[0].externalTiming.realMs = 1;
  report.runs[0].externalTiming.realToken = '0.001';
  report.runs[0].externalTiming.decimalPlaces = 3;
  report.runs[0].externalTiming.resolutionMs = 1;
  report.runs[0].externalTiming.raw = '0.001 real 1.00 user 0.00 sys';
  report.runs[0].policyWallMs = 1;
  validatePolicyReport(report, manifest);
});
expectRejected('missing-launcher-provenance', () => {
  const report = structuredClone(quotaRecords[0].report);
  delete report.launcher;
  validatePolicyReport(report, manifest);
});
expectRejected('controller-cycles-inconsistent', () => {
  const report = structuredClone(quotaRecords[0].report);
  report.runs[0].controller.stopCycles = report.runs[0].controller.controlCycles + 1;
  validatePolicyReport(report, manifest);
});
expectRejected('policy-chain-hash', () => {
  const records = structuredClone(allocationRecords.slice(0, 2));
  records[1].report.matrix.policy.consumedPolicyArtifactSha256[0] = 'f'.repeat(64);
  planAllocationPolicy({ crossover, policyRecords: records, template, manifest });
});
expectRejected('copied-selection', () => {
  const records = structuredClone(allocationRecords.slice(0, 2));
  records[1].report.matrix.cases[0].poolEnvironment.ROLLDOWN_WORKER_THREADS = '18';
  planAllocationPolicy({ crossover, policyRecords: records, template, manifest });
});
await expectRejectedAsync('calibration-binary-hash', async () => {
  const record = syntheticCalibration();
  record.report.binarySha256 = 'f'.repeat(64);
  await requirePassedCpulimitCalibration(record);
});
await expectRejectedAsync('calibration-wrong-execution-environment', async () => {
  const record = syntheticCalibration();
  record.report.executionEnvironmentEligible = false;
  await requirePassedCpulimitCalibration(record);
});
await expectRejectedAsync('calibration-authored-pass-only', async () => {
  const record = syntheticCalibration();
  record.report.samples = [];
  await requirePassedCpulimitCalibration(record);
});
await expectRejectedAsync('calibration-raw-average-tamper', async () => {
  const record = syntheticCalibration();
  record.report.samples[0].load.averageCpuPercent += 1;
  await requirePassedCpulimitCalibration(record);
});
await expectRejectedAsync('calibration-summary-not-derived', async () => {
  const record = syntheticCalibration();
  record.report.levelSummary[0].medianAchievedToTargetRatio = 0.99;
  await requirePassedCpulimitCalibration(record);
});
await expectRejectedAsync('calibration-saturation-not-derived', async () => {
  const record = syntheticCalibration();
  record.report.unconstrainedSaturationCpuPercent = 900;
  await requirePassedCpulimitCalibration(record);
});
await expectRejectedAsync('calibration-stop-cycles-exceed-control', async () => {
  const record = syntheticCalibration();
  record.report.samples[0].controller.stopCycles = 101;
  record.report.levelSummary[0].controllerStopCycles[0] = 101;
  await requirePassedCpulimitCalibration(record);
});
await expectRejectedAsync('calibration-saturated-600-without-stops', async () => {
  const record = syntheticCalibration();
  zeroCalibrationStops(record.report, 600);
  await requirePassedCpulimitCalibration(record);
});
const saturatedEightHundred = syntheticCalibration();
zeroCalibrationStops(saturatedEightHundred.report, 800);
await requirePassedCpulimitCalibration(saturatedEightHundred);

console.log(
  JSON.stringify({
    valid: {
      allocationStages: allocationRecords.map(({ report }) => report.evidenceKind),
      allocationPoints: crossover.points,
      quotaStages: quotaRecords.map(({ report }) => report.evidenceKind),
      quotaPoints: crossover.quotaPoints,
      quotaPercentages: [400, 800, 1_200],
      saturatedEightHundredZeroStopsAccepted: true,
      calibrationHashes: {
        source: controllerProvenance.sourceTree.sha256,
        patch: controllerProvenance.patch.sha256,
        binary: controllerProvenance.binary.sha256,
      },
    },
    rejected,
  }),
);

function makeRecord(matrix, sha256) {
  return {
    path: `/synthetic/${matrix.policy.stage}.raw.json`,
    sha256,
    report: makeReport(matrix),
  };
}

function makeReport(matrix) {
  const runs = [];
  let sequence = 0;
  for (const definition of matrix.cases) {
    for (let index = 0; index < definition.repeats; index++) {
      const blockIndex = definition.startIndex + index;
      const offset = blockIndex % definition.variants.length;
      const order = [
        ...definition.variants.slice(offset),
        ...definition.variants.slice(0, offset),
      ];
      for (const variant of order) {
        const workerCount = variant === 'ordinary' ? 0 : Number(variant.slice('worker-'.length));
        const timing = syntheticTiming(definition, workerCount, index);
        const processId = 10_000 + sequence;
        const externalTiming = syntheticExternalTiming(timing);
        runs.push({
          name: definition.name,
          index: blockIndex,
          sequence: sequence++,
          variant,
          workerCount,
          workerModel: workerCount === 0 ? 'ordinary' : 'rolldown',
          corpus: 'cloudflare-mdx-scale-v1',
          evidenceKind: matrix.evidenceKind,
          processId,
          buildProfile: 'default',
          effectiveRunLinkCheck: false,
          measurementMode: 'measurement',
          instrumentation: false,
          rustInstrumentation: false,
          lifecycleClaim: false,
          runtimeProfile: LIFECYCLE_FIXED_RUNTIME_PROFILE,
          projectCommit: '2b08a67a41da1a521aecbcf465893abae1e9a6df',
          rolldownCommit: LIFECYCLE_FIXED_RUNTIME_PROFILE.rolldownCommit,
          bindingHash: LIFECYCLE_FIXED_RUNTIME_PROFILE.bindingSha256,
          distHash: LIFECYCLE_FIXED_RUNTIME_PROFILE.distSha256,
          sourceManifestHash:
            '84077a08f660782274d5502be25f0ec9297cec9c52508e2c5e9e2a3e8bedc12b',
          poolEnvironment: definition.poolEnvironment,
          totalElapsedMs: timing.wallMs,
          externalTiming,
          policyWallMs: externalTiming.realMs,
          cpuUserMs: timing.cpuMs * 0.9,
          cpuSystemMs: timing.cpuMs * 0.1,
          peakRssBytes: workerCount === 0 ? 1_000_000_000 : 1_500_000_000,
          finalRssBytes: workerCount === 0 ? 500_000_000 : 800_000_000,
          transformedEntryCount: definition.selectionScale,
          selection: {
            scale: definition.selectionScale,
            prefixSha256: definition.selectionPrefixSha256,
          },
          outputChunks: definition.selectionScale,
          normalizedOutputBytes: definition.selectionScale * 100,
          normalizedOutputHash: String(definition.selectionScale).padStart(64, '0'),
          outputNormalization: {
            kind: 'undici-formdata-boundary',
            playgroundUrls: 0,
            files: [],
          },
          hostBefore: admittedHost(),
          hostAfter: admittedHost(),
          hostPolicyViolations: [],
          controller: definition.quotaPercent
            ? controller(processId, definition.quotaPercent)
            : undefined,
        });
      }
    }
  }
  return {
    schema: 1,
    evidenceKind: matrix.evidenceKind,
    measurementFieldsPresent: true,
    timingEligible: true,
    conclusionEligible: false,
    executionScope: 'local-only',
    nodeBinary: process.execPath,
    runner: sourceRecords.runner,
    caseRunner: sourceRecords.caseRunner,
    launcher: sourceRecords.launcher,
    environment: {
      parentCiMarkers: {
        CI: null,
        GITHUB_ACTIONS: null,
        BUILDKITE: null,
        CIRCLECI: null,
        TF_BUILD: null,
        JENKINS_URL: null,
      },
      runtimeProfile: LIFECYCLE_FIXED_RUNTIME_PROFILE,
      correctnessGate: {
        path: matrix.correctnessGate,
        status: 'passed',
        sha256: 'a'.repeat(64),
      },
      childCiMarkersCleared: [
        'CI',
        'GITHUB_ACTIONS',
        'BUILDKITE',
        'CIRCLECI',
        'TF_BUILD',
        'JENKINS_URL',
      ],
      controllerProvenance: matrix.policy.calibration?.controllerProvenance ?? null,
      externalMeasurement: {
        command: '/usr/bin/time',
        arguments: ['-l'],
        timedExecutable: process.execPath,
        allocationTimedScript: sourceRecords.caseRunner.path,
        quotaTimedScript: sourceRecords.launcher.path,
        quotaControllerOutsideTimedProcess: true,
      },
    },
    matrix,
    hostAdmissionAttempts: runs.map(() => ({})),
    hostPolicyViolations: [],
    validationErrors: [],
    runs,
  };
}

function syntheticExternalTiming(timing) {
  const realMs = Math.ceil((timing.wallMs + 100) / 10) * 10;
  const userMs = Math.ceil((timing.cpuMs + 50) / 10) * 10;
  const realToken = (realMs / 1_000).toFixed(2);
  return {
    schema: 1,
    source: '/usr/bin/time -l',
    timedProcess: 'node',
    raw: `${realToken} real ${(userMs / 1_000).toFixed(2)} user 0.00 sys`,
    realToken,
    decimalPlaces: 2,
    resolutionMs: 10,
    realMs,
    userMs,
    systemMs: 0,
  };
}

function syntheticTiming(definition, workerCount, index) {
  const quota = definition.quotaPercent;
  let ordinaryWall = quota === 400 ? 2_000 : quota === 800 ? 1_300 : 1_000;
  if (!quota) ordinaryWall = 1_000;
  if (workerCount === 0) {
    return {
      wallMs: ordinaryWall,
      cpuMs: quota ? (ordinaryWall * quota * 0.75) / 100 : 900,
    };
  }
  const tokio = Number(definition.poolEnvironment.ROLLDOWN_WORKER_THREADS);
  const rayon = Number(definition.poolEnvironment.RAYON_NUM_THREADS);
  const workerPenalty = Math.abs(workerCount - 4) * 60;
  const tokioPenalty = definition.name.includes('tokio-') ? Math.abs(tokio - 8) * 15 : 0;
  const rayonPenalty = definition.name.includes('rayon-') ? Math.abs(rayon - 8) * 20 : 0;
  const noise = definition.repeats === 10 ? (index < 5 ? 0.99 : 1.01) : 1;
  const wallMs = (ordinaryWall * 0.62 + workerPenalty + tokioPenalty + rayonPenalty) * noise;
  return {
    wallMs,
    cpuMs: quota ? (wallMs * quota * 0.75) / 100 : 1_350,
  };
}

function syntheticCalibration() {
  const samples = [];
  const levelSummary = [];
  let pid = 20_000;
  for (let repetition = 0; repetition < 3; repetition++) {
    const levels = repetition % 2 === 0 ? [200, 400, 600, 800] : [800, 600, 400, 200];
    for (const limitPercent of levels) {
      const value = {
        mode: 'controlled',
        limitPercent,
        repetition,
        load: calibrationLoad(10_000, limitPercent * 100),
        controller: controller(pid++, limitPercent),
      };
      samples.push(value);
    }
  }
  for (const limitPercent of [200, 400, 600, 800]) {
    const selected = samples.filter((sample) => sample.limitPercent === limitPercent);
    levelSummary.push({
      limitPercent,
      sampleCount: 3,
      achievedCpuPercent: selected.map(({ load }) => load.averageCpuPercent),
      achievedToTargetRatio: [1, 1, 1],
      medianAchievedToTargetRatio: 1,
      withinFivePercent: true,
      controllerStopCycles: selected.map(({ controller: value }) => value.stopCycles),
      controllerStoppedMs: selected.map(({ controller: value }) => value.stoppedUs / 1_000),
    });
  }
  const equivalence = Array.from({ length: 5 }, (_, block) => ({
    block,
    order: block % 2 === 0 ? ['direct', 'controlled'] : ['controlled', 'direct'],
    direct: { mode: 'direct', block, load: calibrationLoad(10_000, 80_000) },
    controlled: {
      mode: 'controlled',
      limitPercent: 1_200,
      block,
      load: calibrationLoad(10_000, 80_000),
      controller: controller(pid++, 1_200),
    },
    wallRatio: 1,
    cpuRatio: 1,
  }));
  return {
    path: '/synthetic/cpu-rate-calibration.raw.json',
    sha256: 'c'.repeat(64),
    report: {
      schemaVersion: 2,
      kind: 'cpulimit-apple-calibration',
      executionScope: 'local-only',
      node: 'v24.18.0',
      parentCiMarkers: {
        CI: null,
        GITHUB_ACTIONS: null,
        BUILDKITE: null,
        CIRCLECI: null,
        TF_BUILD: null,
        JENKINS_URL: null,
      },
      machine: {
        platform: 'darwin',
        architecture: 'arm64',
        cpuModel: 'Apple M3 Pro',
        logicalCpuCount: 12,
        totalMemoryBytes: 38_654_705_664,
      },
      executionEnvironmentEligible: true,
      options: {
        durationMs: 10_000,
        threadCount: 8,
        repetitions: 3,
        equivalenceBlocks: 5,
        levels: [200, 400, 600, 800],
      },
      binarySha256: controllerProvenance.binary.sha256,
      patchSha256: controllerProvenance.patch.sha256,
      controllerProvenance,
      formalProfile: true,
      passed: true,
      controllerRecordsValid: true,
      levelSummary,
      equivalenceSummary: {
        blocks: 5,
        medianWallRatio: 1,
        medianCpuRatio: 1,
        wallWithinTwoPercent: true,
        cpuWithinTwoPercent: true,
        noControllerStops: true,
      },
      unconstrainedSaturationCpuPercent: 800,
      samples,
      equivalence,
    },
  };
}

function calibrationLoad(wallMs, cpuMs) {
  return {
    durationMs: 10_000,
    threadCount: 8,
    wallMs,
    cpuMs,
    averageCpuPercent: (cpuMs / wallMs) * 100,
  };
}

function zeroCalibrationStops(report, limitPercent) {
  const selected = report.samples.filter((sample) => sample.limitPercent === limitPercent);
  for (const sample of selected) {
    sample.controller.stopCycles = 0;
    sample.controller.stoppedUs = 0;
  }
  const summary = report.levelSummary.find((entry) => entry.limitPercent === limitPercent);
  summary.controllerStopCycles = selected.map(() => 0);
  summary.controllerStoppedMs = selected.map(() => 0);
}

function syntheticCrossover() {
  const points = [640, 768, 896, 9_157];
  const policyEvidenceByScale = Object.fromEntries(
    points.map((scale) => [
      String(scale),
      {
        schema: 1,
        selectedOracleWorkerCount: 3,
        variants: {
          ordinary: standardEvidence(1_000, 900, 1_000_000_000, true, 1, 3),
          'worker-3': standardEvidence(700, 1_300, 1_500_000_000, true, 0.75, 3),
          'worker-4': standardEvidence(680, 1_350, 1_500_000_000, true, 0.73, 3),
          'worker-8': standardEvidence(800, 1_500, 1_800_000_000, true, 0.9, 3),
        },
      },
    ]),
  );
  return {
    schema: 1,
    criterion: 'resource-acceptable',
    baseScreen: { path: '/synthetic/base-screen.raw.json', sha256: 'a'.repeat(64) },
    followups: [{ path: '/synthetic/crossover.raw.json', sha256: 'b'.repeat(64) }],
    decisionSha256: 'd'.repeat(64),
    mechanical: { status: 'exact', scale: 768, previousScale: 640, confirmingNextScale: 896 },
    resource: { status: 'exact', scale: 768, previousScale: 640, confirmingNextScale: 896 },
    points,
    quotaPoints: [768, 9_157],
    policyEvidenceByScale,
    executionTemplate: template,
    outputOraclesByScale: Object.fromEntries(
      points.map((scale) => [
        String(scale),
        {
          source: {
            path: `/synthetic/crossover-${scale}.raw.json`,
            sha256: String(scale).padStart(64, 'a').slice(-64),
            caseName: `synthetic-crossover-${scale}`,
          },
          outputChunks: scale,
          normalizedOutputBytes: scale * 100,
          normalizedOutputHash: String(scale).padStart(64, '0'),
          outputNormalization: {
            kind: 'undici-formdata-boundary',
            playgroundUrls: 0,
            files: [],
          },
        },
      ]),
    ),
  };
}

function standardEvidence(wall, cpu, rss, eligible, upper, oracle) {
  return {
    wallMedianMs: wall,
    cpuMedianMs: cpu,
    peakRssMedianBytes: rss,
    resourceEligible: eligible,
    pairedWallRatioBootstrap95Upper: upper,
    selectedOracleWorkerCount: oracle,
  };
}

function controller(targetPid, limitPercent) {
  const stops = limitPercent < 1_200 ? 20 : 0;
  return {
    version: 1,
    targetPid,
    limitPercent,
    controlCycles: 100,
    stopCycles: stops,
    stoppedUs: stops > 0 ? 500_000 : 0,
  };
}

function assertPlan(plan, stage, cases) {
  if (
    plan.status !== 'matrix-required' ||
    plan.stage !== stage ||
    plan.matrix.cases.length !== cases
  ) {
    throw new Error(`Expected ${stage}/${cases}, got ${JSON.stringify(plan)}`);
  }
  validatePolicyMatrix(plan.matrix, manifest);
}

async function assertRunnerAccepted(matrix, name) {
  const directory = await mkdtemp(nodePath.join(tmpdir(), 'mdx-policy-'));
  try {
    const path = nodePath.join(directory, `${name}.json`);
    await writeFile(path, `${JSON.stringify(matrix)}\n`);
    const result = spawnSync(
      process.execPath,
      [nodePath.join(import.meta.dirname, 'run-policy-matrix.mjs'), '--check-config', path],
      { encoding: 'utf8' },
    );
    if (result.status !== 0) throw new Error(`run-policy-matrix rejected ${name}: ${result.stderr}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function expectRejected(name, operation) {
  try {
    operation();
  } catch {
    rejected.push(name);
    return;
  }
  throw new Error(`Invalid MDX policy artifact was accepted: ${name}`);
}

async function expectRejectedAsync(name, operation) {
  try {
    await operation();
  } catch {
    rejected.push(name);
    return;
  }
  throw new Error(`Invalid asynchronous MDX policy artifact was accepted: ${name}`);
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

async function sourceRecord(name) {
  const path = nodePath.join(import.meta.dirname, name);
  return {
    path,
    sha256: createHash('sha256').update(await readFile(path)).digest('hex'),
  };
}
