import {
  evaluateChildHostPolicy,
  evaluateStartAdmission,
  validateFrozenPerformanceHostPolicy,
} from './local-host-policy.mjs';
import { BASELINE_POOL_ENVIRONMENT, normalizePoolEnvironment } from './pool-environment.mjs';
import { BASE_SCALES, FROZEN_SCALES, REFINEMENT_SCALES } from './scale-corpus.mjs';
import { LIFECYCLE_FIXED_RUNTIME_PROFILE, normalizeRuntimeProfile } from './runtime-profile.mjs';

const SCREEN_VARIANTS = Object.freeze([
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
const BOOTSTRAP_ITERATIONS = 100_000;
const BOOTSTRAP_SEED = 0x20260712;
const bootstrapMedianCache = new Map();

export function validateBaseScreenReport(report, manifest) {
  validatePerformanceEnvelope(report, 'performance-screen');
  if (
    report.conclusionEligible !== false ||
    report.matrix?.cases?.length !== BASE_SCALES.length ||
    report.runs?.length !== BASE_SCALES.length * SCREEN_VARIANTS.length
  ) {
    throw new Error('Base screen must contain one non-concluding ordinary/worker-1..8 run per base scale');
  }
  const scales = report.matrix.cases.map(({ selectionScale }) => selectionScale);
  if (!same(scales, BASE_SCALES)) throw new Error('Base screen scales are missing or reordered');
  for (const definition of report.matrix.cases) {
    validateScreenDefinition(definition, manifest, 'base');
    validateCaseRuns(report, definition, 1);
  }
  if (selectDirectionInterval(report).nonMonotonicScreen) {
    throw new Error('Base screen has a worker-win to worker-loss reversal; no favorable interval may be selected');
  }
  return report;
}

export function validateScaleFollowupReport(report, screenRecord, previousRecords, manifest) {
  const stage = report?.matrix?.followup?.stage;
  const expectedKind = stage === 'refinement-screen' ? 'performance-refinement' : 'performance-confirmation';
  validatePerformanceEnvelope(report, expectedKind);
  const metadata = report.matrix.followup;
  if (
    metadata?.schema !== 1 ||
    metadata.screenArtifactSha256 !== screenRecord.sha256 ||
    !same(
      metadata.consumedArtifactSha256,
      previousRecords.map(({ sha256 }) => sha256),
    ) ||
    !['initial-confirmation', 'refinement-screen', 'refinement-confirmation'].includes(stage)
  ) {
    throw new Error('Follow-up report is not chained to the exact preceding artifacts');
  }
  const direction = selectDirectionInterval(screenRecord.report);
  if (!same(metadata.direction, direction)) {
    throw new Error('Follow-up report changed the deterministic direction interval');
  }
  if (!Array.isArray(report.matrix.cases) || report.matrix.cases.length === 0) {
    throw new Error(`${stage} contains no cases`);
  }
  for (const definition of report.matrix.cases) {
    if (stage === 'refinement-screen') {
      validateScreenDefinition(definition, manifest, 'refinement');
      if (!direction.refinementScales.includes(definition.selectionScale)) {
        throw new Error(`Refinement screen scale ${definition.selectionScale} is outside the frozen interval`);
      }
      validateCaseRuns(report, definition, 1);
    } else {
      validateConfirmationDefinition(definition, manifest, metadata.workerSelectionByScale);
      validateCaseRuns(report, definition, 10);
    }
  }
  const expectedRuns = report.matrix.cases.reduce(
    (sum, definition) => sum + definition.variants.length * (definition.repeats ?? 1),
    0,
  );
  if (report.runs.length !== expectedRuns) {
    throw new Error(`${stage} contains runs outside its declared cases`);
  }
  return report;
}

export function planScaleFollowup({ screenRecord, followupRecords = [], manifest }) {
  validateBaseScreenReport(screenRecord.report, manifest);
  for (const [index, record] of followupRecords.entries()) {
    validateScaleFollowupReport(
      record.report,
      screenRecord,
      followupRecords.slice(0, index),
      manifest,
    );
  }
  validateStageOrder(followupRecords);
  const direction = selectDirectionInterval(screenRecord.report);
  const initialScales = initialConfirmationScales(direction);
  if (followupRecords.length === 0) {
    return matrixPlan(
      'initial-confirmation',
      buildConfirmationMatrix({
        stage: 'initial-confirmation',
        scales: initialScales,
        selectionReports: [screenRecord.report],
        screenRecord,
        followupRecords,
        manifest,
        direction,
      }),
      direction,
      undefined,
    );
  }
  const first = followupRecords[0];
  if (first.report.matrix.followup.stage !== 'initial-confirmation') {
    throw new Error('The first follow-up must be the deterministic initial confirmation');
  }
  if (!same(first.report.matrix.cases.map(({ selectionScale }) => selectionScale), initialScales)) {
    throw new Error('Initial confirmation did not cover the deterministic scale set');
  }
  validateConfirmationSelections(first.report, [screenRecord.report]);
  validateDeterministicRefinementChain(followupRecords, direction);

  const repeatedPoints = collectRepeatedPoints(followupRecords);
  const decision = analyzeCrossover(direction, repeatedPoints);
  const requestedScale = chooseRequestedScale(decision);
  if (requestedScale === undefined) {
    return {
      schema: 1,
      status: 'complete',
      stage: 'crossover-complete',
      direction,
      decision,
      bootstrap: bootstrapRecord(),
      consumedArtifactSha256: followupRecords.map(({ sha256 }) => sha256),
    };
  }

  const refinementScreen = findScaleReport(
    followupRecords,
    'refinement-screen',
    requestedScale,
  );
  const refinementConfirmation = findScaleReport(
    followupRecords,
    'refinement-confirmation',
    requestedScale,
  );
  if (!refinementScreen) {
    return matrixPlan(
      'refinement-screen',
      buildRefinementScreenMatrix({
        scale: requestedScale,
        screenRecord,
        followupRecords,
        manifest,
        direction,
        decision,
      }),
      direction,
      decision,
    );
  }
  if (!refinementConfirmation) {
    return matrixPlan(
      'refinement-confirmation',
      buildConfirmationMatrix({
        stage: 'refinement-confirmation',
        scales: [requestedScale],
        selectionReports: [refinementScreen.report],
        screenRecord,
        followupRecords,
        manifest,
        direction,
        decision,
      }),
      direction,
      decision,
    );
  }
  throw new Error(`Scale ${requestedScale} was already screened and confirmed but remained unconsumed`);
}

export function selectDirectionInterval(screen) {
  const rows = BASE_SCALES.map((scale) => {
    const best = bestScreenedWorker(screen, scale);
    const ordinary = runsAtScale(screen, scale).find(({ variant }) => variant === 'ordinary');
    return {
      scale,
      ordinaryElapsedMs: ordinary.totalElapsedMs,
      bestWorkerCount: best.workerCount,
      bestWorkerElapsedMs: best.elapsedMs,
      workerWins: best.elapsedMs < ordinary.totalElapsedMs,
    };
  });
  let lowerIndex = rows.findIndex(
    (row, index) => index > 0 && !rows[index - 1].workerWins && row.workerWins,
  ) - 1;
  let mode = 'observed-direction-change';
  if (lowerIndex < 0 && rows[0].workerWins) {
    lowerIndex = 0;
    mode = 'left-censored-screen';
  } else if (lowerIndex < 0) {
    lowerIndex = rows.length - 2;
    mode = 'right-censored-screen';
  }
  const lowerScale = rows[lowerIndex].scale;
  const upperScale = rows[lowerIndex + 1].scale;
  const nextBaseScale = rows[lowerIndex + 2]?.scale ?? null;
  const refinementScales = REFINEMENT_SCALES.filter(
    (scale) => scale > lowerScale && scale < upperScale,
  );
  return {
    schema: 1,
    mode,
    lowerScale,
    upperScale,
    nextBaseScale,
    refinementScales,
    nonMonotonicScreen: rows.some(
      (row, index) => index > 0 && rows[index - 1].workerWins && !row.workerWins,
    ),
    rows,
  };
}

export function bestScreenedWorker(report, scale) {
  const workers = runsAtScale(report, scale)
    .filter(({ variant }) => /^worker-[1-8]$/.test(variant))
    .map((run) => ({
      workerCount: Number(run.variant.slice('worker-'.length)),
      elapsedMs: run.totalElapsedMs,
    }))
    .sort((left, right) => left.elapsedMs - right.elapsedMs || left.workerCount - right.workerCount);
  if (workers.length !== 8) throw new Error(`Scale ${scale} lacks an ordinary/worker-1..8 screen`);
  return workers[0];
}

export function analyzeCrossover(direction, repeatedPoints) {
  const universe = [
    direction.lowerScale,
    ...direction.refinementScales,
    direction.upperScale,
    ...(direction.nextBaseScale === null ? [] : [direction.nextBaseScale]),
  ];
  const points = [...repeatedPoints.values()].sort((left, right) => left.scale - right.scale);
  const mechanical = classifyCriterion(
    'mechanical',
    direction,
    universe,
    repeatedPoints,
    (point) => point.mechanical.worker.wallSpeedup.bootstrap95.lower > 1,
  );
  const resource = classifyCriterion(
    'resource-acceptable',
    direction,
    universe,
    repeatedPoints,
    (point) => point.resource?.eligible === true,
  );
  return {
    schema: 1,
    bootstrap: bootstrapRecord(),
    points,
    policyEvidenceByScale: Object.fromEntries(
      points.map((point) => [String(point.scale), point.policyEvidence]),
    ),
    mechanical,
    resource,
  };
}

function validatePerformanceEnvelope(report, expectedEvidenceKind) {
  if (
    report?.schema !== 1 ||
    report.evidenceKind !== expectedEvidenceKind ||
    report.matrix?.evidenceKind !== expectedEvidenceKind ||
    report.measurementFieldsPresent !== true ||
    report.timingEligible !== true ||
    report.conclusionEligible !== (expectedEvidenceKind === 'performance-confirmation') ||
    report.executionScope !== 'local-only' ||
    (report.validationErrors ?? []).length !== 0 ||
    (report.hostPolicyViolations ?? []).length !== 0 ||
    !Array.isArray(report.runs) ||
    report.runs.length === 0
  ) {
    throw new Error(`${expectedEvidenceKind} report is incomplete or misclassified`);
  }
  if (
    !same(normalizeRuntimeProfile(report.matrix.runtimeProfile), LIFECYCLE_FIXED_RUNTIME_PROFILE) ||
    !same(normalizeRuntimeProfile(report.environment?.runtimeProfile), LIFECYCLE_FIXED_RUNTIME_PROFILE) ||
    !same(
      normalizePoolEnvironment(report.matrix.poolEnvironment),
      normalizePoolEnvironment(BASELINE_POOL_ENVIRONMENT),
    ) ||
    !same(
      normalizePoolEnvironment(report.environment?.childPoolEnvironment),
      normalizePoolEnvironment(BASELINE_POOL_ENVIRONMENT),
    ) ||
    report.environment?.correctnessGate?.status !== 'passed' ||
    !/^[a-f0-9]{64}$/.test(report.environment?.correctnessGate?.sha256 ?? '')
  ) {
    throw new Error(`${expectedEvidenceKind} lacks the frozen runtime, pool, or correctness gate`);
  }
  validateFrozenPerformanceHostPolicy(report.matrix.hostPolicy);
  if ((report.hostAdmissionAttempts ?? []).length < report.runs.length) {
    throw new Error(`${expectedEvidenceKind} lacks per-child host admission`);
  }
  if (!same(report.runs.map(({ sequence }) => sequence), report.runs.map((_run, index) => index))) {
    throw new Error(`${expectedEvidenceKind} has a missing or reordered global run sequence`);
  }
  if (Object.values(report.environment?.parentCiMarkers ?? {}).some(isActiveCiValue)) {
    throw new Error(`${expectedEvidenceKind} recorded an active CI marker`);
  }
  for (const run of report.runs) validatePerformanceRun(run, report.matrix.hostPolicy);
}

function validatePerformanceRun(run, hostPolicy) {
  for (const [name, value] of [
    ['totalElapsedMs', run.totalElapsedMs],
    ['cpuUserMs', run.cpuUserMs],
    ['cpuSystemMs', run.cpuSystemMs],
    ['peakRssBytes', run.peakRssBytes],
  ]) {
    if (!Number.isFinite(value) || value < 0 || (name !== 'cpuSystemMs' && value === 0)) {
      throw new Error(`${run.name}/${run.variant} has invalid ${name}`);
    }
  }
  const start = evaluateStartAdmission(hostPolicy, run.hostBefore);
  if (
    start.immediate.length > 0 ||
    start.transient.length > 0 ||
    evaluateChildHostPolicy(hostPolicy, run.hostBefore, run.hostAfter).length > 0 ||
    (run.hostPolicyViolations ?? []).length > 0 ||
    run.measurementMode !== 'measurement' ||
    run.buildProfile !== 'default' ||
    run.effectiveRunLinkCheck !== false ||
    !same(normalizeRuntimeProfile(run.runtimeProfile), LIFECYCLE_FIXED_RUNTIME_PROFILE) ||
    !same(
      normalizePoolEnvironment(run.poolEnvironment),
      normalizePoolEnvironment(BASELINE_POOL_ENVIRONMENT),
    )
  ) {
    throw new Error(`${run.name}/${run.variant} failed frozen run admission`);
  }
}

function validateScreenDefinition(definition, manifest, kind) {
  if (
    !same(definition.variants, SCREEN_VARIANTS) ||
    definition.instrumentation !== false ||
    (definition.rustInstrumentation ?? false) !== false ||
    (definition.measurementMode ?? 'measurement') !== 'measurement' ||
    (definition.warmups ?? 0) !== 0 ||
    (definition.repeats ?? 1) !== 1 ||
    definition.corpus !== 'cloudflare-mdx-scale-v1' ||
    definition.selectionPrefixSha256 !== prefixHash(manifest, definition.selectionScale) ||
    (kind === 'base' && !BASE_SCALES.includes(definition.selectionScale)) ||
    (kind === 'refinement' && !REFINEMENT_SCALES.includes(definition.selectionScale))
  ) {
    throw new Error(`${kind} screen case ${definition.name} changed the frozen one-shot grid`);
  }
}

function validateConfirmationDefinition(definition, manifest, workerSelectionByScale) {
  const selection = workerSelectionByScale?.[String(definition.selectionScale)];
  if (
    definition.instrumentation !== false ||
    (definition.rustInstrumentation ?? false) !== false ||
    (definition.measurementMode ?? 'measurement') !== 'measurement' ||
    (definition.warmups ?? 0) !== 0 ||
    definition.repeats !== 10 ||
    definition.corpus !== 'cloudflare-mdx-scale-v1' ||
    !FROZEN_SCALES.includes(definition.selectionScale) ||
    definition.selectionPrefixSha256 !== prefixHash(manifest, definition.selectionScale) ||
    !selection ||
    selection.bestWorkerCount !== workerCountFromSelection(selection) ||
    !same(definition.variants, confirmationVariants(selection.bestWorkerCount))
  ) {
    throw new Error(`Confirmation case ${definition.name} is not the selected ten-block grid`);
  }
}

function validateCaseRuns(report, definition, expectedPerVariant) {
  const runs = report.runs.filter(({ name }) => name === definition.name);
  if (runs.length !== definition.variants.length * expectedPerVariant) {
    throw new Error(`${definition.name} has an incomplete run count`);
  }
  for (const variant of definition.variants) {
    const selected = runs.filter((run) => run.variant === variant);
    if (
      selected.length !== expectedPerVariant ||
      new Set(selected.map(({ index }) => index)).size !== expectedPerVariant
    ) {
      throw new Error(`${definition.name}/${variant} lacks complete rotated blocks`);
    }
  }
  const expectedOrder = [];
  for (let index = 0; index < expectedPerVariant; index++) {
    const blockIndex = (definition.startIndex ?? 0) + index;
    const offset = blockIndex % definition.variants.length;
    const variants = [
      ...definition.variants.slice(offset),
      ...definition.variants.slice(0, offset),
    ];
    expectedOrder.push(...variants.map((variant) => ({ index: blockIndex, variant })));
  }
  if (!same(runs.map(({ index, variant }) => ({ index, variant })), expectedOrder)) {
    throw new Error(`${definition.name} did not preserve the generated rotated execution order`);
  }
  for (const run of runs) {
    if (
      run.transformedEntryCount !== definition.selectionScale ||
      run.selection?.scale !== definition.selectionScale ||
      run.selection?.prefixSha256 !== definition.selectionPrefixSha256
    ) {
      throw new Error(`${definition.name}/${run.variant} changed the frozen prefix`);
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
      throw new Error(`${definition.name} variants differ for ${field}`);
    }
  }
}

function validateStageOrder(records) {
  if (records.length === 0) return;
  const stages = records.map(({ report }) => report.matrix.followup.stage);
  if (stages[0] !== 'initial-confirmation') throw new Error('Follow-up chain lacks initial confirmation');
  for (let index = 1; index < stages.length; index += 2) {
    if (stages[index] !== 'refinement-screen') {
      throw new Error(`Follow-up ${index} must be a refinement screen`);
    }
    if (index + 1 < stages.length && stages[index + 1] !== 'refinement-confirmation') {
      throw new Error(`Follow-up ${index + 1} must confirm the preceding refinement screen`);
    }
    if (index + 1 < stages.length) {
      const screenScales = records[index].report.matrix.cases.map(({ selectionScale }) => selectionScale);
      const confirmationScales = records[index + 1].report.matrix.cases.map(
        ({ selectionScale }) => selectionScale,
      );
      if (!same(screenScales, confirmationScales)) {
        throw new Error('Refinement confirmation does not match its preceding screen scale');
      }
    }
  }
}

function validateDeterministicRefinementChain(records, direction) {
  let index = 1;
  while (index < records.length) {
    const decision = analyzeCrossover(direction, collectRepeatedPoints(records.slice(0, index)));
    const requestedScale = chooseRequestedScale(decision);
    if (requestedScale === undefined) {
      throw new Error('Follow-up chain continued after crossover became exact or censored');
    }
    const screen = records[index];
    if (
      screen.report.matrix.followup.stage !== 'refinement-screen' ||
      !same(screen.report.matrix.cases.map(({ selectionScale }) => selectionScale), [requestedScale])
    ) {
      throw new Error(`Deterministic refinement required a screen at scale ${requestedScale}`);
    }
    index += 1;
    if (index >= records.length) return;
    const confirmation = records[index];
    if (
      confirmation.report.matrix.followup.stage !== 'refinement-confirmation' ||
      !same(confirmation.report.matrix.cases.map(({ selectionScale }) => selectionScale), [requestedScale])
    ) {
      throw new Error(`Refinement screen at ${requestedScale} must be followed by its confirmation`);
    }
    validateConfirmationSelections(confirmation.report, [screen.report]);
    index += 1;
  }
}

function validateConfirmationSelections(confirmation, selectionReports) {
  for (const definition of confirmation.matrix.cases) {
    const source = selectionReports.find((report) => hasScale(report, definition.selectionScale));
    if (!source) throw new Error(`No selection screen for confirmation scale ${definition.selectionScale}`);
    const best = bestScreenedWorker(source, definition.selectionScale);
    const metadata = confirmation.matrix.followup.workerSelectionByScale[String(definition.selectionScale)];
    if (
      metadata?.bestWorkerCount !== best.workerCount ||
      metadata.bestWorkerElapsedMs !== best.elapsedMs ||
      !same(metadata.variants, confirmationVariants(best.workerCount)) ||
      !same(definition.variants, confirmationVariants(best.workerCount))
    ) {
      throw new Error(`Confirmation scale ${definition.selectionScale} did not use the screened best worker and adjacent counts`);
    }
  }
}

function buildRefinementScreenMatrix({
  scale,
  screenRecord,
  followupRecords,
  manifest,
  direction,
  decision,
}) {
  const definition = caseFromScreen(screenRecord.report, direction.upperScale);
  return baseGeneratedMatrix(screenRecord, followupRecords, direction, 'refinement-screen', decision, {
    evidenceKind: 'performance-refinement',
    cases: [
      {
        ...definition,
        name: `cloudflare-mdx-scale-v1-${scale}-refinement-screen`,
        selectionScale: scale,
        selectionPrefixSha256: prefixHash(manifest, scale),
        instrumentation: false,
        rustInstrumentation: false,
        measurementMode: 'measurement',
        variants: SCREEN_VARIANTS,
        warmups: 0,
        repeats: 1,
        startIndex: followupRecords.length,
      },
    ],
  });
}

function buildConfirmationMatrix({
  stage,
  scales,
  selectionReports,
  screenRecord,
  followupRecords,
  manifest,
  direction,
  decision,
}) {
  const workerSelectionByScale = {};
  const cases = scales.map((scale, index) => {
    const selectionReport = selectionReports.find((report) => hasScale(report, scale));
    if (!selectionReport) throw new Error(`No passed screen supplied for confirmation scale ${scale}`);
    const selected = bestScreenedWorker(selectionReport, scale);
    workerSelectionByScale[String(scale)] = {
      sourceEvidenceKind: selectionReport.evidenceKind,
      bestWorkerCount: selected.workerCount,
      bestWorkerElapsedMs: selected.elapsedMs,
      variants: confirmationVariants(selected.workerCount),
    };
    const definition = caseFromScreen(selectionReport, scale);
    return {
      ...definition,
      name: `cloudflare-mdx-scale-v1-${scale}-${stage}`,
      selectionScale: scale,
      selectionPrefixSha256: prefixHash(manifest, scale),
      instrumentation: false,
      rustInstrumentation: false,
      measurementMode: 'measurement',
      variants: confirmationVariants(selected.workerCount),
      warmups: 0,
      repeats: 10,
      startIndex: followupRecords.length + index,
    };
  });
  return baseGeneratedMatrix(screenRecord, followupRecords, direction, stage, decision, {
    evidenceKind: 'performance-confirmation',
    workerSelectionByScale,
    cases,
  });
}

function baseGeneratedMatrix(
  screenRecord,
  followupRecords,
  direction,
  stage,
  decision,
  { evidenceKind, workerSelectionByScale, cases },
) {
  const source = screenRecord.report.matrix;
  return {
    executionScope: 'local-only',
    evidenceKind,
    executionEnabled: true,
    correctnessGate: screenRecord.report.environment.correctnessGate.path ?? source.correctnessGate,
    runtimeProfile: LIFECYCLE_FIXED_RUNTIME_PROFILE,
    poolEnvironment: BASELINE_POOL_ENVIRONMENT,
    hostPolicy: source.hostPolicy,
    followup: {
      schema: 1,
      stage,
      screenArtifactSha256: screenRecord.sha256,
      consumedArtifactSha256: followupRecords.map(({ sha256 }) => sha256),
      direction,
      decision: decision ?? null,
      workerSelectionByScale: workerSelectionByScale ?? {},
      bootstrap: bootstrapRecord(),
    },
    cases,
  };
}

function matrixPlan(stage, matrix, direction, decision) {
  return {
    schema: 1,
    status: 'matrix-required',
    stage,
    direction,
    decision: decision ?? null,
    matrix,
  };
}

function initialConfirmationScales(direction) {
  return [...new Set([
    direction.lowerScale,
    direction.upperScale,
    direction.nextBaseScale,
    BASE_SCALES.at(-1),
  ].filter((scale) => scale !== null))];
}

function collectRepeatedPoints(records) {
  const points = new Map();
  for (const record of records) {
    if (!record.report.matrix.followup.stage.endsWith('confirmation')) continue;
    for (const definition of record.report.matrix.cases) {
      if (points.has(definition.selectionScale)) {
        throw new Error(`Scale ${definition.selectionScale} was confirmed more than once`);
      }
      points.set(
        definition.selectionScale,
        summarizeRepeatedPolicyCase(record.report, definition),
      );
    }
  }
  return points;
}

export function summarizeRepeatedPolicyCase(report, definition) {
  const runs = report.runs.filter(({ name }) => name === definition.name);
  const ordinary = runs.filter(({ variant }) => variant === 'ordinary');
  const byVariantAndIndex = new Map(runs.map((run) => [`${run.variant}\0${run.index}`, run]));
  const workers = definition.variants
    .filter((variant) => variant !== 'ordinary')
    .map((variant) => {
      const pairs = ordinary.map((baseline) => [baseline, byVariantAndIndex.get(`${variant}\0${baseline.index}`)]);
      if (pairs.some(([, candidate]) => !candidate)) {
        throw new Error(`${definition.name}/${variant} lacks paired blocks`);
      }
      const speedups = pairs.map(
        ([baseline, candidate]) => policyWallMs(baseline) / policyWallMs(candidate),
      );
      const cpuRatios = pairs.map(
        ([baseline, candidate]) => policyCpuMs(candidate) / policyCpuMs(baseline),
      );
      const rssRatios = pairs.map(
        ([baseline, candidate]) => candidate.peakRssBytes / baseline.peakRssBytes,
      );
      const wallSpeedup = {
        ...stats(speedups),
        bootstrap95: bootstrapMedian(speedups),
      };
      const candidateCpuMs = pairs.map(([, candidate]) => policyCpuMs(candidate));
      const candidateWallMs = pairs.map(([, candidate]) => policyWallMs(candidate));
      const candidatePeakRssBytes = pairs.map(([, candidate]) => candidate.peakRssBytes);
      const resourceEligible =
        wallSpeedup.median >= 1.1 &&
        wallSpeedup.bootstrap95.lower >= 1.05 &&
        stats(cpuRatios).median <= 2 &&
        stats(rssRatios).median <= 2 &&
        Math.max(...candidatePeakRssBytes) < MAX_RSS_BYTES;
      return {
        variant,
        workerCount: Number(variant.slice('worker-'.length)),
        medianWallMs: stats(candidateWallMs).median,
        wallMedianBootstrap95: bootstrapMedian(candidateWallMs),
        medianCpuMs: stats(candidateCpuMs).median,
        medianPeakRssBytes: stats(candidatePeakRssBytes).median,
        maximumPeakRssBytes: Math.max(...candidatePeakRssBytes),
        wallSpeedup,
        pairedWallRatioBootstrap95Upper: 1 / wallSpeedup.bootstrap95.lower,
        cpuRatio: stats(cpuRatios),
        peakRssRatio: stats(rssRatios),
        resourceEligible,
      };
    });
  const mechanical = chooseRepeatedWorker(workers);
  const resourceCandidates = workers.filter(({ resourceEligible }) => resourceEligible);
  const resource = resourceCandidates.length > 0 ? chooseRepeatedWorker(resourceCandidates) : undefined;
  const selectedOracleWorkerCount = resource?.workerCount ?? 0;
  const ordinaryWallMs = stats(ordinary.map(policyWallMs)).median;
  const ordinaryCpuMs = stats(ordinary.map(policyCpuMs)).median;
  const ordinaryPeakRssBytes = stats(ordinary.map(({ peakRssBytes }) => peakRssBytes)).median;
  const policyEvidence = {
    schema: 1,
    selectedOracleWorkerCount,
    variants: {
      ordinary: {
        wallMedianMs: ordinaryWallMs,
        cpuMedianMs: ordinaryCpuMs,
        peakRssMedianBytes: ordinaryPeakRssBytes,
        resourceEligible: true,
        pairedWallRatioBootstrap95Upper: 1,
        selectedOracleWorkerCount,
      },
      ...Object.fromEntries(
        workers.map((worker) => [
          worker.variant,
          {
            wallMedianMs: worker.medianWallMs,
            cpuMedianMs: worker.medianCpuMs,
            peakRssMedianBytes: worker.medianPeakRssBytes,
            resourceEligible: worker.resourceEligible,
            pairedWallRatioBootstrap95Upper: worker.pairedWallRatioBootstrap95Upper,
            selectedOracleWorkerCount,
          },
        ]),
      ),
    },
  };
  return {
    scale: definition.selectionScale,
    variants: workers,
    mechanical: { worker: mechanical },
    resource: resource
      ? { eligible: true, worker: resource }
      : { eligible: false, reason: 'no repeated worker candidate passed every frozen resource gate' },
    policyEvidence,
  };
}

export function chooseRepeatedWorker(workers) {
  const ordered = [...workers].sort(
    (left, right) => left.medianWallMs - right.medianWallMs || left.workerCount - right.workerCount,
  );
  const fastest = ordered[0];
  const effectivelyTied = ordered.filter(
    (candidate) =>
      (candidate.medianWallMs - fastest.medianWallMs) / fastest.medianWallMs < 0.02 &&
      intervalsOverlap(candidate.wallMedianBootstrap95, fastest.wallMedianBootstrap95),
  );
  return [...effectivelyTied].sort((left, right) => left.workerCount - right.workerCount)[0];
}

function classifyCriterion(name, direction, universe, points, predicate) {
  let observedPositive = false;
  for (const scale of universe) {
    const point = points.get(scale);
    if (!point) continue;
    const positive = predicate(point);
    if (observedPositive && !positive) {
      throw new Error(`${name} repeated evidence reverses from positive to negative at scale ${scale}`);
    }
    observedPositive ||= positive;
  }
  const lower = points.get(direction.lowerScale);
  const upper = points.get(direction.upperScale);
  if (!lower || !upper) return { name, status: 'incomplete-initial-confirmation' };
  const lowerPositive = predicate(lower);
  const upperPositive = predicate(upper);
  if (lowerPositive) {
    if (direction.lowerScale === BASE_SCALES[0] && upperPositive) {
      return { name, status: 'left-censored', bound: `<=${direction.lowerScale}`, requestedScales: [] };
    }
    return {
      name,
      status: 'interval-censored-before-screen-interval',
      bound: `<${direction.lowerScale}`,
      requestedScales: [],
    };
  }
  if (!upperPositive) {
    if (direction.upperScale === BASE_SCALES.at(-1)) {
      return { name, status: 'right-censored', bound: `>${direction.upperScale}`, requestedScales: [] };
    }
    const next = points.get(direction.nextBaseScale);
    if (next && predicate(next)) {
      return {
        name,
        status: 'interval-censored-after-screen-interval',
        bound: `(${direction.upperScale},${direction.nextBaseScale}]`,
        requestedScales: [],
      };
    }
    const full = points.get(BASE_SCALES.at(-1));
    return full && predicate(full)
      ? {
          name,
          status: 'interval-censored-after-screen-interval',
          bound: `(${direction.upperScale},${BASE_SCALES.at(-1)}]`,
          requestedScales: [],
        }
      : { name, status: 'right-censored', bound: `>${BASE_SCALES.at(-1)}`, requestedScales: [] };
  }

  const candidate = universe.find((scale) => points.has(scale) && predicate(points.get(scale)));
  const candidateIndex = universe.indexOf(candidate);
  const knownNegativeIndex = universe
    .slice(0, candidateIndex)
    .map((scale, index) => ({ scale, index }))
    .filter(({ scale }) => points.has(scale) && !predicate(points.get(scale)))
    .at(-1)?.index;
  if (knownNegativeIndex === undefined) {
    return { name, status: 'non-monotonic-or-unbounded', requestedScales: [] };
  }
  const previousIndex = candidateIndex - 1;
  if (!points.has(universe[previousIndex])) {
    const midpointIndex = Math.floor((knownNegativeIndex + candidateIndex) / 2);
    return {
      name,
      status: 'refinement-required',
      bracket: [universe[knownNegativeIndex], candidate],
      requestedScales: [universe[Math.max(knownNegativeIndex + 1, midpointIndex)]],
    };
  }
  if (predicate(points.get(universe[previousIndex]))) {
    return { name, status: 'non-monotonic-repeated-evidence', requestedScales: [] };
  }
  const nextScale = universe[candidateIndex + 1];
  if (nextScale === undefined) {
    return {
      name,
      status: 'right-edge-censored',
      bound: `(${universe[previousIndex]},${candidate}]`,
      requestedScales: [],
    };
  }
  if (!points.has(nextScale)) {
    return {
      name,
      status: 'refinement-required',
      bracket: [universe[previousIndex], candidate],
      requestedScales: [nextScale],
    };
  }
  if (!predicate(points.get(nextScale))) {
    return { name, status: 'non-monotonic-repeated-evidence', requestedScales: [] };
  }
  return {
    name,
    status: 'exact',
    scale: candidate,
    previousScale: universe[previousIndex],
    confirmingNextScale: nextScale,
    requestedScales: [],
  };
}

function chooseRequestedScale(decision) {
  const requested = [
    ...(decision.mechanical.requestedScales ?? []),
    ...(decision.resource.requestedScales ?? []),
  ].filter((scale) => REFINEMENT_SCALES.includes(scale));
  return [...new Set(requested)].sort((left, right) => left - right)[0];
}

function findScaleReport(records, stage, scale) {
  return records.find(
    ({ report }) =>
      report.matrix.followup.stage === stage &&
      report.matrix.cases.some(({ selectionScale }) => selectionScale === scale),
  );
}

function hasScale(report, scale) {
  return report.matrix.cases.some(({ selectionScale }) => selectionScale === scale);
}

function runsAtScale(report, scale) {
  const definition = report.matrix.cases.find(({ selectionScale }) => selectionScale === scale);
  if (!definition) return [];
  return report.runs.filter(({ name }) => name === definition.name);
}

function caseFromScreen(report, scale) {
  const definition = report.matrix.cases.find(({ selectionScale }) => selectionScale === scale);
  if (!definition) throw new Error(`Screen report lacks scale ${scale}`);
  return Object.fromEntries(
    [
      'projectRoot',
      'rolldownPackageRoot',
      'corpus',
      'buildProfile',
      'fixedNow',
      'limit',
    ]
      .filter((key) => definition[key] !== undefined)
      .map((key) => [key, definition[key]]),
  );
}

function confirmationVariants(workerCount) {
  return [...new Set([
    'ordinary',
    `worker-${workerCount}`,
    ...(workerCount > 1 ? [`worker-${workerCount - 1}`] : []),
    ...(workerCount < 8 ? [`worker-${workerCount + 1}`] : []),
    'worker-4',
    'worker-8',
  ])];
}

function workerCountFromSelection(selection) {
  const candidate = selection.variants?.[1];
  return Number(/^worker-(\d+)$/.exec(candidate ?? '')?.[1]);
}

function prefixHash(manifest, scale) {
  const hash = manifest?.prefixes?.[String(scale)]?.selectionSha256;
  if (!/^[a-f0-9]{64}$/.test(hash ?? '')) throw new Error(`Manifest lacks prefix ${scale}`);
  return hash;
}

function stats(values) {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) {
    throw new Error('Cannot summarize empty or non-finite repeated metrics');
  }
  const sorted = [...values].sort((left, right) => left - right);
  return {
    min: sorted[0],
    median: quantile(sorted, 0.5),
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    max: sorted.at(-1),
    values,
  };
}

function policyWallMs(run) {
  return run.policyWallMs ?? run.totalElapsedMs;
}

function policyCpuMs(run) {
  return run.externalTiming
    ? run.externalTiming.userMs + run.externalTiming.systemMs
    : run.cpuUserMs + run.cpuSystemMs;
}

function bootstrapMedian(values) {
  const cacheKey = values.join('\0');
  const cached = bootstrapMedianCache.get(cacheKey);
  if (cached) return cached;
  const random = mulberry32(BOOTSTRAP_SEED);
  const medians = new Float64Array(BOOTSTRAP_ITERATIONS);
  for (let iteration = 0; iteration < BOOTSTRAP_ITERATIONS; iteration++) {
    const sample = Array.from(
      { length: values.length },
      () => values[Math.floor(random() * values.length)],
    ).sort((left, right) => left - right);
    medians[iteration] = quantile(sample, 0.5);
  }
  medians.sort();
  const result = Object.freeze({
    lower: quantile(medians, 0.025),
    upper: quantile(medians, 0.975),
  });
  bootstrapMedianCache.set(cacheKey, result);
  return result;
}

function quantile(sorted, probability) {
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function mulberry32(seed) {
  return () => {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function bootstrapRecord() {
  return {
    iterations: BOOTSTRAP_ITERATIONS,
    seed: BOOTSTRAP_SEED,
    statistic: 'paired median',
  };
}

function intervalsOverlap(left, right) {
  return left.lower <= right.upper && right.lower <= left.upper;
}

function isActiveCiValue(value) {
  return value !== null && value !== undefined && !['', '0', 'false'].includes(String(value).toLowerCase());
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
