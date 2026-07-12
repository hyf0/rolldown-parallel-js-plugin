import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  analyzeCrossover,
  planScaleFollowup,
  summarizeRepeatedPolicyCase,
} from '../cloudflare-mdx/scale-followup.mjs';
import { validateManifestShape } from '../cloudflare-mdx/scale-corpus.mjs';
import { validateControllerRecord } from '../cloudflare-mdx/mdx-policy.mjs';
import {
  CPULIMIT_BINARY_SHA256,
  CPULIMIT_PATCH_SHA256,
  CPULIMIT_SOURCE_TREE_SHA256,
  CPULIMIT_UPSTREAM_COMMIT,
  CPULIMIT_UPSTREAM_URL,
} from '../cpu-rate-control/cpulimit-provenance.mjs';

export const FORMAL_SOURCE_TYPES = Object.freeze([
  'machine-topology',
  'vue-controlled-harness-source-snapshot',
  'vue-controlled-admission-raw',
  'vue-controlled-admission-pointer',
  'vue-controlled-correctness-raw',
  'vue-controlled-correctness-pointer',
  'vue-controlled-confirmation-raw',
  'vue-controlled-confirmation-summary',
  'vue-independent-correctness-manifest',
  'vue-independent-screen-raw',
  'vue-independent-screen-summary',
  'vue-independent-confirmation-raw',
  'vue-independent-confirmation-summary',
  'mdx-performance-raw',
  'mdx-crossover-complete',
  'mdx-policy-raw',
  'mdx-allocation-complete',
  'cpulimit-calibration',
  'mdx-quota-complete',
]);

export const FORMAL_CASE_SOURCE_TYPES = Object.freeze({
  'vue-controlled': Object.freeze({
    baseline: 'vue-controlled-confirmation-summary',
  }),
  'vue-project': Object.freeze({
    baseline: 'vue-independent-confirmation-summary',
  }),
  mdx: Object.freeze({
    baseline: 'mdx-crossover-complete',
    'allocation-tokio-confirmation': 'mdx-allocation-complete',
    'allocation-rayon-confirmation': 'mdx-allocation-complete',
    'cpu-rate-confirmation': 'mdx-quota-complete',
  }),
});

const HASH = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40,64}$/;
const EMPTY_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const BASELINE_POOLS = Object.freeze({
  ROLLDOWN_WORKER_THREADS: '18',
  RAYON_NUM_THREADS: '12',
  ROLLDOWN_MAX_BLOCKING_THREADS: '4',
});
const LIFECYCLE_BASELINE = Object.freeze({
  kind: 'lifecycle-corrected-baseline',
  sourceCommit: 'b144106882fe244b19b738fc0acf3ffa07c7c9f3',
  nativeBindingSha256:
    '7b8863bb28aefd2e2eb7409f8be6dae57a252fe4a2688383007be7ea2f847bf7',
  distributionSha256:
    '1efffd0b63483e77cd2854fe716941000ae9548768691d7b5a64dceb011f3c45',
});
const INDEPENDENT_PROJECTS = Object.freeze([
  Object.freeze({
    projectId: 'floating-vue',
    band: 'small',
    reachedSfcCount: 4,
  }),
  Object.freeze({
    projectId: 'cabinet-icon',
    band: 'medium',
    reachedSfcCount: 166,
  }),
  Object.freeze({
    projectId: 'directus-amendment-candidate',
    band: 'large',
    reachedSfcCount: 546,
  }),
]);
const REQUIRED_MDX_SOURCE_HASHES = Object.freeze({
  'run-matrix.mjs': 'experiments/cloudflare-mdx/run-matrix.mjs',
  'run-case.mjs': 'experiments/cloudflare-mdx/run-case.mjs',
  'run-policy-matrix.mjs': 'experiments/cloudflare-mdx/run-policy-matrix.mjs',
  'policy-node-launcher.mjs':
    'experiments/cloudflare-mdx/policy-node-launcher.mjs',
});
const MDX_CROSSOVER_STAGES = new Set([
  'initial-confirmation',
  'refinement-screen',
  'refinement-confirmation',
]);
const CONTROLLED_TERMINAL_CROSSOVER_STATUSES = new Set([
  'confirmed',
  'left-censored',
  'not-observed-through-maximum',
  'right-boundary-unconfirmed',
  'inconsistent-repeated-direction',
]);
const MDX_TERMINAL_CROSSOVER_STATUSES = new Set([
  'exact',
  'left-censored',
  'interval-censored-before-screen-interval',
  'right-censored',
  'interval-censored-after-screen-interval',
  'non-monotonic-or-unbounded',
  'non-monotonic-repeated-evidence',
  'right-edge-censored',
]);
const CONTROLLED_FROZEN_SCALES = Object.freeze([
  32, 128, 256, 512, 1024, 2048, 4096, 5000,
]);
const CONTROLLED_HARNESS_ROOTS = Object.freeze([
  'examples/par-plugin/cases/vue-scale',
  'examples/par-plugin/parallel-vue-plugin',
]);
const CONTROLLED_HARNESS_EXPLICIT_FILES = Object.freeze([
  'examples/par-plugin/package.json',
  'pnpm-lock.yaml',
]);
const CONTROLLED_HARNESS_IGNORED_DIRECTORIES = new Set([
  '.corpus',
  '.results',
  'evidence',
]);
const MDX_POLICY_STAGES = Object.freeze([
  'allocation-tokio-screen',
  'allocation-tokio-confirmation',
  'allocation-rayon-screen',
  'allocation-rayon-confirmation',
  'quota-screen',
  'quota-confirmation',
]);
const MDX_SCALE_MANIFEST = JSON.parse(
  readFileSync(
    new URL(
      '../cloudflare-mdx/data/cloudflare-mdx-scale-v1.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
validateManifestShape(MDX_SCALE_MANIFEST);

export function validateFormalSourceContracts(sources, builderSources) {
  const sourceHashByPath = new Map(
    builderSources.map(({ path, sha256 }) => [path, sha256]),
  );
  const bySha256 = new Map(sources.map((source) => [source.sha256, source]));
  if (bySha256.size !== sources.length) {
    throw new Error(
      'formal fixed-policy source reports must have unique content identities',
    );
  }
  for (const source of sources) {
    if (!FORMAL_SOURCE_TYPES.includes(source.sourceType)) {
      throw new Error(`${source.id} has an unknown formal source type`);
    }
    const expectedLinks = new Set();
    const requireLink = (pointer, allowedTypes) => {
      const digest = resolvePointer(source.document, pointer);
      if (!HASH.test(digest ?? '')) {
        throw new Error(
          `${source.id}${pointer} is not a source artifact SHA-256`,
        );
      }
      const target = bySha256.get(digest);
      if (!target || !allowedTypes.includes(target.sourceType)) {
        throw new Error(
          `${source.id}${pointer} does not resolve to ${allowedTypes.join(' or ')}`,
        );
      }
      const key = `${pointer}\0${target.id}`;
      expectedLinks.add(key);
      if (
        !source.links.some(
          (link) =>
            link.sha256Pointer === pointer &&
            link.targetSourceReportId === target.id,
        )
      ) {
        throw new Error(
          `${source.id}${pointer} is not declared as required lineage`,
        );
      }
      return target;
    };
    validateFormalSource(source, { requireLink, sourceHashByPath, sources });
    const actualLinks = new Set(
      source.links.map(
        (link) => `${link.sha256Pointer}\0${link.targetSourceReportId}`,
      ),
    );
    if (!isDeepStrictEqual(actualLinks, expectedLinks)) {
      throw new Error(
        `${source.id} has missing or undeclared formal lineage links`,
      );
    }
  }
  validateCrossSourceContracts(sources);
}

export function deriveFormalStudyOutcomes(sources) {
  const exactlyOne = (type) => {
    const selected = sources.filter(({ sourceType }) => sourceType === type);
    if (selected.length !== 1) {
      throw new Error(`formal outcomes require exactly one ${type}`);
    }
    return selected[0].document;
  };
  const controlled = exactlyOne('vue-controlled-confirmation-summary');
  const independent = exactlyOne('vue-independent-confirmation-raw');
  const mdx = exactlyOne('mdx-crossover-complete');
  const allocation = exactlyOne('mdx-allocation-complete');
  const quota = exactlyOne('mdx-quota-complete');
  const controlledRepeatedScales =
    controlled.resourceAcceptableCrossover.status === 'confirmed'
      ? [...new Set(Object.values(controlledRoleScales(controlled)))].sort(
          (left, right) => left - right,
        )
      : controlled.scaleSummaries
          .map(({ componentCount }) => componentCount)
          .sort((left, right) => left - right);
  const mdxRepeatedScales =
    mdx.decision.resource.status === 'exact'
      ? [...new Set(Object.values(mdxRoleScales(mdx)))].sort(
          (left, right) => left - right,
        )
      : mdx.decision.points
          .map(({ scale }) => scale)
          .sort((left, right) => left - right);
  return {
    schema: 1,
    controlledVue: {
      mechanicalStatus: controlled.mechanicalCrossover.status,
      resourceStatus: controlled.resourceAcceptableCrossover.status,
      repeatedScales: controlledRepeatedScales,
    },
    independentVue: {
      projects: independent.matrix.cases.map((definition) => ({
        projectId: definition.projectId,
        reachedSfcCount: definition.reachedSfcCount,
        screenSelectionStatus: definition.screenSelectionStatus,
        selectedScreenWorkerCount: definition.selectedScreenWorkerCount,
      })),
    },
    mdx: {
      mechanicalStatus: mdx.decision.mechanical.status,
      resourceStatus: mdx.decision.resource.status,
      repeatedScales: mdxRepeatedScales,
      allocationStatus:
        allocation.status === 'complete' ? 'complete' : 'not-applicable',
      quotaStatus: quota.status === 'complete' ? 'complete' : 'not-applicable',
    },
  };
}

function validateFormalSource(source, context) {
  const value = source.document;
  switch (source.sourceType) {
    case 'machine-topology':
      validateMachineTopology(value, source.id);
      return;
    case 'vue-controlled-harness-source-snapshot':
      validateControlledHarnessSourceSnapshot(value, source.id);
      return;
    case 'vue-controlled-admission-raw':
      validateControlledAdmissionRaw(value, source.id);
      return;
    case 'vue-controlled-admission-pointer':
      validateControlledPointer(
        value,
        source.id,
        'vue-scale-admission-evidence-pointer',
        'untimed compile admission; not performance evidence',
      );
      context.requireLink('/raw/sha256', ['vue-controlled-admission-raw']);
      return;
    case 'vue-controlled-correctness-raw':
      validateControlledCorrectnessRaw(value, source.id);
      return;
    case 'vue-controlled-correctness-pointer':
      validateControlledPointer(
        value,
        source.id,
        'vue-scale-correctness-evidence-pointer',
        'untimed correctness; not performance evidence',
      );
      context.requireLink('/raw/sha256', ['vue-controlled-correctness-raw']);
      return;
    case 'vue-controlled-confirmation-raw':
      validateControlledConfirmationRaw(value, source.id);
      context.requireLink('/evidence/admission/pointerSha256', [
        'vue-controlled-admission-pointer',
      ]);
      context.requireLink('/evidence/correctness/pointerSha256', [
        'vue-controlled-correctness-pointer',
      ]);
      return;
    case 'vue-controlled-confirmation-summary':
      validateControlledConfirmationSummary(value, source.id);
      context.requireLink('/sourceReportSha256', [
        'vue-controlled-confirmation-raw',
      ]);
      return;
    case 'vue-independent-correctness-manifest':
      validateIndependentCorrectnessManifest(value, source.id);
      return;
    case 'vue-independent-screen-raw':
      validateIndependentRaw(value, source.id, 'independent-vue-wall-screen');
      context.requireLink('/correctnessEvidence/manifest/sha256', [
        'vue-independent-correctness-manifest',
      ]);
      return;
    case 'vue-independent-screen-summary':
      validateIndependentSummary(
        value,
        source.id,
        'independent-vue-wall-screen',
      );
      context.requireLink('/rawArtifactSha256', ['vue-independent-screen-raw']);
      return;
    case 'vue-independent-confirmation-raw':
      validateIndependentRaw(value, source.id, 'independent-vue-wall-confirm');
      context.requireLink('/correctnessEvidence/manifest/sha256', [
        'vue-independent-correctness-manifest',
      ]);
      context.requireLink('/screenEvidence/raw/sha256', [
        'vue-independent-screen-raw',
      ]);
      context.requireLink('/screenEvidence/summary/sha256', [
        'vue-independent-screen-summary',
      ]);
      return;
    case 'vue-independent-confirmation-summary':
      validateIndependentSummary(
        value,
        source.id,
        'independent-vue-wall-confirm',
      );
      context.requireLink('/rawArtifactSha256', [
        'vue-independent-confirmation-raw',
      ]);
      return;
    case 'mdx-performance-raw':
      validateMdxPerformanceRaw(value, source.id, context.sourceHashByPath);
      validateMdxPerformanceLineage(value, context.requireLink);
      return;
    case 'mdx-crossover-complete':
      validateMdxCrossoverComplete(value, source.id);
      for (
        let index = 0;
        index < value.consumedArtifactSha256.length;
        index++
      ) {
        context.requireLink(`/consumedArtifactSha256/${index}`, [
          'mdx-performance-raw',
        ]);
      }
      return;
    case 'mdx-policy-raw':
      validateMdxPolicyRaw(value, source.id, context.sourceHashByPath);
      validateMdxPolicyLineage(value, context.requireLink);
      return;
    case 'mdx-allocation-complete':
      if (value?.status === 'unavailable') {
        validateUnavailableMdxOutcome(
          value,
          source.id,
          'allocation-unavailable',
        );
        context.requireLink('/crossoverArtifactSha256', [
          'mdx-crossover-complete',
        ]);
        return;
      }
      validateMdxAllocationComplete(value, source.id);
      for (
        let index = 0;
        index < value.consumedPolicyArtifactSha256.length;
        index++
      ) {
        context.requireLink(`/consumedPolicyArtifactSha256/${index}`, [
          'mdx-policy-raw',
        ]);
      }
      validateEmbeddedCrossoverLineage(
        value.crossover,
        '/crossover',
        context.requireLink,
      );
      return;
    case 'cpulimit-calibration':
      validateCpulimitCalibration(value, source.id, context.sourceHashByPath);
      return;
    case 'mdx-quota-complete':
      if (value?.status === 'unavailable') {
        validateUnavailableMdxOutcome(value, source.id, 'quota-unavailable');
        context.requireLink('/crossoverArtifactSha256', [
          'mdx-crossover-complete',
        ]);
        return;
      }
      validateMdxQuotaComplete(value, source.id);
      for (
        let index = 0;
        index < value.consumedPolicyArtifactSha256.length;
        index++
      ) {
        context.requireLink(`/consumedPolicyArtifactSha256/${index}`, [
          'mdx-policy-raw',
        ]);
      }
      context.requireLink('/calibration/sha256', ['cpulimit-calibration']);
      validateEmbeddedCrossoverLineage(
        value.crossover,
        '/crossover',
        context.requireLink,
      );
      return;
    default:
      throw new Error(`${source.id} has an unhandled formal source type`);
  }
}

function validateMachineTopology(value, label) {
  if (
    value?.schema !== 1 ||
    value.kind !== 'rolldown-fixed-worker-policy-machine-topology' ||
    value.executionScope !== 'local-only' ||
    value.node !== 'v24.18.0' ||
    value.platform !== 'darwin' ||
    value.architecture !== 'arm64' ||
    value.cpuModel !== 'Apple M3 Pro' ||
    value.availableParallelism !== 12 ||
    value.logicalCpuCount !== 12 ||
    value.performanceCores !== 6 ||
    value.efficiencyCores !== 6 ||
    value.performanceCores + value.efficiencyCores !== value.logicalCpuCount
  ) {
    throw new Error(`${label} is not the frozen local machine-topology record`);
  }
}

export function validateControlledHarnessSourceSnapshot(value, label) {
  if (
    value?.schema !== 1 ||
    value.kind !== 'vue-controlled-harness-source-snapshot' ||
    value.repository !== 'github.com/rolldown/rolldown' ||
    !/^[a-f0-9]{40}$/.test(value.commit ?? '') ||
    value.gitObjectFormat !== 'sha1' ||
    value.gitCommitObject?.oid !== value.commit ||
    typeof value.gitCommitObject?.contentBase64 !== 'string' ||
    !Array.isArray(value.gitTreeObjects) ||
    value.gitTreeObjects.length === 0 ||
    !Array.isArray(value.blobs) ||
    value.blobs.length === 0
  ) {
    throw new Error(
      `${label} is not a committed controlled Vue harness snapshot`,
    );
  }
  const treeEntries = deriveControlledHarnessGitTreeEntries(value, label);
  const entries = [];
  for (const [index, blob] of value.blobs.entries()) {
    if (
      typeof blob.path !== 'string' ||
      blob.path.length === 0 ||
      !controlledHarnessPathIncluded(blob.path) ||
      !['file', 'symlink'].includes(blob.kind) ||
      typeof blob.contentBase64 !== 'string' ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(blob.contentBase64)
    ) {
      throw new Error(`${label} harness blob ${index} is malformed`);
    }
    const content = Buffer.from(blob.contentBase64, 'base64');
    const gitBlobOid = createHash('sha1')
      .update(`blob ${content.length}\0`)
      .update(content)
      .digest('hex');
    if (
      content.toString('base64') !== blob.contentBase64 ||
      blob.bytes !== content.length ||
      blob.sha256 !== createHash('sha256').update(content).digest('hex') ||
      blob.gitBlobOid !== gitBlobOid
    ) {
      throw new Error(
        `${label} harness blob ${blob.path} differs from its committed bytes`,
      );
    }
    entries.push({
      path: blob.path,
      kind: blob.kind,
      bytes: blob.bytes,
      sha256: blob.sha256,
    });
  }
  const sorted = [...entries].sort((left, right) =>
    Buffer.from(left.path).compare(Buffer.from(right.path)),
  );
  if (
    new Set(entries.map(({ path }) => path)).size !== entries.length ||
    !isDeepStrictEqual(
      value.blobs.map(({ path, kind, gitBlobOid }) => ({
        path,
        kind,
        gitBlobOid,
      })),
      treeEntries,
    ) ||
    CONTROLLED_HARNESS_EXPLICIT_FILES.some(
      (requiredPath) => !entries.some(({ path }) => path === requiredPath),
    ) ||
    CONTROLLED_HARNESS_ROOTS.some(
      (root) => !entries.some(({ path }) => path.startsWith(`${root}/`)),
    ) ||
    !isDeepStrictEqual(entries, sorted) ||
    !isDeepStrictEqual(value.harnessSourceManifest?.entries, entries) ||
    !validHarnessManifest(value.harnessSourceManifest) ||
    !hasHarnessEntry(
      value.harnessSourceManifest,
      'examples/par-plugin/cases/vue-scale/run-matrix.mjs',
    ) ||
    !hasHarnessEntry(
      value.harnessSourceManifest,
      'examples/par-plugin/cases/vue-scale/summarize-matrix.mjs',
    )
  ) {
    throw new Error(
      `${label} harness manifest is not derived from its committed source blobs`,
    );
  }
}

function controlledHarnessPathIncluded(path) {
  const inScope =
    CONTROLLED_HARNESS_ROOTS.some(
      (root) => path === root || path.startsWith(`${root}/`),
    ) || CONTROLLED_HARNESS_EXPLICIT_FILES.includes(path);
  return (
    inScope &&
    !path
      .split('/')
      .some((component) =>
        CONTROLLED_HARNESS_IGNORED_DIRECTORIES.has(component),
      )
  );
}

function deriveControlledHarnessGitTreeEntries(value, label) {
  const commitContent = decodeCanonicalBase64(
    value.gitCommitObject.contentBase64,
    `${label} commit object`,
  );
  if (gitObjectOid('commit', commitContent) !== value.commit) {
    throw new Error(`${label} commit object does not match its Git OID`);
  }
  const rootTreeOid = /^tree ([a-f0-9]{40})\n/.exec(
    commitContent.toString('utf8'),
  )?.[1];
  if (!rootTreeOid) {
    throw new Error(`${label} commit object has no SHA-1 root tree`);
  }
  const treeObjects = new Map();
  for (const [index, object] of value.gitTreeObjects.entries()) {
    if (
      !/^[a-f0-9]{40}$/.test(object?.oid ?? '') ||
      typeof object?.contentBase64 !== 'string' ||
      treeObjects.has(object.oid)
    ) {
      throw new Error(`${label} tree proof ${index} is malformed`);
    }
    const content = decodeCanonicalBase64(
      object.contentBase64,
      `${label} tree object ${object.oid}`,
    );
    if (gitObjectOid('tree', content) !== object.oid) {
      throw new Error(`${label} tree object ${object.oid} has a forged OID`);
    }
    treeObjects.set(object.oid, content);
  }
  const sortedOids = [...treeObjects.keys()].sort((left, right) =>
    Buffer.from(left).compare(Buffer.from(right)),
  );
  if (
    !isDeepStrictEqual(
      value.gitTreeObjects.map(({ oid }) => oid),
      sortedOids,
    )
  ) {
    throw new Error(`${label} tree proof is not canonically ordered`);
  }

  const visited = new Set();
  const result = [];
  const walk = (treeOid, prefix, ancestors) => {
    if (ancestors.has(treeOid)) {
      throw new Error(`${label} tree proof contains a recursive cycle`);
    }
    const content = treeObjects.get(treeOid);
    if (!content) {
      throw new Error(`${label} tree proof omits required tree ${treeOid}`);
    }
    visited.add(treeOid);
    const nextAncestors = new Set(ancestors).add(treeOid);
    for (const entry of parseGitTreeObject(content, label)) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.mode === '40000') {
        if (shouldTraverseControlledHarnessDirectory(path)) {
          walk(entry.oid, path, nextAncestors);
        }
        continue;
      }
      if (!controlledHarnessPathIncluded(path)) continue;
      if (!['100644', '100755', '120000'].includes(entry.mode)) {
        throw new Error(
          `${label} harness tree has unsupported mode ${entry.mode} at ${path}`,
        );
      }
      result.push({
        path,
        kind: entry.mode === '120000' ? 'symlink' : 'file',
        gitBlobOid: entry.oid,
      });
    }
  };
  walk(rootTreeOid, '', new Set());
  if (visited.size !== treeObjects.size) {
    throw new Error(`${label} tree proof contains unused tree objects`);
  }
  return result.sort((left, right) =>
    Buffer.from(left.path).compare(Buffer.from(right.path)),
  );
}

function parseGitTreeObject(content, label) {
  const entries = [];
  let offset = 0;
  while (offset < content.length) {
    const space = content.indexOf(0x20, offset);
    const nul = content.indexOf(0, space + 1);
    if (space < 0 || nul < 0 || nul + 21 > content.length) {
      throw new Error(`${label} contains an invalid Git tree object`);
    }
    const mode = content.subarray(offset, space).toString('ascii');
    const nameBytes = content.subarray(space + 1, nul);
    const name = nameBytes.toString('utf8');
    if (
      name.length === 0 ||
      name.includes('/') ||
      !Buffer.from(name).equals(nameBytes)
    ) {
      throw new Error(`${label} Git tree contains an invalid UTF-8 name`);
    }
    entries.push({
      mode,
      name,
      oid: content.subarray(nul + 1, nul + 21).toString('hex'),
    });
    offset = nul + 21;
  }
  return entries;
}

function shouldTraverseControlledHarnessDirectory(path) {
  if (
    path
      .split('/')
      .some((component) =>
        CONTROLLED_HARNESS_IGNORED_DIRECTORIES.has(component),
      )
  ) {
    return false;
  }
  return (
    CONTROLLED_HARNESS_ROOTS.some(
      (root) =>
        root === path ||
        root.startsWith(`${path}/`) ||
        path.startsWith(`${root}/`),
    ) ||
    CONTROLLED_HARNESS_EXPLICIT_FILES.some((file) =>
      file.startsWith(`${path}/`),
    )
  );
}

function decodeCanonicalBase64(value, label) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error(`${label} is not canonical base64`);
  }
  const content = Buffer.from(value, 'base64');
  if (content.toString('base64') !== value) {
    throw new Error(`${label} is not canonical base64`);
  }
  return content;
}

function gitObjectOid(type, content) {
  return createHash('sha1')
    .update(`${type} ${content.length}\0`)
    .update(content)
    .digest('hex');
}

function validateControlledAdmissionRaw(value, label) {
  if (
    value?.schema !== 1 ||
    value.kind !== 'vue-scale-admission-audit' ||
    value.measurementClass !==
      'untimed compile admission; not performance evidence' ||
    !validControlledRuntime(value.runtime) ||
    value.runtime?.worktreeStatus !== '' ||
    value.fixture?.worktreeStatus !== '' ||
    value.executionEnvironment?.inheritedNodeOptions !== null ||
    !validHarnessManifest(value.harnessSourceManifest)
  ) {
    throw new Error(`${label} is not clean controlled Vue admission evidence`);
  }
  const finalPool = value.audits?.find(({ phase }) => phase === 'final-pool');
  if (
    !finalPool ||
    finalPool.admitted !== true ||
    finalPool.errorCount !== 0 ||
    finalPool.failures?.length !== 0 ||
    finalPool.output?.exports !== 5650
  ) {
    throw new Error(`${label} does not contain the passed 5,650-SFC admission`);
  }
}

function validateControlledCorrectnessRaw(value, label) {
  if (
    value?.schema !== 1 ||
    value.matrix?.lane !== 'correctness-smoke' ||
    value.measurementClass !==
      'untimed correctness; not performance evidence' ||
    value.admitted !== true ||
    value.admissionFailures?.length !== 0 ||
    !validControlledRuntime(value.runtime) ||
    value.runtime?.worktreeStatus !== '' ||
    value.fixture?.worktreeStatus !== '' ||
    value.executionEnvironment?.inheritedNodeOptions !== null ||
    !validHarnessManifest(value.harnessSourceManifest) ||
    !Array.isArray(value.runs) ||
    value.runs.length === 0
  ) {
    throw new Error(
      `${label} is not admitted untimed controlled Vue correctness evidence`,
    );
  }
  assertNoTimingFields(value.runs, label);
}

function validateControlledPointer(value, label, kind, measurementClass) {
  if (
    value?.schema !== 2 ||
    value.kind !== kind ||
    value.passed !== true ||
    value.measurementClass !== measurementClass ||
    !HASH.test(value.raw?.sha256 ?? '') ||
    !Number.isSafeInteger(value.raw?.bytes) ||
    value.raw.bytes <= 0 ||
    !COMMIT.test(value.fixtureCommit ?? '') ||
    !HASH.test(value.harnessSourceManifest?.aggregateSha256 ?? '')
  ) {
    throw new Error(`${label} is not a passed controlled Vue evidence pointer`);
  }
}

function validateControlledConfirmationRaw(value, label) {
  if (
    value?.schema !== 1 ||
    value.measurementClass !==
      'formal local wall evidence subject to host gates' ||
    value.matrix?.lane !== 'wall-confirm' ||
    value.admitted !== true ||
    value.admissionFailures?.length !== 0 ||
    value.fixture?.worktreeStatus !== '' ||
    !validControlledRuntime(value.runtime) ||
    value.runtime?.worktreeStatus !== '' ||
    !validHarnessManifest(value.harnessSourceManifest) ||
    !hasHarnessEntry(
      value.harnessSourceManifest,
      'examples/par-plugin/cases/vue-scale/run-matrix.mjs',
    ) ||
    !hasHarnessEntry(
      value.harnessSourceManifest,
      'examples/par-plugin/cases/vue-scale/summarize-matrix.mjs',
    ) ||
    !samePools(value.matrix.configuredPools, BASELINE_POOLS) ||
    !Array.isArray(value.runs) ||
    value.runs.length === 0 ||
    !Array.isArray(value.hostAdmissions) ||
    value.hostAdmissions.length < value.runs.length
  ) {
    throw new Error(
      `${label} is not an admitted controlled Vue wall confirmation`,
    );
  }
  validateControlledRunGrid(value, label);
  validateTimedRuns(value.runs, label, 'controlled-vue');
}

function validateControlledConfirmationSummary(value, label) {
  if (
    value?.schema !== 1 ||
    !HASH.test(value.sourceReportSha256 ?? '') ||
    !CONTROLLED_TERMINAL_CROSSOVER_STATUSES.has(
      value.mechanicalCrossover?.status,
    ) ||
    !CONTROLLED_TERMINAL_CROSSOVER_STATUSES.has(
      value.resourceAcceptableCrossover?.status,
    ) ||
    !validControlledRuntime(value.runtime) ||
    value.additionalConfirmationMatrix !== null ||
    value.policyEvidence?.schema !== 1 ||
    value.policyEvidence.jsonPointerBase !== '/policyEvidence/byScale' ||
    !Array.isArray(value.scaleSummaries) ||
    value.scaleSummaries.length < 2
  ) {
    throw new Error(
      `${label} is not a completed controlled Vue confirmation summary`,
    );
  }
  const scales = value.scaleSummaries.map(
    ({ componentCount }) => componentCount,
  );
  if (
    new Set(scales).size !== scales.length ||
    !scales.includes(5000) ||
    scales.some(
      (scale) =>
        !Number.isSafeInteger(scale) ||
        !CONTROLLED_FROZEN_SCALES.includes(scale),
    )
  ) {
    throw new Error(`${label} does not retain the frozen 5,000-SFC endpoint`);
  }
  if (value.resourceAcceptableCrossover.status === 'confirmed') {
    controlledRoleScales(value);
  }
  for (const summary of value.scaleSummaries) {
    const policy =
      value.policyEvidence.byScale?.[String(summary.componentCount)];
    if (!policy || !policyMatchesControlledSummary(policy, summary)) {
      throw new Error(
        `${label} policy evidence is not derived from scale ${summary.componentCount}`,
      );
    }
  }
}

function validateIndependentCorrectnessManifest(value, label) {
  if (
    value?.schema !== 2 ||
    value.artifactStore?.kind !== 'git-head-content-addressed' ||
    value.artifactStore.repository !==
      'github.com/hyf0/rolldown-parallel-js-plugin' ||
    !HASH.test(value.artifactStore?.contentSha256 ?? '') ||
    value.artifactStore.root !==
      `research/artifacts/correctness/sha256/${value.artifactStore.contentSha256}` ||
    !Array.isArray(value.artifacts) ||
    value.artifacts.length === 0 ||
    correctnessArtifactSetAddress(value.artifacts) !==
      value.artifactStore.contentSha256
  ) {
    throw new Error(
      `${label} is not the committed independent Vue correctness manifest`,
    );
  }
}

function validateIndependentRaw(value, label, lane) {
  if (
    value?.schema !== 1 ||
    value.measurementClass !==
      'formal local wall evidence subject to host gates' ||
    value.admitted !== true ||
    value.node !== 'v24.18.0' ||
    !validIndependentRuntime(value.runtime) ||
    value.matrix?.lane !== lane ||
    value.matrix.protocol !== 'scale-crossover-protocol-amendment-4' ||
    !samePools(value.configuredPools, BASELINE_POOLS) ||
    value.harness?.clean !== true ||
    value.harness.statusSha256 !== EMPTY_SHA256 ||
    !COMMIT.test(value.harness?.commit ?? '') ||
    !HASH.test(value.harness?.sourceManifestSha256 ?? '') ||
    !validIndependentCorrectnessReference(value.correctnessEvidence) ||
    !Array.isArray(value.runs) ||
    value.runs.length === 0 ||
    INDEPENDENT_PROJECTS.some(({ projectId }) => {
      const expected =
        value.correctnessEvidence.projectCanonicalEvidenceSha256?.[projectId];
      const observed = new Set(
        value.runs
          .filter((run) => run.projectId === projectId)
          .map(({ canonicalEvidenceSha256 }) => canonicalEvidenceSha256),
      );
      return (
        !HASH.test(expected ?? '') ||
        observed.size !== 1 ||
        !observed.has(expected)
      );
    })
  ) {
    throw new Error(
      `${label} is not an admitted independent Vue ${lane} report`,
    );
  }
  validateIndependentRunGrid(value, label);
  validateTimedRuns(value.runs, label, 'independent-vue');
}

function validateIndependentSummary(value, label, lane) {
  if (
    value?.schema !== 1 ||
    value.measurementClass !==
      'formal local wall evidence subject to host gates' ||
    value.lane !== lane ||
    value.protocol !== 'scale-crossover-protocol-amendment-4' ||
    !HASH.test(value.rawArtifactSha256 ?? '') ||
    value.admitted !== true ||
    value.durableEligible !== true ||
    value.harness?.clean !== true ||
    value.harness.statusSha256 !== EMPTY_SHA256 ||
    !isDeepStrictEqual(value.runtimePin, LIFECYCLE_BASELINE) ||
    !validIndependentCorrectnessReference(value.correctnessEvidence) ||
    !HASH.test(value.canonicalSummarySha256 ?? '') ||
    !Array.isArray(value.projectSummaries) ||
    value.projectSummaries.length !== 3
  ) {
    throw new Error(
      `${label} is not a durable independent Vue ${lane} summary`,
    );
  }
  if (lane === 'independent-vue-wall-confirm') {
    for (const [
      index,
      { projectId, band, reachedSfcCount },
    ] of INDEPENDENT_PROJECTS.entries()) {
      const project = value.projectSummaries[index];
      if (
        project?.projectId !== projectId ||
        project.band !== band ||
        project.reachedSfcCount !== reachedSfcCount ||
        project.policyEvidence?.schema !== 1 ||
        project.policyEvidence.selectedOracleWorkerCount !==
          (project.selectedResourceWorker === null
            ? 0
            : Number(project.selectedResourceWorker?.slice('worker-'.length)))
      ) {
        throw new Error(
          `${label} changed the frozen independent Vue ${band} case`,
        );
      }
    }
  }
}

function validateMdxPerformanceRaw(value, label, sourceHashByPath) {
  const expectedConclusion = value?.evidenceKind === 'performance-confirmation';
  if (
    value?.schema !== 1 ||
    ![
      'performance-screen',
      'performance-refinement',
      'performance-confirmation',
    ].includes(value.evidenceKind) ||
    value.matrix?.evidenceKind !== value.evidenceKind ||
    value.measurementFieldsPresent !== true ||
    value.timingEligible !== true ||
    value.conclusionEligible !== expectedConclusion ||
    value.executionScope !== 'local-only' ||
    value.environment?.correctnessGate?.status !== 'passed' ||
    !HASH.test(value.environment?.correctnessGate?.sha256 ?? '') ||
    !samePools(value.matrix.poolEnvironment, BASELINE_POOLS) ||
    !samePools(value.environment?.childPoolEnvironment, BASELINE_POOLS) ||
    value.hostPolicyViolations?.length !== 0 ||
    value.validationErrors?.length !== 0 ||
    !Array.isArray(value.runs) ||
    value.runs.length === 0 ||
    !Array.isArray(value.hostAdmissionAttempts) ||
    value.hostAdmissionAttempts.length < value.runs.length
  ) {
    throw new Error(
      `${label} is not an admitted MDX crossover performance report`,
    );
  }
  requireMdxSourceRecord(
    value.runner,
    'run-matrix.mjs',
    sourceHashByPath,
    label,
  );
  requireMdxSourceRecord(
    value.caseRunner,
    'run-case.mjs',
    sourceHashByPath,
    label,
  );
  validateMdxRunGrid(value, label);
  validateTimedRuns(value.runs, label, 'mdx');
}

function validateMdxPerformanceLineage(value, requireLink) {
  const followup = value.matrix.followup;
  if (!followup) return;
  if (!MDX_CROSSOVER_STAGES.has(followup.stage)) {
    throw new Error(`MDX follow-up has unknown stage ${followup.stage}`);
  }
  requireLink('/matrix/followup/screenArtifactSha256', ['mdx-performance-raw']);
  for (let index = 0; index < followup.consumedArtifactSha256.length; index++) {
    requireLink(`/matrix/followup/consumedArtifactSha256/${index}`, [
      'mdx-performance-raw',
    ]);
  }
}

function validateMdxCrossoverComplete(value, label) {
  if (
    value?.schema !== 1 ||
    value.status !== 'complete' ||
    value.stage !== 'crossover-complete' ||
    value.decision?.schema !== 1 ||
    !MDX_TERMINAL_CROSSOVER_STATUSES.has(value.decision.mechanical?.status) ||
    !MDX_TERMINAL_CROSSOVER_STATUSES.has(value.decision.resource?.status) ||
    !Array.isArray(value.decision.points) ||
    value.decision.points.length < 2 ||
    !Array.isArray(value.consumedArtifactSha256) ||
    value.consumedArtifactSha256.length === 0 ||
    value.consumedArtifactSha256.some((digest) => !HASH.test(digest))
  ) {
    throw new Error(
      `${label} is not a terminal completed MDX crossover decision`,
    );
  }
  const scales = value.decision.points.map(({ scale }) => scale);
  if (
    new Set(scales).size !== scales.length ||
    !scales.includes(9157) ||
    scales.some(
      (scale) =>
        !Number.isSafeInteger(scale) ||
        scale <= 0 ||
        !value.decision.policyEvidenceByScale?.[String(scale)],
    )
  ) {
    throw new Error(`${label} lacks complete repeated MDX policy evidence`);
  }
  if (value.decision.resource.status === 'exact') {
    const roles = mdxRoleScales(value);
    for (const scale of Object.values(roles)) {
      if (!scales.includes(scale)) {
        throw new Error(`${label} lacks repeated evidence for MDX ${scale}`);
      }
    }
  }
}

function validateUnavailableMdxOutcome(value, label, stage) {
  if (
    !isDeepStrictEqual(Object.keys(value ?? {}).sort(), [
      'applicability',
      'crossoverArtifactSha256',
      'reason',
      'resourceStatus',
      'schema',
      'stage',
      'status',
    ]) ||
    value.schema !== 1 ||
    value.status !== 'unavailable' ||
    value.applicability !== 'not-applicable' ||
    value.stage !== stage ||
    value.reason !== 'resource-crossover-not-exact' ||
    !HASH.test(value.crossoverArtifactSha256 ?? '') ||
    !MDX_TERMINAL_CROSSOVER_STATUSES.has(value.resourceStatus) ||
    value.resourceStatus === 'exact'
  ) {
    throw new Error(`${label} is not the frozen unavailable MDX ${stage}`);
  }
}

function validateMdxPolicyRaw(value, label, sourceHashByPath) {
  const stage = value?.matrix?.policy?.stage;
  if (
    value?.schema !== 1 ||
    !MDX_POLICY_STAGES.includes(stage) ||
    value.evidenceKind !== stage ||
    value.matrix.evidenceKind !== stage ||
    value.measurementFieldsPresent !== true ||
    value.timingEligible !== true ||
    value.conclusionEligible !== false ||
    value.executionScope !== 'local-only' ||
    value.environment?.correctnessGate?.status !== 'passed' ||
    !HASH.test(value.environment?.correctnessGate?.sha256 ?? '') ||
    value.hostPolicyViolations?.length !== 0 ||
    value.validationErrors?.length !== 0 ||
    !Array.isArray(value.runs) ||
    value.runs.length === 0 ||
    !Array.isArray(value.hostAdmissionAttempts) ||
    value.hostAdmissionAttempts.length < value.runs.length
  ) {
    throw new Error(`${label} is not an admitted MDX policy report`);
  }
  requireMdxSourceRecord(
    value.runner,
    'run-policy-matrix.mjs',
    sourceHashByPath,
    label,
  );
  requireMdxSourceRecord(
    value.caseRunner,
    'run-case.mjs',
    sourceHashByPath,
    label,
  );
  requireMdxSourceRecord(
    value.launcher,
    'policy-node-launcher.mjs',
    sourceHashByPath,
    label,
  );
  validateMdxRunGrid(value, label);
  validateTimedRuns(value.runs, label, 'mdx-policy');
}

function validateMdxPolicyLineage(value, requireLink) {
  const policy = value.matrix.policy;
  validateEmbeddedCrossoverLineage(
    policy.crossover,
    '/matrix/policy/crossover',
    requireLink,
  );
  for (let index = 0; index < policy.consumedPolicyArtifacts.length; index++) {
    if (
      policy.consumedPolicyArtifacts[index].sha256 !==
      policy.consumedPolicyArtifactSha256[index]
    ) {
      throw new Error(`${policy.stage} policy lineage digest arrays differ`);
    }
    requireLink(`/matrix/policy/consumedPolicyArtifacts/${index}/sha256`, [
      'mdx-policy-raw',
    ]);
  }
  if (policy.stage.startsWith('quota-')) {
    requireLink('/matrix/policy/calibration/sha256', ['cpulimit-calibration']);
  } else if (policy.calibration !== null) {
    throw new Error(`${policy.stage} unexpectedly carries quota calibration`);
  }
}

function validateEmbeddedCrossoverLineage(crossover, base, requireLink) {
  if (
    crossover?.schema !== 1 ||
    crossover.criterion !== 'resource-acceptable' ||
    crossover.resource?.status !== 'exact' ||
    crossover.mechanical?.status !== 'exact' ||
    !HASH.test(crossover.decisionSha256 ?? '') ||
    !Array.isArray(crossover.followups) ||
    crossover.followups.length === 0
  ) {
    throw new Error(
      'MDX policy source lacks an exact completed crossover reference',
    );
  }
  requireLink(`${base}/baseScreen/sha256`, ['mdx-performance-raw']);
  for (let index = 0; index < crossover.followups.length; index++) {
    requireLink(`${base}/followups/${index}/sha256`, ['mdx-performance-raw']);
  }
}

function validateMdxAllocationComplete(value, label) {
  if (
    value?.schema !== 1 ||
    value.status !== 'complete' ||
    value.stage !== 'allocation-complete' ||
    !Array.isArray(value.consumedPolicyArtifactSha256) ||
    value.consumedPolicyArtifactSha256.length !== 4 ||
    !isDeepStrictEqual(
      value.consumedPolicyArtifacts?.map(({ sha256 }) => sha256),
      value.consumedPolicyArtifactSha256,
    ) ||
    value.tokioConfirmation?.evidenceKind !== 'allocation-tokio-confirmation' ||
    value.tokioConfirmation.timingEligible !== true ||
    value.tokioConfirmation.conclusionEligible !== false ||
    value.rayonConfirmation?.evidenceKind !== 'allocation-rayon-confirmation' ||
    value.rayonConfirmation.timingEligible !== true ||
    value.rayonConfirmation.conclusionEligible !== false
  ) {
    throw new Error(
      `${label} is not the completed four-stage MDX allocation chain`,
    );
  }
}

function validateCpulimitCalibration(value, label, sourceHashByPath) {
  const ciMarkers = [
    'BUILDKITE',
    'CI',
    'CIRCLECI',
    'GITHUB_ACTIONS',
    'JENKINS_URL',
    'TF_BUILD',
  ];
  const provenance = value?.controllerProvenance;
  if (
    value?.schemaVersion !== 2 ||
    value.kind !== 'cpulimit-apple-calibration' ||
    value.executionScope !== 'local-only' ||
    value.node !== 'v24.18.0' ||
    !isDeepStrictEqual(
      Object.keys(value.parentCiMarkers ?? {}).sort(),
      ciMarkers,
    ) ||
    Object.values(value.parentCiMarkers ?? {}).some(isActiveCiValue) ||
    !isDeepStrictEqual(value.machine, {
      platform: 'darwin',
      architecture: 'arm64',
      cpuModel: 'Apple M3 Pro',
      logicalCpuCount: 12,
      totalMemoryBytes: 38_654_705_664,
    }) ||
    value.formalProfile !== true ||
    value.passed !== true ||
    value.executionEnvironmentEligible !== true ||
    !isDeepStrictEqual(value.options, {
      durationMs: 10_000,
      threadCount: 8,
      repetitions: 3,
      equivalenceBlocks: 5,
      levels: [200, 400, 600, 800],
    }) ||
    !validCpulimitProvenance(provenance, sourceHashByPath) ||
    value.binarySha256 !== provenance.binary.sha256 ||
    value.patchSha256 !== provenance.patch.sha256 ||
    !Array.isArray(value.samples) ||
    value.samples.length !== 12 ||
    !Array.isArray(value.equivalence) ||
    value.equivalence.length !== 5
  ) {
    throw new Error(`${label} is not the passed formal cpulimit calibration`);
  }
  const expectedOrder = [
    [0, 200],
    [0, 400],
    [0, 600],
    [0, 800],
    [1, 800],
    [1, 600],
    [1, 400],
    [1, 200],
    [2, 200],
    [2, 400],
    [2, 600],
    [2, 800],
  ];
  const saturation = median(
    value.equivalence.map(({ controlled }) => {
      validateCalibrationLoad(controlled?.load);
      return controlled.load.averageCpuPercent;
    }),
  );
  if (!nearlyEqual(value.unconstrainedSaturationCpuPercent, saturation)) {
    throw new Error(
      `${label} saturation ceiling is not derived from raw no-stop pairs`,
    );
  }
  for (const [index, sample] of value.samples.entries()) {
    const [repetition, limitPercent] = expectedOrder[index];
    if (
      !isDeepStrictEqual(Object.keys(sample).sort(), [
        'controller',
        'limitPercent',
        'load',
        'mode',
        'repetition',
      ]) ||
      sample.mode !== 'controlled' ||
      sample.repetition !== repetition ||
      sample.limitPercent !== limitPercent ||
      Math.abs(sample.load.averageCpuPercent / limitPercent - 1) > 0.05
    ) {
      throw new Error(
        `${label} calibration sample ${index} is not admitted raw data`,
      );
    }
    validateCalibrationLoad(sample.load);
    validateControllerRecord(
      sample.controller,
      limitPercent,
      undefined,
      limitPercent < saturation * 0.95,
      sample.load.wallMs,
    );
  }
  const levelSummary = [200, 400, 600, 800].map((limitPercent) => {
    const selected = value.samples.filter(
      (sample) => sample.limitPercent === limitPercent,
    );
    const achieved = selected.map(({ load }) => load.averageCpuPercent);
    const ratios = achieved.map((entry) => entry / limitPercent);
    return {
      limitPercent,
      sampleCount: selected.length,
      achievedCpuPercent: achieved,
      achievedToTargetRatio: ratios,
      medianAchievedToTargetRatio: median(ratios),
      withinFivePercent: ratios.every(
        (ratio) => ratio >= 0.95 && ratio <= 1.05,
      ),
      controllerStopCycles: selected.map(
        ({ controller }) => controller.stopCycles,
      ),
      controllerStoppedMs: selected.map(
        ({ controller }) => controller.stoppedUs / 1_000,
      ),
    };
  });
  if (
    !isDeepStrictEqual(value.levelSummary, levelSummary) ||
    levelSummary.some(({ withinFivePercent }) => !withinFivePercent)
  ) {
    throw new Error(
      `${label} calibration pass is not derived from its level samples`,
    );
  }
  const wallRatios = [];
  const cpuRatios = [];
  for (const [block, pair] of value.equivalence.entries()) {
    const order =
      block % 2 === 0 ? ['direct', 'controlled'] : ['controlled', 'direct'];
    if (
      !isDeepStrictEqual(Object.keys(pair).sort(), [
        'block',
        'controlled',
        'cpuRatio',
        'direct',
        'order',
        'wallRatio',
      ]) ||
      pair.block !== block ||
      !isDeepStrictEqual(pair.order, order) ||
      !isDeepStrictEqual(Object.keys(pair.direct ?? {}).sort(), [
        'block',
        'load',
        'mode',
      ]) ||
      pair.direct.mode !== 'direct' ||
      pair.direct.block !== block ||
      !isDeepStrictEqual(Object.keys(pair.controlled ?? {}).sort(), [
        'block',
        'controller',
        'limitPercent',
        'load',
        'mode',
      ]) ||
      pair.controlled.mode !== 'controlled' ||
      pair.controlled.block !== block ||
      pair.controlled.limitPercent !== 1_200
    ) {
      throw new Error(
        `${label} calibration equivalence block ${block} is invalid`,
      );
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
      throw new Error(
        `${label} calibration equivalence ratios are copied incorrectly`,
      );
    }
    wallRatios.push(wallRatio);
    cpuRatios.push(cpuRatio);
  }
  const equivalenceSummary = {
    blocks: value.equivalence.length,
    medianWallRatio: median(wallRatios),
    medianCpuRatio: median(cpuRatios),
    wallWithinTwoPercent: Math.abs(median(wallRatios) - 1) <= 0.02,
    cpuWithinTwoPercent: Math.abs(median(cpuRatios) - 1) <= 0.02,
    noControllerStops: value.equivalence.every(
      ({ controlled }) => controlled.controller.stopCycles === 0,
    ),
  };
  if (
    value.controllerRecordsValid !== true ||
    !isDeepStrictEqual(value.equivalenceSummary, equivalenceSummary) ||
    !equivalenceSummary.wallWithinTwoPercent ||
    !equivalenceSummary.cpuWithinTwoPercent ||
    !equivalenceSummary.noControllerStops
  ) {
    throw new Error(
      `${label} calibration passed flag is not derived from equivalence raw data`,
    );
  }
}

function validateCalibrationLoad(load) {
  if (
    !isDeepStrictEqual(Object.keys(load ?? {}).sort(), [
      'averageCpuPercent',
      'cpuMs',
      'durationMs',
      'threadCount',
      'wallMs',
    ]) ||
    load.durationMs !== 10_000 ||
    load.threadCount !== 8 ||
    !Number.isFinite(load.wallMs) ||
    load.wallMs <= 0 ||
    !Number.isFinite(load.cpuMs) ||
    load.cpuMs <= 0 ||
    !nearlyEqual(load.averageCpuPercent, (load.cpuMs / load.wallMs) * 100)
  ) {
    throw new Error('CPU-rate calibration load record is incomplete');
  }
}

function isActiveCiValue(value) {
  return (
    value !== null &&
    value !== undefined &&
    !['', '0', 'false'].includes(String(value).toLowerCase())
  );
}

function validCpulimitProvenance(value, sourceHashByPath) {
  return (
    value?.schema === 1 &&
    value.upstreamUrl === CPULIMIT_UPSTREAM_URL &&
    value.upstreamCommit === CPULIMIT_UPSTREAM_COMMIT &&
    isDeepStrictEqual(value.sourceTree, {
      recordFormat: 'path + NUL + bytes + NUL + contentSha256 + LF',
      files: 20,
      bytes: 55_759,
      sha256: CPULIMIT_SOURCE_TREE_SHA256,
    }) &&
    typeof value.patch?.path === 'string' &&
    value.patch.path.length > 0 &&
    value.patch.sha256 === CPULIMIT_PATCH_SHA256 &&
    value.patch.sha256 ===
      sourceHashByPath.get(
        'experiments/cpu-rate-control/cpulimit-apple.patch',
      ) &&
    typeof value.binary?.path === 'string' &&
    value.binary.path.length > 0 &&
    value.binary.sha256 === CPULIMIT_BINARY_SHA256 &&
    value.calibrationHarness?.runCalibrationSha256 ===
      sourceHashByPath.get(
        'experiments/cpu-rate-control/run-calibration.mjs',
      ) &&
    value.calibrationHarness?.cpuLoadSha256 ===
      sourceHashByPath.get('experiments/cpu-rate-control/cpu-load.mjs')
  );
}

function nearlyEqual(left, right) {
  return (
    Math.abs(left - right) <=
    Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right)) * 8
  );
}

function validateMdxQuotaComplete(value, label) {
  if (
    value?.schema !== 1 ||
    value.status !== 'complete' ||
    value.stage !== 'quota-complete' ||
    !Array.isArray(value.consumedPolicyArtifactSha256) ||
    value.consumedPolicyArtifactSha256.length !== 2 ||
    !isDeepStrictEqual(
      value.consumedPolicyArtifacts?.map(({ sha256 }) => sha256),
      value.consumedPolicyArtifactSha256,
    ) ||
    !HASH.test(value.calibration?.sha256 ?? '') ||
    value.confirmation?.evidenceKind !== 'quota-confirmation' ||
    value.confirmation.timingEligible !== true ||
    value.confirmation.conclusionEligible !== false
  ) {
    throw new Error(`${label} is not the completed two-stage MDX quota chain`);
  }
}

function validateCrossSourceContracts(sources) {
  const byType = Map.groupBy(sources, ({ sourceType }) => sourceType);
  const exactlyOne = (type) => {
    const selected = byType.get(type) ?? [];
    if (selected.length !== 1) {
      throw new Error(
        `formal fixed-policy evidence requires exactly one ${type}`,
      );
    }
    return selected[0];
  };
  exactlyOne('machine-topology');
  const controlledHarnessSnapshot = exactlyOne(
    'vue-controlled-harness-source-snapshot',
  );
  const controlledRaw = exactlyOne('vue-controlled-confirmation-raw');
  const controlledSummary = exactlyOne('vue-controlled-confirmation-summary');
  const controlledAdmissionRaw = exactlyOne('vue-controlled-admission-raw');
  const controlledAdmissionPointer = exactlyOne(
    'vue-controlled-admission-pointer',
  );
  const controlledCorrectnessRaw = exactlyOne('vue-controlled-correctness-raw');
  const controlledCorrectnessPointer = exactlyOne(
    'vue-controlled-correctness-pointer',
  );
  if (
    controlledHarnessSnapshot.document.commit !==
      controlledRaw.document.fixture.commit ||
    !isDeepStrictEqual(
      controlledHarnessSnapshot.document.harnessSourceManifest,
      controlledRaw.document.harnessSourceManifest,
    )
  ) {
    throw new Error(
      'controlled Vue harness manifest does not bind the committed source snapshot',
    );
  }
  if (
    controlledSummary.document.sourceReportSha256 !== controlledRaw.sha256 ||
    !isDeepStrictEqual(
      controlledSummary.document.runtime,
      controlledRaw.document.runtime,
    ) ||
    !isDeepStrictEqual(
      controlledSummary.document.fixture,
      controlledRaw.document.fixture,
    )
  ) {
    throw new Error(
      'controlled Vue summary differs from its exact raw provenance',
    );
  }
  for (const source of [controlledAdmissionRaw, controlledCorrectnessRaw]) {
    if (
      !isDeepStrictEqual(
        source.document.harnessSourceManifest,
        controlledRaw.document.harnessSourceManifest,
      )
    ) {
      throw new Error(
        'controlled Vue admission/correctness/wall evidence does not bind one harness manifest',
      );
    }
  }
  for (const [pointer, raw] of [
    [controlledAdmissionPointer, controlledAdmissionRaw],
    [controlledCorrectnessPointer, controlledCorrectnessRaw],
  ]) {
    if (
      pointer.document.harnessSourceManifest.aggregateSha256 !==
        raw.document.harnessSourceManifest.aggregateSha256 ||
      pointer.document.harnessSourceManifest.files !==
        raw.document.harnessSourceManifest.files ||
      pointer.document.harnessSourceManifest.bytes !==
        raw.document.harnessSourceManifest.bytes ||
      pointer.document.fixtureCommit !== raw.document.fixture.commit ||
      pointer.document.raw.sha256 !== raw.sha256 ||
      pointer.document.raw.bytes !== raw.bytes
    ) {
      throw new Error(
        'controlled Vue pointer does not strictly bind its raw report',
      );
    }
  }
  const controlledPolicyEvidence = deriveControlledPolicyEvidence(
    controlledRaw.document,
  );
  if (
    !isDeepStrictEqual(
      controlledSummary.document.policyEvidence,
      controlledPolicyEvidence,
    )
  ) {
    throw new Error(
      'controlled Vue summary policy metrics or oracle differ from raw repeated runs',
    );
  }
  const controlledResourceCrossover = deriveControlledResourceCrossover(
    controlledRaw.document,
  );
  const controlledMechanicalCrossover = deriveControlledMechanicalCrossover(
    controlledRaw.document,
  );
  if (
    !isDeepStrictEqual(
      controlledSummary.document.mechanicalCrossover,
      controlledMechanicalCrossover,
    ) ||
    !isDeepStrictEqual(
      controlledSummary.document.resourceAcceptableCrossover,
      controlledResourceCrossover,
    )
  ) {
    throw new Error(
      'controlled Vue crossover and formal roles differ from raw repeated runs',
    );
  }
  const independentRaw = exactlyOne('vue-independent-confirmation-raw');
  const independentSummary = exactlyOne('vue-independent-confirmation-summary');
  const independentScreenRaw = exactlyOne('vue-independent-screen-raw');
  const independentScreenSummary = exactlyOne('vue-independent-screen-summary');
  const independentManifest = exactlyOne(
    'vue-independent-correctness-manifest',
  );
  if (
    independentSummary.document.rawArtifactSha256 !== independentRaw.sha256 ||
    !isDeepStrictEqual(
      independentSummary.document.harness,
      independentRaw.document.harness,
    ) ||
    !isDeepStrictEqual(
      independentSummary.document.runtimePin,
      independentRaw.document.runtime?.profile,
    ) ||
    independentSummary.document.matrixSha256 !==
      independentRaw.document.matrixSha256 ||
    !isDeepStrictEqual(
      independentSummary.document.correctnessEvidence,
      compactIndependentCorrectnessEvidence(
        independentRaw.document.correctnessEvidence,
      ),
    )
  ) {
    throw new Error(
      'independent Vue summary differs from its exact raw provenance',
    );
  }
  if (
    !isDeepStrictEqual(
      independentScreenRaw.document.harness,
      independentRaw.document.harness,
    ) ||
    !isDeepStrictEqual(
      independentScreenRaw.document.runtime?.profile,
      independentRaw.document.runtime?.profile,
    ) ||
    !isDeepStrictEqual(
      independentScreenRaw.document.correctnessEvidence,
      independentRaw.document.correctnessEvidence,
    ) ||
    !isDeepStrictEqual(
      independentScreenSummary.document.correctnessEvidence,
      compactIndependentCorrectnessEvidence(
        independentScreenRaw.document.correctnessEvidence,
      ),
    )
  ) {
    throw new Error(
      'independent Vue screen and confirmation do not bind one clean harness/runtime',
    );
  }
  for (const source of [independentScreenRaw, independentRaw]) {
    const reference = source.document.correctnessEvidence.manifest;
    if (
      reference.sha256 !== independentManifest.sha256 ||
      reference.bytes !== independentManifest.bytes ||
      reference.repository !==
        independentManifest.document.artifactStore.repository ||
      reference.contentSha256 !==
        independentManifest.document.artifactStore.contentSha256
    ) {
      throw new Error(
        'independent Vue correctness reference does not bind the committed content-addressed manifest',
      );
    }
  }
  const independentPolicyEvidence = deriveIndependentPolicyEvidence(
    independentRaw.document,
  );
  for (const project of independentSummary.document.projectSummaries) {
    if (
      !isDeepStrictEqual(
        project.policyEvidence,
        independentPolicyEvidence[project.projectId],
      )
    ) {
      throw new Error(
        `${project.projectId} independent Vue policy metrics or oracle differ from raw repeated runs`,
      );
    }
  }
  validateIndependentScreenConfirmation(
    independentScreenRaw.document,
    independentRaw.document,
  );
  const crossover = exactlyOne('mdx-crossover-complete');
  validateMdxCrossoverArtifacts(crossover, sources);
  const allocation = exactlyOne('mdx-allocation-complete');
  const quota = exactlyOne('mdx-quota-complete');
  if (crossover.document.decision.resource.status !== 'exact') {
    for (const [source, stage] of [
      [allocation, 'allocation-unavailable'],
      [quota, 'quota-unavailable'],
    ]) {
      if (
        source.document.crossoverArtifactSha256 !== crossover.sha256 ||
        source.document.resourceStatus !==
          crossover.document.decision.resource.status ||
        source.document.stage !== stage
      ) {
        throw new Error(
          `${stage} does not bind the same non-exact MDX terminal crossover`,
        );
      }
    }
    if (
      (byType.get('mdx-policy-raw') ?? []).length > 0 ||
      (byType.get('cpulimit-calibration') ?? []).length > 0
    ) {
      throw new Error(
        'non-exact MDX crossover must not carry inapplicable allocation or quota timing',
      );
    }
    return;
  }
  validateMdxAllocationArtifacts(allocation, sources);
  validateMdxQuotaArtifacts(quota, sources);
  validateEmbeddedCrossoverAgainstComplete(
    allocation.document.crossover,
    crossover.document,
    sources,
  );
  validateEmbeddedCrossoverAgainstComplete(
    quota.document.crossover,
    crossover.document,
    sources,
  );
  if (
    !isDeepStrictEqual(allocation.document.crossover, quota.document.crossover)
  ) {
    throw new Error(
      'allocation and quota do not bind the same rederived MDX crossover',
    );
  }
}

function validateEmbeddedCrossoverAgainstComplete(
  reference,
  complete,
  sources,
) {
  const points = [
    ...new Set([
      complete.decision.resource.previousScale,
      complete.decision.resource.scale,
      complete.decision.resource.confirmingNextScale,
      9157,
    ]),
  ];
  const quotaPoints = [...new Set([complete.decision.resource.scale, 9157])];
  const firstFollowup = sources.find(
    ({ sha256 }) => sha256 === complete.consumedArtifactSha256[0],
  );
  const baseScreenSha256 =
    firstFollowup?.document.matrix?.followup?.screenArtifactSha256;
  const decisionSha256 = createHash('sha256')
    .update(JSON.stringify(complete.decision))
    .digest('hex');
  if (
    reference.decisionSha256 !== decisionSha256 ||
    reference.baseScreen?.sha256 !== baseScreenSha256 ||
    !isDeepStrictEqual(
      reference.followups.map(({ sha256 }) => sha256),
      complete.consumedArtifactSha256,
    ) ||
    !isDeepStrictEqual(reference.mechanical, complete.decision.mechanical) ||
    !isDeepStrictEqual(reference.resource, complete.decision.resource) ||
    !isDeepStrictEqual(reference.points, points) ||
    !isDeepStrictEqual(reference.quotaPoints, quotaPoints) ||
    !isDeepStrictEqual(
      reference.policyEvidenceByScale,
      complete.decision.policyEvidenceByScale,
    )
  ) {
    throw new Error(
      'allocation or quota embedded crossover is not the unique rederived MDX completion',
    );
  }
}

function validateIndependentScreenConfirmation(screen, confirmation) {
  if (
    !isDeepStrictEqual(
      screen.matrix.cases.map(({ projectId, band, reachedSfcCount }) => ({
        projectId,
        band,
        reachedSfcCount,
      })),
      confirmation.matrix.cases.map(({ projectId, band, reachedSfcCount }) => ({
        projectId,
        band,
        reachedSfcCount,
      })),
    )
  ) {
    throw new Error(
      'independent Vue screen and confirmation do not contain one definition per frozen project',
    );
  }
  if (
    confirmation.matrix.generatedFrom?.screenRawSha256 !==
    confirmation.screenEvidence?.raw?.sha256
  ) {
    throw new Error(
      'independent Vue confirmation does not bind its exact screen raw',
    );
  }
  for (const screenCase of screen.matrix.cases) {
    if (
      screenCase.repeats !== 1 ||
      !isDeepStrictEqual(screenCase.variants, [
        'ordinary',
        'worker-1',
        'worker-2',
        'worker-3',
        'worker-4',
        'worker-5',
        'worker-6',
        'worker-7',
        'worker-8',
      ])
    ) {
      throw new Error(
        `${screenCase.projectId} is not the full independent Vue screen grid`,
      );
    }
    const runs = screen.runs.filter(
      ({ projectId }) => projectId === screenCase.projectId,
    );
    const ordinary = runs.find(({ variant }) => variant === 'ordinary');
    const eligible = runs.filter(
      (run) =>
        run.variant !== 'ordinary' &&
        run.totalCpuMs / ordinary.totalCpuMs <= 2 &&
        run.peakRssBytes / ordinary.peakRssBytes <= 2 &&
        run.peakRssBytes < 27 * 1024 ** 3 &&
        run.pagingDelta.pageouts === 0 &&
        run.pagingDelta.swapouts === 0 &&
        run.canonicalEvidenceSha256 === ordinary.canonicalEvidenceSha256,
    );
    const workerRuns = runs.filter(({ variant }) => variant !== 'ordinary');
    const screenSelectionStatus =
      eligible.length > 0
        ? 'resource-envelope-eligible'
        : 'no-resource-envelope-worker';
    const best = [...(eligible.length > 0 ? eligible : workerRuns)].sort(
      (left, right) =>
        left.timeRealMs - right.timeRealMs ||
        Number(left.variant.slice('worker-'.length)) -
          Number(right.variant.slice('worker-'.length)),
    )[0];
    if (!best) throw new Error(`${screenCase.projectId} screen has no worker`);
    const workerCount = Number(best.variant.slice('worker-'.length));
    const expectedVariants = independentConfirmationVariants(workerCount);
    const expectedRepeats =
      Math.max(ordinary.timeRealMs, best.timeRealMs) < 2000 ? 15 : 10;
    const definition = confirmation.matrix.cases.find(
      ({ projectId }) => projectId === screenCase.projectId,
    );
    if (
      !definition ||
      definition.screenSelectionStatus !== screenSelectionStatus ||
      definition.selectedScreenWorkerCount !== workerCount ||
      definition.screenBelowTwoSeconds !== (expectedRepeats === 15) ||
      definition.repeats !== expectedRepeats ||
      !isDeepStrictEqual(definition.variants, expectedVariants)
    ) {
      throw new Error(
        `${screenCase.projectId} confirmation is not the screen-selected best plus adjacent workers`,
      );
    }
  }
}

function independentConfirmationVariants(workerCount) {
  return [
    'ordinary',
    ...[...new Set([workerCount - 1, workerCount, workerCount + 1, 4, 8])]
      .filter((count) => count >= 1 && count <= 8)
      .sort((left, right) => left - right)
      .map((count) => `worker-${count}`),
  ];
}

function validateMdxCrossoverArtifacts(complete, sources) {
  const reports = complete.document.consumedArtifactSha256.map((digest) =>
    sources.find(({ sha256 }) => sha256 === digest),
  );
  if (reports.some(({ sourceType }) => sourceType !== 'mdx-performance-raw')) {
    throw new Error(
      'completed MDX crossover consumes a non-performance artifact',
    );
  }
  const baseSha256 = reports[0]?.document.matrix.followup.screenArtifactSha256;
  const base = sources.find(({ sha256 }) => sha256 === baseSha256);
  if (!base || base.sourceType !== 'mdx-performance-raw') {
    throw new Error('completed MDX crossover lacks its exact base screen');
  }
  const screenRecord = formalMdxRecord(base);
  const prior = [];
  for (const source of reports) {
    const expected = planScaleFollowup({
      screenRecord,
      followupRecords: prior,
      manifest: MDX_SCALE_MANIFEST,
    });
    if (
      expected.status !== 'matrix-required' ||
      !isDeepStrictEqual(source.document.matrix, expected.matrix)
    ) {
      throw new Error(
        'MDX follow-up is not the exact production-generated next stage',
      );
    }
    prior.push(formalMdxRecord(source));
  }
  const expectedComplete = planScaleFollowup({
    screenRecord,
    followupRecords: prior,
    manifest: MDX_SCALE_MANIFEST,
  });
  if (!isDeepStrictEqual(complete.document, expectedComplete)) {
    throw new Error(
      'completed MDX crossover is not the exact production planner result',
    );
  }
  const repeatedPoints = new Map();
  for (const { document } of reports) {
    if (document.evidenceKind !== 'performance-confirmation') continue;
    for (const definition of document.matrix.cases) {
      if (repeatedPoints.has(definition.selectionScale)) {
        throw new Error(
          `completed MDX crossover repeats scale ${definition.selectionScale} twice`,
        );
      }
      repeatedPoints.set(
        definition.selectionScale,
        summarizeRepeatedPolicyCase(document, definition),
      );
    }
  }
  const requiredScales =
    complete.document.decision.resource.status === 'exact'
      ? Object.values(mdxRoleScales(complete.document))
      : complete.document.decision.points.map(({ scale }) => scale);
  for (const scale of requiredScales) {
    if (!repeatedPoints.has(scale)) {
      throw new Error(
        `completed MDX crossover lacks a confirmation raw report at ${scale}`,
      );
    }
  }
  const expectedDecision = analyzeCrossover(
    complete.document.direction,
    repeatedPoints,
  );
  if (!isDeepStrictEqual(complete.document.decision, expectedDecision)) {
    throw new Error(
      'completed MDX crossover decision or policy evidence is not derived from raw repeated runs',
    );
  }
}

function formalMdxRecord(source) {
  return {
    path: source.path,
    sha256: source.sha256,
    report: source.document,
  };
}

function validateMdxAllocationArtifacts(complete, sources) {
  const value = complete.document;
  const reports = value.consumedPolicyArtifactSha256.map((digest) =>
    sources.find(({ sha256 }) => sha256 === digest),
  );
  const stages = reports.map(({ document }) => document.matrix.policy.stage);
  if (!isDeepStrictEqual(stages, MDX_POLICY_STAGES.slice(0, 4))) {
    throw new Error(
      'completed MDX allocation does not consume the exact four generated stages',
    );
  }
  if (
    reports.some(
      ({ document }) =>
        !isDeepStrictEqual(document.matrix.policy.crossover, value.crossover),
    )
  ) {
    throw new Error('allocation stages do not bind their completed crossover');
  }
  const [tokioScreen, tokioConfirmation, rayonScreen, rayonConfirmation] =
    reports.map(({ document }) => document);
  validateTokioScreenGrid(tokioScreen, value.crossover.points);
  assertSummaryMatchesPolicyRaw(value.tokioConfirmation, tokioConfirmation);
  assertSummaryMatchesPolicyRaw(value.rayonConfirmation, rayonConfirmation);
  const roles = mdxPolicyRoleScales(value.crossover);
  for (const scale of Object.values(roles)) {
    const tokioCases = value.tokioConfirmation.cases.filter(
      (entry) => entry.scale === scale,
    );
    const tokioRawCases = tokioConfirmation.matrix.cases.filter(
      (entry) => entry.selectionScale === scale,
    );
    assertFinalistPair(
      tokioCases,
      tokioRawCases,
      tokioScreen,
      'ROLLDOWN_WORKER_THREADS',
      scale,
    );
    const tokioWinner = chooseRepeatedPoolWinner(
      tokioCases,
      'ROLLDOWN_WORKER_THREADS',
    );
    if (
      !isDeepStrictEqual(
        value.repeatedWinnerByScale?.tokio?.[String(scale)],
        tokioWinner,
      )
    ) {
      throw new Error(
        `MDX allocation Tokio winner at ${scale} is not source-computed`,
      );
    }
    const selectedTokio = String(tokioWinner.poolCount);
    const tokioWinnerEntry = tokioCases.find(
      ({ key }) => key === tokioWinner.caseKey,
    );
    validateRayonScreenGrid(
      rayonScreen,
      scale,
      selectedTokio,
      Object.keys(tokioWinnerEntry.policyEvidence.variants),
    );
    for (const report of [rayonScreen, rayonConfirmation]) {
      const cases = report.matrix.cases.filter(
        (entry) => entry.selectionScale === scale,
      );
      if (
        cases.length === 0 ||
        cases.some(
          ({ poolEnvironment }) =>
            poolEnvironment.ROLLDOWN_WORKER_THREADS !== selectedTokio,
        )
      ) {
        throw new Error(
          `MDX allocation Rayon stage did not retain Tokio ${selectedTokio}`,
        );
      }
    }
    const rayonCases = value.rayonConfirmation.cases.filter(
      (entry) => entry.scale === scale,
    );
    const rayonRawCases = rayonConfirmation.matrix.cases.filter(
      (entry) => entry.selectionScale === scale,
    );
    assertFinalistPair(
      rayonCases,
      rayonRawCases,
      rayonScreen,
      'RAYON_NUM_THREADS',
      scale,
    );
    const rayonWinner = chooseRepeatedPoolWinner(
      rayonCases,
      'RAYON_NUM_THREADS',
    );
    if (
      !isDeepStrictEqual(
        value.repeatedWinnerByScale?.rayon?.[String(scale)],
        rayonWinner,
      )
    ) {
      throw new Error(
        `MDX allocation Rayon winner at ${scale} is not source-computed`,
      );
    }
  }
  if (
    tokioScreen.matrix.cases.some(
      ({ poolEnvironment }) =>
        poolEnvironment.RAYON_NUM_THREADS !== '12' ||
        poolEnvironment.ROLLDOWN_MAX_BLOCKING_THREADS !== '4',
    )
  ) {
    throw new Error('Tokio screen changed its frozen companion pools');
  }
}

function validateMdxQuotaArtifacts(complete, sources) {
  const value = complete.document;
  const reports = value.consumedPolicyArtifactSha256.map((digest) =>
    sources.find(({ sha256 }) => sha256 === digest),
  );
  const stages = reports.map(({ document }) => document.matrix.policy.stage);
  if (!isDeepStrictEqual(stages, MDX_POLICY_STAGES.slice(4))) {
    throw new Error(
      'completed MDX quota does not consume the exact screen/confirmation stages',
    );
  }
  if (
    reports.some(
      ({ document }) =>
        !isDeepStrictEqual(document.matrix.policy.crossover, value.crossover),
    )
  ) {
    throw new Error('quota stages do not bind their completed crossover');
  }
  assertSummaryMatchesPolicyRaw(value.confirmation, reports[1].document);
  validateQuotaScreenConfirmation(
    reports[0].document,
    reports[1].document,
    value.crossover,
  );
  for (const report of reports) {
    if (
      report.document.matrix.cases.some(
        ({ poolEnvironment }) => !samePools(poolEnvironment, BASELINE_POOLS),
      )
    ) {
      throw new Error('MDX quota stage changed the frozen baseline pools');
    }
  }
}

function assertSummaryMatchesPolicyRaw(summary, raw) {
  const expected = deriveRepeatedPolicySummary(raw);
  if (!isDeepStrictEqual(summary, expected)) {
    throw new Error(
      `${raw.evidenceKind} compact policy metrics, oracle, or winner differ from raw runs`,
    );
  }
}

function validateTokioScreenGrid(report, scales) {
  const fullVariants = [
    'ordinary',
    'worker-1',
    'worker-2',
    'worker-3',
    'worker-4',
    'worker-5',
    'worker-6',
    'worker-7',
    'worker-8',
  ];
  for (const scale of scales) {
    const cases = report.matrix.cases.filter(
      ({ selectionScale }) => selectionScale === scale,
    );
    if (
      !isDeepStrictEqual(
        cases.map(({ poolEnvironment }) =>
          Number(poolEnvironment.ROLLDOWN_WORKER_THREADS),
        ),
        [4, 8, 12, 18],
      ) ||
      cases.some(
        (definition) =>
          definition.repeats !== 1 ||
          !isDeepStrictEqual(definition.variants, fullVariants) ||
          definition.poolEnvironment.RAYON_NUM_THREADS !== '12' ||
          definition.poolEnvironment.ROLLDOWN_MAX_BLOCKING_THREADS !== '4',
      )
    ) {
      throw new Error(
        `MDX Tokio screen at ${scale} is not the frozen 4/8/12/18 grid`,
      );
    }
  }
}

function validateRayonScreenGrid(report, scale, tokio, variants) {
  const cases = report.matrix.cases.filter(
    ({ selectionScale }) => selectionScale === scale,
  );
  if (
    !isDeepStrictEqual(
      cases.map(({ poolEnvironment }) =>
        Number(poolEnvironment.RAYON_NUM_THREADS),
      ),
      [4, 8, 12],
    ) ||
    cases.some(
      (definition) =>
        definition.repeats !== 1 ||
        !isDeepStrictEqual(definition.variants, variants) ||
        definition.poolEnvironment.ROLLDOWN_WORKER_THREADS !== tokio ||
        definition.poolEnvironment.ROLLDOWN_MAX_BLOCKING_THREADS !== '4',
    )
  ) {
    throw new Error(
      `MDX Rayon screen at ${scale} is not the generated 4/8/12 grid`,
    );
  }
}

function validateQuotaScreenConfirmation(screen, confirmation, crossover) {
  const fullVariants = [
    'ordinary',
    'worker-1',
    'worker-2',
    'worker-3',
    'worker-4',
    'worker-5',
    'worker-6',
    'worker-7',
    'worker-8',
  ];
  for (const scale of crossover.quotaPoints) {
    for (const quotaPercent of [400, 800, 1200]) {
      const source = screen.matrix.cases.filter(
        (definition) =>
          definition.selectionScale === scale &&
          definition.quotaPercent === quotaPercent,
      );
      if (
        source.length !== 1 ||
        source[0].repeats !== 1 ||
        !isDeepStrictEqual(source[0].variants, fullVariants) ||
        !samePools(source[0].poolEnvironment, BASELINE_POOLS)
      ) {
        throw new Error(
          `MDX quota screen ${scale}/${quotaPercent} is not the full worker grid`,
        );
      }
      const selection = selectSingleScreenCandidate(screen, source[0]);
      const oracle =
        crossover.policyEvidenceByScale[String(scale)]
          .selectedOracleWorkerCount;
      const definition = confirmation.matrix.cases.filter(
        (candidate) =>
          candidate.selectionScale === scale &&
          candidate.quotaPercent === quotaPercent,
      );
      if (
        definition.length !== 1 ||
        definition[0].repeats !== 10 ||
        !isDeepStrictEqual(
          definition[0].variants,
          confirmationVariants(selection.workerCount, oracle),
        ) ||
        !isDeepStrictEqual(definition[0].selection, {
          ...selection,
          crossoverOracleWorkerCount: oracle,
        }) ||
        !samePools(definition[0].poolEnvironment, BASELINE_POOLS)
      ) {
        throw new Error(
          `MDX quota confirmation ${scale}/${quotaPercent} is not generated from its screen`,
        );
      }
    }
  }
}

function selectSingleScreenCandidate(report, definition) {
  const runs = report.runs.filter(({ name }) => name === definition.name);
  const ordinary = runs.find(({ variant }) => variant === 'ordinary');
  const ordinaryWall = policyWall(ordinary);
  const ordinaryCpu = policyCpu(ordinary);
  const candidates = runs
    .filter(({ variant }) => variant !== 'ordinary')
    .map((run) => ({
      caseKey: policyCaseKey(definition),
      poolCount: Number(definition.poolEnvironment.ROLLDOWN_WORKER_THREADS),
      workerCount: Number(run.variant.slice('worker-'.length)),
      wallMs: policyWall(run),
      screenResourceEligible:
        ordinaryWall / policyWall(run) >= 1.1 &&
        policyCpu(run) / ordinaryCpu <= 2 &&
        run.peakRssBytes / ordinary.peakRssBytes <= 2 &&
        run.peakRssBytes < 27 * 1024 ** 3,
    }));
  const eligible = candidates.filter(({ screenResourceEligible }) =>
    Boolean(screenResourceEligible),
  );
  const selected = chooseScreenCandidate(
    eligible.length > 0 ? eligible : candidates,
  );
  return {
    ...selected,
    selectionKind:
      eligible.length > 0
        ? 'screen-resource-eligible'
        : 'screen-fastest-fallback',
    screenConclusionEligible: false,
  };
}

export function deriveRepeatedPolicySummary(raw) {
  const cases = raw.matrix.cases.map((definition) => {
    if (definition.repeats !== 10) {
      throw new Error(
        `${definition.name} is not repeated confirmation evidence`,
      );
    }
    const evidence = summarizeRepeatedPolicyCase(raw, definition);
    return {
      key: policyCaseKey(definition),
      scale: definition.selectionScale,
      poolEnvironment: definition.poolEnvironment,
      quotaPercent: definition.quotaPercent ?? null,
      repeated: true,
      policyEvidence: evidence.policyEvidence,
      selection: {
        mechanicalWorkerCount: evidence.mechanical.worker.workerCount,
        resourceOracleWorkerCount:
          evidence.policyEvidence.selectedOracleWorkerCount,
      },
    };
  });
  return {
    schema: 1,
    evidenceKind: raw.evidenceKind,
    timingEligible: true,
    conclusionEligible: false,
    sourcePolicy: raw.matrix.policy,
    policyEvidenceByCase: Object.fromEntries(
      cases.map((entry) => [entry.key, entry.policyEvidence]),
    ),
    cases,
  };
}

function assertFinalistPair(summaryCases, rawCases, screenRaw, poolKey, scale) {
  const kinds = rawCases
    .map(({ selection }) => selection?.rustPoolCandidateKind)
    .sort();
  const counts = new Set(
    rawCases.map(({ poolEnvironment }) => poolEnvironment[poolKey]),
  );
  if (
    summaryCases.length !== 2 ||
    rawCases.length !== 2 ||
    counts.size !== 2 ||
    !isDeepStrictEqual(kinds, ['different-pool-runner-up', 'screen-selected'])
  ) {
    throw new Error(
      `MDX ${poolKey} finalists at ${scale} are not selected winner and runner-up`,
    );
  }
  const expected = selectScreenPairsFromRaw(screenRaw, scale, poolKey);
  const orderedRaw = [...rawCases].sort(
    (left, right) =>
      left.selection.confirmationCandidate -
      right.selection.confirmationCandidate,
  );
  for (const [index, selection] of expected.entries()) {
    const definition = orderedRaw[index];
    if (
      definition.poolEnvironment[poolKey] !== String(selection.poolCount) ||
      definition.selection?.caseKey !== selection.caseKey ||
      definition.selection.poolCount !== selection.poolCount ||
      definition.selection.workerCount !== selection.workerCount ||
      definition.selection.wallMs !== selection.wallMs ||
      definition.selection.selectionKind !== selection.selectionKind ||
      definition.selection.rustPoolCandidateKind !==
        selection.rustPoolCandidateKind ||
      definition.selection.screenConclusionEligible !== false ||
      definition.selection.confirmationCandidate !== index + 1 ||
      !isDeepStrictEqual(
        definition.variants,
        confirmationVariants(selection.workerCount),
      )
    ) {
      throw new Error(
        `MDX ${poolKey} finalist ${index + 1} at ${scale} is not screen-computed`,
      );
    }
  }
}

function selectScreenPairsFromRaw(report, scale, poolKey) {
  const definitions = report.matrix.cases.filter(
    ({ selectionScale }) => selectionScale === scale,
  );
  const candidates = definitions.flatMap((definition) => {
    const runs = report.runs.filter(({ name }) => name === definition.name);
    const ordinary = runs.find(({ variant }) => variant === 'ordinary');
    if (!ordinary) throw new Error(`${definition.name} screen omits ordinary`);
    const ordinaryWall = policyWall(ordinary);
    const ordinaryCpu = policyCpu(ordinary);
    return runs.flatMap((run) => {
      if (run.variant === 'ordinary') return [];
      const workerCount = Number(/^worker-([1-8])$/.exec(run.variant)?.[1]);
      if (!Number.isSafeInteger(workerCount)) {
        throw new Error(`${definition.name} has an invalid screen worker`);
      }
      const wallMs = policyWall(run);
      const resourceEligible =
        ordinaryWall / wallMs >= 1.1 &&
        policyCpu(run) / ordinaryCpu <= 2 &&
        run.peakRssBytes / ordinary.peakRssBytes <= 2 &&
        run.peakRssBytes < 27 * 1024 ** 3;
      return [
        {
          caseKey: policyCaseKey(definition),
          poolCount: Number(definition.poolEnvironment[poolKey]),
          workerCount,
          wallMs,
          screenResourceEligible: resourceEligible,
          recomputedResourceEligible: resourceEligible,
        },
      ];
    });
  });
  const eligible = candidates.filter(
    ({ screenResourceEligible }) => screenResourceEligible,
  );
  const primary = chooseScreenCandidate(
    eligible.length > 0 ? eligible : candidates,
  );
  const otherPoolCandidates = candidates.filter(
    ({ poolCount }) => poolCount !== primary.poolCount,
  );
  const otherEligible = otherPoolCandidates.filter(
    ({ screenResourceEligible }) => screenResourceEligible,
  );
  if (otherPoolCandidates.length === 0) {
    throw new Error(`MDX ${poolKey} screen has no different-pool runner-up`);
  }
  const secondary = chooseScreenCandidate(
    otherEligible.length > 0 ? otherEligible : otherPoolCandidates,
  );
  return [
    {
      ...primary,
      selectionKind:
        eligible.length > 0
          ? 'screen-resource-eligible'
          : 'screen-fastest-fallback',
      rustPoolCandidateKind: 'screen-selected',
      screenConclusionEligible: false,
    },
    {
      ...secondary,
      selectionKind:
        otherEligible.length > 0
          ? 'screen-resource-eligible-runner-up'
          : 'screen-runner-up-fallback',
      rustPoolCandidateKind: 'different-pool-runner-up',
      screenConclusionEligible: false,
    },
  ];
}

function chooseScreenCandidate(candidates) {
  const ordered = [...candidates].sort(
    (left, right) =>
      left.wallMs - right.wallMs ||
      left.workerCount - right.workerCount ||
      left.poolCount - right.poolCount,
  );
  if (ordered.length === 0) {
    throw new Error('MDX pool screen has no worker candidate');
  }
  const fastest = ordered[0];
  return ordered
    .filter(({ wallMs }) => (wallMs - fastest.wallMs) / fastest.wallMs < 0.02)
    .sort(
      (left, right) =>
        left.workerCount - right.workerCount ||
        left.poolCount - right.poolCount,
    )[0];
}

function confirmationVariants(workerCount, extraWorkerCount) {
  return [
    ...new Set([
      'ordinary',
      ...(workerCount > 0 ? [`worker-${workerCount}`] : []),
      ...(workerCount > 1 ? [`worker-${workerCount - 1}`] : []),
      ...(workerCount > 0 && workerCount < 8
        ? [`worker-${workerCount + 1}`]
        : []),
      ...(extraWorkerCount > 0 ? [`worker-${extraWorkerCount}`] : []),
      'worker-4',
      'worker-8',
    ]),
  ];
}

function policyWall(run) {
  return run.policyWallMs ?? run.totalElapsedMs;
}

function policyCpu(run) {
  return run.externalTiming
    ? run.externalTiming.userMs + run.externalTiming.systemMs
    : run.cpuUserMs + run.cpuSystemMs;
}

function chooseRepeatedPoolWinner(cases, poolKey) {
  const candidates = cases.map((entry) => {
    const workerCount = entry.policyEvidence.selectedOracleWorkerCount;
    const variant = workerCount === 0 ? 'ordinary' : `worker-${workerCount}`;
    const evidence = entry.policyEvidence.variants[variant];
    if (!evidence)
      throw new Error(`${entry.key} lacks its repeated selected oracle`);
    return {
      entry,
      poolCount: Number(entry.poolEnvironment[poolKey]),
      workerCount,
      wallMs: evidence.wallMedianMs,
      resourceEligible: evidence.resourceEligible,
    };
  });
  const eligible = candidates.filter(
    ({ resourceEligible }) => resourceEligible,
  );
  const population = eligible.length > 0 ? eligible : candidates;
  const fastest = [...population].sort(
    (left, right) =>
      left.wallMs - right.wallMs ||
      left.workerCount - right.workerCount ||
      left.poolCount - right.poolCount,
  )[0];
  const selected = population
    .filter(({ wallMs }) => (wallMs - fastest.wallMs) / fastest.wallMs < 0.02)
    .sort(
      (left, right) =>
        left.workerCount - right.workerCount ||
        left.poolCount - right.poolCount,
    )[0];
  return {
    caseKey: selected.entry.key,
    poolCount: selected.poolCount,
    workerCount: selected.workerCount,
    wallMedianMs: selected.wallMs,
    resourceEligible: selected.resourceEligible,
  };
}

export function assertFormalCaseContract(definition, source, scaleValue) {
  const expectedType =
    FORMAL_CASE_SOURCE_TYPES[definition.family]?.[definition.study];
  if (source.sourceType !== expectedType) {
    throw new Error(
      `${definition.id} uses ${source.sourceType} instead of formal ${expectedType}`,
    );
  }
  const expectedRoles = formalScaleRoles(source, definition, scaleValue);
  const declaredRoles = definition.scaleRoles ?? [definition.scaleRole];
  if (
    definition.scaleRole !== expectedRoles[0] ||
    !isDeepStrictEqual(declaredRoles, expectedRoles)
  ) {
    throw new Error(
      `${definition.id} relabels source-computed ${expectedRoles.join('+')} as ${declaredRoles.join('+')}`,
    );
  }
  const pointer = definition.policyEvidencePointer;
  if (
    source.sourceType === 'mdx-allocation-complete' &&
    definition.study === 'allocation-tokio-confirmation' &&
    !pointer.startsWith('/tokioConfirmation/cases/')
  ) {
    throw new Error(
      `${definition.id} does not bind the completed Tokio confirmation`,
    );
  }
  if (
    source.sourceType === 'mdx-allocation-complete' &&
    definition.study === 'allocation-rayon-confirmation' &&
    !pointer.startsWith('/rayonConfirmation/cases/')
  ) {
    throw new Error(
      `${definition.id} does not bind the completed Rayon confirmation`,
    );
  }
  if (
    source.sourceType === 'mdx-quota-complete' &&
    !pointer.startsWith('/confirmation/cases/')
  ) {
    throw new Error(
      `${definition.id} does not bind the completed quota confirmation`,
    );
  }
  return expectedRoles;
}

function formalScaleRoles(source, definition, scaleValue) {
  if (source.sourceType === 'vue-controlled-confirmation-summary') {
    return source.document.resourceAcceptableCrossover.status === 'confirmed'
      ? rolesForScale(controlledRoleScales(source.document), scaleValue)
      : curveRolesForScale(
          source.document.scaleSummaries.map(
            ({ componentCount }) => componentCount,
          ),
          scaleValue,
          5000,
        );
  }
  if (source.sourceType === 'vue-independent-confirmation-summary') {
    const project = source.document.projectSummaries.find(
      ({ reachedSfcCount }) => reachedSfcCount === scaleValue,
    );
    const role = {
      small: 'independent-small',
      medium: 'independent-medium',
      large: 'independent-large',
    }[project?.band];
    if (!role)
      throw new Error(
        `${definition.id} does not bind a frozen independent Vue band`,
      );
    return [role];
  }
  if (source.sourceType === 'mdx-crossover-complete') {
    return source.document.decision.resource.status === 'exact'
      ? rolesForScale(mdxRoleScales(source.document), scaleValue)
      : curveRolesForScale(
          source.document.decision.points.map(({ scale }) => scale),
          scaleValue,
          9157,
        );
  }
  if (
    source.sourceType === 'mdx-allocation-complete' ||
    source.sourceType === 'mdx-quota-complete'
  ) {
    return rolesForScale(
      mdxPolicyRoleScales(source.document.crossover),
      scaleValue,
    );
  }
  throw new Error(`${definition.id} has no formal scale-role derivation`);
}

function controlledRoleScales(value) {
  const crossover = value.resourceAcceptableCrossover.crossover;
  const scale = crossover?.componentCount;
  const confirming = crossover?.confirmedByComponentCount;
  const ordered = value.scaleSummaries
    .map(({ componentCount }) => componentCount)
    .sort((a, b) => a - b);
  const index = ordered.indexOf(scale);
  if (
    !Number.isSafeInteger(scale) ||
    !Number.isSafeInteger(confirming) ||
    index <= 0 ||
    ordered[index + 1] !== confirming
  ) {
    throw new Error(
      'controlled Vue crossover is not exact adjacent repeated evidence',
    );
  }
  return {
    'crossover-lower': ordered[index - 1],
    crossover: scale,
    'crossover-confirm': confirming,
    full: 5000,
  };
}

function mdxRoleScales(value) {
  const decision = value.decision.resource;
  if (
    decision.status !== 'exact' ||
    !Number.isSafeInteger(decision.previousScale) ||
    !Number.isSafeInteger(decision.scale) ||
    !Number.isSafeInteger(decision.confirmingNextScale)
  ) {
    throw new Error(
      'MDX crossover does not contain an exact adjacent resource decision',
    );
  }
  return {
    'crossover-lower': decision.previousScale,
    crossover: decision.scale,
    'crossover-confirm': decision.confirmingNextScale,
    full: 9157,
  };
}

function mdxPolicyRoleScales(value) {
  const decision = value.resource;
  if (
    decision?.status !== 'exact' ||
    !Number.isSafeInteger(decision.previousScale) ||
    !Number.isSafeInteger(decision.scale) ||
    !Number.isSafeInteger(decision.confirmingNextScale)
  ) {
    throw new Error(
      'MDX policy crossover lacks the completed resource decision',
    );
  }
  return {
    'crossover-lower': decision.previousScale,
    crossover: decision.scale,
    'crossover-confirm': decision.confirmingNextScale,
    full: 9157,
  };
}

function rolesForScale(roles, scale) {
  const matches = Object.entries(roles).filter(([, value]) => value === scale);
  const names = matches.map(([name]) => name);
  if (
    names.length < 1 ||
    names.length > 2 ||
    (names.length === 2 &&
      !isDeepStrictEqual(names, ['crossover-confirm', 'full']))
  ) {
    throw new Error(
      `scale ${scale} is not one exact source-computed formal role`,
    );
  }
  return names;
}

function curveRolesForScale(scales, scale, fullScale) {
  if (!scales.includes(scale)) {
    throw new Error(`scale ${scale} is not a repeated source-computed point`);
  }
  return scale === fullScale ? ['curve-point', 'full'] : ['curve-point'];
}

function policyMatchesControlledSummary(policy, summary) {
  if (!policy?.variants || !Array.isArray(summary.variants)) return false;
  const selected = summary.selectedResourceWorkerCount ?? 0;
  return summary.variants.every((variant) => {
    const compact = policy.variants[variant.variant];
    return (
      compact?.wallMedianMs === variant.wallMs?.median &&
      compact.cpuMedianMs === variant.totalCpuMs?.median &&
      compact.peakRssMedianBytes === variant.peakRssBytes?.median &&
      compact.resourceEligible ===
        (variant.workerCount === 0 ? true : variant.resourceEligible) &&
      compact.pairedWallRatioBootstrap95Upper ===
        variant.pairedWallRatioBootstrap95?.upper &&
      compact.selectedOracleCount === selected
    );
  });
}

function validHarnessManifest(value) {
  if (
    value?.algorithm !==
      'SHA-256 over UTF-8-sorted repository-relative path + NUL + kind + NUL + bytes + NUL + content SHA-256 + LF records' ||
    !Array.isArray(value.entries) ||
    value.entries.length === 0
  ) {
    return false;
  }
  const paths = value.entries.map(({ path }) => path);
  const sortedPaths = [...paths].sort((left, right) =>
    Buffer.from(left).compare(Buffer.from(right)),
  );
  if (
    new Set(paths).size !== paths.length ||
    !isDeepStrictEqual(paths, sortedPaths) ||
    value.entries.some(
      (entry) =>
        typeof entry.path !== 'string' ||
        entry.path.length === 0 ||
        !['file', 'symlink'].includes(entry.kind) ||
        !Number.isSafeInteger(entry.bytes) ||
        entry.bytes <= 0 ||
        !HASH.test(entry.sha256 ?? ''),
    )
  ) {
    return false;
  }
  const aggregate = createHash('sha256');
  for (const entry of value.entries) {
    aggregate.update(entry.path);
    aggregate.update('\0');
    aggregate.update(entry.kind);
    aggregate.update('\0');
    aggregate.update(String(entry.bytes));
    aggregate.update('\0');
    aggregate.update(entry.sha256);
    aggregate.update('\n');
  }
  return (
    value.files === value.entries.length &&
    value.bytes ===
      value.entries.reduce((total, entry) => total + entry.bytes, 0) &&
    value.aggregateSha256 === aggregate.digest('hex')
  );
}

function validControlledRuntime(runtime) {
  return (
    isDeepStrictEqual(runtime?.runtimePin, LIFECYCLE_BASELINE) &&
    runtime.repositoryCommit === LIFECYCLE_BASELINE.sourceCommit
  );
}

function validIndependentRuntime(runtime) {
  return (
    isDeepStrictEqual(runtime?.profile, LIFECYCLE_BASELINE) &&
    runtime.commit === LIFECYCLE_BASELINE.sourceCommit &&
    runtime.clean === true &&
    runtime.binding?.sha256 === LIFECYCLE_BASELINE.nativeBindingSha256 &&
    runtime.distribution?.sha256 === LIFECYCLE_BASELINE.distributionSha256
  );
}

function correctnessArtifactSetAddress(artifacts) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) return null;
  const pairs = artifacts.map((entry) => {
    if (
      !HASH.test(entry.rawSha256 ?? '') ||
      !HASH.test(entry.summarySha256 ?? '') ||
      entry.raw !== `raw/${entry.rawSha256}.json` ||
      entry.summary !== `summary/${entry.summarySha256}.json`
    ) {
      return null;
    }
    return `${entry.rawSha256}\0${entry.summarySha256}\n`;
  });
  if (pairs.includes(null) || new Set(pairs).size !== pairs.length) return null;
  pairs.sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  return createHash('sha256').update(pairs.join('')).digest('hex');
}

function validIndependentCorrectnessReference(value) {
  return (
    value?.manifest?.repository ===
      'github.com/hyf0/rolldown-parallel-js-plugin' &&
    COMMIT.test(value.manifest.repositoryHead ?? '') &&
    HASH.test(value.manifest.sha256 ?? '') &&
    HASH.test(value.manifest.contentSha256 ?? '') &&
    Number.isSafeInteger(value.manifest.bytes) &&
    value.manifest.bytes > 0
  );
}

function compactIndependentCorrectnessEvidence(value) {
  return {
    manifest: {
      bytes: value.manifest.bytes,
      sha256: value.manifest.sha256,
      repository: value.manifest.repository,
      repositoryHead: value.manifest.repositoryHead,
      contentSha256: value.manifest.contentSha256,
    },
    artifacts: value.artifacts?.map((artifact) => ({
      raw: { bytes: artifact.raw.bytes, sha256: artifact.raw.sha256 },
      summary: {
        bytes: artifact.summary.bytes,
        sha256: artifact.summary.sha256,
      },
      ...(artifact.matrixSha256 === undefined
        ? {}
        : { matrixSha256: artifact.matrixSha256 }),
      ...(artifact.goldenSha256 === undefined
        ? {}
        : { goldenSha256: artifact.goldenSha256 }),
      ...(artifact.canonicalSummarySha256 === undefined
        ? {}
        : { canonicalSummarySha256: artifact.canonicalSummarySha256 }),
    })),
    admittedProjects: value.admittedProjects,
    projectCanonicalEvidenceSha256: value.projectCanonicalEvidenceSha256,
    ...(value.projectAdapterProvenance === undefined
      ? {}
      : { projectAdapterProvenance: value.projectAdapterProvenance }),
  };
}

function hasHarnessEntry(value, path) {
  const entry = value.entries.find((candidate) => candidate.path === path);
  return Boolean(entry && HASH.test(entry.sha256 ?? '') && entry.bytes > 0);
}

function requireMdxSourceRecord(value, fileName, sourceHashByPath, label) {
  const expectedPath = REQUIRED_MDX_SOURCE_HASHES[fileName];
  if (
    typeof value?.path !== 'string' ||
    !value.path.endsWith(`/${fileName}`) ||
    value.sha256 !== sourceHashByPath.get(expectedPath)
  ) {
    throw new Error(`${label} does not bind committed ${fileName} provenance`);
  }
}

function validateControlledRunGrid(report, label) {
  const expected = [];
  for (const definition of report.matrix.cases ?? []) {
    if (
      definition.repeats !== 10 ||
      !Array.isArray(definition.variants) ||
      !definition.variants.includes('ordinary') ||
      !definition.variants.includes('worker-4') ||
      !definition.variants.includes('worker-8')
    ) {
      throw new Error(
        `${label}/${definition.name} is not a ten-block controlled Vue case`,
      );
    }
    for (let index = 0; index < definition.repeats; index++) {
      const offset =
        ((definition.rotationOffset ?? 0) + index) % definition.variants.length;
      const order = [
        ...definition.variants.slice(offset),
        ...definition.variants.slice(0, offset),
      ];
      expected.push(
        ...order.map((variant) => ({
          name: definition.name,
          componentCount: definition.componentCount,
          variant,
          index,
        })),
      );
    }
  }
  assertExactRunGrid(report.runs, expected, label);
}

function validateIndependentRunGrid(report, label) {
  const expected = [];
  const confirmation = report.matrix.lane === 'independent-vue-wall-confirm';
  const definitions = report.matrix.cases ?? [];
  if (
    definitions.length !== INDEPENDENT_PROJECTS.length ||
    definitions.some((definition, index) => {
      const frozen = INDEPENDENT_PROJECTS[index];
      return (
        definition.projectId !== frozen.projectId ||
        definition.band !== frozen.band ||
        definition.reachedSfcCount !== frozen.reachedSfcCount
      );
    }) ||
    new Set(definitions.map(({ projectId }) => projectId)).size !==
      definitions.length
  ) {
    throw new Error(
      `${label} does not contain exactly the frozen three independent Vue projects`,
    );
  }
  for (const definition of definitions) {
    if (
      definition.repeats !== (confirmation ? definition.repeats : 1) ||
      (confirmation && ![10, 15].includes(definition.repeats)) ||
      !Array.isArray(definition.variants) ||
      !definition.variants.includes('ordinary') ||
      (confirmation &&
        (!definition.variants.includes('worker-4') ||
          !definition.variants.includes('worker-8')))
    ) {
      throw new Error(
        `${label}/${definition.projectId} has an invalid independent Vue run grid`,
      );
    }
    for (let blockIndex = 0; blockIndex < definition.repeats; blockIndex++) {
      const offset =
        ((definition.rotationOffset ?? 0) + blockIndex) %
        definition.variants.length;
      const order = [
        ...definition.variants.slice(offset),
        ...definition.variants.slice(0, offset),
      ];
      expected.push(
        ...order.map((variant) => ({
          projectId: definition.projectId,
          variant,
          blockIndex,
        })),
      );
    }
  }
  assertExactRunGrid(report.runs, expected, label);
}

function validateMdxRunGrid(report, label) {
  const expected = [];
  const confirmation =
    report.evidenceKind === 'performance-confirmation' ||
    report.evidenceKind?.endsWith('-confirmation');
  for (const definition of report.matrix.cases ?? []) {
    if (
      definition.repeats !== (confirmation ? 10 : 1) ||
      !Array.isArray(definition.variants) ||
      !definition.variants.includes('ordinary') ||
      (confirmation &&
        (!definition.variants.includes('worker-4') ||
          !definition.variants.includes('worker-8')))
    ) {
      throw new Error(
        `${label}/${definition.name} has an invalid MDX run grid`,
      );
    }
    for (let repeat = 0; repeat < definition.repeats; repeat++) {
      const index = (definition.startIndex ?? 0) + repeat;
      const offset = index % definition.variants.length;
      const order = [
        ...definition.variants.slice(offset),
        ...definition.variants.slice(0, offset),
      ];
      expected.push(
        ...order.map((variant) => ({ name: definition.name, variant, index })),
      );
    }
  }
  assertExactRunGrid(report.runs, expected, label);
}

function assertExactRunGrid(runs, expected, label) {
  if (runs.length !== expected.length) {
    throw new Error(
      `${label} raw run grid is truncated or contains duplicates`,
    );
  }
  const keys = Object.keys(expected[0] ?? {});
  for (const [sequence, expectedRun] of expected.entries()) {
    const actual = runs[sequence];
    if (
      actual.sequence !== sequence ||
      keys.some((key) => actual[key] !== expectedRun[key])
    ) {
      throw new Error(
        `${label} raw run order or block index differs at sequence ${sequence}`,
      );
    }
  }
}

function validateTimedRuns(runs, label, family) {
  for (const run of runs) {
    const wall =
      family === 'independent-vue'
        ? run.timeRealMs
        : family === 'mdx-policy'
          ? run.policyWallMs
          : run.totalElapsedMs;
    const cpu =
      family === 'independent-vue'
        ? run.totalCpuMs
        : family === 'mdx-policy'
          ? run.externalTiming?.userMs + run.externalTiming?.systemMs
          : run.cpuUserMs + run.cpuSystemMs;
    const paging = family.startsWith('mdx') ? run.hostDeltas : run.pagingDelta;
    if (
      !Number.isFinite(wall) ||
      wall <= 0 ||
      !Number.isFinite(cpu) ||
      cpu <= 0 ||
      !Number.isFinite(run.peakRssBytes) ||
      run.peakRssBytes <= 0 ||
      paging?.pageouts !== 0 ||
      paging?.swapouts !== 0
    ) {
      throw new Error(
        `${label} ${family} run lacks admitted wall/CPU/RSS/paging fields`,
      );
    }
    if (
      family === 'controlled-vue' &&
      (!run.hostAdmission || !run.postHostAdmission)
    ) {
      throw new Error(
        `${label} controlled Vue run lacks before/after host admission`,
      );
    }
    if (family === 'controlled-vue') {
      validateVueHostAdmission(run.hostAdmission, 'before-child', false, label);
      validateVueHostAdmission(
        run.postHostAdmission,
        'after-child',
        false,
        label,
      );
    }
    if (
      family === 'independent-vue' &&
      (!run.hostAdmission || !run.postHostAdmission)
    ) {
      throw new Error(
        `${label} independent Vue run lacks before/after host admission`,
      );
    }
    if (family === 'independent-vue') {
      validateVueHostAdmission(run.hostAdmission, 'before-child', true, label);
      validateVueHostAdmission(
        run.postHostAdmission,
        'after-child',
        true,
        label,
      );
    }
    if (
      family.startsWith('mdx') &&
      (!run.hostBefore ||
        !run.hostAfter ||
        run.hostPolicyViolations?.length !== 0)
    ) {
      throw new Error(
        `${label} MDX run lacks clean before/after host admission`,
      );
    }
  }
}

function validateVueHostAdmission(value, phase, phaseRequired, label) {
  const requireTransient = phaseRequired || phase === 'before-child';
  const maximumSwap =
    value.policy?.maximumStartingSwapBytes ??
    value.policy?.maximumSwapBytes ??
    value.policy?.maximumSwapUsedBytes;
  if (
    (phaseRequired && value.phase !== phase) ||
    value.acPower !== true ||
    value.lowPowerMode !== 0 ||
    value.noRecordedThermalWarning !== true ||
    value.noRecordedPerformanceWarning !== true ||
    !Number.isFinite(value.uptimeSeconds) ||
    value.uptimeSeconds > 86_400 ||
    !Number.isFinite(value.swapUsedBytes) ||
    value.swapUsedBytes > 512 * 1024 ** 2 ||
    value.policy?.maximumUptimeSeconds !== 86_400 ||
    maximumSwap !== 512 * 1024 ** 2 ||
    (requireTransient &&
      (!Number.isFinite(value.oneMinuteLoadAverage) ||
        value.oneMinuteLoadAverage > 2 ||
        !Number.isFinite(value.summedProcessCpuPercentage) ||
        value.summedProcessCpuPercentage > 150 ||
        !Number.isFinite(value.memoryFreePercentage) ||
        value.memoryFreePercentage < 50 ||
        (value.unrelatedStudyProcesses?.length ?? 0) !== 0 ||
        value.policy.maximumOneMinuteLoadAverage !== 2 ||
        value.policy.maximumSummedProcessCpuPercentage !== 150 ||
        value.policy.minimumMemoryFreePercentage !== 50 ||
        value.policy.requiredPagingDelta !== 0))
  ) {
    throw new Error(
      `${label} ${phase} does not pass the frozen clean-host policy`,
    );
  }
}

function assertNoTimingFields(runs, label) {
  const forbidden = [
    'totalElapsedMs',
    'timeRealMs',
    'policyWallMs',
    'cpuUserMs',
    'cpuSystemMs',
    'totalCpuMs',
    'peakRssBytes',
    'pagingDelta',
  ];
  if (
    runs.some((run) => forbidden.some((field) => Object.hasOwn(run, field)))
  ) {
    throw new Error(`${label} correctness evidence contains timing fields`);
  }
}

export function normalizeFormalPoolEnvironment(value, label) {
  const normalized =
    value?.tokio === undefined
      ? value
      : {
          ROLLDOWN_WORKER_THREADS: String(value.tokio),
          RAYON_NUM_THREADS: String(value.rayon),
          ROLLDOWN_MAX_BLOCKING_THREADS: String(value.blocking),
        };
  if (
    normalized === null ||
    typeof normalized !== 'object' ||
    Array.isArray(normalized) ||
    !isDeepStrictEqual(
      Object.keys(normalized).sort(),
      Object.keys(BASELINE_POOLS).sort(),
    ) ||
    Object.values(normalized).some(
      (entry) => !/^[1-9][0-9]*$/.test(entry ?? ''),
    )
  ) {
    throw new Error(
      `${label} has an invalid source-bound Rust pool environment`,
    );
  }
  return structuredClone(normalized);
}

function samePools(value, expected) {
  try {
    return isDeepStrictEqual(
      normalizeFormalPoolEnvironment(value, 'pool'),
      expected,
    );
  } catch {
    return false;
  }
}

function policyCaseKey(definition) {
  return [
    `scale-${definition.selectionScale}`,
    `tokio-${definition.poolEnvironment.ROLLDOWN_WORKER_THREADS}`,
    `rayon-${definition.poolEnvironment.RAYON_NUM_THREADS}`,
    `blocking-${definition.poolEnvironment.ROLLDOWN_MAX_BLOCKING_THREADS}`,
    definition.quotaPercent
      ? `quota-${definition.quotaPercent}`
      : 'unthrottled',
  ].join('/');
}

function resolvePointer(document, pointer) {
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) {
    throw new Error(`invalid formal lineage JSON Pointer: ${pointer}`);
  }
  let current = document;
  for (const raw of pointer.slice(1).split('/')) {
    const token = raw.replaceAll('~1', '/').replaceAll('~0', '~');
    if (Array.isArray(current)) current = current[Number(token)];
    else current = current?.[token];
  }
  if (current === undefined)
    throw new Error(`formal lineage JSON Pointer does not resolve: ${pointer}`);
  return current;
}

const POLICY_BOOTSTRAP_RESAMPLES = 100_000;
const POLICY_BOOTSTRAP_SEED = 0x20260712;

export function deriveControlledPolicyEvidence(raw) {
  const byScale = Map.groupBy(raw.runs, ({ componentCount }) => componentCount);
  return {
    schema: 1,
    jsonPointerBase: '/policyEvidence/byScale',
    byScale: Object.fromEntries(
      [...byScale.entries()]
        .sort(([left], [right]) => left - right)
        .map(([scale, runs]) => {
          const ordinaryByIndex = new Map(
            runs
              .filter(({ variant }) => variant === 'ordinary')
              .map((run) => [run.index, run]),
          );
          const summaries = [
            ...new Set(runs.map(({ variant }) => variant)),
          ].map((variant) => {
            const selected = runs.filter((run) => run.variant === variant);
            const pairs = selected.map((run) => [
              ordinaryByIndex.get(run.index),
              run,
            ]);
            if (
              selected.length !== ordinaryByIndex.size ||
              pairs.some(([ordinary]) => !ordinary)
            ) {
              throw new Error(
                `controlled Vue raw blocks are incomplete at ${scale}/${variant}`,
              );
            }
            const walls = selected.map(({ totalElapsedMs }) => totalElapsedMs);
            const cpu = selected.map(
              ({ cpuUserMs, cpuSystemMs }) => cpuUserMs + cpuSystemMs,
            );
            const rss = selected.map(({ peakRssBytes }) => peakRssBytes);
            const speedups = pairs.map(
              ([ordinary, worker]) =>
                ordinary.totalElapsedMs / worker.totalElapsedMs,
            );
            const wallRatios = pairs.map(
              ([ordinary, worker]) =>
                worker.totalElapsedMs / ordinary.totalElapsedMs,
            );
            const cpuRatios = pairs.map(
              ([ordinary, worker]) =>
                (worker.cpuUserMs + worker.cpuSystemMs) /
                (ordinary.cpuUserMs + ordinary.cpuSystemMs),
            );
            const rssRatios = pairs.map(
              ([ordinary, worker]) =>
                worker.peakRssBytes / ordinary.peakRssBytes,
            );
            const workerCount =
              variant === 'ordinary'
                ? 0
                : Number(variant.slice('worker-'.length));
            const wallMedianBootstrap95 = bootstrapMedianInterval(
              walls,
              `${scale}/${variant}/wall`,
            );
            const speedupBootstrap95 = bootstrapMedianInterval(
              speedups,
              `${scale}/${variant}/speedup`,
            );
            const wallRatioBootstrap95 = bootstrapMedianInterval(
              wallRatios,
              `${scale}/${variant}/wall-ratio`,
            );
            const resourceEligible =
              workerCount > 0 &&
              median(speedups) >= 1.1 &&
              speedupBootstrap95.lower >= 1.05 &&
              median(cpuRatios) <= 2 &&
              median(rssRatios) <= 2 &&
              Math.max(...rss) < 27 * 1024 ** 3 &&
              selected.every(
                (run) =>
                  run.pagingDelta?.pageouts === 0 &&
                  run.pagingDelta?.swapouts === 0,
              ) &&
              new Set(selected.map(({ outputCodeHash }) => outputCodeHash))
                .size === 1 &&
              new Set(selected.map(({ outputMapHash }) => outputMapHash))
                .size === 1;
            return {
              variant,
              workerCount,
              wallMedianMs: median(walls),
              wallMedianBootstrap95,
              cpuMedianMs: median(cpu),
              peakRssMedianBytes: median(rss),
              resourceEligible,
              pairedWallRatioBootstrap95Upper: wallRatioBootstrap95.upper,
            };
          });
          const resource = summaries.filter(
            ({ resourceEligible }) => resourceEligible,
          );
          const selectedOracleCount =
            resource.length === 0
              ? 0
              : selectControlledWorker(resource).workerCount;
          return [
            String(scale),
            {
              variants: Object.fromEntries(
                summaries.map((summary) => [
                  summary.variant,
                  {
                    wallMedianMs: summary.wallMedianMs,
                    cpuMedianMs: summary.cpuMedianMs,
                    peakRssMedianBytes: summary.peakRssMedianBytes,
                    resourceEligible:
                      summary.workerCount === 0 || summary.resourceEligible,
                    pairedWallRatioBootstrap95Upper:
                      summary.pairedWallRatioBootstrap95Upper,
                    selectedOracleCount,
                  },
                ]),
              ),
            },
          ];
        }),
    ),
  };
}

export function deriveControlledResourceCrossover(raw) {
  const policy = deriveControlledPolicyEvidence(raw);
  const summaries = Object.entries(policy.byScale)
    .map(([scale, evidence]) => ({
      componentCount: Number(scale),
      resourceEligible: evidence.variants.ordinary.selectedOracleCount > 0,
      selectedWorkerCount: evidence.variants.ordinary.selectedOracleCount,
    }))
    .sort((left, right) => left.componentCount - right.componentCount);
  const resolution = resolveControlledCrossover(summaries, 'resourceEligible');
  if (!resolution.crossover?.componentCount) return resolution;
  const selected = summaries.find(
    ({ componentCount }) =>
      componentCount === resolution.crossover.componentCount,
  );
  return {
    ...resolution,
    crossover: {
      ...resolution.crossover,
      selectedWorker:
        selected?.selectedWorkerCount > 0
          ? `worker-${selected.selectedWorkerCount}`
          : null,
    },
  };
}

export function deriveControlledMechanicalCrossover(raw) {
  const summaries = raw.matrix.cases
    .map((definition) => {
      const runs = raw.runs.filter(
        ({ componentCount }) => componentCount === definition.componentCount,
      );
      const ordinaryByIndex = new Map(
        runs
          .filter(({ variant }) => variant === 'ordinary')
          .map((run) => [run.index, run]),
      );
      const workers = definition.variants
        .filter((variant) => variant !== 'ordinary')
        .map((variant) => {
          const selected = runs.filter((run) => run.variant === variant);
          const walls = selected.map(({ totalElapsedMs }) => totalElapsedMs);
          const speedups = selected.map(
            (run) =>
              ordinaryByIndex.get(run.index).totalElapsedMs /
              run.totalElapsedMs,
          );
          return {
            variant,
            workerCount: Number(variant.slice('worker-'.length)),
            wallMedianMs: median(walls),
            wallMedianBootstrap95: bootstrapMedianInterval(
              walls,
              `${definition.componentCount}/${variant}/wall`,
            ),
            mechanicalGain:
              bootstrapMedianInterval(
                speedups,
                `${definition.componentCount}/${variant}/speedup`,
              ).lower > 1,
          };
        });
      const selected = selectControlledWorker(workers);
      return {
        componentCount: definition.componentCount,
        mechanicalGain: selected.mechanicalGain,
        selectedWorker: selected.variant,
      };
    })
    .sort((left, right) => left.componentCount - right.componentCount);
  const resolution = resolveControlledCrossover(summaries, 'mechanicalGain');
  if (!resolution.crossover?.componentCount) return resolution;
  const selected = summaries.find(
    ({ componentCount }) =>
      componentCount === resolution.crossover.componentCount,
  );
  return {
    ...resolution,
    crossover: {
      ...resolution.crossover,
      selectedWorker: selected?.selectedWorker ?? null,
    },
  };
}

function resolveControlledCrossover(summaries, field) {
  const ordered = [...CONTROLLED_FROZEN_SCALES];
  const byScale = new Map(
    summaries.map((summary) => [summary.componentCount, summary]),
  );
  let observedPositive = false;
  for (const summary of summaries) {
    if (summary[field]) observedPositive = true;
    else if (observedPositive) {
      return {
        status: 'inconsistent-repeated-direction',
        crossover: null,
        additionalScales: [],
        repeatScales: summaries.map(({ componentCount }) => componentCount),
        reason: `repeated ${field} changes from positive back to negative`,
      };
    }
  }

  let candidateIndex = -1;
  for (let index = 0; index < ordered.length - 1; index++) {
    if (
      byScale.get(ordered[index])?.[field] &&
      byScale.get(ordered[index + 1])?.[field]
    ) {
      candidateIndex = index;
      break;
    }
  }
  if (candidateIndex !== -1) {
    while (candidateIndex > 0) {
      const previousScale = ordered[candidateIndex - 1];
      const previous = byScale.get(previousScale);
      if (!previous) {
        return {
          status: 'additional-confirmation-required',
          crossover: null,
          additionalScales: [previousScale],
          repeatScales: [],
          reason: `the immediately smaller frozen scale before ${ordered[candidateIndex]} was not repeated`,
        };
      }
      if (!previous[field]) {
        return {
          status: 'confirmed',
          crossover: {
            componentCount: ordered[candidateIndex],
            confirmedByComponentCount: ordered[candidateIndex + 1],
          },
          additionalScales: [],
          repeatScales: [],
        };
      }
      candidateIndex--;
    }
    return {
      status: 'left-censored',
      crossover: {
        atOrBelowComponentCount: ordered[0],
        confirmedByComponentCount: ordered[1],
      },
      additionalScales: [],
      repeatScales: [],
    };
  }

  const firstPositive = summaries.find((summary) => summary[field]);
  if (!firstPositive) {
    if (byScale.get(ordered.at(-1))?.[field] === false) {
      return {
        status: 'not-observed-through-maximum',
        crossover: null,
        additionalScales: [],
        repeatScales: [],
      };
    }
    return {
      status: 'additional-confirmation-required',
      crossover: null,
      additionalScales: [ordered.at(-1)],
      repeatScales: [],
      reason: 'the maximum frozen scale has not been repeated',
    };
  }
  const index = ordered.indexOf(firstPositive.componentCount);
  if (index === ordered.length - 1) {
    return {
      status: 'right-boundary-unconfirmed',
      crossover: null,
      additionalScales: [],
      repeatScales: [],
      reason:
        'a gain observed only at the maximum scale has no larger frozen point for confirmation',
    };
  }
  const additionalScales = [];
  if (index > 0 && !byScale.has(ordered[index - 1])) {
    additionalScales.push(ordered[index - 1]);
  }
  if (!byScale.has(ordered[index + 1])) {
    additionalScales.push(ordered[index + 1]);
  }
  return {
    status: 'additional-confirmation-required',
    crossover: null,
    additionalScales,
    repeatScales: [],
    reason: `the positive result at ${firstPositive.componentCount} lacks an actual-adjacent frozen confirmation boundary`,
  };
}

export function deriveIndependentPolicyEvidence(raw) {
  const projectIds = raw.matrix.cases.map(({ projectId }) => projectId);
  const runKeys = raw.runs.map(
    ({ projectId, variant, blockIndex }) =>
      `${projectId}\0${variant}\0${blockIndex}`,
  );
  if (
    new Set(projectIds).size !== projectIds.length ||
    new Set(runKeys).size !== runKeys.length
  ) {
    throw new Error(
      'independent Vue policy derivation rejects duplicate definitions or runs',
    );
  }
  return Object.fromEntries(
    raw.matrix.cases.map((definition) => {
      const runs = raw.runs.filter(
        ({ projectId }) => projectId === definition.projectId,
      );
      const ordinary = runs.filter(({ variant }) => variant === 'ordinary');
      const ordinaryByBlock = new Map(
        ordinary.map((run) => [run.blockIndex, run]),
      );
      const workers = [...new Set(runs.map(({ variant }) => variant))]
        .filter((variant) => variant !== 'ordinary')
        .map((variant) => {
          const selected = runs.filter((run) => run.variant === variant);
          const pairs = selected.map((run) => [
            ordinaryByBlock.get(run.blockIndex),
            run,
          ]);
          if (
            selected.length !== ordinary.length ||
            pairs.some(([baseline]) => !baseline)
          ) {
            throw new Error(
              `${definition.projectId}/${variant} raw blocks are incomplete`,
            );
          }
          const walls = selected.map(({ timeRealMs }) => timeRealMs);
          const speedups = pairs.map(
            ([baseline, worker]) => baseline.timeRealMs / worker.timeRealMs,
          );
          const wallRatios = pairs.map(
            ([baseline, worker]) => worker.timeRealMs / baseline.timeRealMs,
          );
          const cpuRatios = pairs.map(
            ([baseline, worker]) => worker.totalCpuMs / baseline.totalCpuMs,
          );
          const rssRatios = pairs.map(
            ([baseline, worker]) => worker.peakRssBytes / baseline.peakRssBytes,
          );
          const rss = selected.map(({ peakRssBytes }) => peakRssBytes);
          return {
            variant,
            workerCount: Number(variant.slice('worker-'.length)),
            wallMedianMs: median(walls),
            wallMedianBootstrap95: bootstrapMedianInterval(
              walls,
              `${definition.projectId}/${variant}/time-real`,
            ),
            cpuMedianMs: median(selected.map(({ totalCpuMs }) => totalCpuMs)),
            peakRssMedianBytes: median(rss),
            pairedWallRatioBootstrap95Upper: bootstrapMedianInterval(
              wallRatios,
              `${definition.projectId}/${variant}/worker-to-ordinary-wall-ratio`,
            ).upper,
            resourceEligible:
              median(speedups) >= 1.1 &&
              bootstrapMedianInterval(
                speedups,
                `${definition.projectId}/${variant}/speedup`,
              ).lower >= 1.05 &&
              median(cpuRatios) <= 2 &&
              median(rssRatios) <= 2 &&
              Math.max(...rss) < 27 * 1024 ** 3 &&
              selected.every(
                (run) =>
                  run.pagingDelta?.pageouts === 0 &&
                  run.pagingDelta?.swapouts === 0,
              ),
          };
        });
      const resource = workers.filter(
        ({ resourceEligible }) => resourceEligible,
      );
      const selectedOracleWorkerCount =
        resource.length === 0
          ? 0
          : selectIndependentWorker(resource).workerCount;
      return [
        definition.projectId,
        {
          schema: 1,
          canonicalWallField: 'timeRealMs',
          pairedWallRatioDirection: 'worker/ordinary',
          selectedOracleWorkerCount,
          variants: {
            ordinary: {
              wallMedianMs: median(
                ordinary.map(({ timeRealMs }) => timeRealMs),
              ),
              cpuMedianMs: median(ordinary.map(({ totalCpuMs }) => totalCpuMs)),
              peakRssMedianBytes: median(
                ordinary.map(({ peakRssBytes }) => peakRssBytes),
              ),
              resourceEligible: true,
              pairedWallRatioBootstrap95Upper: 1,
            },
            ...Object.fromEntries(
              workers.map((worker) => [
                worker.variant,
                {
                  wallMedianMs: worker.wallMedianMs,
                  cpuMedianMs: worker.cpuMedianMs,
                  peakRssMedianBytes: worker.peakRssMedianBytes,
                  resourceEligible: worker.resourceEligible,
                  pairedWallRatioBootstrap95Upper:
                    worker.pairedWallRatioBootstrap95Upper,
                },
              ]),
            ),
          },
        },
      ];
    }),
  );
}

function selectControlledWorker(workers) {
  const fastest = [...workers].sort(
    (left, right) =>
      left.wallMedianMs - right.wallMedianMs ||
      left.workerCount - right.workerCount,
  )[0];
  return (
    workers
      .filter((candidate) => candidate.workerCount < fastest.workerCount)
      .filter(
        (candidate) =>
          Math.abs(candidate.wallMedianMs - fastest.wallMedianMs) /
            fastest.wallMedianMs <
            0.02 &&
          intervalsOverlap(
            candidate.wallMedianBootstrap95,
            fastest.wallMedianBootstrap95,
          ),
      )
      .sort((left, right) => left.workerCount - right.workerCount)[0] ?? fastest
  );
}

function selectIndependentWorker(workers) {
  return selectControlledWorker(workers);
}

function intervalsOverlap(left, right) {
  return left.lower <= right.upper && right.lower <= left.upper;
}

function bootstrapMedianInterval(values, label) {
  const random = xorshift32(POLICY_BOOTSTRAP_SEED ^ hashLabel(label));
  const medians = new Float64Array(POLICY_BOOTSTRAP_RESAMPLES);
  const sample = Array.from({ length: values.length });
  for (let iteration = 0; iteration < medians.length; iteration++) {
    for (let index = 0; index < values.length; index++) {
      sample[index] = values[Math.floor(random() * values.length)];
    }
    medians[iteration] = median(sample);
  }
  medians.sort();
  return { lower: quantile(medians, 0.025), upper: quantile(medians, 0.975) };
}

function median(values) {
  return quantile(
    [...values].sort((left, right) => left - right),
    0.5,
  );
}

function quantile(sorted, probability) {
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function xorshift32(seed) {
  let state = seed >>> 0 || 0x6d2b79f5;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 2 ** 32;
  };
}

function hashLabel(value) {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export const FORMAL_BASELINE_POOL_ENVIRONMENT = BASELINE_POOLS;
