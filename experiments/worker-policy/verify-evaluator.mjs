import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { verifySourceBindings } from './evidence-artifacts.mjs';
import { buildFixedPolicyEvidence } from './evidence-builder.mjs';
import {
  CURRENT_PROTOCOL_REVISION,
  EVIDENCE_REQUIRED_BUILDER_SOURCES,
  EVIDENCE_REQUIRED_PROTOCOL_DOCUMENTS,
  evaluateFixedWorkerPolicies,
  validateEvidence,
} from './evaluator.mjs';
import {
  deriveControlledPolicyEvidence,
  deriveControlledResourceCrossover,
  deriveIndependentPolicyEvidence,
  deriveRepeatedPolicySummary,
} from './formal-source-contracts.mjs';
import {
  analyzeCrossover,
  planScaleFollowup,
  summarizeRepeatedPolicyCase,
} from '../cloudflare-mdx/scale-followup.mjs';

const HASH = 'a'.repeat(64);
const SOURCE_HASH = 'd'.repeat(64);
const CPULIMIT_PATCH_SHA256 =
  'de4c2800dbc1b4cbad8d280ec1aebecda7256dbf221fbb97daf83e7fa0a88060';
const CPULIMIT_BINARY_SHA256 =
  '233531824804f4be5ef3b425b0903bd36a90c069fd44598da4fad77e90eb0bd9';
const BUILDER_SOURCE_HASHES = Object.freeze({
  'experiments/cpu-rate-control/cpulimit-apple.patch': CPULIMIT_PATCH_SHA256,
  'experiments/cpu-rate-control/run-calibration.mjs':
    '982ae9fa559ab957671ef215ed0ba3369c8eaba7d7e3877c759870edd81f06f3',
  'experiments/cpu-rate-control/cpu-load.mjs':
    '21f5dc5a5dfc667b3aa2f7ed5a39d0c98563ee61cfe513a8350ffb5cfab02b4f',
});
const COMMIT = 'b'.repeat(40);
const LIFECYCLE_BASELINE = Object.freeze({
  kind: 'lifecycle-corrected-baseline',
  sourceCommit: 'b144106882fe244b19b738fc0acf3ffa07c7c9f3',
  nativeBindingSha256:
    '7b8863bb28aefd2e2eb7409f8be6dae57a252fe4a2688383007be7ea2f847bf7',
  distributionSha256:
    '1efffd0b63483e77cd2854fe716941000ae9548768691d7b5a64dceb011f3c45',
});
const MDX_RUNTIME_PROFILE = Object.freeze({
  kind: 'lifecycle-fixed-baseline',
  rolldownCommit: LIFECYCLE_BASELINE.sourceCommit,
  bindingSha256: LIFECYCLE_BASELINE.nativeBindingSha256,
  distSha256: LIFECYCLE_BASELINE.distributionSha256,
  baseCommit: '0aa600b5721b852cdc4095c7122a929a8cb4a798',
  changeScope: 'remove-early-parent-worker-unref-only',
});
const EMPTY_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const BASELINE_POOLS = Object.freeze({
  ROLLDOWN_WORKER_THREADS: '18',
  RAYON_NUM_THREADS: '12',
  ROLLDOWN_MAX_BLOCKING_THREADS: '4',
});
const MDX_SCALES = [896, 1024, 2048, 9157];
const MDX_BASE_SCALES = [32, 128, 256, 512, 1024, 2048, 4096, 9157];
const MDX_SCALE_MANIFEST = JSON.parse(
  readFileSync(
    new URL(
      '../cloudflare-mdx/data/cloudflare-mdx-scale-v1.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const CONTROLLED_SCALES = [512, 1024, 2048, 5000];
const INDEPENDENT_CASES = [
  { projectId: 'floating-vue', band: 'small', reachedSfcCount: 4 },
  { projectId: 'cabinet-icon', band: 'medium', reachedSfcCount: 166 },
  {
    projectId: 'directus-amendment-candidate',
    band: 'large',
    reachedSfcCount: 546,
  },
];
const records = new Map();
const definitions = [];

const addSource = (id, sourceType, document, links = []) => {
  const sha256 = String(records.size + 1).padStart(64, '0');
  const path = `reports/sha256/${sha256}.json`;
  records.set(id, {
    path,
    sha256,
    bytes: Math.max(1, JSON.stringify(document).length),
    document,
  });
  definitions.push({ id, sourceType, path, assertions: [], links });
  return sha256;
};

addSource('machine', 'machine-topology', {
  schema: 1,
  kind: 'rolldown-fixed-worker-policy-machine-topology',
  executionScope: 'local-only',
  node: 'v24.18.0',
  platform: 'darwin',
  architecture: 'arm64',
  cpuModel: 'Apple M3 Pro',
  availableParallelism: 12,
  logicalCpuCount: 12,
  performanceCores: 6,
  efficiencyCores: 6,
  performanceLevels: [
    { name: 'Performance', logicalCpuCount: 6 },
    { name: 'Efficiency', logicalCpuCount: 6 },
  ],
});

const controlledHarnessBlobs = [
  controlledHarnessBlob(
    'examples/par-plugin/cases/vue-scale/run-matrix.mjs',
    'export const runMatrix = true;\n',
  ),
  controlledHarnessBlob(
    'examples/par-plugin/cases/vue-scale/summarize-matrix.mjs',
    'export const summarizeMatrix = true;\n',
  ),
].sort((left, right) =>
  Buffer.from(left.path).compare(Buffer.from(right.path)),
);
const harnessSourceManifest = createHarnessManifest(
  controlledHarnessBlobs.map(({ path, kind, bytes, sha256 }) => ({
    path,
    kind,
    bytes,
    sha256,
  })),
);
const controlledHarnessSnapshotSha = addSource(
  'controlled-harness-source-snapshot',
  'vue-controlled-harness-source-snapshot',
  {
    schema: 1,
    kind: 'vue-controlled-harness-source-snapshot',
    repository: 'github.com/rolldown/rolldown',
    commit: COMMIT,
    gitObjectFormat: 'sha1',
    harnessSourceManifest,
    blobs: controlledHarnessBlobs,
  },
);
const controlledAdmissionRawSha = addSource(
  'controlled-admission-raw',
  'vue-controlled-admission-raw',
  {
    schema: 1,
    kind: 'vue-scale-admission-audit',
    measurementClass: 'untimed compile admission; not performance evidence',
    harnessSourceManifest,
    runtime: controlledRuntime(),
    fixture: { worktreeStatus: '', commit: COMMIT },
    executionEnvironment: { inheritedNodeOptions: null },
    audits: [
      {
        phase: 'quasar-pre-exclusion',
        admitted: false,
        errorCount: 3,
        failures: [{}, {}, {}],
      },
      {
        phase: 'final-pool',
        admitted: true,
        errorCount: 0,
        failures: [],
        output: { exports: 5650 },
      },
    ],
  },
);
const controlledAdmissionPointerSha = addSource(
  'controlled-admission-pointer',
  'vue-controlled-admission-pointer',
  controlledPointer(
    'vue-scale-admission-evidence-pointer',
    'untimed compile admission; not performance evidence',
    controlledAdmissionRawSha,
  ),
  [{ sourceId: 'controlled-admission-raw', sha256Pointer: '/raw/sha256' }],
);
const controlledCorrectnessRawSha = addSource(
  'controlled-correctness-raw',
  'vue-controlled-correctness-raw',
  {
    schema: 1,
    measurementClass: 'untimed correctness; not performance evidence',
    admitted: true,
    admissionFailures: [],
    matrix: { lane: 'correctness-smoke' },
    harnessSourceManifest,
    runtime: controlledRuntime(),
    fixture: { worktreeStatus: '', commit: COMMIT },
    executionEnvironment: { inheritedNodeOptions: null },
    runs: [{ variant: 'ordinary', measurementClass: 'correctness-only' }],
  },
);
const controlledCorrectnessPointerSha = addSource(
  'controlled-correctness-pointer',
  'vue-controlled-correctness-pointer',
  controlledPointer(
    'vue-scale-correctness-evidence-pointer',
    'untimed correctness; not performance evidence',
    controlledCorrectnessRawSha,
  ),
  [{ sourceId: 'controlled-correctness-raw', sha256Pointer: '/raw/sha256' }],
);
const controlledCaseDefinitions = CONTROLLED_SCALES.map(
  (componentCount, rotationOffset) => ({
    name: `controlled-${componentCount}`,
    componentCount,
    variants: ['ordinary', 'worker-4', 'worker-8'],
    repeats: 10,
    rotationOffset,
  }),
);
const controlledRaw = {
  schema: 1,
  measurementClass: 'formal local wall evidence subject to host gates',
  admitted: true,
  admissionFailures: [],
  matrix: {
    lane: 'wall-confirm',
    configuredPools: numericPools(),
    cases: controlledCaseDefinitions,
  },
  harnessSourceManifest,
  runtime: controlledRuntime(),
  fixture: { worktreeStatus: '', commit: COMMIT },
  evidence: {
    admission: { pointerSha256: controlledAdmissionPointerSha },
    correctness: { pointerSha256: controlledCorrectnessPointerSha },
  },
  hostAdmissions: [],
  runs: controlledRuns(controlledCaseDefinitions),
};
controlledRaw.hostAdmissions = controlledRaw.runs.map(() => hostAdmission());
const controlledRawSha = addSource(
  'controlled-confirmation-raw',
  'vue-controlled-confirmation-raw',
  controlledRaw,
  [
    {
      sourceId: 'controlled-admission-pointer',
      sha256Pointer: '/evidence/admission/pointerSha256',
    },
    {
      sourceId: 'controlled-correctness-pointer',
      sha256Pointer: '/evidence/correctness/pointerSha256',
    },
  ],
);
const controlledPolicyEvidence = deriveControlledPolicyEvidence(controlledRaw);
const controlledSummaries = CONTROLLED_SCALES.map((componentCount) =>
  controlledScaleSummary(
    componentCount,
    controlledPolicyEvidence.byScale[String(componentCount)],
  ),
);
const controlledSummary = {
  schema: 1,
  sourceReportSha256: controlledRawSha,
  runtime: structuredClone(controlledRaw.runtime),
  fixture: structuredClone(controlledRaw.fixture),
  mechanicalCrossover: {
    status: 'confirmed',
    crossover: { componentCount: 1024, confirmedByComponentCount: 2048 },
  },
  resourceAcceptableCrossover: deriveControlledResourceCrossover(controlledRaw),
  additionalConfirmationMatrix: null,
  scaleSummaries: controlledSummaries,
  policyEvidence: controlledPolicyEvidence,
};
addSource(
  'controlled-summary',
  'vue-controlled-confirmation-summary',
  controlledSummary,
  [
    {
      sourceId: 'controlled-confirmation-raw',
      sha256Pointer: '/sourceReportSha256',
    },
  ],
);

const correctnessArtifacts = [
  correctnessArtifact('1'.repeat(64), '2'.repeat(64)),
  correctnessArtifact('3'.repeat(64), '4'.repeat(64)),
];
const correctnessContentSha256 =
  correctnessArtifactSetAddress(correctnessArtifacts);
const correctnessManifestDocument = {
  schema: 2,
  artifactStore: {
    kind: 'git-head-content-addressed',
    repository: 'github.com/hyf0/rolldown-parallel-js-plugin',
    contentSha256: correctnessContentSha256,
    root: `research/artifacts/correctness/sha256/${correctnessContentSha256}`,
  },
  artifacts: correctnessArtifacts,
};
const correctnessManifestSha = addSource(
  'independent-correctness-manifest',
  'vue-independent-correctness-manifest',
  correctnessManifestDocument,
);
const independentCorrectnessEvidence = {
  manifest: {
    bytes: records.get('independent-correctness-manifest').bytes,
    sha256: correctnessManifestSha,
    repository: 'github.com/hyf0/rolldown-parallel-js-plugin',
    repositoryHead: COMMIT,
    contentSha256: correctnessContentSha256,
  },
  artifacts: correctnessArtifacts.map((entry) => ({
    raw: { bytes: 1, sha256: entry.rawSha256 },
    summary: { bytes: 1, sha256: entry.summarySha256 },
  })),
  admittedProjects: INDEPENDENT_CASES.map(({ projectId }) => projectId),
  projectCanonicalEvidenceSha256: Object.fromEntries(
    INDEPENDENT_CASES.map(({ projectId }) => [projectId, HASH]),
  ),
};
const independentHarness = {
  commit: COMMIT,
  clean: true,
  statusSha256: EMPTY_SHA256,
  sourceFileCount: 10,
  sourceManifestSha256: HASH,
};
const independentRuntime = {
  profile: structuredClone(LIFECYCLE_BASELINE),
  commit: LIFECYCLE_BASELINE.sourceCommit,
  clean: true,
  binding: { sha256: LIFECYCLE_BASELINE.nativeBindingSha256 },
  distribution: { sha256: LIFECYCLE_BASELINE.distributionSha256 },
};
const independentScreenRaw = independentRaw(
  'independent-vue-wall-screen',
  correctnessManifestSha,
);
const independentScreenRawSha = addSource(
  'independent-screen-raw',
  'vue-independent-screen-raw',
  independentScreenRaw,
  [
    {
      sourceId: 'independent-correctness-manifest',
      sha256Pointer: '/correctnessEvidence/manifest/sha256',
    },
  ],
);
const independentScreenSummary = independentSummary(
  'independent-vue-wall-screen',
  independentScreenRawSha,
  [
    { projectId: 'floating-vue' },
    { projectId: 'cabinet-icon' },
    { projectId: 'directus-amendment-candidate' },
  ],
);
const independentScreenSummarySha = addSource(
  'independent-screen-summary',
  'vue-independent-screen-summary',
  independentScreenSummary,
  [{ sourceId: 'independent-screen-raw', sha256Pointer: '/rawArtifactSha256' }],
);
const independentConfirmRaw = independentRaw(
  'independent-vue-wall-confirm',
  correctnessManifestSha,
  {
    raw: { bytes: 1, sha256: independentScreenRawSha },
    summary: {
      bytes: 1,
      sha256: independentScreenSummarySha,
      canonicalSummarySha256: HASH,
    },
  },
);
const independentConfirmRawSha = addSource(
  'independent-confirmation-raw',
  'vue-independent-confirmation-raw',
  independentConfirmRaw,
  [
    {
      sourceId: 'independent-correctness-manifest',
      sha256Pointer: '/correctnessEvidence/manifest/sha256',
    },
    {
      sourceId: 'independent-screen-raw',
      sha256Pointer: '/screenEvidence/raw/sha256',
    },
    {
      sourceId: 'independent-screen-summary',
      sha256Pointer: '/screenEvidence/summary/sha256',
    },
  ],
);
const independentPolicyEvidence = deriveIndependentPolicyEvidence(
  independentConfirmRaw,
);
const independentProjects = INDEPENDENT_CASES.map((definition) =>
  independentProject(
    definition.projectId,
    definition.band,
    definition.reachedSfcCount,
    independentPolicyEvidence[definition.projectId],
  ),
);
const independentConfirmSummary = independentSummary(
  'independent-vue-wall-confirm',
  independentConfirmRawSha,
  independentProjects,
);
addSource(
  'independent-confirmation-summary',
  'vue-independent-confirmation-summary',
  independentConfirmSummary,
  [
    {
      sourceId: 'independent-confirmation-raw',
      sha256Pointer: '/rawArtifactSha256',
    },
  ],
);

const mdxBaseRaw = mdxScalePerformanceReport(
  mdxBaseScreenMatrix(),
  new Map(MDX_BASE_SCALES.map((scale) => [scale, scale >= 1024 ? 1.2 : 0.95])),
);
const mdxBaseSha = addSource(
  'mdx-base-screen',
  'mdx-performance-raw',
  mdxBaseRaw,
);
const mdxScreenRecord = mdxFixtureRecord('mdx-base-screen');
const mdxInitialPlan = planScaleFollowup({
  screenRecord: mdxScreenRecord,
  manifest: MDX_SCALE_MANIFEST,
});
const mdxConfirmationRaw = mdxScalePerformanceReport(
  mdxInitialPlan.matrix,
  new Map([
    [512, 0.95],
    [1024, 1.25],
    [2048, 1.3],
    [9157, 1.4],
  ]),
);
const mdxConfirmationSha = addSource(
  'mdx-confirmation',
  'mdx-performance-raw',
  mdxConfirmationRaw,
  [
    {
      sourceId: 'mdx-base-screen',
      sha256Pointer: '/matrix/followup/screenArtifactSha256',
    },
  ],
);
const mdxInitialRecord = mdxFixtureRecord('mdx-confirmation');
const refinement768Plan = planScaleFollowup({
  screenRecord: mdxScreenRecord,
  followupRecords: [mdxInitialRecord],
  manifest: MDX_SCALE_MANIFEST,
});
const refinement768Raw = mdxScalePerformanceReport(
  refinement768Plan.matrix,
  new Map(),
);
const refinement768Sha = addSource(
  'mdx-refinement-768-screen',
  'mdx-performance-raw',
  refinement768Raw,
  mdxFollowupLinks(['mdx-confirmation']),
);
const refinement768Record = mdxFixtureRecord('mdx-refinement-768-screen');
const confirmation768Plan = planScaleFollowup({
  screenRecord: mdxScreenRecord,
  followupRecords: [mdxInitialRecord, refinement768Record],
  manifest: MDX_SCALE_MANIFEST,
});
const confirmation768Raw = mdxScalePerformanceReport(
  confirmation768Plan.matrix,
  new Map([[768, 0.98]]),
);
const confirmation768Sha = addSource(
  'mdx-refinement-768-confirmation',
  'mdx-performance-raw',
  confirmation768Raw,
  mdxFollowupLinks(['mdx-confirmation', 'mdx-refinement-768-screen']),
);
const confirmation768Record = mdxFixtureRecord(
  'mdx-refinement-768-confirmation',
);
const refinement896Plan = planScaleFollowup({
  screenRecord: mdxScreenRecord,
  followupRecords: [
    mdxInitialRecord,
    refinement768Record,
    confirmation768Record,
  ],
  manifest: MDX_SCALE_MANIFEST,
});
const refinement896Raw = mdxScalePerformanceReport(
  refinement896Plan.matrix,
  new Map(),
);
const refinement896Sha = addSource(
  'mdx-refinement-896-screen',
  'mdx-performance-raw',
  refinement896Raw,
  mdxFollowupLinks([
    'mdx-confirmation',
    'mdx-refinement-768-screen',
    'mdx-refinement-768-confirmation',
  ]),
);
const refinement896Record = mdxFixtureRecord('mdx-refinement-896-screen');
const confirmation896Plan = planScaleFollowup({
  screenRecord: mdxScreenRecord,
  followupRecords: [
    mdxInitialRecord,
    refinement768Record,
    confirmation768Record,
    refinement896Record,
  ],
  manifest: MDX_SCALE_MANIFEST,
});
const confirmation896Raw = mdxScalePerformanceReport(
  confirmation896Plan.matrix,
  new Map([[896, 0.98]]),
);
const confirmation896Sha = addSource(
  'mdx-refinement-896-confirmation',
  'mdx-performance-raw',
  confirmation896Raw,
  mdxFollowupLinks([
    'mdx-confirmation',
    'mdx-refinement-768-screen',
    'mdx-refinement-768-confirmation',
    'mdx-refinement-896-screen',
  ]),
);
const mdxFollowupIds = [
  'mdx-confirmation',
  'mdx-refinement-768-screen',
  'mdx-refinement-768-confirmation',
  'mdx-refinement-896-screen',
  'mdx-refinement-896-confirmation',
];
const mdxFollowupRecords = mdxFollowupIds.map(mdxFixtureRecord);
const mdxCrossover = planScaleFollowup({
  screenRecord: mdxScreenRecord,
  followupRecords: mdxFollowupRecords,
  manifest: MDX_SCALE_MANIFEST,
});
const crossoverDecision = mdxCrossover.decision;
addSource(
  'mdx-crossover-complete',
  'mdx-crossover-complete',
  mdxCrossover,
  mdxFollowupIds.map((sourceId, index) => ({
    sourceId,
    sha256Pointer: `/consumedArtifactSha256/${index}`,
  })),
);

const policyCrossover = {
  schema: 1,
  criterion: 'resource-acceptable',
  baseScreen: { path: '/tmp/base.json', sha256: mdxBaseSha },
  followups: mdxFollowupRecords.map(({ path, sha256 }) => ({ path, sha256 })),
  decisionSha256: createHash('sha256')
    .update(JSON.stringify(crossoverDecision))
    .digest('hex'),
  mechanical: structuredClone(crossoverDecision.mechanical),
  resource: structuredClone(crossoverDecision.resource),
  points: MDX_SCALES,
  quotaPoints: [1024, 9157],
  policyEvidenceByScale: structuredClone(
    crossoverDecision.policyEvidenceByScale,
  ),
  executionTemplate: {},
  outputOraclesByScale: {},
};
const commonCrossoverLinks = (base) => [
  { sourceId: 'mdx-base-screen', sha256Pointer: `${base}/baseScreen/sha256` },
  ...mdxFollowupIds.map((sourceId, index) => ({
    sourceId,
    sha256Pointer: `${base}/followups/${index}/sha256`,
  })),
];

const tokioScreenCases = MDX_SCALES.flatMap((scale) =>
  [4, 8, 12, 18].map((tokio) => policyDefinition(scale, pool(tokio, 12), 1)),
);
const tokioScreenRaw = mdxPolicyRaw(
  'allocation-tokio-screen',
  policyCrossover,
  [],
  tokioScreenCases,
);
const tokioScreenSha = addSource(
  'mdx-tokio-screen',
  'mdx-policy-raw',
  tokioScreenRaw,
  commonCrossoverLinks('/matrix/policy/crossover'),
);
const tokioConfirmCases = MDX_SCALES.flatMap((scale) => [
  policyDefinition(
    scale,
    pool(18, 12),
    10,
    undefined,
    syntheticSelection(
      tokioScreenCases,
      scale,
      'ROLLDOWN_WORKER_THREADS',
      18,
      1,
    ),
  ),
  policyDefinition(
    scale,
    pool(8, 12),
    10,
    undefined,
    syntheticSelection(
      tokioScreenCases,
      scale,
      'ROLLDOWN_WORKER_THREADS',
      8,
      2,
    ),
  ),
]);
const tokioConfirmRaw = mdxPolicyRaw(
  'allocation-tokio-confirmation',
  policyCrossover,
  [{ id: 'mdx-tokio-screen', sha256: tokioScreenSha }],
  tokioConfirmCases,
);
const tokioConfirmSha = addSource(
  'mdx-tokio-confirmation',
  'mdx-policy-raw',
  tokioConfirmRaw,
  [
    ...commonCrossoverLinks('/matrix/policy/crossover'),
    {
      sourceId: 'mdx-tokio-screen',
      sha256Pointer: '/matrix/policy/consumedPolicyArtifacts/0/sha256',
    },
  ],
);
const rayonScreenCases = MDX_SCALES.flatMap((scale) =>
  [4, 8, 12].map((rayon) => policyDefinition(scale, pool(18, rayon), 1)),
);
for (const definition of rayonScreenCases) {
  definition.variants = [
    'ordinary',
    'worker-4',
    'worker-3',
    'worker-5',
    'worker-8',
  ];
}
const rayonScreenRaw = mdxPolicyRaw(
  'allocation-rayon-screen',
  policyCrossover,
  [
    { id: 'mdx-tokio-screen', sha256: tokioScreenSha },
    { id: 'mdx-tokio-confirmation', sha256: tokioConfirmSha },
  ],
  rayonScreenCases,
);
const rayonScreenSha = addSource(
  'mdx-rayon-screen',
  'mdx-policy-raw',
  rayonScreenRaw,
  [
    ...commonCrossoverLinks('/matrix/policy/crossover'),
    {
      sourceId: 'mdx-tokio-screen',
      sha256Pointer: '/matrix/policy/consumedPolicyArtifacts/0/sha256',
    },
    {
      sourceId: 'mdx-tokio-confirmation',
      sha256Pointer: '/matrix/policy/consumedPolicyArtifacts/1/sha256',
    },
  ],
);
const rayonConfirmCases = MDX_SCALES.flatMap((scale) => [
  policyDefinition(
    scale,
    pool(18, 12),
    10,
    undefined,
    syntheticSelection(rayonScreenCases, scale, 'RAYON_NUM_THREADS', 12, 1),
  ),
  policyDefinition(
    scale,
    pool(18, 4),
    10,
    undefined,
    syntheticSelection(rayonScreenCases, scale, 'RAYON_NUM_THREADS', 4, 2),
  ),
]);
const rayonConfirmRaw = mdxPolicyRaw(
  'allocation-rayon-confirmation',
  policyCrossover,
  [
    { id: 'mdx-tokio-screen', sha256: tokioScreenSha },
    { id: 'mdx-tokio-confirmation', sha256: tokioConfirmSha },
    { id: 'mdx-rayon-screen', sha256: rayonScreenSha },
  ],
  rayonConfirmCases,
);
const rayonConfirmSha = addSource(
  'mdx-rayon-confirmation',
  'mdx-policy-raw',
  rayonConfirmRaw,
  [
    ...commonCrossoverLinks('/matrix/policy/crossover'),
    {
      sourceId: 'mdx-tokio-screen',
      sha256Pointer: '/matrix/policy/consumedPolicyArtifacts/0/sha256',
    },
    {
      sourceId: 'mdx-tokio-confirmation',
      sha256Pointer: '/matrix/policy/consumedPolicyArtifacts/1/sha256',
    },
    {
      sourceId: 'mdx-rayon-screen',
      sha256Pointer: '/matrix/policy/consumedPolicyArtifacts/2/sha256',
    },
  ],
);
const tokioSummary = policySummary(tokioConfirmRaw, 'ROLLDOWN_WORKER_THREADS');
const rayonSummary = policySummary(rayonConfirmRaw, 'RAYON_NUM_THREADS');
const allocationComplete = {
  schema: 1,
  status: 'complete',
  stage: 'allocation-complete',
  crossover: structuredClone(policyCrossover),
  consumedPolicyArtifactSha256: [
    tokioScreenSha,
    tokioConfirmSha,
    rayonScreenSha,
    rayonConfirmSha,
  ],
  consumedPolicyArtifacts: [
    artifactReference(tokioScreenSha),
    artifactReference(tokioConfirmSha),
    artifactReference(rayonScreenSha),
    artifactReference(rayonConfirmSha),
  ],
  tokioConfirmation: tokioSummary,
  rayonConfirmation: rayonSummary,
  repeatedWinnerByScale: {
    tokio: winnerByScale(tokioSummary, 'ROLLDOWN_WORKER_THREADS'),
    rayon: winnerByScale(rayonSummary, 'RAYON_NUM_THREADS'),
  },
};
addSource(
  'mdx-allocation-complete',
  'mdx-allocation-complete',
  allocationComplete,
  [
    {
      sourceId: 'mdx-tokio-screen',
      sha256Pointer: '/consumedPolicyArtifactSha256/0',
    },
    {
      sourceId: 'mdx-tokio-confirmation',
      sha256Pointer: '/consumedPolicyArtifactSha256/1',
    },
    {
      sourceId: 'mdx-rayon-screen',
      sha256Pointer: '/consumedPolicyArtifactSha256/2',
    },
    {
      sourceId: 'mdx-rayon-confirmation',
      sha256Pointer: '/consumedPolicyArtifactSha256/3',
    },
    ...commonCrossoverLinks('/crossover'),
  ],
);

const calibrationSha = addSource(
  'cpulimit-calibration',
  'cpulimit-calibration',
  syntheticCalibration(),
);
const calibrationReference = {
  path: '/tmp/calibration.json',
  sha256: calibrationSha,
};
const quotaScreenCases = [1024, 9157].flatMap((scale) =>
  [400, 800, 1200].map((quota) =>
    policyDefinition(scale, pool(18, 12), 1, quota),
  ),
);
const quotaScreenRaw = mdxPolicyRaw(
  'quota-screen',
  policyCrossover,
  [],
  quotaScreenCases,
  calibrationReference,
);
const quotaScreenSha = addSource(
  'mdx-quota-screen',
  'mdx-policy-raw',
  quotaScreenRaw,
  [
    ...commonCrossoverLinks('/matrix/policy/crossover'),
    {
      sourceId: 'cpulimit-calibration',
      sha256Pointer: '/matrix/policy/calibration/sha256',
    },
  ],
);
const quotaConfirmCases = [1024, 9157].flatMap((scale) =>
  [400, 800, 1200].map((quota) =>
    policyDefinition(
      scale,
      pool(18, 12),
      10,
      quota,
      syntheticQuotaSelection(quotaScreenCases, scale, quota),
    ),
  ),
);
const quotaConfirmRaw = mdxPolicyRaw(
  'quota-confirmation',
  policyCrossover,
  [{ id: 'mdx-quota-screen', sha256: quotaScreenSha }],
  quotaConfirmCases,
  calibrationReference,
);
const quotaConfirmSha = addSource(
  'mdx-quota-confirmation',
  'mdx-policy-raw',
  quotaConfirmRaw,
  [
    ...commonCrossoverLinks('/matrix/policy/crossover'),
    {
      sourceId: 'mdx-quota-screen',
      sha256Pointer: '/matrix/policy/consumedPolicyArtifacts/0/sha256',
    },
    {
      sourceId: 'cpulimit-calibration',
      sha256Pointer: '/matrix/policy/calibration/sha256',
    },
  ],
);
const quotaSummary = policySummary(quotaConfirmRaw);
const quotaComplete = {
  schema: 1,
  status: 'complete',
  stage: 'quota-complete',
  crossover: structuredClone(policyCrossover),
  calibration: calibrationReference,
  consumedPolicyArtifactSha256: [quotaScreenSha, quotaConfirmSha],
  consumedPolicyArtifacts: [
    artifactReference(quotaScreenSha),
    artifactReference(quotaConfirmSha),
  ],
  confirmation: quotaSummary,
};
addSource('mdx-quota-complete', 'mdx-quota-complete', quotaComplete, [
  {
    sourceId: 'mdx-quota-screen',
    sha256Pointer: '/consumedPolicyArtifactSha256/0',
  },
  {
    sourceId: 'mdx-quota-confirmation',
    sha256Pointer: '/consumedPolicyArtifactSha256/1',
  },
  { sourceId: 'cpulimit-calibration', sha256Pointer: '/calibration/sha256' },
  ...commonCrossoverLinks('/crossover'),
]);

const cases = [];
for (const [index, scaleRole] of formalCrossoverRoles().entries()) {
  const controlledScale = CONTROLLED_SCALES[index];
  cases.push({
    id: `controlled-${scaleRole}`,
    family: 'vue-controlled',
    study: 'baseline',
    scaleRole,
    sourceId: 'controlled-summary',
    scaleValuePointer: `/scaleSummaries/${index}/componentCount`,
    policyEvidencePointer: `/policyEvidence/byScale/${controlledScale}`,
    policyEvidenceSchemaPointer: '/policyEvidence/schema',
    oracleWorkerCountPointer: `/policyEvidence/byScale/${controlledScale}/variants/ordinary/selectedOracleCount`,
    poolEnvironmentSourceId: 'controlled-confirmation-raw',
    poolEnvironmentPointer: '/matrix/configuredPools',
  });
  const mdxScale = MDX_SCALES[index];
  const mdxPointIndex = crossoverDecision.points.findIndex(
    ({ scale }) => scale === mdxScale,
  );
  cases.push({
    id: `mdx-${scaleRole}`,
    family: 'mdx',
    study: 'baseline',
    scaleRole,
    sourceId: 'mdx-crossover-complete',
    scaleValuePointer: `/decision/points/${mdxPointIndex}/scale`,
    policyEvidencePointer: `/decision/policyEvidenceByScale/${mdxScale}`,
    policyEvidenceSchemaPointer: `/decision/policyEvidenceByScale/${mdxScale}/schema`,
    oracleWorkerCountPointer: `/decision/policyEvidenceByScale/${mdxScale}/selectedOracleWorkerCount`,
    poolEnvironmentSourceId: 'mdx-confirmation',
    poolEnvironmentPointer: '/matrix/poolEnvironment',
  });
}
for (const [index, [scaleRole, scale]] of [
  ['independent-small', 4],
  ['independent-medium', 166],
  ['independent-large', 546],
].entries()) {
  cases.push({
    id: `vue-project-${scaleRole}`,
    family: 'vue-project',
    study: 'baseline',
    scaleRole,
    sourceId: 'independent-confirmation-summary',
    scaleValuePointer: `/projectSummaries/${index}/reachedSfcCount`,
    policyEvidencePointer: `/projectSummaries/${index}/policyEvidence`,
    policyEvidenceSchemaPointer: `/projectSummaries/${index}/policyEvidence/schema`,
    oracleWorkerCountPointer: `/projectSummaries/${index}/policyEvidence/selectedOracleWorkerCount`,
    poolEnvironmentSourceId: 'independent-confirmation-raw',
    poolEnvironmentPointer: '/configuredPools',
  });
  assert.equal(independentProjects[index].reachedSfcCount, scale);
}
for (const [study, summaryField] of [
  ['allocation-tokio-confirmation', 'tokioConfirmation'],
  ['allocation-rayon-confirmation', 'rayonConfirmation'],
]) {
  const sourceCases = allocationComplete[summaryField].cases;
  for (const [index, entry] of sourceCases.entries()) {
    cases.push({
      id: `${study}-${index}`,
      family: 'mdx',
      study,
      scaleRole: roleForMdxScale(entry.scale),
      sourceId: 'mdx-allocation-complete',
      sourceStudyPointer: `/${summaryField}/sourcePolicy/stage`,
      scaleValuePointer: `/${summaryField}/cases/${index}/scale`,
      policyEvidencePointer: `/${summaryField}/cases/${index}/policyEvidence`,
      policyEvidenceSchemaPointer: `/${summaryField}/cases/${index}/policyEvidence/schema`,
      oracleWorkerCountPointer: `/${summaryField}/cases/${index}/policyEvidence/selectedOracleWorkerCount`,
      poolEnvironmentSourceId: 'mdx-allocation-complete',
      poolEnvironmentPointer: `/${summaryField}/cases/${index}/poolEnvironment`,
    });
  }
}
for (const [index, entry] of quotaComplete.confirmation.cases.entries()) {
  cases.push({
    id: `quota-${entry.quotaPercent}-${entry.scale}`,
    family: 'mdx',
    study: 'cpu-rate-confirmation',
    scaleRole: roleForMdxScale(entry.scale),
    sourceId: 'mdx-quota-complete',
    sourceStudyPointer: '/confirmation/sourcePolicy/stage',
    scaleValuePointer: `/confirmation/cases/${index}/scale`,
    policyEvidencePointer: `/confirmation/cases/${index}/policyEvidence`,
    policyEvidenceSchemaPointer: `/confirmation/cases/${index}/policyEvidence/schema`,
    oracleWorkerCountPointer: `/confirmation/cases/${index}/policyEvidence/selectedOracleWorkerCount`,
    cpuRatePercentPointer: `/confirmation/cases/${index}/quotaPercent`,
    poolEnvironmentSourceId: 'mdx-quota-complete',
    poolEnvironmentPointer: `/confirmation/cases/${index}/poolEnvironment`,
  });
}

const plan = {
  schemaVersion: 1,
  kind: 'rolldown-fixed-worker-policy-build-plan',
  protocol: CURRENT_PROTOCOL_REVISION,
  formalCoverage: true,
  candidatePolicy: {
    fittedFromEvidence: false,
    frozenBeforeEvidence: true,
    frozenBy: '.agents/docs/scale-crossover-protocol-amendment-1.md',
    fixedFourWorkerCount: 4,
    hardwareCapFormula: 'min(availableParallelism, workerSafetyCap)',
    workerSafetyCap: 8,
  },
  sources: definitions,
  machine: {
    sourceId: 'machine',
    workerSafetyCap: 8,
    bindings: {
      availableParallelism: '/availableParallelism',
      performanceCores: '/performanceCores',
      efficiencyCores: '/efficiencyCores',
      cpuModel: '/cpuModel',
      node: '/node',
    },
  },
  cases,
};

const buildInputs = {
  plan,
  planRecord: {
    path: 'experiments/worker-policy/data/build-plan.json',
    sha256: HASH,
    bytes: 1,
  },
  builderSources: EVIDENCE_REQUIRED_BUILDER_SOURCES.map((path) => ({
    path,
    sha256: BUILDER_SOURCE_HASHES[path] ?? SOURCE_HASH,
    bytes: 1,
  })),
  sourceCommit: COMMIT,
  protocolDocuments: EVIDENCE_REQUIRED_PROTOCOL_DOCUMENTS.map((path) => ({
    path,
    sha256: HASH,
    bytes: 1,
  })),
  sourceDocuments: records,
};

const evidence = buildFixedPolicyEvidence(buildInputs);
validateEvidence(evidence);
verifySourceBindings(
  evidence,
  evidence.sourceReports.map(({ id }) => records.get(id).document),
);
const result = evaluateFixedWorkerPolicies(evidence, {
  sourceBindingsVerified: true,
});
assert.equal(result.formalCoveragePassed, true);
assert.equal(
  result.localFixedPolicyGate.passed,
  true,
  JSON.stringify(result.candidates),
);
assert.equal(result.shippableAutomaticFixedPolicy, false);
assert.deepEqual(
  result.localFixedPolicyGate.passingCandidates.map(
    ({ workerCount }) => workerCount,
  ),
  [4, 8],
);
const smallFour = result.candidates.fixedFour.results.find(
  ({ caseId }) => caseId === 'vue-project-independent-small',
);
assert.equal(smallFour.passed, true);
assert.equal(smallFour.pairedWallRatioToOrdinaryBootstrap95Upper, 1.02);
assert.equal(
  evidence.cases.find(({ id }) => id === 'controlled-crossover').scaleValue,
  1024,
);
assert.deepEqual(
  evidence.cases.find(({ id }) => id === 'controlled-crossover')
    .poolEnvironment,
  BASELINE_POOLS,
);

const terminalEvidence = terminalBoundaryEvidence(evidence);
validateEvidence(terminalEvidence);
const terminalResult = evaluateFixedWorkerPolicies(terminalEvidence, {
  sourceBindingsVerified: true,
});
assert.equal(terminalResult.localFixedPolicyGate.passed, true);
for (const candidate of Object.values(terminalResult.candidates)) {
  assert.equal(candidate.results.length, terminalEvidence.cases.length);
  assert.equal(
    candidate.results.filter(
      ({ scaleRoles }) =>
        scaleRoles?.includes('crossover-confirm') &&
        scaleRoles.includes('full'),
    ).length,
    6,
  );
}
const duplicatedTerminal = structuredClone(terminalEvidence);
const duplicatedCase = structuredClone(
  duplicatedTerminal.cases.find(
    ({ family, study, scaleRoles }) =>
      family === 'vue-controlled' &&
      study === 'baseline' &&
      scaleRoles.includes('crossover-confirm') &&
      scaleRoles.includes('full'),
  ),
);
duplicatedCase.id = `${duplicatedCase.id}-duplicate`;
duplicatedTerminal.cases.push(duplicatedCase);
assert.throws(
  () => validateEvidence(duplicatedTerminal),
  /reuses a policyEvidence block/,
);
const relabelledTerminal = structuredClone(terminalEvidence);
relabelledTerminal.cases.find(
  ({ family, study, scaleRoles }) =>
    family === 'mdx' &&
    study === 'baseline' &&
    scaleRoles.includes('crossover-confirm') &&
    scaleRoles.includes('full'),
).scaleRoles = ['full'];
assert.throws(
  () => validateEvidence(relabelledTerminal),
  /invalid fixed-worker policy case/,
);

const negativePlans = [
  [
    'forged-source-type',
    (value) =>
      (value.sources.find(({ id }) => id === 'controlled-summary').sourceType =
        'vue-independent-confirmation-summary'),
    undefined,
    /controlled Vue confirmation summary|durable independent Vue|formal source type|instead of formal/,
  ],
  [
    'missing-formal-lineage',
    (value) =>
      (value.sources.find(({ id }) => id === 'controlled-summary').links = []),
    undefined,
    /required lineage/,
  ],
  [
    'wrong-baseline-pools',
    () => {},
    (documents) =>
      (documents.get(
        'controlled-confirmation-raw',
      ).document.matrix.configuredPools.tokio = 17),
    /controlled Vue wall confirmation|18\/12\/4/,
  ],
  [
    'relabelled-crossover-role',
    (value) =>
      (value.cases.find(({ id }) => id === 'controlled-crossover').scaleRole =
        'crossover-confirm'),
    undefined,
    /relabels source-computed crossover/,
  ],
  [
    'relabelled-tokio-finalist',
    () => {},
    (documents) =>
      (documents
        .get('mdx-tokio-confirmation')
        .document.matrix.cases.find(
          ({ selection }) =>
            selection.rustPoolCandidateKind === 'different-pool-runner-up',
        ).selection.rustPoolCandidateKind = 'screen-selected'),
    /finalists.*selected winner and runner-up/,
  ],
  [
    'rayon-drops-selected-tokio',
    () => {},
    (documents) =>
      (documents.get(
        'mdx-rayon-confirmation',
      ).document.matrix.cases[0].poolEnvironment.ROLLDOWN_WORKER_THREADS =
        '12'),
    /Rayon stage did not retain Tokio|compact policy metrics, oracle, or winner differ/,
  ],
  [
    'wrong-policy-pool-grid',
    () => {},
    (documents) =>
      (documents.get(
        'mdx-quota-confirmation',
      ).document.matrix.cases[0].poolEnvironment.RAYON_NUM_THREADS = '11'),
    /quota stage changed the frozen baseline pools|compact policy metrics, oracle, or winner differ/,
  ],
  [
    'forged-mdx-conclusion-class',
    () => {},
    (documents) =>
      (documents.get('mdx-base-screen').document.conclusionEligible = true),
    /crossover performance report/,
  ],
  [
    'forged-controlled-summary-metrics',
    () => {},
    (documents) => {
      const summary = documents.get('controlled-summary').document;
      summary.policyEvidence.byScale['1024'].variants['worker-4'].wallMedianMs =
        1;
      summary.scaleSummaries
        .find(({ componentCount }) => componentCount === 1024)
        .variants.find(({ variant }) => variant === 'worker-4').wallMs.median =
        1;
    },
    /controlled Vue summary policy metrics or oracle differ from raw repeated runs/,
  ],
  [
    'forged-controlled-resource-crossover',
    () => {},
    (documents) =>
      (documents.get(
        'controlled-summary',
      ).document.resourceAcceptableCrossover.crossover.selectedWorker =
        'worker-8'),
    /controlled Vue resource crossover and formal roles differ from raw repeated runs/,
  ],
  [
    'truncated-controlled-raw-grid',
    () => {},
    (documents) =>
      documents.get('controlled-confirmation-raw').document.runs.pop(),
    /raw run grid is truncated or contains duplicates/,
  ],
  [
    'duplicated-independent-raw-grid',
    () => {},
    (documents) => {
      const runs = documents.get('independent-confirmation-raw').document.runs;
      runs.push(structuredClone(runs.at(-1)));
    },
    /raw run grid is truncated or contains duplicates/,
  ],
  [
    'forged-independent-screen-selection',
    () => {},
    (documents) =>
      (documents.get(
        'independent-confirmation-raw',
      ).document.matrix.cases[0].selectedScreenWorkerCount = 5),
    /confirmation is not the screen-selected best plus adjacent workers/,
  ],
  [
    'forged-mdx-baseline-decision',
    () => {},
    (documents) => {
      const decision = documents.get('mdx-crossover-complete').document
        .decision;
      decision.policyEvidenceByScale['1024'].selectedOracleWorkerCount = 8;
      decision.points.find(
        ({ scale }) => scale === 1024,
      ).policyEvidence.selectedOracleWorkerCount = 8;
    },
    /decision or policy evidence is not derived from raw repeated runs|completed MDX crossover is not the exact production planner result/,
  ],
  [
    'forged-mdx-screened-fastest-worker',
    () => {},
    (documents) =>
      (documents.get(
        'mdx-confirmation',
      ).document.matrix.followup.workerSelectionByScale[
        '1024'
      ].bestWorkerElapsedMs += 1),
    /MDX follow-up is not the exact production-generated next stage/,
  ],
  [
    'forged-mdx-followup-direction',
    () => {},
    (documents) =>
      (documents.get(
        'mdx-refinement-768-screen',
      ).document.matrix.followup.direction.upperScale = 2048),
    /MDX follow-up is not the exact production-generated next stage/,
  ],
  [
    'truncated-mdx-crossover-raw-grid',
    () => {},
    (documents) => documents.get('mdx-confirmation').document.runs.pop(),
    /raw run grid is truncated or contains duplicates/,
  ],
  [
    'forged-tokio-screen-grid',
    () => {},
    (documents) => {
      const screen = documents.get('mdx-tokio-screen').document;
      const definition = screen.matrix.cases[0];
      definition.variants = definition.variants.filter(
        (variant) => variant !== 'worker-8',
      );
      screen.runs = screen.runs
        .filter(
          (run) => run.name !== definition.name || run.variant !== 'worker-8',
        )
        .map((run, sequence) => ({ ...run, sequence }));
    },
    /Tokio screen.*is not the frozen 4\/8\/12\/18 grid/,
  ],
  [
    'forged-allocation-summary-winner',
    () => {},
    (documents) => {
      const complete = documents.get('mdx-allocation-complete').document;
      const entry = complete.tokioConfirmation.cases[0];
      entry.policyEvidence.selectedOracleWorkerCount = 8;
      entry.policyEvidence.variants['worker-8'].wallMedianMs = 1;
      complete.tokioConfirmation.policyEvidenceByCase[entry.key] =
        entry.policyEvidence;
      complete.repeatedWinnerByScale.tokio[String(entry.scale)] = {
        caseKey: entry.key,
        poolCount: Number(entry.poolEnvironment.ROLLDOWN_WORKER_THREADS),
        workerCount: 8,
        wallMedianMs: 1,
        resourceEligible: true,
      };
    },
    /compact policy metrics, oracle, or winner differ from raw runs/,
  ],
  [
    'duplicated-allocation-raw-grid',
    () => {},
    (documents) => {
      const report = documents.get('mdx-tokio-confirmation').document;
      const { runs } = report;
      runs.push(structuredClone(runs.at(-1)));
      report.hostAdmissionAttempts.push(
        structuredClone(report.hostAdmissionAttempts.at(-1)),
      );
    },
    /raw run grid is truncated or contains duplicates/,
  ],
  [
    'forged-allocation-embedded-crossover',
    () => {},
    (documents) => {
      for (const id of [
        'mdx-allocation-complete',
        'mdx-tokio-screen',
        'mdx-tokio-confirmation',
        'mdx-rayon-screen',
        'mdx-rayon-confirmation',
      ]) {
        const document = documents.get(id).document;
        const crossover =
          id === 'mdx-allocation-complete'
            ? document.crossover
            : document.matrix.policy.crossover;
        crossover.resource.scale = 2048;
      }
      const complete = documents.get('mdx-allocation-complete').document;
      complete.tokioConfirmation.sourcePolicy.crossover.resource.scale = 2048;
      complete.rayonConfirmation.sourcePolicy.crossover.resource.scale = 2048;
    },
    /embedded crossover is not the unique rederived MDX completion/,
  ],
  [
    'forged-quota-summary-oracle',
    () => {},
    (documents) => {
      const confirmation =
        documents.get('mdx-quota-complete').document.confirmation;
      const entry = confirmation.cases[0];
      entry.policyEvidence.selectedOracleWorkerCount = 8;
      entry.policyEvidence.variants['worker-8'].wallMedianMs = 1;
      confirmation.policyEvidenceByCase[entry.key] = entry.policyEvidence;
      entry.selection.resourceOracleWorkerCount = 8;
    },
    /compact policy metrics, oracle, or winner differ from raw runs/,
  ],
  [
    'duplicated-quota-raw-grid',
    () => {},
    (documents) => {
      const report = documents.get('mdx-quota-confirmation').document;
      const { runs } = report;
      runs.push(structuredClone(runs.at(-1)));
      report.hostAdmissionAttempts.push(
        structuredClone(report.hostAdmissionAttempts.at(-1)),
      );
    },
    /raw run grid is truncated or contains duplicates/,
  ],
  [
    'forged-quota-screen-selection',
    () => {},
    (documents) =>
      (documents.get(
        'mdx-quota-confirmation',
      ).document.matrix.cases[0].selection.workerCount = 8),
    /quota confirmation.*is not generated from its screen/,
  ],
  [
    'forged-cpulimit-calibration-sample',
    () => {},
    (documents) =>
      (documents.get(
        'cpulimit-calibration',
      ).document.samples[0].load.averageCpuPercent = 199),
    /calibration sample 0 is not admitted raw data|calibration load record is incomplete/,
  ],
  [
    'forged-cpulimit-frozen-profile',
    () => {},
    (documents) => {
      const calibration = documents.get('cpulimit-calibration').document;
      calibration.parentCiMarkers.CI = '1';
      calibration.options.durationMs = 9_000;
    },
    /is not the passed formal cpulimit calibration/,
  ],
  [
    'forged-cpulimit-provenance',
    () => {},
    (documents) => {
      const calibration = documents.get('cpulimit-calibration').document;
      calibration.binarySha256 = 'c'.repeat(64);
      calibration.controllerProvenance.binary.sha256 = 'c'.repeat(64);
    },
    /is not the passed formal cpulimit calibration/,
  ],
  [
    'forged-cpulimit-saturation',
    () => {},
    (documents) =>
      (documents.get(
        'cpulimit-calibration',
      ).document.unconstrainedSaturationCpuPercent = 799),
    /saturation ceiling is not derived/,
  ],
  [
    'forged-cpulimit-controller-record',
    () => {},
    (documents) =>
      (documents.get(
        'cpulimit-calibration',
      ).document.samples[0].controller.stopCycles = 101),
    /Invalid cpulimit controller record/,
  ],
  [
    'duplicated-independent-project-definition',
    () => {},
    (documents) => {
      const report = documents.get('independent-confirmation-raw').document;
      report.matrix.cases.push(structuredClone(report.matrix.cases[0]));
      const duplicateRuns = report.runs
        .filter(
          ({ projectId }) => projectId === report.matrix.cases[0].projectId,
        )
        .map((run) => ({
          ...structuredClone(run),
          sequence: report.runs.length,
        }));
      report.runs.push(...duplicateRuns);
    },
    /does not contain exactly the frozen three independent Vue projects|rejects duplicate definitions or runs/,
  ],
  [
    'missing-controlled-runtime-pin',
    () => {},
    (documents) =>
      delete documents.get('controlled-confirmation-raw').document.runtime
        .runtimePin,
    /is not an admitted controlled Vue wall confirmation/,
  ],
  [
    'missing-independent-runtime-pin',
    () => {},
    (documents) =>
      delete documents.get('independent-confirmation-raw').document.runtime
        .profile,
    /is not an admitted independent Vue/,
  ],
  [
    'forged-controlled-harness-entry',
    () => {},
    (documents) => {
      const manifest = documents.get('controlled-confirmation-raw').document
        .harnessSourceManifest;
      for (const entry of manifest.entries) entry.sha256 = 'c'.repeat(64);
    },
    /is not an admitted controlled Vue wall confirmation/,
  ],
  [
    'forged-controlled-harness-everywhere-except-snapshot',
    () => {},
    (documents) => {
      const forged = createHarnessManifest(
        harnessSourceManifest.entries.map((entry) => ({
          ...entry,
          sha256: 'c'.repeat(64),
        })),
      );
      for (const id of [
        'controlled-admission-raw',
        'controlled-correctness-raw',
        'controlled-confirmation-raw',
      ]) {
        documents.get(id).document.harnessSourceManifest =
          structuredClone(forged);
      }
      for (const id of [
        'controlled-admission-pointer',
        'controlled-correctness-pointer',
      ]) {
        documents.get(id).document.harnessSourceManifest = {
          files: forged.files,
          bytes: forged.bytes,
          aggregateSha256: forged.aggregateSha256,
        };
      }
    },
    /controlled Vue harness manifest does not bind the committed source snapshot/,
  ],
  [
    'missing-controlled-harness-snapshot',
    (value) => {
      value.sources = value.sources.filter(
        ({ id }) => id !== 'controlled-harness-source-snapshot',
      );
    },
    (documents) => documents.delete('controlled-harness-source-snapshot'),
    /requires exactly one vue-controlled-harness-source-snapshot/,
  ],
  [
    'duplicated-controlled-harness-snapshot',
    (value) => {
      const sha256 = 'f'.repeat(64);
      value.sources.push({
        id: 'controlled-harness-source-snapshot-copy',
        sourceType: 'vue-controlled-harness-source-snapshot',
        path: `reports/sha256/${sha256}.json`,
        assertions: [],
        links: [],
      });
    },
    (documents) => {
      const document = structuredClone(
        documents.get('controlled-harness-source-snapshot').document,
      );
      const sha256 = 'f'.repeat(64);
      documents.set('controlled-harness-source-snapshot-copy', {
        path: `reports/sha256/${sha256}.json`,
        sha256,
        bytes: JSON.stringify(document).length,
        document,
      });
    },
    /requires exactly one vue-controlled-harness-source-snapshot/,
  ],
  [
    'mismatched-controlled-harness-snapshot',
    () => {},
    (documents) => {
      const snapshot = documents.get(
        'controlled-harness-source-snapshot',
      ).document;
      const blobs = controlledHarnessBlobs.map((blob, index) =>
        controlledHarnessBlob(blob.path, `forged source ${index}\n`),
      );
      snapshot.blobs = blobs;
      snapshot.harnessSourceManifest = createHarnessManifest(
        blobs.map(({ path, kind, bytes, sha256 }) => ({
          path,
          kind,
          bytes,
          sha256,
        })),
      );
    },
    /controlled Vue harness manifest does not bind the committed source snapshot/,
  ],
  [
    'forged-independent-correctness-content-address',
    () => {},
    (documents) =>
      (documents.get(
        'independent-correctness-manifest',
      ).document.artifacts[0].rawSha256 = 'c'.repeat(64)),
    /is not the committed independent Vue correctness manifest/,
  ],
  [
    'forged-independent-host-admission',
    () => {},
    (documents) =>
      (documents.get(
        'independent-confirmation-raw',
      ).document.runs[0].hostAdmission.policy.maximumOneMinuteLoadAverage = 3),
    /does not pass the frozen clean-host policy/,
  ],
  [
    'mismatched-independent-harness-source-manifest',
    () => {},
    (documents) =>
      (documents.get(
        'independent-screen-raw',
      ).document.harness.sourceManifestSha256 = 'c'.repeat(64)),
    /screen and confirmation do not bind one clean harness\/runtime/,
  ],
];
for (const [label, mutatePlan, mutateDocuments, expected] of negativePlans) {
  const invalidPlan = structuredClone(plan);
  const invalidDocuments = cloneRecords(records);
  mutatePlan(invalidPlan);
  mutateDocuments?.(invalidDocuments);
  assert.throws(
    () =>
      buildFixedPolicyEvidence({
        ...buildInputs,
        plan: invalidPlan,
        sourceDocuments: invalidDocuments,
      }),
    expected,
    label,
  );
}

const smallMedianFailure = structuredClone(evidence);
smallMedianFailure.cases
  .find(({ id }) => id === 'vue-project-independent-small')
  .variants.find(({ workerCount }) => workerCount === 4).wallMedianMs = 104;
const smallMedianResult = evaluateFixedWorkerPolicies(smallMedianFailure, {
  sourceBindingsVerified: true,
});
assert(
  smallMedianResult.candidates.fixedFour.results
    .find(({ caseId }) => caseId === 'vue-project-independent-small')
    .failures.some((failure) =>
      failure.includes('small-case median regression'),
    ),
);

const smallBootstrapFailure = structuredClone(evidence);
smallBootstrapFailure.cases
  .find(({ id }) => id === 'vue-project-independent-small')
  .variants.find(
    ({ workerCount }) => workerCount === 4,
  ).pairedWallRatioToOrdinaryBootstrap95Upper = 1.051;
const smallBootstrapResult = evaluateFixedWorkerPolicies(
  smallBootstrapFailure,
  {
    sourceBindingsVerified: true,
  },
);
assert(
  smallBootstrapResult.candidates.fixedFour.results
    .find(({ caseId }) => caseId === 'vue-project-independent-small')
    .failures.some((failure) => failure.includes('small-case bootstrap upper')),
);

const nonSmallIneligible = structuredClone(evidence);
nonSmallIneligible.cases
  .find(({ id }) => id === 'controlled-crossover')
  .variants.find(({ workerCount }) => workerCount === 8).resourceEligible =
  false;
assert(
  evaluateFixedWorkerPolicies(nonSmallIneligible, {
    sourceBindingsVerified: true,
  })
    .candidates.hardwareCap.results.find(
      ({ caseId }) => caseId === 'controlled-crossover',
    )
    .failures.includes('candidate is not resource eligible'),
);

const forgedBoundMetric = structuredClone(evidence);
forgedBoundMetric.cases
  .find(({ id }) => id === 'controlled-crossover')
  .variants.find(({ workerCount }) => workerCount === 4).wallMedianMs = 1;
assert.throws(
  () =>
    verifySourceBindings(
      forgedBoundMetric,
      evidence.sourceReports.map(({ id }) => records.get(id).document),
    ),
  /differs from/,
);

console.log(
  JSON.stringify({
    valid: {
      sourceTypes: new Set(
        evidence.sourceReports.map(({ sourceType }) => sourceType),
      ).size,
      sources: evidence.sourceReports.length,
      cases: evidence.cases.length,
      formalCoverage: result.formalCoveragePassed,
      localFixedPolicyGatePassed: result.localFixedPolicyGate.passed,
      passingCandidates: result.localFixedPolicyGate.passingCandidates,
      terminalBoundaryCases: terminalEvidence.cases.length,
      terminalBoundaryEvaluatedOnce: true,
    },
    rejected: [
      ...negativePlans.map(([label]) => label),
      'small-median-over-3-percent',
      'small-bootstrap-over-5-percent',
      'non-small-resource-ineligible',
      'forged-bound-metric',
      'duplicated-terminal-policy-block',
      'relabelled-terminal-role',
    ],
  }),
);

function controlledPointer(kind, measurementClass, rawSha256) {
  return {
    schema: 2,
    kind,
    passed: true,
    measurementClass,
    raw: { path: 'raw/report.json', bytes: 1, sha256: rawSha256 },
    harnessSourceManifest: {
      files: harnessSourceManifest.files,
      bytes: harnessSourceManifest.bytes,
      aggregateSha256: harnessSourceManifest.aggregateSha256,
    },
    fixtureCommit: COMMIT,
  };
}

function controlledScaleSummary(componentCount, block) {
  const oracleWorkerCount = block.variants.ordinary.selectedOracleCount;
  const variants = Object.entries(block.variants).map(([variant, compact]) => ({
    variant,
    workerCount:
      variant === 'ordinary' ? 0 : Number(variant.slice('worker-'.length)),
    wallMs: { median: compact.wallMedianMs },
    totalCpuMs: { median: compact.cpuMedianMs },
    peakRssBytes: { median: compact.peakRssMedianBytes },
    pairedWallRatioBootstrap95: {
      upper: compact.pairedWallRatioBootstrap95Upper,
    },
    resourceEligible: compact.resourceEligible,
  }));
  return {
    componentCount,
    selectedResourceWorker: `worker-${oracleWorkerCount}`,
    selectedResourceWorkerCount: oracleWorkerCount,
    resourceEligible: true,
    variants,
  };
}

function independentRaw(lane, manifestSha256, screenEvidence) {
  const confirmation = lane === 'independent-vue-wall-confirm';
  const cases = INDEPENDENT_CASES.map((definition, rotationOffset) => ({
    ...definition,
    variants: confirmation
      ? ['ordinary', 'worker-3', 'worker-4', 'worker-5', 'worker-8']
      : [
          'ordinary',
          'worker-1',
          'worker-2',
          'worker-3',
          'worker-4',
          'worker-5',
          'worker-6',
          'worker-7',
          'worker-8',
        ],
    repeats: confirmation ? 15 : 1,
    rotationOffset,
    selectedScreenWorkerCount: confirmation ? 4 : undefined,
    screenBelowTwoSeconds: confirmation ? true : undefined,
  }));
  let sequence = 0;
  const runs = cases.flatMap((definition) =>
    Array.from({ length: definition.repeats }, (_, blockIndex) => {
      const offset =
        (definition.rotationOffset + blockIndex) % definition.variants.length;
      const order = [
        ...definition.variants.slice(offset),
        ...definition.variants.slice(0, offset),
      ];
      return order.map((variant) => {
        const workerCount =
          variant === 'ordinary' ? 0 : Number(variant.slice('worker-'.length));
        const wall =
          workerCount === 0
            ? 100
            : definition.band === 'small'
              ? workerCount === 4
                ? 102
                : 102.5
              : workerCount === 4
                ? 50
                : 50.5;
        return {
          ...independentTimedRun(),
          sequence: sequence++,
          projectId: definition.projectId,
          variant,
          blockIndex,
          timeRealMs: wall,
          canonicalEvidenceSha256: HASH,
        };
      });
    }).flat(),
  );
  return {
    schema: 1,
    measurementClass: 'formal local wall evidence subject to host gates',
    admitted: true,
    node: 'v24.18.0',
    harness: structuredClone(independentHarness),
    runtime: structuredClone(independentRuntime),
    matrix: {
      lane,
      protocol: 'scale-crossover-protocol-amendment-4',
      cases,
      generatedFrom: confirmation
        ? { screenRawSha256: screenEvidence.raw.sha256 }
        : undefined,
    },
    matrixSha256: HASH,
    configuredPools: structuredClone(BASELINE_POOLS),
    correctnessEvidence: {
      ...structuredClone(independentCorrectnessEvidence),
      manifest: {
        ...structuredClone(independentCorrectnessEvidence.manifest),
        sha256: manifestSha256,
      },
    },
    screenEvidence,
    runs,
  };
}

function independentSummary(lane, rawArtifactSha256, projectSummaries) {
  return {
    schema: 1,
    measurementClass: 'formal local wall evidence subject to host gates',
    lane,
    protocol: 'scale-crossover-protocol-amendment-4',
    rawArtifactSha256,
    runtimePin: structuredClone(independentRuntime.profile),
    harness: structuredClone(independentHarness),
    correctnessEvidence: structuredClone(independentCorrectnessEvidence),
    matrixSha256: HASH,
    admitted: true,
    durableEligible: true,
    canonicalSummarySha256: HASH,
    projectSummaries,
  };
}

function independentProject(projectId, band, reachedSfcCount, policyEvidence) {
  return {
    projectId,
    band,
    reachedSfcCount,
    selectedResourceWorker:
      policyEvidence.selectedOracleWorkerCount === 0
        ? null
        : `worker-${policyEvidence.selectedOracleWorkerCount}`,
    policyEvidence,
  };
}

function mdxFixtureRecord(id) {
  const record = records.get(id);
  return { path: record.path, sha256: record.sha256, report: record.document };
}

function mdxFollowupLinks(consumedIds) {
  return [
    {
      sourceId: 'mdx-base-screen',
      sha256Pointer: '/matrix/followup/screenArtifactSha256',
    },
    ...consumedIds.map((sourceId, index) => ({
      sourceId,
      sha256Pointer: `/matrix/followup/consumedArtifactSha256/${index}`,
    })),
  ];
}

function mdxBaseScreenMatrix() {
  return {
    executionScope: 'local-only',
    evidenceKind: 'performance-screen',
    correctnessGate: 'scale-correctness-gate.json',
    runtimeProfile: structuredClone(MDX_RUNTIME_PROFILE),
    poolEnvironment: structuredClone(BASELINE_POOLS),
    hostPolicy: mdxHostPolicy(),
    cases: MDX_BASE_SCALES.map((scale, startIndex) => ({
      name: `synthetic-${scale}-screen`,
      projectRoot: '/synthetic/cloudflare',
      rolldownPackageRoot: '/synthetic/rolldown/packages/rolldown',
      corpus: 'cloudflare-mdx-scale-v1',
      buildProfile: 'default',
      selectionScale: scale,
      selectionPrefixSha256:
        MDX_SCALE_MANIFEST.prefixes[String(scale)].selectionSha256,
      instrumentation: false,
      variants: [
        'ordinary',
        'worker-1',
        'worker-2',
        'worker-3',
        'worker-4',
        'worker-5',
        'worker-6',
        'worker-7',
        'worker-8',
      ],
      warmups: 0,
      repeats: 1,
      startIndex,
    })),
  };
}

function mdxScalePerformanceReport(matrix, speedupByScale) {
  const runs = [];
  let sequence = 0;
  for (const definition of matrix.cases) {
    const repeats = definition.repeats ?? 1;
    const targetSpeedup = speedupByScale.get(definition.selectionScale) ?? 1;
    for (let repeat = 0; repeat < repeats; repeat++) {
      const index = (definition.startIndex ?? 0) + repeat;
      const offset = index % definition.variants.length;
      const order = [
        ...definition.variants.slice(offset),
        ...definition.variants.slice(0, offset),
      ];
      for (const variant of order) {
        const workerCount =
          variant === 'ordinary' ? 0 : Number(variant.slice('worker-'.length));
        let wall = 1_000;
        if (workerCount > 0) {
          const selectedWall = 1_000 / targetSpeedup;
          if (repeats > 1 && workerCount === 4) {
            wall = selectedWall * (repeat < repeats / 2 ? 0.98 : 1.02);
          } else if (repeats > 1 && workerCount === 3) {
            wall = selectedWall * 1.01;
          } else if (repeats > 1 && workerCount === 8) {
            wall = selectedWall * 1.005;
          } else if (repeats > 1) {
            wall = selectedWall * 1.02;
          } else {
            wall = selectedWall * (1 + Math.abs(workerCount - 4) * 0.1);
          }
        }
        runs.push({
          name: definition.name,
          index,
          sequence: sequence++,
          variant,
          buildProfile: 'default',
          effectiveRunLinkCheck: false,
          measurementMode: 'measurement',
          runtimeProfile: structuredClone(MDX_RUNTIME_PROFILE),
          poolEnvironment: structuredClone(BASELINE_POOLS),
          totalElapsedMs: wall,
          cpuUserMs: 900,
          cpuSystemMs: 100,
          peakRssBytes: 1_000_000_000,
          transformedEntryCount: definition.selectionScale,
          selection: {
            scale: definition.selectionScale,
            prefixSha256: definition.selectionPrefixSha256,
          },
          outputChunks: definition.selectionScale,
          normalizedOutputBytes: definition.selectionScale * 100,
          normalizedOutputHash: String(definition.selectionScale).padStart(
            64,
            '0',
          ),
          outputNormalization: {
            kind: 'synthetic',
            playgroundUrls: 0,
            files: [],
          },
          hostBefore: mdxAdmittedHost(),
          hostAfter: mdxAdmittedHost(),
          hostDeltas: { pageouts: 0, swapouts: 0 },
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
    runner: mdxSourceRecord('run-matrix.mjs'),
    caseRunner: mdxSourceRecord('run-case.mjs'),
    environment: {
      parentCiMarkers: { CI: null },
      runtimeProfile: structuredClone(MDX_RUNTIME_PROFILE),
      childPoolEnvironment: structuredClone(BASELINE_POOLS),
      correctnessGate: { status: 'passed', sha256: HASH },
    },
    matrix,
    hostAdmissionAttempts: runs.map(() => ({})),
    hostPolicyViolations: [],
    validationErrors: [],
    runs,
  };
}

function mdxAdmittedHost() {
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

function mdxHostPolicy() {
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

function mdxPerformanceRaw(evidenceKind, followup, scales) {
  const confirmation = evidenceKind === 'performance-confirmation';
  const cases = scales.map((selectionScale, startIndex) => ({
    name: `mdx-${selectionScale}-${evidenceKind}`,
    selectionScale,
    variants: confirmation
      ? ['ordinary', 'worker-4', 'worker-8']
      : [
          'ordinary',
          'worker-1',
          'worker-2',
          'worker-3',
          'worker-4',
          'worker-5',
          'worker-6',
          'worker-7',
          'worker-8',
        ],
    repeats: confirmation ? 10 : 1,
    startIndex,
  }));
  const matrix = {
    evidenceKind,
    poolEnvironment: structuredClone(BASELINE_POOLS),
    cases,
  };
  if (followup) matrix.followup = followup;
  let sequence = 0;
  const runs = cases.flatMap((definition) =>
    Array.from({ length: definition.repeats }, (_, repeat) => {
      const index = definition.startIndex + repeat;
      const offset = index % definition.variants.length;
      const order = [
        ...definition.variants.slice(offset),
        ...definition.variants.slice(0, offset),
      ];
      return order.map((variant) => {
        const worker =
          variant === 'ordinary' ? 0 : Number(variant.slice('worker-'.length));
        const wall =
          worker === 0
            ? 100
            : definition.selectionScale === 512
              ? 104 + worker / 10
              : worker === 4
                ? 50
                : worker === 8
                  ? 50.5
                  : 60 + worker;
        return {
          ...mdxTimedRun(wall),
          sequence: sequence++,
          name: definition.name,
          variant,
          index,
          transformedEntryCount: definition.selectionScale,
        };
      });
    }).flat(),
  );
  return {
    schema: 1,
    evidenceKind,
    measurementFieldsPresent: true,
    timingEligible: true,
    conclusionEligible: evidenceKind === 'performance-confirmation',
    executionScope: 'local-only',
    matrix,
    environment: {
      correctnessGate: { status: 'passed', sha256: HASH },
      childPoolEnvironment: structuredClone(BASELINE_POOLS),
    },
    runner: mdxSourceRecord('run-matrix.mjs'),
    caseRunner: mdxSourceRecord('run-case.mjs'),
    hostAdmissionAttempts: runs.map(() => ({})),
    hostPolicyViolations: [],
    validationErrors: [],
    runs,
  };
}

function mdxTimedRun(wallMs) {
  const {
    policyWallMs: _policyWallMs,
    externalTiming: _externalTiming,
    ...base
  } = timedRun();
  return {
    ...base,
    totalElapsedMs: wallMs,
  };
}

function mdxPolicyRaw(stage, crossover, consumed, cases, calibration = null) {
  cases.forEach((definition, index) => {
    definition.startIndex ??= index;
  });
  const policy = {
    schema: 1,
    stage,
    crossover: structuredClone(crossover),
    consumedPolicyArtifactSha256: consumed.map(({ sha256 }) => sha256),
    consumedPolicyArtifacts: consumed.map(({ sha256 }) =>
      artifactReference(sha256),
    ),
    calibration,
  };
  let sequence = 0;
  const runs = cases.flatMap((definition) =>
    Array.from({ length: definition.repeats }, (_, repeat) => {
      const index = definition.startIndex + repeat;
      const offset = index % definition.variants.length;
      const order = [
        ...definition.variants.slice(offset),
        ...definition.variants.slice(0, offset),
      ];
      return order.map((variant) => ({
        ...policyTimedRun(syntheticPolicyWall(stage, definition, variant)),
        name: definition.name,
        variant,
        index,
        sequence: sequence++,
      }));
    }).flat(),
  );
  return {
    schema: 1,
    evidenceKind: stage,
    measurementFieldsPresent: true,
    timingEligible: true,
    conclusionEligible: false,
    executionScope: 'local-only',
    matrix: { evidenceKind: stage, policy, cases },
    environment: { correctnessGate: { status: 'passed', sha256: HASH } },
    runner: mdxSourceRecord('run-policy-matrix.mjs'),
    caseRunner: mdxSourceRecord('run-case.mjs'),
    launcher: mdxSourceRecord('policy-node-launcher.mjs'),
    hostAdmissionAttempts: runs.map(() => ({})),
    hostPolicyViolations: [],
    validationErrors: [],
    runs,
  };
}

function policyDefinition(
  selectionScale,
  poolEnvironment,
  repeats,
  quotaPercent,
  selection,
) {
  return {
    name: `case-${selectionScale}-${poolEnvironment.ROLLDOWN_WORKER_THREADS}-${poolEnvironment.RAYON_NUM_THREADS}-${quotaPercent ?? 'none'}`,
    selectionScale,
    poolEnvironment,
    quotaPercent,
    repeats,
    variants:
      repeats === 1
        ? [
            'ordinary',
            'worker-1',
            'worker-2',
            'worker-3',
            'worker-4',
            'worker-5',
            'worker-6',
            'worker-7',
            'worker-8',
          ]
        : ['ordinary', 'worker-4', 'worker-3', 'worker-5', 'worker-8'],
    selection,
  };
}

function syntheticSelection(
  cases,
  scale,
  poolKey,
  poolCount,
  confirmationCandidate,
) {
  const definition = cases.find(
    (entry) =>
      entry.selectionScale === scale &&
      Number(entry.poolEnvironment[poolKey]) === poolCount,
  );
  const primary = confirmationCandidate === 1;
  return {
    caseKey: policyCaseKey(definition),
    poolCount,
    workerCount: 4,
    wallMs: syntheticPolicyWall(
      poolKey === 'ROLLDOWN_WORKER_THREADS'
        ? 'allocation-tokio-screen'
        : 'allocation-rayon-screen',
      definition,
      'worker-4',
    ),
    screenResourceEligible: true,
    recomputedResourceEligible: true,
    selectionKind: primary
      ? 'screen-resource-eligible'
      : 'screen-resource-eligible-runner-up',
    rustPoolCandidateKind: primary
      ? 'screen-selected'
      : 'different-pool-runner-up',
    screenConclusionEligible: false,
    confirmationCandidate,
  };
}

function syntheticQuotaSelection(cases, scale, quotaPercent) {
  const definition = cases.find(
    (entry) =>
      entry.selectionScale === scale && entry.quotaPercent === quotaPercent,
  );
  return {
    caseKey: policyCaseKey(definition),
    poolCount: 18,
    workerCount: 4,
    wallMs: 50,
    screenResourceEligible: true,
    selectionKind: 'screen-resource-eligible',
    screenConclusionEligible: false,
    crossoverOracleWorkerCount:
      crossoverDecision.policyEvidenceByScale[String(scale)]
        .selectedOracleWorkerCount,
  };
}

function syntheticPolicyWall(stage, definition, variant) {
  if (variant === 'ordinary') return 100;
  let base = 50;
  if (stage === 'allocation-tokio-screen') {
    base = { 18: 50, 8: 60, 12: 70, 4: 80 }[
      Number(definition.poolEnvironment.ROLLDOWN_WORKER_THREADS)
    ];
  } else if (stage === 'allocation-rayon-screen') {
    base = { 12: 50, 4: 60, 8: 70 }[
      Number(definition.poolEnvironment.RAYON_NUM_THREADS)
    ];
  } else if (stage === 'allocation-tokio-confirmation') {
    base =
      definition.poolEnvironment.ROLLDOWN_WORKER_THREADS === '18' ? 50 : 60;
  } else if (stage === 'allocation-rayon-confirmation') {
    base = definition.poolEnvironment.RAYON_NUM_THREADS === '12' ? 50 : 60;
  }
  const workerCount = Number(variant.slice('worker-'.length));
  if (workerCount === 4) return base;
  if (workerCount === 8) return base + 0.5;
  return base + 10 + workerCount;
}

function policyTimedRun(wallMs) {
  return {
    ...timedRun(),
    totalElapsedMs: wallMs,
    policyWallMs: wallMs,
  };
}

function policySummary(raw, variedPoolKey) {
  void variedPoolKey;
  return deriveRepeatedPolicySummary(raw);
}

function winnerByScale(summary, poolKey) {
  return Object.fromEntries(
    MDX_SCALES.map((scale) => {
      const candidates = summary.cases
        .filter((entry) => entry.scale === scale)
        .map((entry) => {
          const workerCount = entry.policyEvidence.selectedOracleWorkerCount;
          const evidence =
            entry.policyEvidence.variants[`worker-${workerCount}`];
          return {
            entry,
            poolCount: Number(entry.poolEnvironment[poolKey]),
            workerCount,
            wallMs: evidence.wallMedianMs,
            resourceEligible: evidence.resourceEligible,
          };
        })
        .sort(
          (left, right) =>
            left.wallMs - right.wallMs ||
            left.workerCount - right.workerCount ||
            left.poolCount - right.poolCount,
        );
      const selected = candidates[0];
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

function evidenceBlock(oracleWorkerCount, selectedWall = 50) {
  const ordinaryBest = oracleWorkerCount === 0;
  const variants = {
    ordinary: variant(100, 100, 1000, true, 1, oracleWorkerCount),
    'worker-4': variant(
      ordinaryBest ? 102 : selectedWall,
      ordinaryBest ? 108 : 101,
      ordinaryBest ? 1080 : 1005,
      !ordinaryBest,
      ordinaryBest ? 1.04 : 0.52,
      oracleWorkerCount,
    ),
    'worker-8': variant(
      ordinaryBest ? 102.5 : selectedWall + 0.5,
      ordinaryBest ? 109 : 102,
      ordinaryBest ? 1090 : 1008,
      !ordinaryBest,
      ordinaryBest ? 1.045 : 0.53,
      oracleWorkerCount,
    ),
  };
  return { schema: 1, selectedOracleWorkerCount: oracleWorkerCount, variants };
}

function smallEvidenceBlock() {
  return evidenceBlock(0);
}

function variant(
  wallMedianMs,
  cpuMedianMs,
  peakRssMedianBytes,
  resourceEligible,
  pairedWallRatioBootstrap95Upper,
  selectedOracleWorkerCount,
) {
  return {
    wallMedianMs,
    cpuMedianMs,
    peakRssMedianBytes,
    resourceEligible,
    pairedWallRatioBootstrap95Upper,
    selectedOracleWorkerCount,
  };
}

function exactDecision() {
  return {
    name: 'resource-acceptable',
    status: 'exact',
    previousScale: 512,
    scale: 1024,
    confirmingNextScale: 2048,
    requestedScales: [],
  };
}

function controlledRuns(definitions) {
  let sequence = 0;
  return definitions.flatMap((definition) =>
    Array.from({ length: definition.repeats }, (_, index) => {
      const offset =
        (definition.rotationOffset + index) % definition.variants.length;
      const order = [
        ...definition.variants.slice(offset),
        ...definition.variants.slice(0, offset),
      ];
      return order.map((variant) => {
        const workerCount =
          variant === 'ordinary' ? 0 : Number(variant.slice('worker-'.length));
        const wall =
          workerCount === 0
            ? 100
            : definition.componentCount === 512
              ? 104 + workerCount / 10
              : workerCount === 4
                ? 50
                : 50.5;
        return {
          ...timedRun(),
          sequence: sequence++,
          name: definition.name,
          componentCount: definition.componentCount,
          variant,
          index,
          totalElapsedMs: wall,
          outputCodeHash: HASH,
          outputMapHash: HASH,
        };
      });
    }).flat(),
  );
}

function timedRun() {
  return {
    totalElapsedMs: 10,
    policyWallMs: 10,
    externalTiming: { userMs: 8, systemMs: 2 },
    cpuUserMs: 8,
    cpuSystemMs: 2,
    peakRssBytes: 1000,
    pagingDelta: { pageouts: 0, swapouts: 0 },
    hostDeltas: { pageouts: 0, swapouts: 0 },
    hostAdmission: hostAdmission('before-child'),
    postHostAdmission: hostAdmission('after-child'),
    hostBefore: {},
    hostAfter: {},
    hostPolicyViolations: [],
  };
}

function independentTimedRun() {
  return {
    timeRealMs: 10,
    totalCpuMs: 10,
    peakRssBytes: 1000,
    pagingDelta: { pageouts: 0, swapouts: 0 },
    hostAdmission: hostAdmission('before-child'),
    postHostAdmission: hostAdmission('after-child'),
  };
}

function hostAdmission(phase = 'before-child') {
  return {
    phase,
    admittedAt: '2026-07-12T00:00:00.000Z',
    acPower: true,
    lowPowerMode: 0,
    noRecordedThermalWarning: true,
    noRecordedPerformanceWarning: true,
    uptimeSeconds: 100,
    swapUsedBytes: 0,
    oneMinuteLoadAverage: 0.1,
    summedProcessCpuPercentage: 10,
    memoryFreePercentage: 90,
    unrelatedStudyProcesses: [],
    policy: {
      maximumUptimeSeconds: 86_400,
      maximumStartingSwapBytes: 512 * 1024 ** 2,
      maximumSwapBytes: 512 * 1024 ** 2,
      maximumOneMinuteLoadAverage: 2,
      maximumSummedProcessCpuPercentage: 150,
      minimumMemoryFreePercentage: 50,
      requiredPagingDelta: 0,
    },
  };
}

function controlledHarnessBlob(path, contentUtf8) {
  const content = Buffer.from(contentUtf8);
  return {
    path,
    kind: 'file',
    bytes: content.length,
    sha256: createHash('sha256').update(content).digest('hex'),
    gitBlobOid: createHash('sha1')
      .update(`blob ${content.length}\0`)
      .update(content)
      .digest('hex'),
    contentBase64: content.toString('base64'),
  };
}

function createHarnessManifest(entries) {
  entries = [...entries].sort((left, right) =>
    Buffer.from(left.path).compare(Buffer.from(right.path)),
  );
  const aggregate = createHash('sha256');
  for (const entry of entries) {
    aggregate.update(entry.path);
    aggregate.update('\0');
    aggregate.update(entry.kind);
    aggregate.update('\0');
    aggregate.update(String(entry.bytes));
    aggregate.update('\0');
    aggregate.update(entry.sha256);
    aggregate.update('\n');
  }
  return {
    algorithm:
      'SHA-256 over UTF-8-sorted repository-relative path + NUL + kind + NUL + bytes + NUL + content SHA-256 + LF records',
    files: entries.length,
    bytes: entries.reduce((total, entry) => total + entry.bytes, 0),
    aggregateSha256: aggregate.digest('hex'),
    entries,
  };
}

function controlledRuntime() {
  return {
    repositoryCommit: LIFECYCLE_BASELINE.sourceCommit,
    worktreeStatus: '',
    runtimePin: structuredClone(LIFECYCLE_BASELINE),
  };
}

function correctnessArtifact(rawSha256, summarySha256) {
  return {
    raw: `raw/${rawSha256}.json`,
    rawSha256,
    summary: `summary/${summarySha256}.json`,
    summarySha256,
  };
}

function correctnessArtifactSetAddress(artifacts) {
  const pairs = artifacts
    .map(({ rawSha256, summarySha256 }) => `${rawSha256}\0${summarySha256}\n`)
    .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  return createHash('sha256').update(pairs.join('')).digest('hex');
}

function mdxSourceRecord(fileName) {
  return {
    path: `/fixture/experiments/cloudflare-mdx/${fileName}`,
    sha256: SOURCE_HASH,
  };
}

function numericPools() {
  return { tokio: 18, rayon: 12, blocking: 4 };
}

function pool(tokio, rayon) {
  return {
    ROLLDOWN_WORKER_THREADS: String(tokio),
    RAYON_NUM_THREADS: String(rayon),
    ROLLDOWN_MAX_BLOCKING_THREADS: '4',
  };
}

function artifactReference(sha256) {
  return { path: `/tmp/${sha256}.json`, sha256 };
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

function formalCrossoverRoles() {
  return ['crossover-lower', 'crossover', 'crossover-confirm', 'full'];
}

function roleForMdxScale(scale) {
  return new Map(
    MDX_SCALES.map((value, index) => [value, formalCrossoverRoles()[index]]),
  ).get(scale);
}

function cloneRecords(value) {
  return new Map(
    [...value].map(([id, record]) => [id, structuredClone(record)]),
  );
}

function terminalBoundaryEvidence(source) {
  const value = structuredClone(source);
  for (const family of ['vue-controlled', 'mdx']) {
    value.cases = value.cases.filter(
      (entry) =>
        !(
          entry.study === 'baseline' &&
          entry.family === family &&
          entry.scaleRole === 'crossover-confirm'
        ),
    );
    const full = value.cases.find(
      (entry) =>
        entry.study === 'baseline' &&
        entry.family === family &&
        entry.scaleRole === 'full',
    );
    full.scaleRole = 'crossover-confirm';
    full.scaleRoles = ['crossover-confirm', 'full'];
  }
  for (const study of [
    'allocation-tokio-confirmation',
    'allocation-rayon-confirmation',
  ]) {
    value.cases = value.cases.filter(
      (entry) =>
        !(entry.study === study && entry.scaleRole === 'crossover-confirm'),
    );
    for (const full of value.cases.filter(
      (entry) => entry.study === study && entry.scaleRole === 'full',
    )) {
      full.scaleRole = 'crossover-confirm';
      full.scaleRoles = ['crossover-confirm', 'full'];
    }
  }
  return value;
}

function syntheticCalibration() {
  const order = [
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
  const load = (averageCpuPercent) => ({
    wallMs: 100,
    cpuMs: averageCpuPercent,
    averageCpuPercent,
    durationMs: 10_000,
    threadCount: 8,
  });
  const controller = (limitPercent, stops) => ({
    version: 1,
    limitPercent,
    targetPid: 100,
    controlCycles: 100,
    stopCycles: stops ? 1 : 0,
    stoppedUs: stops ? 1_000 : 0,
  });
  const samples = order.map(([repetition, limitPercent]) => ({
    mode: 'controlled',
    repetition,
    limitPercent,
    controller: controller(limitPercent, limitPercent < 800 * 0.95),
    load: load(limitPercent),
  }));
  const levelSummary = [200, 400, 600, 800].map((limitPercent) => {
    const selected = samples.filter(
      (sample) => sample.limitPercent === limitPercent,
    );
    return {
      limitPercent,
      sampleCount: 3,
      achievedCpuPercent: [limitPercent, limitPercent, limitPercent],
      achievedToTargetRatio: [1, 1, 1],
      medianAchievedToTargetRatio: 1,
      withinFivePercent: true,
      controllerStopCycles: selected.map(
        ({ controller }) => controller.stopCycles,
      ),
      controllerStoppedMs: selected.map(
        ({ controller }) => controller.stoppedUs / 1_000,
      ),
    };
  });
  const equivalence = Array.from({ length: 5 }, (_, block) => ({
    block,
    order:
      block % 2 === 0 ? ['direct', 'controlled'] : ['controlled', 'direct'],
    direct: {
      mode: 'direct',
      block,
      load: load(800),
    },
    controlled: {
      mode: 'controlled',
      block,
      limitPercent: 1_200,
      controller: controller(1_200, false),
      load: load(800),
    },
    wallRatio: 1,
    cpuRatio: 1,
  }));
  return {
    schemaVersion: 2,
    kind: 'cpulimit-apple-calibration',
    executionScope: 'local-only',
    node: 'v24.18.0',
    parentCiMarkers: {
      BUILDKITE: null,
      CI: null,
      CIRCLECI: null,
      GITHUB_ACTIONS: null,
      JENKINS_URL: null,
      TF_BUILD: null,
    },
    machine: {
      platform: 'darwin',
      architecture: 'arm64',
      cpuModel: 'Apple M3 Pro',
      logicalCpuCount: 12,
      totalMemoryBytes: 38_654_705_664,
    },
    options: {
      durationMs: 10_000,
      threadCount: 8,
      repetitions: 3,
      equivalenceBlocks: 5,
      levels: [200, 400, 600, 800],
    },
    binarySha256: CPULIMIT_BINARY_SHA256,
    patchSha256: CPULIMIT_PATCH_SHA256,
    controllerProvenance: {
      schema: 1,
      upstreamUrl: 'https://github.com/opsengine/cpulimit.git',
      upstreamCommit: 'f4d2682804931e7aea02a869137344bb5452a3cd',
      sourceTree: {
        recordFormat: 'path + NUL + bytes + NUL + contentSha256 + LF',
        files: 20,
        bytes: 55_759,
        sha256:
          'd7a8dccb84e90d854b146fb0b7363868e222c9f50469ebc11650f7165c76c21a',
      },
      patch: { path: '/tmp/cpulimit.patch', sha256: CPULIMIT_PATCH_SHA256 },
      binary: { path: '/tmp/cpulimit', sha256: CPULIMIT_BINARY_SHA256 },
      calibrationHarness: {
        runCalibrationSha256:
          BUILDER_SOURCE_HASHES[
            'experiments/cpu-rate-control/run-calibration.mjs'
          ],
        cpuLoadSha256:
          BUILDER_SOURCE_HASHES['experiments/cpu-rate-control/cpu-load.mjs'],
      },
    },
    unconstrainedSaturationCpuPercent: 800,
    formalProfile: true,
    passed: true,
    executionEnvironmentEligible: true,
    samples,
    levelSummary,
    equivalence,
    controllerRecordsValid: true,
    equivalenceSummary: {
      blocks: 5,
      medianWallRatio: 1,
      medianCpuRatio: 1,
      wallWithinTwoPercent: true,
      cpuWithinTwoPercent: true,
      noControllerStops: true,
    },
  };
}
