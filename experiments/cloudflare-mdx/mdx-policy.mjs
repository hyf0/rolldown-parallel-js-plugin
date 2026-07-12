import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import nodePath from 'node:path';
import { captureCpulimitProvenance } from '../cpu-rate-control/cpulimit-provenance.mjs';
import {
  evaluateChildHostPolicy,
  evaluateStartAdmission,
  validateFrozenPerformanceHostPolicy,
} from './local-host-policy.mjs';
import { BASELINE_POOL_ENVIRONMENT, normalizePoolEnvironment } from './pool-environment.mjs';
import { loadScaleManifest } from './scale-corpus.mjs';
import {
  planScaleFollowup,
  summarizeRepeatedPolicyCase,
} from './scale-followup.mjs';
import { LIFECYCLE_FIXED_RUNTIME_PROFILE, normalizeRuntimeProfile } from './runtime-profile.mjs';

export const POLICY_STAGES = Object.freeze([
  'allocation-tokio-screen',
  'allocation-tokio-confirmation',
  'allocation-rayon-screen',
  'allocation-rayon-confirmation',
  'quota-screen',
  'quota-confirmation',
]);
export const TOKIO_COUNTS = Object.freeze([4, 8, 12, 18]);
export const RAYON_COUNTS = Object.freeze([4, 8, 12]);
export const QUOTA_PERCENTAGES = Object.freeze([400, 800, 1_200]);
export const POLICY_SCREEN_VARIANTS = Object.freeze([
  'ordinary',
  'worker-1',
  'worker-2',
  'worker-3',
  'worker-4',
  'worker-5',
  'worker-6',
  'worker-7',
  'worker-8',
]);

const MAX_RSS_BYTES = 27 * 1024 ** 3;
const EXPECTED_PROJECT_COMMIT = '2b08a67a41da1a521aecbcf465893abae1e9a6df';
const EXPECTED_SOURCE_MANIFEST_SHA256 =
  '84077a08f660782274d5502be25f0ec9297cec9c52508e2c5e9e2a3e8bedc12b';
const CALIBRATION_CI_MARKERS = [
  'BUILDKITE',
  'CI',
  'CIRCLECI',
  'GITHUB_ACTIONS',
  'JENKINS_URL',
  'TF_BUILD',
];

export async function readArtifactRecord(path) {
  const absolutePath = nodePath.resolve(path);
  const source = await readFile(absolutePath);
  return {
    path: absolutePath,
    sha256: sha256(source),
    report: JSON.parse(source),
  };
}

export function requireCompletedMdxCrossover(screenRecord, crossoverRecords, manifest) {
  const plan = planScaleFollowup({
    screenRecord,
    followupRecords: crossoverRecords,
    manifest,
  });
  if (
    plan.status !== 'complete' ||
    plan.decision?.mechanical?.status !== 'exact' ||
    plan.decision?.resource?.status !== 'exact'
  ) {
    throw new Error('Rust-pool and quota policy require an exact completed MDX crossover chain');
  }
  const selected = plan.decision.resource;
  const points = [...new Set([
    selected.previousScale,
    selected.scale,
    selected.confirmingNextScale,
    9_157,
  ])];
  const evidenceByScale = plan.decision.policyEvidenceByScale;
  for (const scale of points) {
    if (!evidenceByScale[String(scale)]) {
      throw new Error(`Completed crossover lacks repeated policy evidence at scale ${scale}`);
    }
  }
  const executionTemplate = executionTemplateFromScreen(screenRecord.report);
  const outputOraclesByScale = collectCrossoverOutputOracles(crossoverRecords, points);
  return {
    schema: 1,
    criterion: 'resource-acceptable',
    baseScreen: { path: screenRecord.path, sha256: screenRecord.sha256 },
    followups: crossoverRecords.map(({ path, sha256 }) => ({ path, sha256 })),
    decisionSha256: sha256(JSON.stringify(plan.decision)),
    mechanical: plan.decision.mechanical,
    resource: plan.decision.resource,
    points,
    quotaPoints: [...new Set([selected.scale, 9_157])],
    policyEvidenceByScale: evidenceByScale,
    executionTemplate,
    outputOraclesByScale,
  };
}

export async function loadAndRequireCrossoverReference(reference) {
  const manifest = await loadScaleManifest();
  const screenRecord = await readAndMatch(reference.baseScreen);
  const crossoverRecords = await Promise.all(reference.followups.map(readAndMatch));
  const actual = requireCompletedMdxCrossover(screenRecord, crossoverRecords, manifest);
  if (!same(actual, reference)) {
    throw new Error('Policy matrix crossover reference differs from its exact artifact chain');
  }
  return { manifest, screenRecord, crossoverRecords, crossover: actual };
}

export async function requirePassedCpulimitCalibration(record) {
  const current = await captureCpulimitProvenance();
  const value = record.report;
  if (
    value?.schemaVersion !== 2 ||
    value.kind !== 'cpulimit-apple-calibration' ||
    value.executionScope !== 'local-only' ||
    value.node !== 'v24.18.0' ||
    !same(Object.keys(value.parentCiMarkers ?? {}).sort(), CALIBRATION_CI_MARKERS) ||
    Object.values(value.parentCiMarkers ?? {}).some(isActiveCiValue) ||
    !same(value.machine, {
      platform: 'darwin',
      architecture: 'arm64',
      cpuModel: 'Apple M3 Pro',
      logicalCpuCount: 12,
      totalMemoryBytes: 38_654_705_664,
    }) ||
    value.formalProfile !== true ||
    value.passed !== true ||
    value.executionEnvironmentEligible !== true ||
    !same(value.controllerProvenance, current) ||
    value.binarySha256 !== current.binary.sha256 ||
    value.patchSha256 !== current.patch.sha256 ||
    !same(value.options, {
      durationMs: 10_000,
      threadCount: 8,
      repetitions: 3,
      equivalenceBlocks: 5,
      levels: [200, 400, 600, 800],
    })
  ) {
    throw new Error(
      `CPU-rate calibration is not the exact formally passed frozen profile: ${JSON.stringify({
        schemaVersion: value?.schemaVersion,
        kind: value?.kind,
        executionScope: value?.executionScope,
        node: value?.node,
        parentCiMarkerNames: Object.keys(value?.parentCiMarkers ?? {}).sort(),
        activeCi: Object.entries(value?.parentCiMarkers ?? {}).filter(([, entry]) => isActiveCiValue(entry)),
        machine: value?.machine,
        formalProfile: value?.formalProfile,
        passed: value?.passed,
        provenanceMatches: same(value?.controllerProvenance, current),
        binaryMatches: value?.binarySha256 === current.binary.sha256,
        patchMatches: value?.patchSha256 === current.patch.sha256,
        options: value?.options,
      })}`,
    );
  }
  if (
    !Array.isArray(value.samples) ||
    value.samples.length !== 12 ||
    !Array.isArray(value.equivalence) ||
    value.equivalence.length !== 5
  ) {
    throw new Error('CPU-rate calibration raw sample cardinality is incomplete');
  }
  const expectedSampleOrder = [
    [0, 200], [0, 400], [0, 600], [0, 800],
    [1, 800], [1, 600], [1, 400], [1, 200],
    [2, 200], [2, 400], [2, 600], [2, 800],
  ];
  const unconstrainedSaturationCpuPercent = median(
    value.equivalence.map(({ controlled }) => {
      validateCalibrationLoad(controlled?.load);
      return controlled.load.averageCpuPercent;
    }),
  );
  if (
    !nearlyEqual(value.unconstrainedSaturationCpuPercent, unconstrainedSaturationCpuPercent)
  ) {
    throw new Error('CPU-rate saturation ceiling is not derived from raw 1,200% no-stop pairs');
  }
  for (const [index, sample] of value.samples.entries()) {
    const [repetition, limitPercent] = expectedSampleOrder[index];
    if (
      !same(Object.keys(sample).sort(), ['controller', 'limitPercent', 'load', 'mode', 'repetition']) ||
      sample.mode !== 'controlled' ||
      sample.repetition !== repetition ||
      sample.limitPercent !== limitPercent
    ) {
      throw new Error(`CPU-rate calibration sample ${index} changed the frozen execution order`);
    }
    validateCalibrationLoad(sample.load);
    validateControllerRecord(
      sample.controller,
      limitPercent,
      undefined,
      limitPercent < unconstrainedSaturationCpuPercent * 0.95,
      sample.load.wallMs,
    );
  }
  const recomputedLevelSummary = [200, 400, 600, 800].map((limitPercent) => {
    const selected = value.samples.filter((sample) => sample.limitPercent === limitPercent);
    const achieved = selected.map(({ load }) => load.averageCpuPercent);
    const ratios = achieved.map((entry) => entry / limitPercent);
    return {
      limitPercent,
      sampleCount: selected.length,
      achievedCpuPercent: achieved,
      achievedToTargetRatio: ratios,
      medianAchievedToTargetRatio: median(ratios),
      withinFivePercent: ratios.every((ratio) => ratio >= 0.95 && ratio <= 1.05),
      controllerStopCycles: selected.map(({ controller }) => controller.stopCycles),
      controllerStoppedMs: selected.map(({ controller }) => controller.stoppedUs / 1_000),
    };
  });
  if (
    !same(value.levelSummary, recomputedLevelSummary) ||
    recomputedLevelSummary.some(({ withinFivePercent }) => !withinFivePercent)
  ) {
    throw new Error('CPU-rate calibration level summary is not derived from admitted raw samples');
  }
  for (const [block, pair] of value.equivalence.entries()) {
    const order = block % 2 === 0 ? ['direct', 'controlled'] : ['controlled', 'direct'];
    if (
      !same(Object.keys(pair).sort(), ['block', 'controlled', 'cpuRatio', 'direct', 'order', 'wallRatio']) ||
      pair.block !== block ||
      !same(pair.order, order) ||
      !same(Object.keys(pair.direct ?? {}).sort(), ['block', 'load', 'mode']) ||
      pair.direct.mode !== 'direct' ||
      pair.direct.block !== block ||
      !same(Object.keys(pair.controlled ?? {}).sort(), ['block', 'controller', 'limitPercent', 'load', 'mode']) ||
      pair.controlled.mode !== 'controlled' ||
      pair.controlled.block !== block ||
      pair.controlled.limitPercent !== 1_200
    ) {
      throw new Error(`CPU-rate equivalence block ${block} changed the frozen alternating profile`);
    }
    validateCalibrationLoad(pair.direct.load);
    validateCalibrationLoad(pair.controlled.load);
    validateControllerRecord(
      pair.controlled.controller,
      1_200,
      undefined,
      false,
      pair.controlled.load.wallMs,
    );
    const wallRatio = pair.controlled.load.wallMs / pair.direct.load.wallMs;
    const cpuRatio = pair.controlled.load.cpuMs / pair.direct.load.cpuMs;
    if (
      !nearlyEqual(pair.wallRatio, wallRatio) ||
      !nearlyEqual(pair.cpuRatio, cpuRatio) ||
      pair.controlled.controller.stopCycles !== 0 ||
      pair.controlled.controller.stoppedUs !== 0
    ) {
      throw new Error(`CPU-rate equivalence block ${block} is not derived from its raw pair`);
    }
  }
  const wallRatios = value.equivalence.map(({ controlled, direct }) => controlled.load.wallMs / direct.load.wallMs);
  const cpuRatios = value.equivalence.map(({ controlled, direct }) => controlled.load.cpuMs / direct.load.cpuMs);
  const recomputedEquivalenceSummary = {
    blocks: value.equivalence.length,
    medianWallRatio: median(wallRatios),
    medianCpuRatio: median(cpuRatios),
    wallWithinTwoPercent: Math.abs(median(wallRatios) - 1) <= 0.02,
    cpuWithinTwoPercent: Math.abs(median(cpuRatios) - 1) <= 0.02,
    noControllerStops: value.equivalence.every(({ controlled }) => controlled.controller.stopCycles === 0),
  };
  if (
    value.controllerRecordsValid !== true ||
    !same(value.equivalenceSummary, recomputedEquivalenceSummary) ||
    !recomputedEquivalenceSummary.wallWithinTwoPercent ||
    !recomputedEquivalenceSummary.cpuWithinTwoPercent ||
    !recomputedEquivalenceSummary.noControllerStops
  ) {
    throw new Error('CPU-rate equivalence summary is not derived from admitted raw pairs');
  }
  return { ...record, controllerProvenance: current };
}

export function validatePolicyMatrix(matrix, manifest) {
  const stage = matrix?.policy?.stage;
  if (
    matrix?.executionScope !== 'local-only' ||
    matrix.evidenceKind !== stage ||
    !POLICY_STAGES.includes(stage) ||
    typeof matrix.correctnessGate !== 'string' ||
    matrix.correctnessGate.length === 0 ||
    !same(normalizeRuntimeProfile(matrix.runtimeProfile), LIFECYCLE_FIXED_RUNTIME_PROFILE) ||
    matrix.policy.schema !== 1 ||
    !/^[a-f0-9]{64}$/.test(matrix.policy.crossover.decisionSha256 ?? '') ||
    !Array.isArray(matrix.policy.consumedPolicyArtifactSha256) ||
    !Array.isArray(matrix.policy.consumedPolicyArtifacts) ||
    !same(
      matrix.policy.consumedPolicyArtifacts.map(({ sha256 }) => sha256),
      matrix.policy.consumedPolicyArtifactSha256,
    ) ||
    !Array.isArray(matrix.cases) ||
    matrix.cases.length === 0
  ) {
    throw new Error('MDX policy matrix classification, runtime, gate, or chain is incomplete');
  }
  const frozenTemplate = requireCrossoverExecutionTemplate(matrix.policy.crossover);
  if (
    matrix.correctnessGate !== frozenTemplate.correctnessGate ||
    !same(matrix.hostPolicy, frozenTemplate.hostPolicy)
  ) {
    throw new Error('MDX policy matrix changed the execution template frozen by the crossover chain');
  }
  validateFrozenPerformanceHostPolicy(matrix.hostPolicy);
  if (stage.startsWith('quota-')) {
    if (
      typeof matrix.policy.calibration?.path !== 'string' ||
      !/^[a-f0-9]{64}$/.test(matrix.policy.calibration?.sha256 ?? '') ||
      !matrix.policy.calibration?.controllerProvenance ||
      !positive(matrix.policy.calibration?.unconstrainedSaturationCpuPercent)
    ) {
      throw new Error('Quota matrix lacks an exact passed calibration reference');
    }
  } else if (matrix.policy.calibration !== null) {
    throw new Error('Allocation matrix must not carry quota calibration provenance');
  }
  const expectedScales = stage.startsWith('quota-')
    ? matrix.policy.crossover.quotaPoints
    : matrix.policy.crossover.points;
  const seenKeys = new Set();
  for (const definition of matrix.cases) {
    validatePolicyCase(definition, stage, expectedScales, manifest);
    if (
      definition.projectRoot !== frozenTemplate.projectRoot ||
      definition.rolldownPackageRoot !== frozenTemplate.rolldownPackageRoot
    ) {
      throw new Error(`${definition.name} changed the project or Rolldown runtime root`);
    }
    const key = policyCaseKey(definition);
    if (seenKeys.has(key)) throw new Error(`Policy matrix duplicates ${key}`);
    seenKeys.add(key);
  }
  validateStageGrid(matrix, stage, expectedScales);
  return matrix;
}

export function validatePolicyReport(report, manifest) {
  const stage = report?.matrix?.policy?.stage;
  validatePolicyMatrix(report.matrix, manifest);
  if (
    report.schema !== 1 ||
    report.evidenceKind !== stage ||
    report.measurementFieldsPresent !== true ||
    report.timingEligible !== true ||
    report.conclusionEligible !== false ||
    report.executionScope !== 'local-only' ||
    report.environment?.correctnessGate?.status !== 'passed' ||
    report.environment?.correctnessGate?.path !== report.matrix.correctnessGate ||
    !/^[a-f0-9]{64}$/.test(report.environment?.correctnessGate?.sha256 ?? '') ||
    !same(normalizeRuntimeProfile(report.environment?.runtimeProfile), LIFECYCLE_FIXED_RUNTIME_PROFILE) ||
    (report.hostPolicyViolations ?? []).length !== 0 ||
    (report.validationErrors ?? []).length !== 0 ||
    !Array.isArray(report.runs)
  ) {
    throw new Error(`${stage} report is incomplete or misclassified`);
  }
  if (
    !same(Object.keys(report.environment?.parentCiMarkers ?? {}).sort(), CALIBRATION_CI_MARKERS) ||
    !same([...(report.environment?.childCiMarkersCleared ?? [])].sort(), CALIBRATION_CI_MARKERS) ||
    (stage.startsWith('quota-')
      ? !same(
          report.environment?.controllerProvenance,
          report.matrix.policy.calibration.controllerProvenance,
        )
      : report.environment?.controllerProvenance !== null)
  ) {
    throw new Error(`${stage} changed CI isolation or controller provenance`);
  }
  if (
    !validSourceRecord(report.runner, 'run-policy-matrix.mjs') ||
    !validSourceRecord(report.caseRunner, 'run-case.mjs') ||
    !validSourceRecord(report.launcher, 'policy-node-launcher.mjs') ||
    report.nodeBinary !== report.environment?.externalMeasurement?.timedExecutable ||
    !same(report.environment?.externalMeasurement, {
      command: '/usr/bin/time',
      arguments: ['-l'],
      timedExecutable: report.nodeBinary,
      allocationTimedScript: report.caseRunner.path,
      quotaTimedScript: report.launcher.path,
      quotaControllerOutsideTimedProcess: true,
    })
  ) {
    throw new Error(`${stage} lacks exact runner, launcher, or direct Node timing provenance`);
  }
  if (Object.values(report.environment?.parentCiMarkers ?? {}).some(isActiveCiValue)) {
    throw new Error(`${stage} recorded an active CI marker`);
  }
  if ((report.hostAdmissionAttempts ?? []).length < report.runs.length) {
    throw new Error(`${stage} lacks per-child host admission`);
  }
  if (!same(report.runs.map(({ sequence }) => sequence), report.runs.map((_run, index) => index))) {
    throw new Error(`${stage} has missing or reordered global run sequence`);
  }
  const expectedRunCount = report.matrix.cases.reduce(
    (sum, definition) => sum + definition.variants.length * definition.repeats,
    0,
  );
  if (report.runs.length !== expectedRunCount) throw new Error(`${stage} has undeclared or missing runs`);
  for (const definition of report.matrix.cases) validatePolicyCaseRuns(report, definition, stage);
  for (const scale of new Set(report.runs.map(({ transformedEntryCount }) => transformedEntryCount))) {
    const selected = report.runs.filter(({ transformedEntryCount }) => transformedEntryCount === scale);
    for (const field of [
      'outputChunks',
      'normalizedOutputBytes',
      'normalizedOutputHash',
      'outputNormalization',
    ]) {
      if (new Set(selected.map((run) => JSON.stringify(run[field]))).size !== 1) {
        throw new Error(`${stage} changes ${field} across pool/quota settings at scale ${scale}`);
      }
    }
  }
  return report;
}

export function summarizePolicyReport(report, manifest) {
  validatePolicyReport(report, manifest);
  const cases = report.matrix.cases.map((definition) => {
    const repeated = definition.repeats === 10;
    const evidence = repeated
      ? summarizeRepeatedPolicyCase(report, definition)
      : summarizePolicyScreenCase(report, definition);
    return {
      key: policyCaseKey(definition),
      scale: definition.selectionScale,
      poolEnvironment: definition.poolEnvironment,
      quotaPercent: definition.quotaPercent ?? null,
      repeated,
      policyEvidence: evidence.policyEvidence,
      selection: repeated
        ? {
            mechanicalWorkerCount: evidence.mechanical.worker.workerCount,
            resourceOracleWorkerCount: evidence.policyEvidence.selectedOracleWorkerCount,
          }
        : evidence.selection,
    };
  });
  return {
    schema: 1,
    evidenceKind: report.evidenceKind,
    timingEligible: true,
    conclusionEligible: false,
    sourcePolicy: report.matrix.policy,
    policyEvidenceByCase: Object.fromEntries(cases.map((entry) => [entry.key, entry.policyEvidence])),
    cases,
  };
}

export function planAllocationPolicy({ crossover, policyRecords, template, manifest }) {
  template = requireMatchingExecutionTemplate(crossover, template);
  validatePolicyChain(policyRecords, crossover, manifest, 'allocation');
  validateGeneratedAllocationChain(crossover, policyRecords, template, manifest);
  if (policyRecords.length === 0) {
    return policyMatrixPlan(
      buildTokioScreenMatrix(crossover, [], template, manifest),
      'allocation-tokio-screen',
    );
  }
  if (policyRecords.length === 1) {
    const screenSummary = summarizePolicyReport(policyRecords[0].report, manifest);
    return policyMatrixPlan(
      buildTokioConfirmationMatrix(
        crossover,
        policyRecords,
        template,
        manifest,
        screenSummary,
      ),
      'allocation-tokio-confirmation',
    );
  }
  if (policyRecords.length === 2) {
    const repeatedSummary = summarizePolicyReport(policyRecords[1].report, manifest);
    return policyMatrixPlan(
      buildRayonScreenMatrix(crossover, policyRecords, template, manifest, repeatedSummary),
      'allocation-rayon-screen',
    );
  }
  if (policyRecords.length === 3) {
    const screenSummary = summarizePolicyReport(policyRecords[2].report, manifest);
    return policyMatrixPlan(
      buildRayonConfirmationMatrix(
        crossover,
        policyRecords,
        template,
        manifest,
        screenSummary,
      ),
      'allocation-rayon-confirmation',
    );
  }
  if (policyRecords.length === 4) {
    const tokioConfirmation = summarizePolicyReport(policyRecords[1].report, manifest);
    const rayonConfirmation = summarizePolicyReport(policyRecords[3].report, manifest);
    return {
      schema: 1,
      status: 'complete',
      stage: 'allocation-complete',
      crossover,
      consumedPolicyArtifactSha256: policyRecords.map(({ sha256 }) => sha256),
      consumedPolicyArtifacts: policyRecords.map(({ path, sha256 }) => ({ path, sha256 })),
      tokioConfirmation,
      rayonConfirmation,
      repeatedWinnerByScale: {
        tokio: repeatedPoolWinnersByScale(
          tokioConfirmation,
          crossover.points,
          'ROLLDOWN_WORKER_THREADS',
        ),
        rayon: repeatedPoolWinnersByScale(
          rayonConfirmation,
          crossover.points,
          'RAYON_NUM_THREADS',
        ),
      },
    };
  }
  throw new Error('Allocation policy chain continued after its repeated Rayon winner');
}

export function planQuotaPolicy({
  crossover,
  policyRecords,
  template,
  manifest,
  calibration,
}) {
  template = requireMatchingExecutionTemplate(crossover, template);
  validatePolicyChain(policyRecords, crossover, manifest, 'quota', calibration);
  validateGeneratedQuotaChain(crossover, policyRecords, template, manifest, calibration);
  if (policyRecords.length === 0) {
    return policyMatrixPlan(
      buildQuotaScreenMatrix(crossover, [], template, manifest, calibration),
      'quota-screen',
    );
  }
  if (policyRecords.length === 1) {
    const screenSummary = summarizePolicyReport(policyRecords[0].report, manifest);
    return policyMatrixPlan(
      buildQuotaConfirmationMatrix(
        crossover,
        policyRecords,
        template,
        manifest,
        calibration,
        screenSummary,
      ),
      'quota-confirmation',
    );
  }
  if (policyRecords.length === 2) {
    return {
      schema: 1,
      status: 'complete',
      stage: 'quota-complete',
      crossover,
      calibration: calibrationReference(calibration),
      consumedPolicyArtifactSha256: policyRecords.map(({ sha256 }) => sha256),
      consumedPolicyArtifacts: policyRecords.map(({ path, sha256 }) => ({ path, sha256 })),
      confirmation: summarizePolicyReport(policyRecords[1].report, manifest),
    };
  }
  throw new Error('Quota policy chain continued after confirmation');
}

function validatePolicyChain(records, crossover, manifest, family, calibration) {
  const expectedStages =
    family === 'allocation'
      ? [
          'allocation-tokio-screen',
          'allocation-tokio-confirmation',
          'allocation-rayon-screen',
          'allocation-rayon-confirmation',
        ]
      : ['quota-screen', 'quota-confirmation'];
  for (const [index, record] of records.entries()) {
    validatePolicyReport(record.report, manifest);
    if (
      record.report.matrix.policy.stage !== expectedStages[index] ||
      !same(record.report.matrix.policy.crossover, crossover) ||
      !same(
        record.report.matrix.policy.consumedPolicyArtifactSha256,
        records.slice(0, index).map(({ sha256 }) => sha256),
      ) ||
      !same(
        record.report.matrix.policy.consumedPolicyArtifacts,
        records.slice(0, index).map(({ path, sha256 }) => ({ path, sha256 })),
      )
    ) {
      throw new Error(`${family} policy artifact ${index} breaks the exact generated chain`);
    }
    if (
      family === 'quota' &&
      !same(record.report.matrix.policy.calibration, calibrationReference(calibration))
    ) {
      throw new Error('Quota policy artifact changed its formal calibration reference');
    }
  }
}

function validateGeneratedAllocationChain(crossover, records, template, manifest) {
  if (records.length > 0) {
    const expected = buildTokioScreenMatrix(crossover, [], template, manifest);
    if (!same(records[0].report.matrix, expected)) {
      throw new Error('Tokio screen report was not produced by the deterministic generator');
    }
  }
  if (records.length > 1) {
    const expected = buildTokioConfirmationMatrix(
      crossover,
      records.slice(0, 1),
      template,
      manifest,
      summarizePolicyReport(records[0].report, manifest),
    );
    if (!same(records[1].report.matrix, expected)) {
      throw new Error('Tokio confirmation report changed deterministic selection');
    }
  }
  if (records.length > 2) {
    const expected = buildRayonScreenMatrix(
      crossover,
      records.slice(0, 2),
      template,
      manifest,
      summarizePolicyReport(records[1].report, manifest),
    );
    if (!same(records[2].report.matrix, expected)) {
      throw new Error('Rayon screen report changed repeated Tokio finalists');
    }
  }
  if (records.length > 3) {
    const expected = buildRayonConfirmationMatrix(
      crossover,
      records.slice(0, 3),
      template,
      manifest,
      summarizePolicyReport(records[2].report, manifest),
    );
    if (!same(records[3].report.matrix, expected)) {
      throw new Error('Rayon confirmation report changed deterministic selection');
    }
  }
}

function validateGeneratedQuotaChain(crossover, records, template, manifest, calibration) {
  if (records.length > 0) {
    const expected = buildQuotaScreenMatrix(crossover, [], template, manifest, calibration);
    if (!same(records[0].report.matrix, expected)) {
      throw new Error('Quota screen report was not produced by the deterministic generator');
    }
  }
  if (records.length > 1) {
    const expected = buildQuotaConfirmationMatrix(
      crossover,
      records.slice(0, 1),
      template,
      manifest,
      calibration,
      summarizePolicyReport(records[0].report, manifest),
    );
    if (!same(records[1].report.matrix, expected)) {
      throw new Error('Quota confirmation report changed deterministic selection or oracle');
    }
  }
}

function buildTokioScreenMatrix(crossover, records, template, manifest) {
  const cases = [];
  for (const scale of crossover.points) {
    for (const tokio of TOKIO_COUNTS) {
      cases.push(
        makeCase(template, manifest, {
          name: `mdx-${scale}-tokio-${tokio}-screen`,
          scale,
          poolEnvironment: pool(tokio, 12),
          variants: POLICY_SCREEN_VARIANTS,
          repeats: 1,
          startIndex: cases.length,
        }),
      );
    }
  }
  return makePolicyMatrix('allocation-tokio-screen', crossover, records, template, cases);
}

function buildTokioConfirmationMatrix(crossover, records, template, manifest, screenSummary) {
  const cases = [];
  for (const scale of crossover.points) {
    const selections = selectScreenPairs(
      screenSummary.cases.filter((entry) => entry.scale === scale),
      'ROLLDOWN_WORKER_THREADS',
    );
    for (const [candidateIndex, selection] of selections.entries()) {
      cases.push(
        makeCase(template, manifest, {
          name: `mdx-${scale}-tokio-${selection.poolCount}-confirmation-${candidateIndex + 1}`,
          scale,
          poolEnvironment: pool(selection.poolCount, 12),
          variants: confirmationVariants(selection.workerCount),
          repeats: 10,
          startIndex: cases.length,
          selection: { ...selection, confirmationCandidate: candidateIndex + 1 },
        }),
      );
    }
  }
  return makePolicyMatrix(
    'allocation-tokio-confirmation',
    crossover,
    records,
    template,
    cases,
  );
}

function buildRayonScreenMatrix(crossover, records, template, manifest, repeatedSummary) {
  const cases = [];
  for (const scale of crossover.points) {
    const finalist = selectRepeatedPoolWinner(
      repeatedSummary.cases.filter((entry) => entry.scale === scale),
      'ROLLDOWN_WORKER_THREADS',
    ).entry;
    const tokio = Number(finalist.poolEnvironment.ROLLDOWN_WORKER_THREADS);
    const workers = Object.keys(finalist.policyEvidence.variants).filter((variant) => variant !== 'ordinary');
    for (const rayon of RAYON_COUNTS) {
      cases.push(
        makeCase(template, manifest, {
          name: `mdx-${scale}-tokio-${tokio}-rayon-${rayon}-screen`,
          scale,
          poolEnvironment: pool(tokio, rayon),
          variants: ['ordinary', ...workers],
          repeats: 1,
          startIndex: cases.length,
        }),
      );
    }
  }
  return makePolicyMatrix('allocation-rayon-screen', crossover, records, template, cases);
}

function buildRayonConfirmationMatrix(crossover, records, template, manifest, screenSummary) {
  const cases = [];
  for (const scale of crossover.points) {
    const selections = selectScreenPairs(
      screenSummary.cases.filter((entry) => entry.scale === scale),
      'RAYON_NUM_THREADS',
    );
    for (const [candidateIndex, selection] of selections.entries()) {
      const sourceCase = screenSummary.cases.find((entry) => entry.key === selection.caseKey);
      const tokio = Number(sourceCase.poolEnvironment.ROLLDOWN_WORKER_THREADS);
      cases.push(
        makeCase(template, manifest, {
          name: `mdx-${scale}-tokio-${tokio}-rayon-${selection.poolCount}-confirmation-${candidateIndex + 1}`,
          scale,
          poolEnvironment: pool(tokio, selection.poolCount),
          variants: confirmationVariants(selection.workerCount),
          repeats: 10,
          startIndex: cases.length,
          selection: { ...selection, confirmationCandidate: candidateIndex + 1 },
        }),
      );
    }
  }
  return makePolicyMatrix(
    'allocation-rayon-confirmation',
    crossover,
    records,
    template,
    cases,
  );
}

function buildQuotaScreenMatrix(crossover, records, template, manifest, calibration) {
  const cases = [];
  for (const scale of crossover.quotaPoints) {
    for (const quotaPercent of QUOTA_PERCENTAGES) {
      cases.push(
        makeCase(template, manifest, {
          name: `mdx-${scale}-quota-${quotaPercent}-screen`,
          scale,
          poolEnvironment: BASELINE_POOL_ENVIRONMENT,
          variants: POLICY_SCREEN_VARIANTS,
          repeats: 1,
          startIndex: cases.length,
          quotaPercent,
        }),
      );
    }
  }
  return makePolicyMatrix('quota-screen', crossover, records, template, cases, calibration);
}

function buildQuotaConfirmationMatrix(
  crossover,
  records,
  template,
  manifest,
  calibration,
  screenSummary,
) {
  const cases = [];
  for (const scale of crossover.quotaPoints) {
    const crossoverOracle = crossover.policyEvidenceByScale[String(scale)].selectedOracleWorkerCount;
    for (const quotaPercent of QUOTA_PERCENTAGES) {
      const source = screenSummary.cases.find(
        (entry) => entry.scale === scale && entry.quotaPercent === quotaPercent,
      );
      const selection = selectScreenPair([source], 'ROLLDOWN_WORKER_THREADS');
      cases.push(
        makeCase(template, manifest, {
          name: `mdx-${scale}-quota-${quotaPercent}-confirmation`,
          scale,
          poolEnvironment: BASELINE_POOL_ENVIRONMENT,
          variants: confirmationVariants(selection.workerCount, crossoverOracle),
          repeats: 10,
          startIndex: cases.length,
          quotaPercent,
          selection: { ...selection, crossoverOracleWorkerCount: crossoverOracle },
        }),
      );
    }
  }
  return makePolicyMatrix('quota-confirmation', crossover, records, template, cases, calibration);
}

function makePolicyMatrix(stage, crossover, records, template, cases, calibration) {
  return {
    executionScope: 'local-only',
    evidenceKind: stage,
    executionEnabled: true,
    correctnessGate: template.correctnessGate,
    runtimeProfile: LIFECYCLE_FIXED_RUNTIME_PROFILE,
    hostPolicy: structuredClone(template.hostPolicy),
    policy: {
      schema: 1,
      stage,
      crossover: structuredClone(crossover),
      consumedPolicyArtifactSha256: records.map(({ sha256 }) => sha256),
      consumedPolicyArtifacts: records.map(({ path, sha256 }) => ({ path, sha256 })),
      calibration: calibration ? calibrationReference(calibration) : null,
    },
    cases,
  };
}

function makeCase(template, manifest, options) {
  return {
    name: options.name,
    projectRoot: template.projectRoot,
    rolldownPackageRoot: template.rolldownPackageRoot,
    corpus: 'cloudflare-mdx-scale-v1',
    buildProfile: 'default',
    selectionScale: options.scale,
    selectionPrefixSha256: prefixHash(manifest, options.scale),
    instrumentation: false,
    rustInstrumentation: false,
    measurementMode: 'measurement',
    poolEnvironment: normalizePoolEnvironment(options.poolEnvironment),
    quotaPercent: options.quotaPercent,
    variants: options.variants,
    warmups: 0,
    repeats: options.repeats,
    startIndex: options.startIndex,
    selection: options.selection,
  };
}

function selectScreenPairs(cases, poolKey) {
  const candidates = cases.flatMap((entry) => {
    const ordinary = entry.policyEvidence.variants.ordinary;
    return Object.entries(entry.policyEvidence.variants).flatMap(([variant, evidence]) => {
      if (variant === 'ordinary') return [];
      const workerCount = Number(variant.slice('worker-'.length));
      const speedup = ordinary.wallMedianMs / evidence.wallMedianMs;
      const cpuRatio = evidence.cpuMedianMs / ordinary.cpuMedianMs;
      const rssRatio = evidence.peakRssMedianBytes / ordinary.peakRssMedianBytes;
      return [{
        caseKey: entry.key,
        poolCount: Number(entry.poolEnvironment[poolKey]),
        workerCount,
        wallMs: evidence.wallMedianMs,
        screenResourceEligible: evidence.resourceEligible,
        recomputedResourceEligible:
          speedup >= 1.1 &&
          cpuRatio <= 2 &&
          rssRatio <= 2 &&
          evidence.peakRssMedianBytes < MAX_RSS_BYTES,
      }];
    });
  });
  if (candidates.some((candidate) => candidate.screenResourceEligible !== candidate.recomputedResourceEligible)) {
    throw new Error('Screen policyEvidence resource eligibility differs from its raw one-shot ratios');
  }
  const eligible = candidates.filter(({ screenResourceEligible }) => screenResourceEligible);
  const primary = chooseScreenCandidate(eligible.length > 0 ? eligible : candidates);
  const otherPoolCandidates = candidates.filter(({ poolCount }) => poolCount !== primary.poolCount);
  const otherEligible = otherPoolCandidates.filter(({ screenResourceEligible }) => screenResourceEligible);
  if (otherPoolCandidates.length === 0) {
    throw new Error(`Rust-pool screen ${poolKey} did not expose a second pool candidate`);
  }
  const secondary = chooseScreenCandidate(otherEligible.length > 0 ? otherEligible : otherPoolCandidates);
  return [
    {
      ...primary,
      selectionKind: eligible.length > 0 ? 'screen-resource-eligible' : 'screen-fastest-fallback',
      rustPoolCandidateKind: 'screen-selected',
      screenConclusionEligible: false,
    },
    {
      ...secondary,
      selectionKind:
        otherEligible.length > 0 ? 'screen-resource-eligible-runner-up' : 'screen-runner-up-fallback',
      rustPoolCandidateKind: 'different-pool-runner-up',
      screenConclusionEligible: false,
    },
  ];
}

function selectScreenPair(cases, poolKey) {
  if (new Set(cases.map((entry) => Number(entry.poolEnvironment[poolKey]))).size === 1) {
    const candidates = cases.flatMap((entry) =>
      Object.entries(entry.policyEvidence.variants).flatMap(([variant, evidence]) =>
        variant === 'ordinary'
          ? []
          : [{
              caseKey: entry.key,
              poolCount: Number(entry.poolEnvironment[poolKey]),
              workerCount: Number(variant.slice('worker-'.length)),
              wallMs: evidence.wallMedianMs,
              screenResourceEligible: evidence.resourceEligible,
            }],
      ),
    );
    const eligible = candidates.filter(({ screenResourceEligible }) => screenResourceEligible);
    const selected = chooseScreenCandidate(eligible.length > 0 ? eligible : candidates);
    return {
      ...selected,
      selectionKind: eligible.length > 0 ? 'screen-resource-eligible' : 'screen-fastest-fallback',
      screenConclusionEligible: false,
    };
  }
  return selectScreenPairs(cases, poolKey)[0];
}

function chooseScreenCandidate(candidates) {
  const ordered = [...candidates].sort(
    (left, right) =>
      left.wallMs - right.wallMs ||
      left.workerCount - right.workerCount ||
      left.poolCount - right.poolCount,
  );
  if (ordered.length === 0) throw new Error('Screen contains no JavaScript worker candidate');
  const fastest = ordered[0];
  const withinTwoPercent = ordered.filter(
    ({ wallMs }) => (wallMs - fastest.wallMs) / fastest.wallMs < 0.02,
  );
  return [...withinTwoPercent].sort(
    (left, right) => left.workerCount - right.workerCount || left.poolCount - right.poolCount,
  )[0];
}

function selectRepeatedPoolWinner(cases, poolKey) {
  const candidates = cases.map((entry) => {
    const workerCount = entry.policyEvidence.selectedOracleWorkerCount;
    const variant = workerCount === 0 ? 'ordinary' : `worker-${workerCount}`;
    const evidence = entry.policyEvidence.variants[variant];
    if (!evidence) throw new Error(`${entry.key} lacks repeated evidence for its selected oracle`);
    return {
      entry,
      poolCount: Number(entry.poolEnvironment[poolKey]),
      workerCount,
      wallMs: evidence.wallMedianMs,
      resourceEligible: evidence.resourceEligible,
    };
  });
  const eligible = candidates.filter(({ resourceEligible }) => resourceEligible);
  const selected = chooseScreenCandidate(
    (eligible.length > 0 ? eligible : candidates).map((candidate) => ({
      ...candidate,
      screenResourceEligible: candidate.resourceEligible,
    })),
  );
  return selected;
}

function repeatedPoolWinnersByScale(summary, scales, poolKey) {
  return Object.fromEntries(
    scales.map((scale) => {
      const selected = selectRepeatedPoolWinner(
        summary.cases.filter((entry) => entry.scale === scale),
        poolKey,
      );
      return [
        String(scale),
        {
          caseKey: selected.entry.key,
          poolCount: selected.poolCount,
          workerCount: selected.workerCount,
          wallMedianMs: selected.wallMs,
          resourceEligible: selected.resourceEligible,
        },
      ];
    }),
  );
}

function summarizePolicyScreenCase(report, definition) {
  const runs = report.runs.filter(({ name }) => name === definition.name);
  const ordinary = runs.find(({ variant }) => variant === 'ordinary');
  const ordinaryWallMs = policyWallMs(ordinary);
  const ordinaryCpuMs = policyCpuMs(ordinary);
  const variants = Object.fromEntries(
    runs.map((run) => [
      run.variant,
      {
        wallMedianMs: policyWallMs(run),
        cpuMedianMs: policyCpuMs(run),
        peakRssMedianBytes: run.peakRssBytes,
        resourceEligible:
          run.variant === 'ordinary' ||
          (ordinaryWallMs / policyWallMs(run) >= 1.1 &&
            policyCpuMs(run) / ordinaryCpuMs <= 2 &&
            run.peakRssBytes / ordinary.peakRssBytes <= 2 &&
            run.peakRssBytes < MAX_RSS_BYTES),
        pairedWallRatioBootstrap95Upper: run.variant === 'ordinary' ? 1 : null,
        selectedOracleWorkerCount: null,
      },
    ]),
  );
  const workerRuns = runs.filter(({ variant }) => variant !== 'ordinary');
  const eligibleWorkers = workerRuns.filter(
    (run) => variants[run.variant].resourceEligible,
  );
  const selectionPopulation = eligibleWorkers.length > 0 ? eligibleWorkers : workerRuns;
  const fastest = [...selectionPopulation].sort(
    (left, right) =>
      policyWallMs(left) - policyWallMs(right) ||
      Number(left.variant.slice('worker-'.length)) - Number(right.variant.slice('worker-'.length)),
  )[0];
  const withinTwoPercent = selectionPopulation.filter(
    (run) => (policyWallMs(run) - policyWallMs(fastest)) / policyWallMs(fastest) < 0.02,
  );
  const selectedRun = [...withinTwoPercent].sort(
    (left, right) =>
      Number(left.variant.slice('worker-'.length)) - Number(right.variant.slice('worker-'.length)),
  )[0];
  const selectedOracleWorkerCount = Number(selectedRun.variant.slice('worker-'.length));
  for (const evidence of Object.values(variants)) evidence.selectedOracleWorkerCount = selectedOracleWorkerCount;
  return {
    policyEvidence: { schema: 1, selectedOracleWorkerCount, variants },
    selection: {
      workerCount: selectedOracleWorkerCount,
      selectionKind:
        eligibleWorkers.length > 0 ? 'screen-resource-eligible' : 'screen-fastest-fallback',
      screenConclusionEligible: false,
      ordinaryWallMs,
      workerWallMs: policyWallMs(selectedRun),
    },
  };
}

function validatePolicyCase(definition, stage, expectedScales, manifest) {
  if (
    typeof definition.name !== 'string' ||
    !expectedScales.includes(definition.selectionScale) ||
    definition.corpus !== 'cloudflare-mdx-scale-v1' ||
    definition.buildProfile !== 'default' ||
    definition.selectionPrefixSha256 !== prefixHash(manifest, definition.selectionScale) ||
    definition.instrumentation !== false ||
    definition.rustInstrumentation !== false ||
    definition.measurementMode !== 'measurement' ||
    definition.warmups !== 0 ||
    !Array.isArray(definition.variants) ||
    definition.variants[0] !== 'ordinary' ||
    !definition.variants.every(
      (variant) => variant === 'ordinary' || /^worker-[1-8]$/.test(variant),
    ) ||
    new Set(definition.variants).size !== definition.variants.length
  ) {
    throw new Error(`Invalid policy case: ${definition?.name}`);
  }
  normalizePoolEnvironment(definition.poolEnvironment);
  const confirmation = stage.endsWith('confirmation');
  if ((confirmation && definition.repeats !== 10) || (!confirmation && definition.repeats !== 1)) {
    throw new Error(`${definition.name} has the wrong screen/confirmation block count`);
  }
  if (confirmation && (!definition.variants.includes('worker-4') || !definition.variants.includes('worker-8'))) {
    throw new Error(`${definition.name} lacks fixed worker-4/worker-8 policy candidates`);
  }
  if (stage.startsWith('quota-')) {
    if (!QUOTA_PERCENTAGES.includes(definition.quotaPercent)) {
      throw new Error(`${definition.name} has an invalid aggregate CPU rate`);
    }
    if (!same(normalizePoolEnvironment(definition.poolEnvironment), normalizePoolEnvironment(BASELINE_POOL_ENVIRONMENT))) {
      throw new Error(`${definition.name} changed Rust pools in the quota axis`);
    }
  } else if (definition.quotaPercent !== undefined) {
    throw new Error(`${definition.name} mixed quota and allocation axes`);
  } else if (definition.poolEnvironment.ROLLDOWN_MAX_BLOCKING_THREADS !== '4') {
    throw new Error(`${definition.name} changed the frozen blocking pool`);
  }
}

function validateStageGrid(matrix, stage, scales) {
  const cases = matrix.cases;
  if (stage === 'allocation-tokio-screen') {
    requireGrid(cases, scales, TOKIO_COUNTS, 'ROLLDOWN_WORKER_THREADS', POLICY_SCREEN_VARIANTS);
    for (const definition of cases) requirePool(definition, undefined, 12);
  } else if (stage === 'allocation-tokio-confirmation') {
    requireTwoPoolsPerScale(cases, scales, 'ROLLDOWN_WORKER_THREADS');
    for (const definition of cases) requirePool(definition, undefined, 12);
  } else if (stage === 'allocation-rayon-screen') {
    requireGrid(cases, scales, RAYON_COUNTS, 'RAYON_NUM_THREADS');
  } else if (stage === 'allocation-rayon-confirmation') {
    requireTwoPoolsPerScale(cases, scales, 'RAYON_NUM_THREADS');
  } else if (stage === 'quota-screen' || stage === 'quota-confirmation') {
    requireGrid(cases, scales, QUOTA_PERCENTAGES, 'quotaPercent', stage === 'quota-screen' ? POLICY_SCREEN_VARIANTS : undefined);
  }
}

function requireGrid(cases, scales, counts, field, exactVariants) {
  if (cases.length !== scales.length * counts.length) throw new Error(`Policy grid ${field} is incomplete`);
  for (const scale of scales) {
    const selected = cases.filter(({ selectionScale }) => selectionScale === scale);
    const actual = selected.map((definition) =>
      field === 'quotaPercent' ? definition.quotaPercent : Number(definition.poolEnvironment[field]),
    );
    if (!same(actual, counts)) throw new Error(`Scale ${scale} changed ${field} grid order`);
    if (exactVariants && selected.some(({ variants }) => !same(variants, exactVariants))) {
      throw new Error(`Scale ${scale} changed the ordinary/worker screen grid`);
    }
  }
}

function requireTwoPoolsPerScale(cases, scales, field) {
  if (cases.length !== scales.length * 2) {
    throw new Error('Allocation confirmation must contain two Rust-pool candidates per scale');
  }
  for (const scale of scales) {
    const selected = cases.filter(({ selectionScale }) => selectionScale === scale);
    if (
      selected.length !== 2 ||
      new Set(selected.map((definition) => definition.poolEnvironment[field])).size !== 2
    ) {
      throw new Error(`Scale ${scale} lacks two distinct repeated ${field} candidates`);
    }
  }
}

function requirePool(definition, tokio, rayon) {
  if (
    (tokio !== undefined && Number(definition.poolEnvironment.ROLLDOWN_WORKER_THREADS) !== tokio) ||
    (rayon !== undefined && Number(definition.poolEnvironment.RAYON_NUM_THREADS) !== rayon) ||
    definition.poolEnvironment.ROLLDOWN_MAX_BLOCKING_THREADS !== '4'
  ) {
    throw new Error(`${definition.name} changed a held Rust pool`);
  }
}

function validatePolicyCaseRuns(report, definition, stage) {
  const runs = report.runs.filter(({ name }) => name === definition.name);
  const expectedOrder = [];
  for (let index = 0; index < definition.repeats; index++) {
    const blockIndex = definition.startIndex + index;
    const offset = blockIndex % definition.variants.length;
    const order = [
      ...definition.variants.slice(offset),
      ...definition.variants.slice(0, offset),
    ];
    expectedOrder.push(...order.map((variant) => ({ index: blockIndex, variant })));
  }
  if (!same(runs.map(({ index, variant }) => ({ index, variant })), expectedOrder)) {
    throw new Error(`${definition.name} has incomplete rotated blocks`);
  }
  for (const run of runs) {
    const start = evaluateStartAdmission(report.matrix.hostPolicy, run.hostBefore);
    const workerCount = run.variant === 'ordinary' ? 0 : Number(/^worker-(\d+)$/.exec(run.variant)?.[1]);
    const workerModel = workerCount === 0 ? 'ordinary' : 'rolldown';
    if (
      start.immediate.length > 0 ||
      start.transient.length > 0 ||
      evaluateChildHostPolicy(report.matrix.hostPolicy, run.hostBefore, run.hostAfter).length > 0 ||
      (run.hostPolicyViolations ?? []).length > 0 ||
      run.measurementMode !== 'measurement' ||
      run.evidenceKind !== stage ||
      run.instrumentation !== false ||
      run.rustInstrumentation !== false ||
      run.lifecycleClaim !== false ||
      run.corpus !== 'cloudflare-mdx-scale-v1' ||
      run.workerCount !== workerCount ||
      run.workerModel !== workerModel ||
      run.buildProfile !== 'default' ||
      run.effectiveRunLinkCheck !== false ||
      run.transformedEntryCount !== definition.selectionScale ||
      run.selection?.prefixSha256 !== definition.selectionPrefixSha256 ||
      !same(normalizePoolEnvironment(run.poolEnvironment), normalizePoolEnvironment(definition.poolEnvironment)) ||
      !same(normalizeRuntimeProfile(run.runtimeProfile), LIFECYCLE_FIXED_RUNTIME_PROFILE) ||
      run.projectCommit !== EXPECTED_PROJECT_COMMIT ||
      run.rolldownCommit !== LIFECYCLE_FIXED_RUNTIME_PROFILE.rolldownCommit ||
      run.bindingHash !== LIFECYCLE_FIXED_RUNTIME_PROFILE.bindingSha256 ||
      run.distHash !== LIFECYCLE_FIXED_RUNTIME_PROFILE.distSha256 ||
      run.sourceManifestHash !== EXPECTED_SOURCE_MANIFEST_SHA256 ||
      !positive(run.totalElapsedMs) ||
      !nonNegative(run.cpuUserMs) ||
      !nonNegative(run.cpuSystemMs) ||
      !positive(run.peakRssBytes) ||
      !positive(run.finalRssBytes) ||
      run.peakRssBytes < run.finalRssBytes ||
      !Number.isSafeInteger(run.processId) ||
      run.processId <= 1 ||
      !validExternalTiming(run.externalTiming) ||
      run.policyWallMs !== run.externalTiming.realMs ||
      run.externalTiming.realMs + run.externalTiming.resolutionMs < run.totalElapsedMs ||
      run.externalTiming.userMs + run.externalTiming.systemMs + 2 * run.externalTiming.resolutionMs <
        run.cpuUserMs + run.cpuSystemMs ||
      !runMatchesOutputOracle(
        run,
        report.matrix.policy.crossover.outputOraclesByScale[String(definition.selectionScale)],
      ) ||
      hasAttributionPayload(run)
    ) {
      throw new Error(`${definition.name}/${run.variant} failed policy run admission`);
    }
    if (stage.startsWith('quota-')) {
      validateControllerRecord(
        run.controller,
        definition.quotaPercent,
        run.processId,
        definition.quotaPercent <
          report.matrix.policy.calibration.unconstrainedSaturationCpuPercent * 0.95,
        run.policyWallMs,
      );
      const achievedCpuPercent =
        ((run.externalTiming.userMs + run.externalTiming.systemMs) / run.policyWallMs) * 100;
      if (achievedCpuPercent > definition.quotaPercent * 1.05) {
        throw new Error(`${definition.name}/${run.variant} exceeded its aggregate CPU-rate ceiling`);
      }
    } else if (run.controller !== undefined) {
      throw new Error('Allocation run unexpectedly contains a CPU-rate controller record');
    }
  }
  for (const field of [
    'transformedEntryCount',
    'selection',
    'outputChunks',
    'normalizedOutputBytes',
    'normalizedOutputHash',
    'outputNormalization',
  ]) {
    if (new Set(runs.map((run) => JSON.stringify(run[field]))).size !== 1) {
      throw new Error(`${definition.name} differs across variants for ${field}`);
    }
  }
}

export function validateControllerRecord(
  controller,
  limitPercent,
  processId,
  requireStops,
  elapsedMs,
) {
  if (
    !same(
      Object.keys(controller ?? {}).sort(),
      ['controlCycles', 'limitPercent', 'stopCycles', 'stoppedUs', 'targetPid', 'version'],
    ) ||
    controller?.version !== 1 ||
    controller.limitPercent !== limitPercent ||
    !Number.isSafeInteger(controller.targetPid) ||
    controller.targetPid <= 1 ||
    (processId !== undefined && controller.targetPid !== processId) ||
    !Number.isSafeInteger(controller.controlCycles) ||
    controller.controlCycles <= 0 ||
    !Number.isSafeInteger(controller.stopCycles) ||
    controller.stopCycles < 0 ||
    controller.stopCycles > controller.controlCycles ||
    !Number.isSafeInteger(controller.stoppedUs) ||
    controller.stoppedUs < 0 ||
    (elapsedMs !== undefined && controller.stoppedUs > elapsedMs * 1_000) ||
    (controller.stopCycles === 0) !== (controller.stoppedUs === 0) ||
    (requireStops && (controller.stopCycles === 0 || controller.stoppedUs === 0))
  ) {
    throw new Error(`Invalid cpulimit controller record for ${limitPercent}%`);
  }
}

function validateCalibrationLoad(load) {
  if (
    !same(
      Object.keys(load ?? {}).sort(),
      ['averageCpuPercent', 'cpuMs', 'durationMs', 'threadCount', 'wallMs'],
    ) ||
    load.durationMs !== 10_000 ||
    load.threadCount !== 8 ||
    !positive(load.wallMs) ||
    !positive(load.cpuMs) ||
    !nearlyEqual(load.averageCpuPercent, (load.cpuMs / load.wallMs) * 100)
  ) {
    throw new Error('CPU-rate calibration load record is incomplete or not derived from raw CPU/wall time');
  }
}

function policyCaseKey(definition) {
  return [
    `scale-${definition.selectionScale}`,
    `tokio-${definition.poolEnvironment.ROLLDOWN_WORKER_THREADS}`,
    `rayon-${definition.poolEnvironment.RAYON_NUM_THREADS}`,
    `blocking-${definition.poolEnvironment.ROLLDOWN_MAX_BLOCKING_THREADS}`,
    definition.quotaPercent ? `quota-${definition.quotaPercent}` : 'unthrottled',
  ].join('/');
}

function confirmationVariants(workerCount, extraWorkerCount) {
  return [...new Set([
    'ordinary',
    ...(workerCount > 0 ? [`worker-${workerCount}`] : []),
    ...(workerCount > 1 ? [`worker-${workerCount - 1}`] : []),
    ...(workerCount > 0 && workerCount < 8 ? [`worker-${workerCount + 1}`] : []),
    ...(extraWorkerCount > 0 ? [`worker-${extraWorkerCount}`] : []),
    'worker-4',
    'worker-8',
  ])];
}

function calibrationReference(calibration) {
  return {
    path: calibration.path,
    sha256: calibration.sha256,
    controllerProvenance: calibration.controllerProvenance,
    unconstrainedSaturationCpuPercent:
      calibration.report.unconstrainedSaturationCpuPercent,
  };
}

function executionTemplateFromScreen(report) {
  const definitions = report?.matrix?.cases ?? [];
  const first = definitions[0];
  const correctnessGate = report.environment?.correctnessGate?.path ?? report.matrix?.correctnessGate;
  const template = {
    projectRoot: first?.projectRoot,
    rolldownPackageRoot: first?.rolldownPackageRoot,
    correctnessGate,
    hostPolicy: report.matrix?.hostPolicy,
  };
  if (
    !nodePath.isAbsolute(template.projectRoot ?? '') ||
    !nodePath.isAbsolute(template.rolldownPackageRoot ?? '') ||
    typeof template.correctnessGate !== 'string' ||
    template.correctnessGate.length === 0 ||
    definitions.some(
      (definition) =>
        definition.projectRoot !== template.projectRoot ||
        definition.rolldownPackageRoot !== template.rolldownPackageRoot,
    )
  ) {
    throw new Error('Base MDX screen does not define one exact execution template');
  }
  validateFrozenPerformanceHostPolicy(template.hostPolicy);
  return template;
}

function requireCrossoverExecutionTemplate(crossover) {
  const template = crossover?.executionTemplate;
  if (
    !same(
      Object.keys(template ?? {}).sort(),
      ['correctnessGate', 'hostPolicy', 'projectRoot', 'rolldownPackageRoot'],
    ) ||
    !nodePath.isAbsolute(template?.projectRoot ?? '') ||
    !nodePath.isAbsolute(template?.rolldownPackageRoot ?? '') ||
    typeof template?.correctnessGate !== 'string' ||
    template.correctnessGate.length === 0
  ) {
    throw new Error('Crossover reference lacks its frozen execution template');
  }
  validateFrozenPerformanceHostPolicy(template.hostPolicy);
  const scales = crossover.points ?? [];
  if (
    !crossover.outputOraclesByScale ||
    !same(Object.keys(crossover.outputOraclesByScale), scales.map(String)) ||
    scales.some((scale) => !validOutputOracle(crossover.outputOraclesByScale[String(scale)]))
  ) {
    throw new Error('Crossover reference lacks a valid output oracle for every selected scale');
  }
  return template;
}

function requireMatchingExecutionTemplate(crossover, template) {
  const frozen = requireCrossoverExecutionTemplate(crossover);
  if (template !== undefined && !same(template, frozen)) {
    throw new Error('Policy generation template differs from the exact crossover source template');
  }
  return frozen;
}

function collectCrossoverOutputOracles(records, scales) {
  return Object.fromEntries(
    scales.map((scale) => {
      const matches = records.flatMap((record) =>
        (record.report.matrix?.followup?.stage ?? '').endsWith('confirmation')
          ? record.report.matrix.cases
              .filter((definition) => definition.selectionScale === scale)
              .map((definition) => ({ record, definition }))
          : [],
      );
      if (matches.length !== 1) {
        throw new Error(`Scale ${scale} must have exactly one repeated crossover output oracle`);
      }
      const { record, definition } = matches[0];
      const runs = record.report.runs.filter(({ name }) => name === definition.name);
      const first = runs[0];
      const oracle = {
        source: { path: record.path, sha256: record.sha256, caseName: definition.name },
        outputChunks: first?.outputChunks,
        normalizedOutputBytes: first?.normalizedOutputBytes,
        normalizedOutputHash: first?.normalizedOutputHash,
        outputNormalization: first?.outputNormalization,
      };
      if (
        !validOutputOracle(oracle) ||
        runs.some((run) => !runMatchesOutputOracle(run, oracle))
      ) {
        throw new Error(`Scale ${scale} crossover output oracle is empty or inconsistent`);
      }
      return [String(scale), oracle];
    }),
  );
}

function validOutputOracle(oracle) {
  const normalization = oracle?.outputNormalization;
  return (
    same(
      Object.keys(oracle ?? {}).sort(),
      [
        'normalizedOutputBytes',
        'normalizedOutputHash',
        'outputChunks',
        'outputNormalization',
        'source',
      ],
    ) &&
    same(Object.keys(oracle.source ?? {}).sort(), ['caseName', 'path', 'sha256']) &&
    typeof oracle?.source?.path === 'string' &&
    /^[a-f0-9]{64}$/.test(oracle.source.sha256 ?? '') &&
    typeof oracle.source.caseName === 'string' &&
    Number.isSafeInteger(oracle.outputChunks) &&
    oracle.outputChunks > 0 &&
    Number.isSafeInteger(oracle.normalizedOutputBytes) &&
    oracle.normalizedOutputBytes > 0 &&
    /^[a-f0-9]{64}$/.test(oracle.normalizedOutputHash ?? '') &&
    same(Object.keys(normalization ?? {}).sort(), ['files', 'kind', 'playgroundUrls']) &&
    normalization.kind === 'undici-formdata-boundary' &&
    Number.isSafeInteger(normalization.playgroundUrls) &&
    normalization.playgroundUrls >= 0 &&
    Array.isArray(normalization.files) &&
    normalization.files.every((file) => typeof file === 'string' && file.length > 0) &&
    new Set(normalization.files).size === normalization.files.length
  );
}

function runMatchesOutputOracle(run, oracle) {
  return (
    run.outputChunks === oracle.outputChunks &&
    run.normalizedOutputBytes === oracle.normalizedOutputBytes &&
    run.normalizedOutputHash === oracle.normalizedOutputHash &&
    same(run.outputNormalization, oracle.outputNormalization)
  );
}

function pool(tokio, rayon) {
  return {
    ROLLDOWN_WORKER_THREADS: String(tokio),
    RAYON_NUM_THREADS: String(rayon),
    ROLLDOWN_MAX_BLOCKING_THREADS: '4',
  };
}

function prefixHash(manifest, scale) {
  const hash = manifest.prefixes?.[String(scale)]?.selectionSha256;
  if (!/^[a-f0-9]{64}$/.test(hash ?? '')) throw new Error(`Missing frozen prefix ${scale}`);
  return hash;
}

async function readAndMatch(reference) {
  const record = await readArtifactRecord(reference.path);
  if (record.sha256 !== reference.sha256) throw new Error(`Policy source artifact changed: ${reference.path}`);
  return record;
}

function policyMatrixPlan(matrix, stage) {
  return { schema: 1, status: 'matrix-required', stage, matrix };
}

function policyWallMs(run) {
  return run.policyWallMs ?? run.totalElapsedMs;
}

function policyCpuMs(run) {
  return run.externalTiming
    ? run.externalTiming.userMs + run.externalTiming.systemMs
    : run.cpuUserMs + run.cpuSystemMs;
}

function validExternalTiming(value) {
  const rawMatch =
    typeof value?.raw === 'string'
      ? value.raw.match(/^(\d+(?:\.\d+)?) real (\d+(?:\.\d+)?) user (\d+(?:\.\d+)?) sys$/)
      : null;
  if (
    !same(
      Object.keys(value ?? {}).sort(),
      [
        'decimalPlaces',
        'raw',
        'realMs',
        'realToken',
        'resolutionMs',
        'schema',
        'source',
        'systemMs',
        'timedProcess',
        'userMs',
      ],
    ) ||
    value.schema !== 1 ||
    value.source !== '/usr/bin/time -l' ||
    value.timedProcess !== 'node' ||
    !/^\d+(?:\.\d+)?$/.test(value.realToken ?? '') ||
    !Number.isSafeInteger(value.decimalPlaces) ||
    value.decimalPlaces < 0 ||
    value.decimalPlaces > 6 ||
    !positive(value.resolutionMs) ||
    value.resolutionMs !== 10 ** (3 - value.decimalPlaces) ||
    !positive(value.realMs) ||
    !nearlyEqual(value.realMs, Number(value.realToken) * 1_000) ||
    !nonNegative(value.userMs) ||
    !nonNegative(value.systemMs) ||
    !rawMatch ||
    rawMatch[1] !== value.realToken ||
    !nearlyEqual(Number(rawMatch[2]) * 1_000, value.userMs) ||
    !nearlyEqual(Number(rawMatch[3]) * 1_000, value.systemMs)
  ) {
    return false;
  }
  return true;
}

function validSourceRecord(record, name) {
  return (
    same(Object.keys(record ?? {}).sort(), ['path', 'sha256']) &&
    record?.path === nodePath.join(import.meta.dirname, name) &&
    /^[a-f0-9]{64}$/.test(record.sha256 ?? '')
  );
}

function hasAttributionPayload(run) {
  return [
    'metrics',
    'rustMetrics',
    'lifecycleMetrics',
    'moduleInitMetrics',
    'attributionResources',
    'attributionSummary',
    'correctnessCounters',
  ].some((field) => Object.hasOwn(run, field));
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function nearlyEqual(left, right) {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= 1e-9;
}

function positive(value) {
  return Number.isFinite(value) && value > 0;
}

function nonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isActiveCiValue(value) {
  return value !== null && value !== undefined && !['', '0', 'false'].includes(String(value).toLowerCase());
}
