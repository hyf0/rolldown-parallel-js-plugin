import { readFile, writeFile } from 'node:fs/promises';
import nodePath from 'node:path';
import {
  evaluateChildHostPolicy,
  evaluateStartAdmission,
  validateFrozenPerformanceHostPolicy,
} from './local-host-policy.mjs';
import { normalizePoolEnvironment } from './pool-environment.mjs';
import { LIFECYCLE_FIXED_RUNTIME_PROFILE, normalizeRuntimeProfile } from './runtime-profile.mjs';
import { loadScaleManifest } from './scale-corpus.mjs';
import { EXPECTED_COMPILER_ENVIRONMENT } from './environment-provenance.mjs';
import { requireCurrentEvidenceProvenance } from './evidence-provenance.mjs';

const coverageOnly = process.argv[2] === '--verify-coverage';
const inputArgument = process.argv[coverageOnly ? 3 : 2];
const outputArgument = process.argv[coverageOnly ? 4 : 3];
if (!inputArgument) {
  throw new Error('Usage: node summarize-graph-matrix.mjs <raw-report.json> [summary.json]');
}
const inputPath = nodePath.resolve(inputArgument);
const outputPath = outputArgument ? nodePath.resolve(outputArgument) : undefined;
const report = JSON.parse(await readFile(inputPath, 'utf8'));
const scaleManifest = await loadScaleManifest();
if (coverageOnly) {
  validateExactGraphCoverage(report);
  console.log(JSON.stringify({ valid: true, cases: report.config.cases.length, runs: report.runs.length }));
  process.exit(0);
}
await requireCurrentEvidenceProvenance(
  report.environment,
  report.runner,
  report.caseRunner,
  'run-graph-matrix.mjs',
  'run-graph-case.mjs',
);
if (report.kind !== 'local-graph-formal-matrix' || report.executionScope !== 'local-only') {
  throw new Error('Expected a local graph formal matrix report');
}
validateConclusionReport(report);
if ((report.validationErrors ?? []).length !== 0) {
  throw new Error(
    `Cannot summarize a report with validation errors: ${report.validationErrors.join('; ')}`,
  );
}

const bootstrapIterations = report.config.summary?.bootstrapIterations ?? 100_000;
const bootstrapSeed = report.config.summary?.bootstrapSeed ?? 0x20260712;
if (
  !Number.isInteger(bootstrapIterations) ||
  bootstrapIterations < 1_000 ||
  !Number.isInteger(bootstrapSeed)
) {
  throw new Error('Invalid bootstrap settings in matrix config');
}
const hostPolicyViolations = [
  ...(report.hostPolicyViolations ?? []).map((message) => ({
    scope: 'matrix',
    message,
  })),
  ...report.runs.flatMap((run) =>
    (run.hostPolicyViolations ?? []).map((message) => ({
      scope: 'run',
      name: run.name,
      index: run.index,
      variant: run.variant,
      message,
    })),
  ),
];
const environmentProvenanceComplete = hasCompleteEnvironmentProvenance(report.environment);
const activeParentCiMarkers = Object.entries(report.environment?.parentCiMarkers ?? {})
  .filter(([, value]) => isActiveCiValue(value))
  .map(([name, value]) => ({ name, value }));
const effectiveRunLinkCheckRecorded = report.runs.every(
  (run) => typeof run.runLinkCheck === 'boolean',
);
const effectiveRunLinkCheckDisabled = report.runs.every((run) => run.runLinkCheck === false);
const benchmarkIneligibilityReasons = [];
if (!report.runner?.sha256) {
  benchmarkIneligibilityReasons.push('runner source-hash provenance is missing');
}
if (!report.caseRunner?.sha256) {
  benchmarkIneligibilityReasons.push('case-runner source-hash provenance is missing');
}
if (!environmentProvenanceComplete) {
  benchmarkIneligibilityReasons.push('execution-environment provenance is missing');
}
if (activeParentCiMarkers.length > 0) {
  benchmarkIneligibilityReasons.push(
    `${activeParentCiMarkers.length} active parent CI marker(s) were recorded`,
  );
}
if (!effectiveRunLinkCheckRecorded) {
  benchmarkIneligibilityReasons.push(
    'effective RUN_LINK_CHECK state is missing from one or more runs',
  );
} else if (!effectiveRunLinkCheckDisabled) {
  benchmarkIneligibilityReasons.push('RUN_LINK_CHECK was enabled in one or more runs');
}
if (hostPolicyViolations.length > 0) {
  benchmarkIneligibilityReasons.push(`${hostPolicyViolations.length} host-policy violation(s)`);
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
      hostEvents: summarizeHostEvents(selected),
    };
  }

  const byVariantAndIndex = new Map(runs.map((run) => [`${run.variant}\0${run.index}`, run]));
  const count = report.config.selectedWorkerCount;
  const pairDefinitions = [
    ['ordinary', `managed-${count}`],
    ['ordinary', `worker-${count}`],
    [`managed-${count}`, `worker-${count}`],
  ];
  const paired = {};
  for (const [baselineVariant, candidateVariant] of pairDefinitions) {
    if (!variants[baselineVariant] || !variants[candidateVariant]) continue;
    const pairs = runs
      .filter((run) => run.variant === baselineVariant)
      .map((baseline) => [
        baseline,
        byVariantAndIndex.get(`${candidateVariant}\0${baseline.index}`),
      ]);
    if (pairs.some(([, candidate]) => !candidate)) {
      throw new Error(`${name} is missing a ${baselineVariant}/${candidateVariant} block pair`);
    }
    paired[`${baselineVariant}-to-${candidateVariant}`] = pairedStats(
      pairs,
      bootstrapSeed ^ hashString(`${name}\0${baselineVariant}\0${candidateVariant}`),
    );
  }
  cases.push({ name, variants, paired });
}

const summary = {
  schema: 1,
  kind: 'local-graph-formal-matrix-summary',
  evidenceKind: report.evidenceKind,
  timingEligible: true,
  conclusionEligible: true,
  source: inputPath,
  generatedAt: new Date().toISOString(),
  executionScope: report.executionScope,
  benchmarkEligible: benchmarkIneligibilityReasons.length === 0,
  benchmarkIneligibilityReasons,
  provenance: {
    runnerSourceHashRecorded: Boolean(report.runner?.sha256),
    caseRunnerSourceHashRecorded: Boolean(report.caseRunner?.sha256),
    executionEnvironmentRecorded: environmentProvenanceComplete,
    activeParentCiMarkers,
    effectiveRunLinkCheckRecorded,
  },
  bootstrap: {
    iterations: bootstrapIterations,
    seed: bootstrapSeed,
    statistic: 'paired median',
  },
  pairedMetricDefinitions: {
    wallSpeedup: 'baseline wall time / candidate wall time',
    cpuRatio: 'candidate CPU time / baseline CPU time',
    peakRssRatio: 'candidate peak RSS / baseline peak RSS',
  },
  host: {
    atStart: report.host.atStart,
    atFinish: report.host.atFinish,
    policyViolations: hostPolicyViolations,
    events: summarizeHostEvents(report.runs),
  },
  rawDifferences: report.rawDifferences,
  parity: report.parity,
  cases,
};
const serialized = `${JSON.stringify(summary, null, 2)}\n`;
if (outputPath) await writeFile(outputPath, serialized);
else process.stdout.write(serialized);

function pairedStats(pairs, seed) {
  const wallSpeedups = pairs.map(
    ([baseline, candidate]) => baseline.totalElapsedMs / candidate.totalElapsedMs,
  );
  const cpuRatios = pairs.map(
    ([baseline, candidate]) =>
      (candidate.cpuUserMs + candidate.cpuSystemMs) / (baseline.cpuUserMs + baseline.cpuSystemMs),
  );
  const peakRssRatios = pairs.map(
    ([baseline, candidate]) => candidate.peakRssBytes / baseline.peakRssBytes,
  );
  return {
    blocks: pairs.length,
    wallSpeedup: metricWithInterval(wallSpeedups, seed ^ 0x77616c6c),
    cpuRatio: metricWithInterval(cpuRatios, seed ^ 0x63707500),
    peakRssRatio: metricWithInterval(peakRssRatios, seed ^ 0x72737300),
  };
}

function metricWithInterval(values, seed) {
  return {
    ...stats(values),
    bootstrap95: bootstrapMedian(values, bootstrapIterations, seed),
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

function bootstrapMedian(values, iterations, seed) {
  const random = mulberry32(seed >>> 0);
  const medians = [];
  for (let iteration = 0; iteration < iterations; iteration++) {
    const sample = Array.from(
      { length: values.length },
      () => values[Math.floor(random() * values.length)],
    ).sort((left, right) => left - right);
    medians.push(quantile(sample, 0.5));
  }
  medians.sort((left, right) => left - right);
  return {
    lower: quantile(medians, 0.025),
    upper: quantile(medians, 0.975),
  };
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

function hashString(value) {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function summarizeHostEvents(runs) {
  const counters = {};
  for (const field of [
    'pageins',
    'pageouts',
    'swapins',
    'swapouts',
    'compressions',
    'decompressions',
  ]) {
    const values = runs
      .map((run) => run.hostDeltas.virtualMemoryCounters[field])
      .filter(Number.isFinite);
    counters[field] = {
      samples: values.length,
      samplesWithIncrease: values.filter((value) => value > 0).length,
      totalDeltaPages: values.reduce((sum, value) => sum + value, 0),
      maxDeltaPages: values.length === 0 ? undefined : Math.max(...values),
    };
  }
  const swapUsedDeltas = runs.map((run) => run.hostDeltas.swapUsedBytes).filter(Number.isFinite);
  return {
    virtualMemoryCounters: counters,
    swapUsedBytes: {
      samples: swapUsedDeltas.length,
      samplesWithIncrease: swapUsedDeltas.filter((value) => value > 0).length,
      totalDelta: swapUsedDeltas.reduce((sum, value) => sum + value, 0),
      maxDelta: swapUsedDeltas.length === 0 ? undefined : Math.max(...swapUsedDeltas),
    },
  };
}

function hasCompleteEnvironmentProvenance(environment) {
  if (
    !environment?.parentCiMarkers ||
    !Array.isArray(environment.childCiMarkersCleared) ||
    !Object.hasOwn(environment, 'childInputRunLinkCheck') ||
    environment.childInputRunLinkCheck !== null ||
    environment.runCaseRunLinkCheck !== false
  ) {
    return false;
  }
  const cleared = new Set(environment.childCiMarkersCleared);
  return (
    environment.runtimeProfile?.kind === 'lifecycle-fixed-baseline' &&
    same(environment.compilerEnvironment, EXPECTED_COMPILER_ENVIRONMENT) &&
    environment.harnessSourceManifest?.sourceCount > 0 &&
    /^[a-f0-9]{64}$/.test(environment.harnessSourceManifest?.selectionSha256 ?? '') &&
    environment.correctnessGate?.status === 'passed' &&
    /^[a-f0-9]{64}$/.test(environment.correctnessGate?.sha256 ?? '') &&
    environment.childPoolEnvironment &&
    Object.keys(environment.parentCiMarkers).every((name) => cleared.has(name))
  );
}

function validateConclusionReport(value) {
  if (
    value.evidenceKind !== 'performance-confirmation' ||
    value.measurementFieldsPresent !== true ||
    value.timingEligible !== true ||
    value.conclusionEligible !== true ||
    value.config?.evidenceKind !== 'performance-confirmation'
  ) {
    throw new Error('Graph summary requires a repeated performance-confirmation report');
  }
  if (
    !Number.isInteger(value.config.selectedWorkerCount) ||
    value.config.selectedWorkerCount < 1 ||
    value.config.selectedWorkerCount > 8
  ) {
    throw new Error('Graph report does not pin the screened worker count');
  }
  validateExactGraphCoverage(value);
  validateFrozenPerformanceHostPolicy(value.config.hostPolicy);
  const runtime = normalizeRuntimeProfile(value.environment?.runtimeProfile);
  if (JSON.stringify(runtime) !== JSON.stringify(LIFECYCLE_FIXED_RUNTIME_PROFILE)) {
    throw new Error('Graph report did not use the lifecycle-fixed baseline');
  }
  const pools = normalizePoolEnvironment(value.config.poolEnvironment);
  if (
    JSON.stringify(pools) !==
    JSON.stringify(normalizePoolEnvironment(value.environment?.childPoolEnvironment))
  ) {
    throw new Error('Graph report pool provenance is inconsistent');
  }
  if (
    value.environment?.correctnessGate?.status !== 'passed' ||
    !/^[a-f0-9]{64}$/.test(value.environment?.correctnessGate?.sha256 ?? '')
  ) {
    throw new Error('Graph report lacks the passed correctness gate');
  }
  if ((value.hostAdmissionAttempts ?? []).length < value.runs.length) {
    throw new Error('Graph report lacks per-child host admission');
  }
  for (const definition of value.config.cases) {
    if ((definition.warmups ?? 0) !== 0 || definition.repeats !== 10) {
      throw new Error(`${definition.name} is not a ten-block graph confirmation`);
    }
  }
  for (const run of value.runs) {
    for (const metric of [run.totalElapsedMs, run.cpuUserMs, run.cpuSystemMs, run.peakRssBytes]) {
      if (!Number.isFinite(metric) || metric < 0) {
        throw new Error(`${run.name}/${run.variant} has non-finite metrics`);
      }
    }
    if (
      JSON.stringify(normalizeRuntimeProfile(run.runtimeProfile)) !== JSON.stringify(runtime) ||
      JSON.stringify(normalizePoolEnvironment(run.poolEnvironment)) !== JSON.stringify(pools)
    ) {
      throw new Error(`${run.name}/${run.variant} has inconsistent provenance`);
    }
    const start = evaluateStartAdmission(value.config.hostPolicy, run.hostBefore);
    const child = evaluateChildHostPolicy(value.config.hostPolicy, run.hostBefore, run.hostAfter);
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

function validateExactGraphCoverage(value) {
  const count = value.config.selectedWorkerCount;
  const crossover = value.config.confirmedCrossoverPoint;
  if (!Number.isInteger(crossover) || crossover < 1 || crossover >= 9_157) {
    throw new Error('Graph report does not pin a confirmed crossover point below 9,157');
  }
  const variants = ['ordinary', `managed-${count}`, `worker-${count}`];
  const definitions = [
    {
      name: `cloudflare-mdx-graph-confirmed-crossover-${crossover}`,
      graphPoint: 'confirmed-crossover',
      selectionScale: crossover,
      startIndex: 0,
    },
    {
      name: 'cloudflare-mdx-graph-full-9157',
      graphPoint: 'full-corpus',
      selectionScale: 9_157,
      startIndex: 10,
    },
  ];
  if (value.config.cases?.length !== definitions.length || value.runs?.length !== 60) {
    throw new Error('Graph report must contain exactly two cases and 60 measured runs');
  }
  for (const [position, expected] of definitions.entries()) {
    const definition = value.config.cases[position];
    const expectedPrefix = scaleManifest.prefixes[String(expected.selectionScale)]?.selectionSha256;
    if (
      !/^[a-f0-9]{64}$/.test(expectedPrefix ?? '') ||
      definition.name !== expected.name ||
      definition.graphPoint !== expected.graphPoint ||
      definition.corpus !== 'cloudflare-mdx-scale-v1' ||
      definition.selectionScale !== expected.selectionScale ||
      definition.selectionPrefixSha256 !== expectedPrefix ||
      definition.startIndex !== expected.startIndex ||
      definition.repeats !== 10 ||
      (definition.warmups ?? 0) !== 0 ||
      definition.instrumentation !== false ||
      definition.measurementMode !== 'measurement' ||
      !same(definition.variants, variants)
    ) {
      throw new Error(`Graph ${expected.graphPoint} definition is incomplete`);
    }
    const selected = value.runs.filter(({ name }) => name === expected.name);
    if (selected.length !== 30) {
      throw new Error(`Graph ${expected.graphPoint} case has ${selected.length}/30 runs`);
    }
    for (let index = expected.startIndex; index < expected.startIndex + 10; index++) {
      const block = selected.filter((run) => run.index === index);
      if (block.length !== 3 || !same(block.map(({ variant }) => variant).sort(), [...variants].sort())) {
        throw new Error(`Graph ${expected.graphPoint} block ${index} is incomplete`);
      }
    }
    for (const run of selected) {
      if (
        run.selection?.scale !== expected.selectionScale ||
        run.selection?.prefixSha256 !== expectedPrefix ||
        run.measurementMode !== 'measurement'
      ) {
        throw new Error(`Graph ${expected.graphPoint}/${run.variant} selection differs`);
      }
    }
    const parityFields = [
      'graphProfile', 'instrumentation', 'transformedEntryCount', 'selection',
      'codeModuleCount', 'codeOnlyModules', 'graphWithoutObservedCode', 'graphModuleCount',
      'graphStaticEdges', 'graphDynamicEdges', 'graphProjectStaticEdges',
      'graphExternalStaticEdges', 'graphNonProjectInternalStaticEdges',
      'graphNonProjectInternalIds', 'graphHash', 'moduleKindCounts', 'boundaryHash', 'boundary',
      'outputChunks', 'outputAssets', 'normalizedOutputBytes', 'normalizedOutputHash',
      'outputNormalization',
    ];
    for (const field of parityFields) {
      if (new Set(selected.map((run) => JSON.stringify(run[field]))).size !== 1) {
        throw new Error(`Graph ${expected.graphPoint} raw runs differ for ${field}`);
      }
    }
    const rawDifferences = ['codeHash', 'outputBytes', 'outputHash'].flatMap((field) => {
      const values = Object.fromEntries(
        variants.map((variant) => [
          variant,
          [...new Set(selected.filter((run) => run.variant === variant).map((run) => JSON.stringify(run[field])))],
        ]),
      );
      return new Set(Object.values(values).flat()).size === 1
        ? []
        : [{ name: expected.name, field, values }];
    });
    const recomputedParity = {
      name: expected.name,
      graph: true,
      boundary: true,
      normalizedOutput: true,
      moduleMetadataPattern: true,
      rawParityRequired: false,
      fields: parityFields,
      mdxAstroMetaModules: Object.fromEntries(
        variants.map((variant) => [
          variant,
          [...new Set(selected.filter((run) => run.variant === variant).map((run) => run.mdxAstroMetaModules))],
        ]),
      ),
      rawDifferences,
    };
    const expectedMetadata = {
      ordinary: [expected.selectionScale],
      [`managed-${count}`]: [expected.selectionScale],
      [`worker-${count}`]: [0],
    };
    if (
      !same(recomputedParity.mdxAstroMetaModules, expectedMetadata) ||
      !same(value.parity[position], recomputedParity)
    ) {
      throw new Error(`Graph ${expected.graphPoint} parity claim is not derived from all raw runs`);
    }
  }
  if (
    value.runs.some((run) => !definitions.some(({ name }) => name === run.name)) ||
    !same(value.parity?.map(({ name }) => name), definitions.map(({ name }) => name))
  ) {
    throw new Error('Graph report contains missing or unexpected cases');
  }
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isActiveCiValue(value) {
  return (
    value !== null &&
    value !== undefined &&
    !['', '0', 'false'].includes(String(value).toLowerCase())
  );
}
