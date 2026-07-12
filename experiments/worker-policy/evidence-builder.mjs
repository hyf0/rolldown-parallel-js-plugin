import { isDeepStrictEqual } from 'node:util';
import {
  CURRENT_PROTOCOL_REVISION,
  EVIDENCE_POLICY_METRICS,
  EVIDENCE_POOL_KEYS,
  validateEvidence,
} from './evaluator.mjs';
import {
  FORMAL_SOURCE_TYPES,
  assertFormalCaseContract,
  normalizeFormalPoolEnvironment,
  validateFormalSourceContracts,
} from './formal-source-contracts.mjs';

const PLAN_KIND = 'rolldown-fixed-worker-policy-build-plan';
const SOURCE_PATH = /^reports\/sha256\/([0-9a-f]{64})\.json$/;
const FAMILY_UNITS = Object.freeze({
  'vue-controlled': 'SFCs',
  'vue-project': 'SFCs',
  mdx: 'MDX',
  svelte: 'components',
});
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

export function buildFixedPolicyEvidence({
  plan,
  planRecord,
  builderSources,
  sourceCommit,
  protocolDocuments,
  sourceDocuments,
}) {
  validatePlanHeader(plan);
  const sources = normalizeSources(
    plan.sources,
    sourceDocuments,
    plan.formalCoverage,
    builderSources,
  );
  const sourceIndexById = new Map(
    sources.map((source, index) => [source.id, index]),
  );
  const machine = normalizeMachine(plan.machine, sources, sourceIndexById);
  const cases = [...plan.cases]
    .sort((left, right) => compareUtf8(left.id, right.id))
    .map((definition) =>
      normalizeCase(definition, sources, sourceIndexById, plan.formalCoverage),
    );
  requireReachableSources(sources, machine.sourceReportIndex, cases);
  const evidence = {
    schemaVersion: 2,
    kind: 'rolldown-fixed-worker-policy-evidence',
    protocol: CURRENT_PROTOCOL_REVISION,
    formalCoverage: plan.formalCoverage,
    repository: {
      sourceCommit,
      buildPlan: planRecord,
      builderSources,
    },
    protocolDocuments,
    candidatePolicy: {
      fittedFromEvidence: false,
      frozenBeforeEvidence: true,
      frozenBy: '.agents/docs/scale-crossover-protocol-amendment-1.md',
      fixedFour: { workerCount: 4 },
      hardwareCap: {
        formula: 'min(availableParallelism, workerSafetyCap)',
        workerSafetyCap: 8,
      },
    },
    sourceReports: sources.map(({ document: _document, ...source }) => source),
    machine,
    cases,
  };
  validateEvidence(evidence);
  return evidence;
}

function validatePlanHeader(plan) {
  if (
    plan?.schemaVersion !== 1 ||
    plan.kind !== PLAN_KIND ||
    plan.protocol !== CURRENT_PROTOCOL_REVISION ||
    typeof plan.formalCoverage !== 'boolean' ||
    !Array.isArray(plan.sources) ||
    plan.sources.length === 0 ||
    !Array.isArray(plan.cases) ||
    plan.cases.length === 0 ||
    (plan.formalCoverage &&
      plan.sources.some(
        (source) => !FORMAL_SOURCE_TYPES.includes(source.sourceType),
      )) ||
    !isDeepStrictEqual(plan.candidatePolicy, {
      fittedFromEvidence: false,
      frozenBeforeEvidence: true,
      frozenBy: '.agents/docs/scale-crossover-protocol-amendment-1.md',
      fixedFourWorkerCount: 4,
      hardwareCapFormula: 'min(availableParallelism, workerSafetyCap)',
      workerSafetyCap: 8,
    })
  ) {
    throw new Error('invalid fixed-worker policy build plan header');
  }
  const caseIds = plan.cases.map(({ id }) => id);
  if (
    caseIds.some((id) => typeof id !== 'string' || id.length === 0) ||
    new Set(caseIds).size !== caseIds.length
  ) {
    throw new Error(
      'fixed-worker policy build plan case IDs are missing or duplicated',
    );
  }
}

function normalizeSources(
  definitions,
  documents,
  formalCoverage,
  builderSources,
) {
  if (!(documents instanceof Map))
    throw new Error('source documents must be keyed by source ID');
  const ids = definitions.map(({ id }) => id);
  if (
    ids.some((id) => typeof id !== 'string' || id.length === 0) ||
    new Set(ids).size !== ids.length ||
    documents.size !== definitions.length
  ) {
    throw new Error('source report IDs are missing, duplicated, or incomplete');
  }
  const sorted = [...definitions].sort((left, right) =>
    compareUtf8(left.id, right.id),
  );
  const indexById = new Map(sorted.map(({ id }, index) => [id, index]));
  const sources = sorted.map((definition) => {
    const record = documents.get(definition.id);
    const match = SOURCE_PATH.exec(definition.path ?? '');
    if (
      !record ||
      !match ||
      record.path !== definition.path ||
      record.sha256 !== match[1] ||
      !Number.isSafeInteger(record.bytes) ||
      record.bytes <= 0 ||
      record.document === null ||
      typeof record.document !== 'object' ||
      Array.isArray(record.document) ||
      !Array.isArray(definition.assertions) ||
      !Array.isArray(definition.links) ||
      (formalCoverage && !FORMAL_SOURCE_TYPES.includes(definition.sourceType))
    ) {
      throw new Error(
        `invalid content-addressed source report: ${definition.id ?? '<unnamed>'}`,
      );
    }
    const assertions = definition.assertions.map((assertion) => {
      if (
        !validPointer(assertion?.pointer) ||
        !Object.hasOwn(assertion, 'equals')
      ) {
        throw new Error(`${definition.id} has an invalid assertion`);
      }
      const actual = resolveJsonPointer(record.document, assertion.pointer);
      if (!isDeepStrictEqual(actual, assertion.equals)) {
        throw new Error(
          `${definition.id}${assertion.pointer} differs from its required assertion`,
        );
      }
      return structuredClone(assertion);
    });
    const links = definition.links.map((link) => {
      const targetIndex = indexById.get(link?.sourceId);
      if (targetIndex === undefined || !validPointer(link.sha256Pointer)) {
        throw new Error(`${definition.id} has an invalid lineage link`);
      }
      const targetRecord = documents.get(link.sourceId);
      const linkedSha256 = resolveJsonPointer(
        record.document,
        link.sha256Pointer,
      );
      if (linkedSha256 !== targetRecord.sha256) {
        throw new Error(
          `${definition.id}${link.sha256Pointer} does not bind ${link.sourceId}`,
        );
      }
      return {
        targetSourceReportIndex: targetIndex,
        targetSourceReportId: link.sourceId,
        sha256Pointer: link.sha256Pointer,
      };
    });
    return {
      id: definition.id,
      path: record.path,
      sha256: record.sha256,
      bytes: record.bytes,
      sourceType: definition.sourceType ?? null,
      assertions,
      links,
      document: record.document,
    };
  });
  if (formalCoverage) validateFormalSourceContracts(sources, builderSources);
  return sources;
}

function normalizeMachine(definition, sources, sourceIndexById) {
  const sourceReportIndex = sourceIndexById.get(definition?.sourceId);
  if (
    sourceReportIndex === undefined ||
    definition.workerSafetyCap !== 8 ||
    !validPointer(definition.bindings?.availableParallelism) ||
    !validPointer(definition.bindings?.performanceCores) ||
    !validPointer(definition.bindings?.efficiencyCores) ||
    !validPointer(definition.bindings?.cpuModel) ||
    !validPointer(definition.bindings?.node)
  ) {
    throw new Error('invalid fixed-worker policy machine binding');
  }
  const source = sources[sourceReportIndex];
  const availableParallelism = resolveJsonPointer(
    source.document,
    definition.bindings.availableParallelism,
  );
  const cpuModel = resolveJsonPointer(
    source.document,
    definition.bindings.cpuModel,
  );
  const node = resolveJsonPointer(source.document, definition.bindings.node);
  const performanceCores = resolveJsonPointer(
    source.document,
    definition.bindings.performanceCores,
  );
  const efficiencyCores = resolveJsonPointer(
    source.document,
    definition.bindings.efficiencyCores,
  );
  return {
    availableParallelism,
    workerSafetyCap: definition.workerSafetyCap,
    performanceCores,
    efficiencyCores,
    cpuModel,
    node,
    sourceReportIndex,
    sourceReportId: source.id,
    sourceBindings: structuredClone(definition.bindings),
  };
}

function normalizeCase(definition, sources, sourceIndexById, formalCoverage) {
  const sourceReportIndex = sourceIndexById.get(definition?.sourceId);
  if (
    sourceReportIndex === undefined ||
    typeof definition.id !== 'string' ||
    !Object.hasOwn(FAMILY_UNITS, definition.family) ||
    !STUDIES.has(definition.study) ||
    typeof definition.scaleRole !== 'string' ||
    !validPointer(definition.scaleValuePointer) ||
    !validPointer(definition.policyEvidencePointer) ||
    !validPointer(definition.policyEvidenceSchemaPointer) ||
    !validPointer(definition.oracleWorkerCountPointer) ||
    (definition.study === 'baseline' &&
      definition.sourceStudyPointer != null) ||
    (definition.study !== 'baseline' &&
      !validPointer(definition.sourceStudyPointer)) ||
    (![undefined, null].includes(definition.cpuRatePercentPointer) &&
      !validPointer(definition.cpuRatePercentPointer)) ||
    (![undefined, null].includes(definition.poolEnvironmentPointer) &&
      !validPointer(definition.poolEnvironmentPointer)) ||
    (![undefined, null].includes(definition.poolEnvironmentSourceId) &&
      typeof definition.poolEnvironmentSourceId !== 'string') ||
    (formalCoverage &&
      (!validPointer(definition.poolEnvironmentPointer) ||
        typeof definition.poolEnvironmentSourceId !== 'string'))
  ) {
    throw new Error(
      `invalid fixed-worker policy case binding: ${definition?.id ?? '<unnamed>'}`,
    );
  }
  const source = sources[sourceReportIndex];
  const scaleValue = resolveJsonPointer(
    source.document,
    definition.scaleValuePointer,
  );
  if (
    !['number', 'string'].includes(typeof scaleValue) ||
    (typeof scaleValue === 'number' &&
      (!Number.isSafeInteger(scaleValue) || scaleValue <= 0)) ||
    (typeof scaleValue === 'string' && scaleValue.length === 0)
  ) {
    throw new Error(`${definition.id} has an invalid bound scale`);
  }
  const policyEvidence = resolveJsonPointer(
    source.document,
    definition.policyEvidencePointer,
  );
  const policyEvidenceSchema = resolveJsonPointer(
    source.document,
    definition.policyEvidenceSchemaPointer,
  );
  const oracleWorkerCount = resolveJsonPointer(
    source.document,
    definition.oracleWorkerCountPointer,
  );
  if (
    policyEvidenceSchema !== 1 ||
    policyEvidence?.variants === null ||
    typeof policyEvidence.variants !== 'object' ||
    Array.isArray(policyEvidence.variants) ||
    !Number.isSafeInteger(oracleWorkerCount)
  ) {
    throw new Error(
      `${definition.id} does not bind a repeated schema-1 policyEvidence block`,
    );
  }
  requireOracleEchoes(
    policyEvidence.variants,
    oracleWorkerCount,
    definition.id,
  );
  const variantsPointer = joinPointer(
    definition.policyEvidencePointer,
    'variants',
  );
  const variants = Object.entries(policyEvidence.variants)
    .map(([variantName, value]) =>
      normalizeVariant(variantName, value, variantsPointer, definition.id),
    )
    .sort((left, right) => left.workerCount - right.workerCount);
  const cpuRatePercent = definition.cpuRatePercentPointer
    ? resolveJsonPointer(source.document, definition.cpuRatePercentPointer)
    : null;
  const poolSourceReportIndex = definition.poolEnvironmentPointer
    ? sourceIndexById.get(
        definition.poolEnvironmentSourceId ?? definition.sourceId,
      )
    : undefined;
  if (
    definition.poolEnvironmentPointer &&
    poolSourceReportIndex === undefined
  ) {
    throw new Error(`${definition.id} names a missing Rust-pool source report`);
  }
  const poolSource =
    poolSourceReportIndex === undefined
      ? undefined
      : sources[poolSourceReportIndex];
  const poolEnvironment = definition.poolEnvironmentPointer
    ? normalizeFormalPoolEnvironment(
        resolveJsonPointer(
          poolSource.document,
          definition.poolEnvironmentPointer,
        ),
        definition.id,
      )
    : null;
  if (poolEnvironment !== null)
    validatePoolEnvironment(poolEnvironment, definition.id);
  const sourceStudy = definition.sourceStudyPointer
    ? resolveJsonPointer(source.document, definition.sourceStudyPointer)
    : null;
  if (sourceStudy !== SOURCE_STUDIES[definition.study]) {
    throw new Error(
      `${definition.id} is not bound to the expected policy stage`,
    );
  }
  const scaleRoles = formalCoverage
    ? assertFormalCaseContract(definition, source, scaleValue)
    : (definition.scaleRoles ?? [definition.scaleRole]);
  const ordinaryBestSmallCase =
    ['small-negative', 'independent-small'].includes(definition.scaleRole) &&
    oracleWorkerCount === 0;
  return {
    id: definition.id,
    family: definition.family,
    study: definition.study,
    sourceStudy,
    scale: `${scaleValue} ${FAMILY_UNITS[definition.family]}`,
    scaleValue,
    scaleRole: definition.scaleRole,
    scaleRoles,
    cpuRatePercent,
    poolEnvironment,
    ordinaryBestSmallCase,
    heldOut: true,
    heldOutFromCandidateFitting: true,
    oracleWorkerCount,
    sourceReportIndex,
    sourceReportId: source.id,
    sourceBindings: {
      scaleValue: definition.scaleValuePointer,
      policyEvidence: definition.policyEvidencePointer,
      policyEvidenceSchema: definition.policyEvidenceSchemaPointer,
      oracleWorkerCount: definition.oracleWorkerCountPointer,
      cpuRatePercent: definition.cpuRatePercentPointer ?? null,
      poolEnvironment:
        definition.poolEnvironmentPointer === undefined ||
        definition.poolEnvironmentPointer === null
          ? null
          : {
              sourceReportIndex: poolSourceReportIndex,
              sourceReportId: poolSource.id,
              pointer: definition.poolEnvironmentPointer,
            },
      sourceStudy: definition.sourceStudyPointer ?? null,
    },
    variants,
  };
}

function normalizeVariant(variantName, value, variantsPointer, caseId) {
  const workerCount =
    variantName === 'ordinary'
      ? 0
      : Number(/^worker-([1-8])$/.exec(variantName)?.[1]);
  if (!Number.isSafeInteger(workerCount)) {
    throw new Error(`${caseId} has an invalid repeated variant ${variantName}`);
  }
  const sourceBindings = Object.fromEntries(
    EVIDENCE_POLICY_METRICS.map((field) => [
      field,
      joinPointer(
        variantsPointer,
        variantName,
        field === 'pairedWallRatioToOrdinaryBootstrap95Upper'
          ? 'pairedWallRatioBootstrap95Upper'
          : field,
      ),
    ]),
  );
  return {
    workerCount,
    wallMedianMs: value?.wallMedianMs,
    cpuMedianMs: value?.cpuMedianMs,
    peakRssMedianBytes: value?.peakRssMedianBytes,
    resourceEligible: value?.resourceEligible,
    pairedWallRatioToOrdinaryBootstrap95Upper:
      value?.pairedWallRatioBootstrap95Upper,
    sourceBindings,
  };
}

function requireOracleEchoes(variants, oracleWorkerCount, label) {
  const values = Object.values(variants);
  for (const field of ['selectedOracleWorkerCount', 'selectedOracleCount']) {
    const present = values.filter((value) => Object.hasOwn(value ?? {}, field));
    if (present.length === 0) continue;
    if (
      present.length !== values.length ||
      present.some((value) => value[field] !== oracleWorkerCount)
    ) {
      throw new Error(`${label} has inconsistent ${field} echoes`);
    }
  }
}

function requireReachableSources(sources, machineIndex, cases) {
  const reachable = new Set([
    machineIndex,
    ...sources.flatMap((source, index) =>
      source.sourceType === 'vue-controlled-harness-source-snapshot'
        ? [index]
        : [],
    ),
    ...cases.map(({ sourceReportIndex }) => sourceReportIndex),
    ...cases.flatMap(({ sourceBindings }) =>
      sourceBindings.poolEnvironment === null
        ? []
        : [sourceBindings.poolEnvironment.sourceReportIndex],
    ),
  ]);
  const queue = [...reachable];
  while (queue.length > 0) {
    for (const link of sources[queue.shift()].links) {
      if (reachable.has(link.targetSourceReportIndex)) continue;
      reachable.add(link.targetSourceReportIndex);
      queue.push(link.targetSourceReportIndex);
    }
  }
  if (reachable.size !== sources.length) {
    const unused = sources
      .filter((_source, index) => !reachable.has(index))
      .map(({ id }) => id)
      .join(', ');
    throw new Error(
      `fixed-policy build plan has unreachable source reports: ${unused}`,
    );
  }
}

export function resolveJsonPointer(document, pointer) {
  if (!validPointer(pointer))
    throw new Error(`invalid JSON Pointer: ${pointer}`);
  let current = document;
  for (const token of pointer.slice(1).split('/').map(unescapePointerToken)) {
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/.test(token) || Number(token) >= current.length) {
        throw new Error(`JSON Pointer does not resolve: ${pointer}`);
      }
      current = current[Number(token)];
    } else if (
      current === null ||
      typeof current !== 'object' ||
      !Object.hasOwn(current, token)
    ) {
      throw new Error(`JSON Pointer does not resolve: ${pointer}`);
    } else {
      current = current[token];
    }
  }
  return current;
}

export function joinPointer(base, ...tokens) {
  if (!validPointer(base))
    throw new Error(`invalid JSON Pointer base: ${base}`);
  return `${base}/${tokens.map(escapePointerToken).join('/')}`;
}

function escapePointerToken(value) {
  return String(value).replaceAll('~', '~0').replaceAll('/', '~1');
}

function unescapePointerToken(value) {
  if (/~(?:[^01]|$)/.test(value))
    throw new Error(`invalid JSON Pointer escape: ${value}`);
  return value.replaceAll('~1', '/').replaceAll('~0', '~');
}

function validPointer(value) {
  return typeof value === 'string' && value.startsWith('/');
}

function validatePoolEnvironment(value, label) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !isDeepStrictEqual(
      Object.keys(value).sort(),
      [...EVIDENCE_POOL_KEYS].sort(),
    ) ||
    EVIDENCE_POOL_KEYS.some((key) => !/^[1-9][0-9]*$/.test(value[key] ?? ''))
  ) {
    throw new Error(`${label} has an invalid bound Rust pool environment`);
  }
}

function compareUtf8(left, right) {
  return Buffer.from(left).compare(Buffer.from(right));
}

export const FIXED_POLICY_BUILD_PLAN_KIND = PLAN_KIND;
