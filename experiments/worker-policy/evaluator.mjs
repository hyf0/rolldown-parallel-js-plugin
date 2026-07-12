import { FORMAL_SOURCE_TYPES } from './formal-source-contracts.mjs';

export const CURRENT_PROTOCOL_REVISION = 'scale-crossover-v1-amended-7';

export const POLICY_GATES = Object.freeze({
  maximumWallRegretRatio: 1.05,
  maximumCpuRatioToOracle: 1.1,
  maximumRssRatioToOracle: 1.1,
  maximumSmallMedianRegressionRatio: 1.03,
  maximumSmallBootstrapUpperRegressionRatio: 1.05,
});

const REQUIRED_PROTOCOL_DOCUMENTS = Object.freeze([
  '.agents/docs/scale-crossover-frozen-protocol.md',
  ...Array.from(
    { length: 7 },
    (_value, index) =>
      `.agents/docs/scale-crossover-protocol-amendment-${index + 1}.md`,
  ),
]);
const REQUIRED_BUILDER_SOURCES = Object.freeze([
  'experiments/worker-policy/build-fixed-policy-evidence.mjs',
  'experiments/worker-policy/capture-machine-topology.mjs',
  'experiments/worker-policy/evaluate-fixed-policy.mjs',
  'experiments/worker-policy/evaluator.mjs',
  'experiments/worker-policy/evidence-artifacts.mjs',
  'experiments/worker-policy/evidence-builder.mjs',
  'experiments/worker-policy/formal-source-contracts.mjs',
  'experiments/cloudflare-mdx/generate-mdx-policy.mjs',
  'experiments/cloudflare-mdx/generate-scale-followup.mjs',
  'experiments/cloudflare-mdx/mdx-policy.mjs',
  'experiments/cloudflare-mdx/policy-node-launcher.mjs',
  'experiments/cloudflare-mdx/run-case.mjs',
  'experiments/cloudflare-mdx/run-matrix.mjs',
  'experiments/cloudflare-mdx/run-policy-matrix.mjs',
  'experiments/cloudflare-mdx/scale-followup.mjs',
  'experiments/cloudflare-mdx/scale-corpus.mjs',
  'experiments/cloudflare-mdx/local-host-policy.mjs',
  'experiments/cloudflare-mdx/pool-environment.mjs',
  'experiments/cloudflare-mdx/runtime-profile.mjs',
  'experiments/cloudflare-mdx/data/cloudflare-mdx-scale-v1.json',
  'experiments/cloudflare-mdx/summarize-policy-matrix.mjs',
  'experiments/cpu-rate-control/cpulimit-provenance.mjs',
  'experiments/cpu-rate-control/run-calibration.mjs',
  'experiments/cpu-rate-control/cpu-load.mjs',
  'experiments/cpu-rate-control/cpulimit-apple.patch',
]);
const CASE_FAMILIES = new Set([
  'vue-controlled',
  'vue-project',
  'mdx',
  'svelte',
]);
const SCALE_ROLES = new Set([
  'small-negative',
  'crossover-lower',
  'crossover',
  'crossover-confirm',
  'full',
  'independent-small',
  'independent-medium',
  'independent-large',
]);
const STUDIES = new Set([
  'baseline',
  'allocation-tokio-confirmation',
  'allocation-rayon-confirmation',
  'cpu-rate-confirmation',
]);
const SOURCE_STUDIES = Object.freeze({
  baseline: null,
  'allocation-tokio-confirmation': 'allocation-tokio-confirmation',
  'allocation-rayon-confirmation': 'allocation-rayon-confirmation',
  'cpu-rate-confirmation': 'quota-confirmation',
});
const POLICY_METRICS = Object.freeze([
  'wallMedianMs',
  'cpuMedianMs',
  'peakRssMedianBytes',
  'resourceEligible',
  'pairedWallRatioToOrdinaryBootstrap95Upper',
]);
const POOL_KEYS = Object.freeze([
  'ROLLDOWN_WORKER_THREADS',
  'RAYON_NUM_THREADS',
  'ROLLDOWN_MAX_BLOCKING_THREADS',
]);

export function evaluateFixedWorkerPolicies(
  evidence,
  { sourceBindingsVerified = false } = {},
) {
  validateEvidence(evidence);
  const candidateCounts = {
    fixedFour: evidence.candidatePolicy.fixedFour.workerCount,
    hardwareCap: Math.min(
      evidence.machine.availableParallelism,
      evidence.candidatePolicy.hardwareCap.workerSafetyCap,
    ),
  };
  const cases = evidence.cases.map(evaluateCase);
  const candidates = Object.fromEntries(
    Object.entries(candidateCounts).map(([name, workerCount]) => [
      name,
      evaluateCandidate(name, workerCount, cases),
    ]),
  );
  const formalCoveragePassed =
    evidence.formalCoverage && sourceBindingsVerified;
  const passingLocalCandidates = Object.values(candidates)
    .filter(({ passed }) => passed)
    .map(({ name, workerCount }) => ({ name, workerCount }));
  return {
    schemaVersion: 2,
    kind: 'rolldown-fixed-worker-policy-evaluation',
    protocol: evidence.protocol,
    gates: POLICY_GATES,
    repository: evidence.repository,
    protocolDocuments: evidence.protocolDocuments,
    candidatePolicy: evidence.candidatePolicy,
    sourceReports: evidence.sourceReports,
    machine: evidence.machine,
    cases,
    candidates,
    formalCoveragePassed,
    sourceBindingsVerified,
    localFixedPolicyGate: {
      passed: formalCoveragePassed && passingLocalCandidates.length > 0,
      passingCandidates: formalCoveragePassed ? passingLocalCandidates : [],
      machineCount: 1,
    },
    shippableAutomaticFixedPolicy: false,
    portabilityBoundary: {
      crossMachineEvidencePresent: false,
      conclusion:
        'This iteration can pass or falsify a predeclared fixed count on the frozen local M3 Pro. It cannot establish a user-wide hardware heuristic from one machine.',
    },
    unchangedRuntimeBoundary: {
      ordinaryFallbackAvailableAfterPoolCreation: false,
      workerPoolResizableAfterCreation: false,
      onlineQueuePolicyCanBeValidated: false,
      conclusion:
        'The unchanged runtime can validate or falsify fixed startup counts and inspect queue signals offline; it cannot establish a progressive policy.',
    },
  };
}

function evaluateCase(value) {
  const variants = new Map(
    value.variants.map((variant) => [variant.workerCount, variant]),
  );
  const resourceWorkers = value.variants.filter(
    ({ workerCount, resourceEligible }) => workerCount > 0 && resourceEligible,
  );
  const oracle = variants.get(value.oracleWorkerCount);
  if (!oracle?.resourceEligible) {
    throw new Error(
      `${value.id} names a missing or resource-ineligible oracle`,
    );
  }
  if (resourceWorkers.length === 0 && value.oracleWorkerCount !== 0) {
    throw new Error(
      `${value.id} must use ordinary when no worker is resource eligible`,
    );
  }
  if (resourceWorkers.length > 0 && value.oracleWorkerCount === 0) {
    throw new Error(
      `${value.id} cannot use ordinary while a resource-eligible worker exists`,
    );
  }
  if (resourceWorkers.length > 0) {
    const fastestWall = Math.min(
      ...resourceWorkers.map(({ wallMedianMs }) => wallMedianMs),
    );
    if ((oracle.wallMedianMs - fastestWall) / fastestWall >= 0.02) {
      throw new Error(
        `${value.id} oracle is outside the frozen below-two-percent tie window`,
      );
    }
  }
  const ordinary = variants.get(0);
  if (!ordinary) throw new Error(`${value.id} omits ordinary execution`);
  if (value.ordinaryBestSmallCase && oracle.workerCount !== 0) {
    throw new Error(
      `${value.id} is labelled ordinary-best but worker-${oracle.workerCount} wins`,
    );
  }
  return {
    ...value,
    oracle: {
      workerCount: oracle.workerCount,
      wallMedianMs: oracle.wallMedianMs,
      cpuMedianMs: oracle.cpuMedianMs,
      peakRssMedianBytes: oracle.peakRssMedianBytes,
    },
  };
}

function evaluateCandidate(name, workerCount, cases) {
  const results = cases.map((testCase) => {
    const candidate = testCase.variants.find(
      (variant) => variant.workerCount === workerCount,
    );
    if (!candidate) {
      return {
        caseId: testCase.id,
        passed: false,
        failures: [`worker-${workerCount} evidence is missing`],
      };
    }
    const ordinary = testCase.variants.find(
      ({ workerCount: count }) => count === 0,
    );
    const wallRegretRatio =
      candidate.wallMedianMs / testCase.oracle.wallMedianMs;
    const cpuRatioToOracle =
      candidate.cpuMedianMs / testCase.oracle.cpuMedianMs;
    const rssRatioToOracle =
      candidate.peakRssMedianBytes / testCase.oracle.peakRssMedianBytes;
    const ordinaryMedianRegressionRatio =
      candidate.wallMedianMs / ordinary.wallMedianMs;
    const smallUpper = candidate.pairedWallRatioToOrdinaryBootstrap95Upper;
    const failures = [];
    // The ordinary-best small case deliberately has no resource-eligible worker. A fixed
    // candidate is still allowed to pass the separately frozen 3% median and 5% bootstrap
    // small-case limits; this does not make that worker the resource oracle.
    if (!candidate.resourceEligible && testCase.oracle.workerCount !== 0) {
      failures.push('candidate is not resource eligible');
    }
    if (wallRegretRatio > POLICY_GATES.maximumWallRegretRatio) {
      failures.push(
        `wall regret ${wallRegretRatio.toFixed(6)} exceeds ${POLICY_GATES.maximumWallRegretRatio}`,
      );
    }
    if (cpuRatioToOracle > POLICY_GATES.maximumCpuRatioToOracle) {
      failures.push(
        `CPU ratio ${cpuRatioToOracle.toFixed(6)} exceeds ${POLICY_GATES.maximumCpuRatioToOracle}`,
      );
    }
    if (rssRatioToOracle > POLICY_GATES.maximumRssRatioToOracle) {
      failures.push(
        `RSS ratio ${rssRatioToOracle.toFixed(6)} exceeds ${POLICY_GATES.maximumRssRatioToOracle}`,
      );
    }
    if (testCase.ordinaryBestSmallCase) {
      if (
        ordinaryMedianRegressionRatio >
        POLICY_GATES.maximumSmallMedianRegressionRatio
      ) {
        failures.push(
          `small-case median regression ${ordinaryMedianRegressionRatio.toFixed(6)} exceeds ${POLICY_GATES.maximumSmallMedianRegressionRatio}`,
        );
      }
      if (smallUpper > POLICY_GATES.maximumSmallBootstrapUpperRegressionRatio) {
        failures.push(
          `small-case bootstrap upper ${smallUpper.toFixed(6)} exceeds ${POLICY_GATES.maximumSmallBootstrapUpperRegressionRatio}`,
        );
      }
    }
    return {
      caseId: testCase.id,
      family: testCase.family,
      study: testCase.study,
      scale: testCase.scale,
      scaleRole: testCase.scaleRole,
      scaleRoles: testCase.scaleRoles,
      cpuRatePercent: testCase.cpuRatePercent,
      poolEnvironment: testCase.poolEnvironment,
      candidateWorkerCount: workerCount,
      oracleWorkerCount: testCase.oracle.workerCount,
      wallRegretRatio,
      cpuRatioToOracle,
      rssRatioToOracle,
      ordinaryMedianRegressionRatio,
      pairedWallRatioToOrdinaryBootstrap95Upper: smallUpper,
      passed: failures.length === 0,
      failures,
    };
  });
  return {
    name,
    workerCount,
    passed: results.every(({ passed }) => passed),
    failedCaseCount: results.filter(({ passed }) => !passed).length,
    results,
  };
}

export function validateEvidence(value) {
  if (
    value?.schemaVersion !== 2 ||
    value.kind !== 'rolldown-fixed-worker-policy-evidence' ||
    value.protocol !== CURRENT_PROTOCOL_REVISION ||
    typeof value.formalCoverage !== 'boolean' ||
    !validRepositoryRecord(value.repository) ||
    !validProtocolDocuments(value.protocolDocuments) ||
    !validCandidatePolicy(value.candidatePolicy) ||
    !validMachine(value.machine) ||
    !Array.isArray(value.sourceReports) ||
    value.sourceReports.length === 0 ||
    !Array.isArray(value.cases) ||
    value.cases.length === 0
  ) {
    throw new Error('invalid fixed-worker policy evidence header');
  }
  validateSourceReports(value.sourceReports);
  if (
    value.formalCoverage &&
    value.sourceReports.some(
      ({ sourceType }) => !FORMAL_SOURCE_TYPES.includes(sourceType),
    )
  ) {
    throw new Error(
      'formal fixed-policy evidence contains an unknown source type',
    );
  }
  if (
    value.machine.sourceReportIndex < 0 ||
    value.machine.sourceReportIndex >= value.sourceReports.length ||
    value.machine.sourceReportId !==
      value.sourceReports[value.machine.sourceReportIndex].id
  ) {
    throw new Error(
      'fixed-policy machine binding names a missing source report',
    );
  }
  const ids = new Set();
  const sourcePolicyBindings = new Set();
  for (const testCase of value.cases) {
    validateCase(testCase, value, ids);
    const key = `${testCase.sourceReportIndex}\0${testCase.sourceBindings.policyEvidence}`;
    if (sourcePolicyBindings.has(key)) {
      throw new Error(
        `${testCase.id} reuses a policyEvidence block already counted by another case`,
      );
    }
    sourcePolicyBindings.add(key);
  }
  if (value.formalCoverage) {
    validateFormalCoverage(value.cases);
    if (
      value.machine.availableParallelism !== 12 ||
      value.machine.workerSafetyCap !== 8 ||
      value.machine.performanceCores !== 6 ||
      value.machine.efficiencyCores !== 6 ||
      value.machine.cpuModel !== 'Apple M3 Pro' ||
      value.machine.node !== 'v24.18.0'
    ) {
      throw new Error(
        'formal fixed-policy evidence does not match the frozen local M3 Pro host',
      );
    }
  }
}

function validateCase(testCase, evidence, ids) {
  if (
    typeof testCase?.id !== 'string' ||
    testCase.id.length === 0 ||
    ids.has(testCase.id) ||
    !CASE_FAMILIES.has(testCase.family) ||
    !STUDIES.has(testCase.study) ||
    testCase.sourceStudy !== SOURCE_STUDIES[testCase.study] ||
    typeof testCase.scale !== 'string' ||
    !['number', 'string'].includes(typeof testCase.scaleValue) ||
    !SCALE_ROLES.has(testCase.scaleRole) ||
    !Array.isArray(testCase.scaleRoles) ||
    testCase.scaleRoles.length < 1 ||
    testCase.scaleRoles.length > 2 ||
    new Set(testCase.scaleRoles).size !== testCase.scaleRoles.length ||
    !testCase.scaleRoles.includes(testCase.scaleRole) ||
    testCase.scaleRoles.some((role) => !SCALE_ROLES.has(role)) ||
    ![null, 400, 800, 1200].includes(testCase.cpuRatePercent) ||
    typeof testCase.ordinaryBestSmallCase !== 'boolean' ||
    testCase.heldOut !== true ||
    testCase.heldOutFromCandidateFitting !== true ||
    !Number.isSafeInteger(testCase.oracleWorkerCount) ||
    testCase.oracleWorkerCount < 0 ||
    testCase.oracleWorkerCount > 8 ||
    !Number.isSafeInteger(testCase.sourceReportIndex) ||
    testCase.sourceReportIndex < 0 ||
    testCase.sourceReportIndex >= evidence.sourceReports.length ||
    testCase.sourceReportId !==
      evidence.sourceReports[testCase.sourceReportIndex].id ||
    !validCaseBindings(testCase.sourceBindings, testCase.study) ||
    !Array.isArray(testCase.variants) ||
    testCase.variants.length < 3 ||
    testCase.variants.length > 9
  ) {
    throw new Error(
      `invalid fixed-worker policy case: ${testCase?.id ?? '<unnamed>'}`,
    );
  }
  if (
    testCase.study === 'cpu-rate-confirmation' &&
    testCase.cpuRatePercent === null
  ) {
    throw new Error(`${testCase.id} omits its CPU-rate setting`);
  }
  if (
    testCase.study !== 'cpu-rate-confirmation' &&
    testCase.cpuRatePercent !== null
  ) {
    throw new Error(
      `${testCase.id} assigns a CPU rate outside the quota study`,
    );
  }
  if (
    testCase.sourceBindings.poolEnvironment !== null &&
    (testCase.sourceBindings.poolEnvironment.sourceReportIndex >=
      evidence.sourceReports.length ||
      testCase.sourceBindings.poolEnvironment.sourceReportId !==
        evidence.sourceReports[
          testCase.sourceBindings.poolEnvironment.sourceReportIndex
        ]?.id)
  ) {
    throw new Error(
      `${testCase.id} Rust-pool binding names a missing source report`,
    );
  }
  if (
    testCase.study.startsWith('allocation-') ||
    testCase.study === 'cpu-rate-confirmation'
  ) {
    validatePoolEnvironment(testCase.poolEnvironment, testCase.id);
  } else if (testCase.poolEnvironment !== null) {
    validatePoolEnvironment(testCase.poolEnvironment, testCase.id);
  }
  ids.add(testCase.id);
  const counts = testCase.variants.map(({ workerCount }) => workerCount);
  const requiredCounts = new Set([0, 4, 8, testCase.oracleWorkerCount]);
  if (
    new Set(counts).size !== counts.length ||
    counts.some(
      (count) => !Number.isSafeInteger(count) || count < 0 || count > 8,
    ) ||
    [...requiredCounts].some((count) => !counts.includes(count))
  ) {
    throw new Error(
      `${testCase.id} must contain ordinary, fixed candidates four/eight, and its repeated oracle`,
    );
  }
  for (const variant of testCase.variants)
    validateVariant(variant, testCase.id);
}

function validateVariant(variant, caseId) {
  if (
    !Number.isFinite(variant.wallMedianMs) ||
    variant.wallMedianMs <= 0 ||
    !Number.isFinite(variant.cpuMedianMs) ||
    variant.cpuMedianMs <= 0 ||
    !Number.isFinite(variant.peakRssMedianBytes) ||
    variant.peakRssMedianBytes <= 0 ||
    typeof variant.resourceEligible !== 'boolean' ||
    !Number.isFinite(variant.pairedWallRatioToOrdinaryBootstrap95Upper) ||
    variant.pairedWallRatioToOrdinaryBootstrap95Upper <= 0 ||
    POLICY_METRICS.some(
      (field) => !validPointer(variant.sourceBindings?.[field]),
    )
  ) {
    throw new Error(
      `${caseId}/worker-${variant.workerCount} has incomplete metrics or bindings`,
    );
  }
  if (variant.workerCount === 0) {
    if (
      variant.resourceEligible !== true ||
      variant.pairedWallRatioToOrdinaryBootstrap95Upper !== 1
    ) {
      throw new Error(`${caseId}/ordinary is not the admitted reference`);
    }
  }
}

function validateFormalCoverage(cases) {
  const has = (predicate) => cases.some(predicate);
  const exactOne = (predicate, label) => {
    if (cases.filter(predicate).length !== 1) {
      throw new Error(
        `formal fixed-policy evidence requires exactly one ${label} case`,
      );
    }
  };
  for (const role of [
    'crossover-lower',
    'crossover',
    'crossover-confirm',
    'full',
  ]) {
    for (const family of ['vue-controlled', 'mdx']) {
      exactOne(
        (value) =>
          value.study === 'baseline' &&
          value.family === family &&
          value.scaleRoles.includes(role) &&
          value.cpuRatePercent === null,
        `baseline ${family}/${role}`,
      );
    }
  }
  for (const role of [
    'independent-small',
    'independent-medium',
    'independent-large',
  ]) {
    exactOne(
      (value) =>
        value.study === 'baseline' &&
        value.family === 'vue-project' &&
        value.scaleRoles.includes(role) &&
        value.cpuRatePercent === null,
      `baseline vue-project/${role}`,
    );
  }
  if (!has(({ ordinaryBestSmallCase }) => ordinaryBestSmallCase)) {
    throw new Error(
      'formal fixed-policy evidence omits an ordinary-best small case',
    );
  }
  for (const value of cases.filter(({ study }) => study === 'baseline')) {
    if (
      !isDeepPoolEnvironment(value.poolEnvironment, {
        ROLLDOWN_WORKER_THREADS: '18',
        RAYON_NUM_THREADS: '12',
        ROLLDOWN_MAX_BLOCKING_THREADS: '4',
      })
    ) {
      throw new Error(
        `${value.id} does not source-bind the frozen baseline 18/12/4 pools`,
      );
    }
  }
  const independentScales = [
    'independent-small',
    'independent-medium',
    'independent-large',
  ].map(
    (role) =>
      cases.find(
        (value) =>
          value.study === 'baseline' &&
          value.family === 'vue-project' &&
          value.scaleRoles.includes(role),
      ).scaleValue,
  );
  if (
    independentScales.some((value) => typeof value !== 'number') ||
    JSON.stringify(independentScales) !== JSON.stringify([4, 166, 546])
  ) {
    throw new Error(
      'independent Vue evidence does not match the frozen 4/166/546 SFC bands',
    );
  }
  validateRoleScaleAgreement(cases);
  validateAllocationCoverage(
    cases,
    'allocation-tokio-confirmation',
    'ROLLDOWN_WORKER_THREADS',
  );
  validateAllocationCoverage(
    cases,
    'allocation-rayon-confirmation',
    'RAYON_NUM_THREADS',
  );
  for (const cpuRatePercent of [400, 800, 1200]) {
    for (const scaleRole of ['crossover', 'full']) {
      exactOne(
        (value) =>
          value.study === 'cpu-rate-confirmation' &&
          value.family === 'mdx' &&
          value.cpuRatePercent === cpuRatePercent &&
          value.scaleRoles.includes(scaleRole),
        `MDX ${scaleRole} at ${cpuRatePercent}%`,
      );
    }
  }
  for (const value of cases.filter(
    ({ study }) => study === 'cpu-rate-confirmation',
  )) {
    if (
      !isDeepPoolEnvironment(value.poolEnvironment, {
        ROLLDOWN_WORKER_THREADS: '18',
        RAYON_NUM_THREADS: '12',
        ROLLDOWN_MAX_BLOCKING_THREADS: '4',
      })
    ) {
      throw new Error(
        `${value.id} does not use the frozen baseline Rust pools under quota`,
      );
    }
  }
}

function validateRoleScaleAgreement(cases) {
  for (const family of ['vue-controlled', 'mdx']) {
    const baseline = cases.filter(
      (value) => value.study === 'baseline' && value.family === family,
    );
    const byRole = new Map(
      baseline.flatMap((value) =>
        value.scaleRoles.map((role) => [role, value.scaleValue]),
      ),
    );
    if (
      [...byRole.values()].some((value) => typeof value !== 'number') ||
      !(byRole.get('crossover-lower') < byRole.get('crossover')) ||
      !(byRole.get('crossover') < byRole.get('crossover-confirm')) ||
      !(byRole.get('crossover-confirm') <= byRole.get('full'))
    ) {
      throw new Error(
        `${family} crossover roles are not a strictly ordered repeated boundary`,
      );
    }
    const expectedFull = family === 'vue-controlled' ? 5000 : 9157;
    if (byRole.get('full') !== expectedFull) {
      throw new Error(`${family} full scale must remain ${expectedFull}`);
    }
    if (family !== 'mdx') continue;
    for (const value of cases.filter(
      (candidate) =>
        candidate.family === 'mdx' && candidate.study !== 'baseline',
    )) {
      for (const role of value.scaleRoles) {
        if (byRole.get(role) !== value.scaleValue) {
          throw new Error(
            `${value.id} scale differs from the baseline MDX ${role} point`,
          );
        }
      }
    }
  }
}

function validateAllocationCoverage(cases, study, poolKey) {
  for (const scaleRole of [
    'crossover-lower',
    'crossover',
    'crossover-confirm',
    'full',
  ]) {
    const selected = cases.filter(
      (value) =>
        value.study === study &&
        value.family === 'mdx' &&
        value.scaleRoles.includes(scaleRole),
    );
    const counts = new Set(
      selected.map(({ poolEnvironment }) => poolEnvironment?.[poolKey]),
    );
    const fixedPoolKeys = POOL_KEYS.filter((key) => key !== poolKey);
    const fixedPoolsMatch = fixedPoolKeys.every(
      (key) =>
        new Set(selected.map(({ poolEnvironment }) => poolEnvironment?.[key]))
          .size === 1,
    );
    const frozenCompanionPools =
      selected.every(
        ({ poolEnvironment }) =>
          poolEnvironment.ROLLDOWN_MAX_BLOCKING_THREADS === '4',
      ) &&
      (study !== 'allocation-tokio-confirmation' ||
        selected.every(
          ({ poolEnvironment }) => poolEnvironment.RAYON_NUM_THREADS === '12',
        ));
    if (
      selected.length !== 2 ||
      counts.size !== 2 ||
      !fixedPoolsMatch ||
      !frozenCompanionPools
    ) {
      throw new Error(
        `formal fixed-policy evidence requires two repeated ${study} pool settings at ${scaleRole}`,
      );
    }
  }
}

function isDeepPoolEnvironment(left, right) {
  return POOL_KEYS.every((key) => left?.[key] === right[key]);
}

function validateSourceReports(sources) {
  const ids = new Set();
  const paths = new Set();
  for (let index = 0; index < sources.length; index++) {
    const source = sources[index];
    if (
      typeof source?.id !== 'string' ||
      source.id.length === 0 ||
      ids.has(source.id) ||
      typeof source.path !== 'string' ||
      paths.has(source.path) ||
      !/^reports\/sha256\/[0-9a-f]{64}\.json$/.test(source.path) ||
      !/^[0-9a-f]{64}$/.test(source.sha256 ?? '') ||
      !source.path.includes(source.sha256) ||
      !Number.isSafeInteger(source.bytes) ||
      source.bytes <= 0 ||
      !(
        source.sourceType === null ||
        source.sourceType === undefined ||
        (typeof source.sourceType === 'string' && source.sourceType.length > 0)
      ) ||
      !Array.isArray(source.assertions) ||
      !Array.isArray(source.links)
    ) {
      throw new Error(`invalid fixed-policy source report at index ${index}`);
    }
    for (const assertion of source.assertions) {
      if (
        !validPointer(assertion?.pointer) ||
        !Object.hasOwn(assertion, 'equals')
      ) {
        throw new Error(`${source.id} has an invalid source assertion`);
      }
    }
    for (const link of source.links) {
      if (
        !Number.isSafeInteger(link?.targetSourceReportIndex) ||
        link.targetSourceReportIndex < 0 ||
        link.targetSourceReportIndex >= sources.length ||
        link.targetSourceReportId !==
          sources[link.targetSourceReportIndex]?.id ||
        !validPointer(link.sha256Pointer)
      ) {
        throw new Error(`${source.id} has an invalid lineage link`);
      }
    }
    ids.add(source.id);
    paths.add(source.path);
  }
}

function validRepositoryRecord(value) {
  return (
    /^[0-9a-f]{40,64}$/.test(value?.sourceCommit ?? '') &&
    validArtifactRecord(value?.buildPlan) &&
    validRepoRelativePath(value.buildPlan.path) &&
    Array.isArray(value.builderSources) &&
    value.builderSources.length === REQUIRED_BUILDER_SOURCES.length &&
    value.builderSources.every(
      (record, index) =>
        record?.path === REQUIRED_BUILDER_SOURCES[index] &&
        validArtifactRecord(record),
    )
  );
}

function validProtocolDocuments(value) {
  return (
    Array.isArray(value) &&
    value.length === REQUIRED_PROTOCOL_DOCUMENTS.length &&
    value.every(
      (entry, index) =>
        entry?.path === REQUIRED_PROTOCOL_DOCUMENTS[index] &&
        validArtifactRecord(entry),
    )
  );
}

function validCandidatePolicy(value) {
  return (
    value?.fittedFromEvidence === false &&
    value.frozenBeforeEvidence === true &&
    value.frozenBy === '.agents/docs/scale-crossover-protocol-amendment-1.md' &&
    value.fixedFour?.workerCount === 4 &&
    value.hardwareCap?.formula ===
      'min(availableParallelism, workerSafetyCap)' &&
    value.hardwareCap?.workerSafetyCap === 8
  );
}

function validMachine(value) {
  return (
    Number.isSafeInteger(value?.availableParallelism) &&
    value.availableParallelism > 0 &&
    value.workerSafetyCap === 8 &&
    Number.isSafeInteger(value.performanceCores) &&
    value.performanceCores > 0 &&
    Number.isSafeInteger(value.efficiencyCores) &&
    value.efficiencyCores > 0 &&
    typeof value.cpuModel === 'string' &&
    typeof value.node === 'string' &&
    Number.isSafeInteger(value.sourceReportIndex) &&
    typeof value.sourceReportId === 'string' &&
    [
      'availableParallelism',
      'performanceCores',
      'efficiencyCores',
      'cpuModel',
      'node',
    ].every((field) => validPointer(value.sourceBindings?.[field]))
  );
}

function validCaseBindings(value, study) {
  return (
    validPointer(value?.scaleValue) &&
    validPointer(value.policyEvidence) &&
    validPointer(value.policyEvidenceSchema) &&
    validPointer(value.oracleWorkerCount) &&
    (value.cpuRatePercent === null || validPointer(value.cpuRatePercent)) &&
    (value.poolEnvironment === null ||
      validCrossReportBinding(value.poolEnvironment)) &&
    (value.sourceStudy === null || validPointer(value.sourceStudy)) &&
    (study !== 'cpu-rate-confirmation' || validPointer(value.cpuRatePercent)) &&
    (!study.startsWith('allocation-') ||
      validCrossReportBinding(value.poolEnvironment)) &&
    (study === 'baseline' || validPointer(value.sourceStudy))
  );
}

function validCrossReportBinding(value) {
  return (
    Number.isSafeInteger(value?.sourceReportIndex) &&
    value.sourceReportIndex >= 0 &&
    typeof value.sourceReportId === 'string' &&
    validPointer(value.pointer)
  );
}

function validatePoolEnvironment(value, label) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify([...POOL_KEYS].sort()) ||
    POOL_KEYS.some((key) => !/^[1-9][0-9]*$/.test(value[key] ?? ''))
  ) {
    throw new Error(`${label} has an invalid Rust pool environment`);
  }
}

function validArtifactRecord(value) {
  return (
    typeof value?.path === 'string' &&
    /^[0-9a-f]{64}$/.test(value.sha256 ?? '') &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes > 0
  );
}

function validRepoRelativePath(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !value.startsWith('/') &&
    !value.split('/').includes('..') &&
    !value.includes('\\')
  );
}

function validPointer(value) {
  return typeof value === 'string' && value.startsWith('/');
}

export const EVIDENCE_POLICY_METRICS = POLICY_METRICS;
export const EVIDENCE_REQUIRED_PROTOCOL_DOCUMENTS = REQUIRED_PROTOCOL_DOCUMENTS;
export const EVIDENCE_POOL_KEYS = POOL_KEYS;
export const EVIDENCE_REQUIRED_BUILDER_SOURCES = REQUIRED_BUILDER_SOURCES;
