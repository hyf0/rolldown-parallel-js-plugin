import { readFile, writeFile } from 'node:fs/promises';
import nodePath from 'node:path';
import {
  evaluateChildHostPolicy,
  evaluateStartAdmission,
  validateFrozenPerformanceHostPolicy,
} from './local-host-policy.mjs';
import { normalizePoolEnvironment } from './pool-environment.mjs';
import { LIFECYCLE_FIXED_RUNTIME_PROFILE, normalizeRuntimeProfile } from './runtime-profile.mjs';
import { EXPECTED_COMPILER_ENVIRONMENT } from './environment-provenance.mjs';
import { requireCurrentEvidenceProvenance } from './evidence-provenance.mjs';

const inputPath = nodePath.resolve(process.argv[2] ?? '');
const outputPath = process.argv[3] ? nodePath.resolve(process.argv[3]) : undefined;
if (!inputPath) throw new Error('Expected a raw matrix path');
const report = JSON.parse(await readFile(inputPath, 'utf8'));
await requireCurrentEvidenceProvenance(
  report.environment,
  report.runner,
  report.caseRunner,
  'run-matrix.mjs',
  'run-case.mjs',
);
validateConclusionReport(report);
const executionScope = report.executionScope ?? 'unrecorded';
const reportHostPolicyViolations = report.hostPolicyViolations ?? [];
const runHostPolicyViolations = report.runs.flatMap((run) =>
  (run.hostPolicyViolations ?? []).map((message) => ({
    name: run.name,
    index: run.index,
    variant: run.variant,
    message,
  })),
);
const validationErrors = report.validationErrors ?? [];
const sourceReports = report.sourceReports ?? [];
const provenanceRecords =
  report.runner || report.caseRunner || report.environment ? [report] : sourceReports;
const runnerHashes = provenanceRecords.map(({ runner }) => runner?.sha256);
const caseRunnerHashes = provenanceRecords.map(({ caseRunner }) => caseRunner?.sha256);
const runnerProvenanceComplete = provenanceRecords.length > 0 && runnerHashes.every(Boolean);
const caseRunnerProvenanceComplete =
  provenanceRecords.length > 0 && caseRunnerHashes.every(Boolean);
const runnerProvenanceConsistent = runnerProvenanceComplete && new Set(runnerHashes).size === 1;
const caseRunnerProvenanceConsistent =
  caseRunnerProvenanceComplete && new Set(caseRunnerHashes).size === 1;
const environmentProvenanceComplete =
  provenanceRecords.length > 0 &&
  provenanceRecords.every(({ environment }) => hasCompleteEnvironmentProvenance(environment));
const environmentPolicySignatures = provenanceRecords.map(({ environment }) =>
  environmentPolicySignature(environment),
);
const environmentPoliciesCompatible =
  environmentProvenanceComplete && new Set(environmentPolicySignatures).size === 1;
const activeParentCiMarkers = provenanceRecords.flatMap(({ environment }, sourceIndex) =>
  Object.entries(environment?.parentCiMarkers ?? {})
    .filter(([, value]) => isActiveCiValue(value))
    .map(([name, value]) => ({ sourceIndex, name, value })),
);
const buildProfiles = new Set(report.runs.map((run) => run.buildProfile ?? 'unrecorded'));
const effectiveRunLinkCheckRecorded = report.runs.every(
  (run) => typeof run.effectiveRunLinkCheck === 'boolean',
);
const effectiveRunLinkCheckEnabled = report.runs.some((run) => run.effectiveRunLinkCheck === true);
const affectedHostPolicyRuns = new Set(
  runHostPolicyViolations.map(({ name, index, variant }) => `${name}\0${index}\0${variant}`),
).size;
const benchmarkIneligibilityReasons = [];
if (executionScope !== 'local-only') {
  benchmarkIneligibilityReasons.push(
    `execution scope is ${executionScope}; local-only provenance is required`,
  );
}
if (!runnerProvenanceComplete) {
  benchmarkIneligibilityReasons.push('runner source-hash provenance is missing');
} else if (!runnerProvenanceConsistent) {
  benchmarkIneligibilityReasons.push('source reports used different matrix-runner revisions');
}
if (!caseRunnerProvenanceComplete) {
  benchmarkIneligibilityReasons.push('case-runner source-hash provenance is missing');
} else if (!caseRunnerProvenanceConsistent) {
  benchmarkIneligibilityReasons.push('source reports used different case-runner revisions');
}
if (!environmentProvenanceComplete) {
  benchmarkIneligibilityReasons.push('execution-environment provenance is missing');
} else if (!environmentPoliciesCompatible) {
  benchmarkIneligibilityReasons.push('source reports used different child-environment policies');
}
if (activeParentCiMarkers.length > 0) {
  benchmarkIneligibilityReasons.push(
    `${activeParentCiMarkers.length} active parent CI marker(s) were recorded`,
  );
}
if (buildProfiles.size !== 1 || !buildProfiles.has('default')) {
  benchmarkIneligibilityReasons.push(
    `benchmark runs used non-default or mixed build profiles: ${[...buildProfiles].join(', ')}`,
  );
}
if (!effectiveRunLinkCheckRecorded) {
  benchmarkIneligibilityReasons.push(
    'effective RUN_LINK_CHECK state is missing from one or more runs',
  );
} else if (effectiveRunLinkCheckEnabled) {
  benchmarkIneligibilityReasons.push('RUN_LINK_CHECK was enabled in one or more runs');
}
if (reportHostPolicyViolations.length > 0) {
  benchmarkIneligibilityReasons.push(
    `${reportHostPolicyViolations.length} report-level host-policy violation(s)`,
  );
}
if (runHostPolicyViolations.length > 0) {
  benchmarkIneligibilityReasons.push(
    `${runHostPolicyViolations.length} run-level host-policy violation(s) across ${affectedHostPolicyRuns} run(s)`,
  );
}
if (validationErrors.length > 0) {
  benchmarkIneligibilityReasons.push(`${validationErrors.length} validation error(s)`);
}

const cases = [];
for (const name of new Set(report.runs.map((run) => run.name))) {
  const runs = report.runs.filter((run) => run.name === name);
  const variants = {};
  for (const variant of new Set(runs.map((run) => run.variant))) {
    const selected = runs.filter((run) => run.variant === variant);
    variants[variant] = {
      samples: selected.length,
      wallMs: stats(selected.map((run) => run.totalElapsedMs)),
      cpuMs: stats(selected.map((run) => run.cpuUserMs + run.cpuSystemMs)),
      peakRssBytes: stats(selected.map((run) => run.peakRssBytes)),
      normalizedOutputHashes: [...new Set(selected.map((run) => run.normalizedOutputHash))],
    };
  }

  const byVariantAndIndex = new Map(runs.map((run) => [`${run.variant}\0${run.index}`, run]));
  const ordinary = runs.filter((run) => run.variant === 'ordinary');
  const paired = {};
  for (const variant of Object.keys(variants).filter((variant) => variant !== 'ordinary')) {
    const pairs = ordinary
      .map((baseline) => [baseline, byVariantAndIndex.get(`${variant}\0${baseline.index}`)])
      .filter((pair) => pair[1]);
    paired[`ordinary-to-${variant}`] = pairedStats(
      pairs.map(([baseline, candidate]) => baseline.totalElapsedMs / candidate.totalElapsedMs),
      pairs.map(
        ([baseline, candidate]) =>
          (candidate.cpuUserMs + candidate.cpuSystemMs) /
          (baseline.cpuUserMs + baseline.cpuSystemMs),
      ),
      pairs.map(([baseline, candidate]) => candidate.peakRssBytes / baseline.peakRssBytes),
    );
  }
  if (variants['managed-4'] && variants['worker-4']) {
    const managed = runs.filter((run) => run.variant === 'managed-4');
    const pairs = managed
      .map((baseline) => [baseline, byVariantAndIndex.get(`worker-4\0${baseline.index}`)])
      .filter((pair) => pair[1]);
    paired['managed-4-to-worker-4'] = pairedStats(
      pairs.map(([managedRun, workerRun]) => managedRun.totalElapsedMs / workerRun.totalElapsedMs),
      pairs.map(
        ([managedRun, workerRun]) =>
          (workerRun.cpuUserMs + workerRun.cpuSystemMs) /
          (managedRun.cpuUserMs + managedRun.cpuSystemMs),
      ),
      pairs.map(([managedRun, workerRun]) => workerRun.peakRssBytes / managedRun.peakRssBytes),
    );
  }
  cases.push({ name, variants, paired });
}

const summary = {
  schema: 1,
  evidenceKind: report.evidenceKind,
  timingEligible: true,
  conclusionEligible: true,
  bootstrap: {
    iterations: 100_000,
    seed: 0x20260712,
    statistic: 'paired median',
  },
  source: inputPath,
  generatedAt: new Date().toISOString(),
  executionScope,
  benchmarkEligible: benchmarkIneligibilityReasons.length === 0,
  benchmarkIneligibilityReasons,
  provenance: {
    runnerSourceHashRecorded: runnerProvenanceComplete,
    runnerSourceHashConsistent: runnerProvenanceConsistent,
    caseRunnerSourceHashRecorded: caseRunnerProvenanceComplete,
    caseRunnerSourceHashConsistent: caseRunnerProvenanceConsistent,
    executionEnvironmentRecorded: environmentProvenanceComplete,
    executionEnvironmentPoliciesCompatible: environmentPoliciesCompatible,
    activeParentCiMarkers,
    buildProfiles: [...buildProfiles],
    effectiveRunLinkCheckRecorded,
  },
  hostPolicyViolations: {
    report: reportHostPolicyViolations,
    runs: runHostPolicyViolations,
  },
  validationErrors,
  rawOutputDifferences: report.rawOutputDifferences ?? [],
  cases,
};
const serialized = `${JSON.stringify(summary, null, 2)}\n`;
if (outputPath) await writeFile(outputPath, serialized);
else process.stdout.write(serialized);

function pairedStats(wallSpeedups, cpuRatios, rssRatios) {
  return {
    blocks: wallSpeedups.length,
    wallSpeedup: {
      ...stats(wallSpeedups),
      bootstrap95: bootstrapMedian(wallSpeedups),
    },
    cpuRatio: stats(cpuRatios),
    peakRssRatio: stats(rssRatios),
    wallSpeedups,
    cpuRatios,
    peakRssRatios: rssRatios,
  };
}

function stats(values) {
  if (values.length === 0) return undefined;
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error('Cannot summarize non-finite metric values');
  }
  const sorted = [...values].sort((left, right) => left - right);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.length > 1
      ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
      : 0;
  return {
    min: sorted[0],
    median: quantile(sorted, 0.5),
    mean,
    max: sorted.at(-1),
    sampleStandardDeviation: Math.sqrt(variance),
    values,
  };
}

function bootstrapMedian(values) {
  const random = mulberry32(0x20260712);
  const medians = [];
  for (let iteration = 0; iteration < 100_000; iteration++) {
    const sample = Array.from(
      { length: values.length },
      () => values[Math.floor(random() * values.length)],
    ).sort((left, right) => left - right);
    medians.push(quantile(sample, 0.5));
  }
  medians.sort((left, right) => left - right);
  return { lower: quantile(medians, 0.025), upper: quantile(medians, 0.975) };
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

function hasCompleteEnvironmentProvenance(environment) {
  return Boolean(
    environment &&
    environment.parentCiMarkers &&
    Array.isArray(environment.childCiMarkersCleared) &&
    Object.hasOwn(environment, 'childInputRunLinkCheck') &&
    environment.childInputRunLinkCheck === null &&
    environment.runCaseProfilePolicy?.default === false &&
    environment.runCaseProfilePolicy?.['ci-link-check'] === true &&
    environment.runtimeProfile?.kind === 'lifecycle-fixed-baseline' &&
    JSON.stringify(environment.compilerEnvironment) ===
      JSON.stringify(EXPECTED_COMPILER_ENVIRONMENT) &&
    environment.harnessSourceManifest?.sourceCount > 0 &&
    /^[a-f0-9]{64}$/.test(environment.harnessSourceManifest?.selectionSha256 ?? '') &&
    environment.correctnessGate?.status === 'passed' &&
    /^[a-f0-9]{64}$/.test(environment.correctnessGate?.sha256 ?? '') &&
    environment.childPoolEnvironment &&
    Object.keys(environment.parentCiMarkers).every((name) =>
      environment.childCiMarkersCleared.includes(name),
    ),
  );
}

function validateConclusionReport(value) {
  if (
    value.evidenceKind !== 'performance-confirmation' ||
    value.matrix?.evidenceKind !== 'performance-confirmation' ||
    value.measurementFieldsPresent !== true ||
    value.timingEligible !== true ||
    value.conclusionEligible !== true
  ) {
    throw new Error(
      `Only repeated performance-confirmation reports can be summarized; got ${value.evidenceKind}`,
    );
  }
  if (!Array.isArray(value.runs) || value.runs.length === 0) {
    throw new Error('Performance confirmation report has no runs');
  }
  if (
    !/^[a-f0-9]{64}$/.test(value.runner?.sha256 ?? '') ||
    !/^[a-f0-9]{64}$/.test(value.caseRunner?.sha256 ?? '')
  ) {
    throw new Error('Performance confirmation report lacks runner provenance');
  }
  validateFrozenPerformanceHostPolicy(value.matrix.hostPolicy);
  const expectedRuntime = normalizeRuntimeProfile(value.environment?.runtimeProfile);
  if (JSON.stringify(expectedRuntime) !== JSON.stringify(LIFECYCLE_FIXED_RUNTIME_PROFILE)) {
    throw new Error('Performance confirmation did not use the lifecycle-fixed baseline');
  }
  const expectedPools = normalizePoolEnvironment(value.matrix.poolEnvironment);
  if (
    JSON.stringify(expectedPools) !==
    JSON.stringify(normalizePoolEnvironment(value.environment?.childPoolEnvironment))
  ) {
    throw new Error('Performance confirmation pool provenance is inconsistent');
  }
  if (
    value.environment?.correctnessGate?.status !== 'passed' ||
    !/^[a-f0-9]{64}$/.test(value.environment?.correctnessGate?.sha256 ?? '')
  ) {
    throw new Error('Performance confirmation lacks a pinned passed correctness gate');
  }
  if (Object.values(value.environment?.parentCiMarkers ?? {}).some(isActiveCiValue)) {
    throw new Error('Performance confirmation recorded an active CI marker');
  }
  if ((value.hostAdmissionAttempts ?? []).length < value.runs.length) {
    throw new Error('Performance confirmation lacks per-child host-admission provenance');
  }
  if ((value.hostPolicyViolations ?? []).length > 0 || (value.validationErrors ?? []).length > 0) {
    throw new Error('Performance confirmation contains host or validation failures');
  }
  for (const definition of value.matrix.cases) {
    if ((definition.warmups ?? 0) !== 0 || definition.repeats !== 10) {
      throw new Error(`${definition.name} is not a ten-block no-warmup confirmation`);
    }
    for (const variant of definition.variants) {
      const count = value.runs.filter(
        (run) => run.name === definition.name && run.variant === variant,
      ).length;
      if (count !== 10) {
        throw new Error(`${definition.name}/${variant} has ${count} runs, expected 10`);
      }
    }
  }
  for (const run of value.runs) {
    for (const [name, metric] of [
      ['totalElapsedMs', run.totalElapsedMs],
      ['cpuUserMs', run.cpuUserMs],
      ['cpuSystemMs', run.cpuSystemMs],
      ['peakRssBytes', run.peakRssBytes],
    ]) {
      if (!Number.isFinite(metric) || metric < 0 || (name !== 'cpuSystemMs' && metric === 0)) {
        throw new Error(`${run.name}/${run.variant} has invalid ${name}: ${metric}`);
      }
    }
    if (
      run.measurementMode !== 'measurement' ||
      JSON.stringify(normalizeRuntimeProfile(run.runtimeProfile)) !==
        JSON.stringify(expectedRuntime) ||
      JSON.stringify(normalizePoolEnvironment(run.poolEnvironment)) !==
        JSON.stringify(expectedPools)
    ) {
      throw new Error(`${run.name}/${run.variant} has inconsistent runtime provenance`);
    }
    const start = evaluateStartAdmission(value.matrix.hostPolicy, run.hostBefore);
    const child = evaluateChildHostPolicy(value.matrix.hostPolicy, run.hostBefore, run.hostAfter);
    if (
      start.immediate.length > 0 ||
      start.transient.length > 0 ||
      child.length > 0 ||
      (run.hostPolicyViolations ?? []).length > 0
    ) {
      throw new Error(`${run.name}/${run.variant} failed frozen host admission`);
    }
  }
}

function environmentPolicySignature(environment) {
  if (!hasCompleteEnvironmentProvenance(environment)) return undefined;
  return JSON.stringify({
    childCiMarkersCleared: [...environment.childCiMarkersCleared].sort(),
    childInputRunLinkCheck: environment.childInputRunLinkCheck,
    runCaseProfilePolicy: environment.runCaseProfilePolicy,
  });
}

function isActiveCiValue(value) {
  return (
    value !== null &&
    value !== undefined &&
    !['', '0', 'false'].includes(String(value).toLowerCase())
  );
}
