import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import nodePath from 'node:path';
import { validateControlledHarnessSourceSnapshot } from '../worker-policy/formal-source-contracts.mjs';

export const PRODUCT_CAPABILITIES = Object.freeze([
  'code',
  'sourceMaps',
  'metadata',
  'diagnostics',
  'state',
  'pluginContext',
  'hookOrder',
  'lifecycle',
  'virtualModules',
  'cacheDeterminism',
  'failure',
  'shutdown',
]);

const STATUSES = new Set(['pass', 'product-failure', 'not-tested']);
const PERFORMANCE_STATUSES = new Set(['pass', 'failed', 'not-established']);
const PRODUCT_FAMILY_IDS = Object.freeze(['cloudflare-mdx', 'controlled-vue']);
const CONTROLLED_VUE_CONTENT_SHA256 =
  '82ff7743fcd200d2c0df5efb8b740b6be9585b66a164a9072be483956119b8b6';
const CONTROLLED_VUE_BUNDLE_ROOT =
  `experiments/product-capabilities/evidence/controlled-vue/sha256/${CONTROLLED_VUE_CONTENT_SHA256}`;

export async function validateProductCapabilityLedger(ledger, { repoRoot } = {}) {
  const root = nodePath.resolve(repoRoot ?? process.cwd());
  if (
    ledger?.schema !== 1 ||
    ledger.kind !== 'parallel-js-plugin-product-capability-ledger' ||
    !same(ledger.capabilitySet, PRODUCT_CAPABILITIES) ||
    !Array.isArray(ledger.families) ||
    !same(
      ledger.families.map(({ id }) => id),
      PRODUCT_FAMILY_IDS,
    )
  ) {
    throw new Error('Product capability ledger header or capability set is invalid');
  }

  const evidence = await readEvidence(ledger.evidence, root);
  const familyIds = new Set();
  for (const family of ledger.families) {
    if (typeof family?.id !== 'string' || familyIds.has(family.id)) {
      throw new Error('Product capability family identity is missing or duplicated');
    }
    familyIds.add(family.id);
    validatePerformanceCrossovers(family, evidence);
    if (!same(Object.keys(family.capabilities ?? {}), PRODUCT_CAPABILITIES)) {
      throw new Error(`${family.id} does not classify the complete capability set in order`);
    }
    for (const capability of PRODUCT_CAPABILITIES) {
      const record = family.capabilities[capability];
      if (
        !STATUSES.has(record?.status) ||
        !Array.isArray(record.evidence) ||
        typeof record.reason !== 'string' ||
        record.reason.length === 0 ||
        record.evidence.some((id) => !evidence.has(id))
      ) {
        throw new Error(`${family.id}/${capability} has an invalid classification`);
      }
      if (record.status === 'not-tested' ? record.evidence.length !== 0 : record.evidence.length === 0) {
        throw new Error(`${family.id}/${capability} evidence does not match its status`);
      }
    }
    const allPass = PRODUCT_CAPABILITIES.every(
      (capability) => family.capabilities[capability].status === 'pass',
    );
    if (family.semanticCapabilitiesPass !== allPass) {
      throw new Error(`${family.id} semanticCapabilitiesPass is not derived from all capabilities`);
    }
    const productCrossover =
      allPass &&
      family.performanceCrossovers.mechanical.status === 'pass' &&
      family.performanceCrossovers.resourceAcceptable.status === 'pass';
    if (family.productCrossover !== productCrossover) {
      throw new Error(`${family.id} productCrossover lacks semantic or performance crossover proof`);
    }
  }
  const semanticCapabilitiesPass = ledger.families.every(
    ({ semanticCapabilitiesPass: passed }) => passed,
  );
  if (ledger.semanticCapabilitiesPass !== semanticCapabilitiesPass) {
    throw new Error('Global semanticCapabilitiesPass is not derived from every family');
  }
  const productCrossoverFamilies = ledger.families
    .filter(({ productCrossover }) => productCrossover)
    .map(({ id }) => id);
  if (
    !same(ledger.productCrossoverFamilies, productCrossoverFamilies) ||
    ledger.productCrossover !== (productCrossoverFamilies.length > 0)
  ) {
    throw new Error('Global productCrossover is not derived from per-family product crossovers');
  }

  validateMdxFacts(ledger, evidence);
  await validateVueFacts(ledger, evidence);
  return ledger;
}

function validatePerformanceCrossovers(family, evidence) {
  const records = family?.performanceCrossovers;
  if (!same(Object.keys(records ?? {}), ['mechanical', 'resourceAcceptable'])) {
    throw new Error(`${family.id} performance crossover classifications are incomplete`);
  }
  for (const [name, record] of Object.entries(records)) {
    if (
      !PERFORMANCE_STATUSES.has(record?.status) ||
      !Array.isArray(record.evidence) ||
      record.evidence.some((id) => !evidence.has(id)) ||
      typeof record.reason !== 'string' ||
      record.reason.length === 0 ||
      (record.status === 'not-established'
        ? record.evidence.length !== 0
        : record.evidence.length === 0)
    ) {
      throw new Error(`${family.id}/${name} has an invalid performance crossover classification`);
    }
  }
}

async function readEvidence(definitions, root) {
  if (!definitions || Array.isArray(definitions)) {
    throw new Error('Product capability evidence catalog is missing');
  }
  const realRoot = await realpath(root);
  const result = new Map();
  for (const [id, definition] of Object.entries(definitions)) {
    if (
      !['local-json', 'local-source'].includes(definition?.kind) ||
      typeof definition.path !== 'string' ||
      !Number.isSafeInteger(definition.bytes) ||
      definition.bytes <= 0 ||
      !/^[a-f0-9]{64}$/.test(definition.sha256 ?? '')
    ) {
      throw new Error(`Evidence ${id} descriptor is invalid`);
    }
    const path = nodePath.resolve(root, definition.path);
    if (path === root || !path.startsWith(`${root}${nodePath.sep}`)) {
      throw new Error(`Evidence ${id} escapes the repository root`);
    }
    const fileStat = await lstat(path);
    const realPath = await realpath(path);
    if (
      fileStat.isSymbolicLink() ||
      !fileStat.isFile() ||
      (realPath !== realRoot && !realPath.startsWith(`${realRoot}${nodePath.sep}`))
    ) {
      throw new Error(`Evidence ${id} is not a regular repository-local file`);
    }
    const source = await readFile(path);
    const sha256 = createHash('sha256').update(source).digest('hex');
    if (source.byteLength !== definition.bytes || sha256 !== definition.sha256) {
      throw new Error(`Evidence ${id} bytes or hash changed`);
    }
    result.set(id, {
      definition,
      document: definition.kind === 'local-json' ? JSON.parse(source) : undefined,
      path,
      source,
    });
  }
  return result;
}

function validateMdxFacts(ledger, evidence) {
  const family = ledger.families.find(({ id }) => id === 'cloudflare-mdx');
  const full = evidence.get('mdxFullCorrectness')?.document;
  const semantic = evidence.get('mdxSemanticSentinel')?.document;
  const gate = evidence.get('mdxCorrectnessGate')?.document;
  if (!family || !full || !semantic || !gate) {
    throw new Error('Cloudflare MDX capability evidence is incomplete');
  }
  if (
    gate.status !== 'passed' ||
    gate.requiredArtifacts?.fullCorpus?.sha256 !==
      evidence.get('mdxFullCorrectness').definition.sha256 ||
    gate.requiredArtifacts?.semanticSentinel?.sha256 !==
      evidence.get('mdxSemanticSentinel').definition.sha256 ||
    gate.sourceMapCapability?.status !== 'product-failure'
  ) {
    throw new Error('Cloudflare MDX correctness gate does not bind the ledger evidence');
  }
  const equalityFields = ['transformedEntryCount', 'outputChunks', 'normalizedOutputBytes', 'normalizedOutputHash'];
  if (
    full.runs?.length !== 4 ||
    !same(full.runs.map(({ variant }) => variant).sort(), ['ordinary', 'ordinary', 'worker-4', 'worker-4']) ||
    equalityFields.some(
      (field) => new Set(full.runs.map((run) => JSON.stringify(run[field]))).size !== 1,
    ) ||
    full.runs.some(
      (run) =>
        run.transformedEntryCount !== 9_157 ||
        run.evidenceKind !== 'correctness-only' ||
        run.lifecycleClaim !== false,
    )
  ) {
    throw new Error('Cloudflare MDX full-corpus code evidence is incomplete');
  }
  if (
    semantic.success?.parity?.normalizedOutput !== true ||
    semantic.success?.productCapabilities?.metadata !== 'product-failure' ||
    semantic.diagnostic?.productCapability !== 'product-failure' ||
    semantic.diagnostic?.parity?.structured !== true ||
    semantic.diagnostic?.parity?.exact !== false
  ) {
    throw new Error('Cloudflare MDX semantic failure evidence changed');
  }
  const expected = {
    code: 'pass',
    sourceMaps: 'product-failure',
    metadata: 'product-failure',
    diagnostics: 'product-failure',
    state: 'not-tested',
    pluginContext: 'not-tested',
    hookOrder: 'not-tested',
    lifecycle: 'not-tested',
    virtualModules: 'not-tested',
    cacheDeterminism: 'not-tested',
    failure: 'product-failure',
    shutdown: 'not-tested',
  };
  const expectedEvidence = {
    code: ['mdxFullCorrectness', 'mdxCorrectnessGate'],
    sourceMaps: ['mdxCorrectnessGate'],
    metadata: ['mdxSemanticSentinel'],
    diagnostics: ['mdxSemanticSentinel'],
    state: [],
    pluginContext: [],
    hookOrder: [],
    lifecycle: [],
    virtualModules: [],
    cacheDeterminism: [],
    failure: ['mdxSemanticSentinel'],
    shutdown: [],
  };
  assertCapabilityFacts(family, expected, expectedEvidence);
}

async function validateVueFacts(ledger, evidence) {
  const family = ledger.families.find(({ id }) => id === 'controlled-vue');
  const manifestEvidence = evidence.get('controlledVueBundleManifest');
  const admissionRawEvidence = evidence.get('controlledVueAdmissionRaw');
  const admissionPointerEvidence = evidence.get('controlledVueAdmissionPointer');
  const rawEvidence = evidence.get('controlledVueCorrectnessRaw');
  const pointerEvidence = evidence.get('controlledVueCorrectnessPointer');
  const snapshotEvidence = evidence.get('controlledVueHarnessSnapshot');
  const implementationEvidence = evidence.get('controlledVuePluginImplementation');
  const runnerEvidence = evidence.get('controlledVueCaseRunner');
  const raw = rawEvidence?.document;
  const pointer = pointerEvidence?.document;
  if (
    !family ||
    !manifestEvidence ||
    !admissionRawEvidence ||
    !admissionPointerEvidence ||
    !rawEvidence ||
    !pointerEvidence ||
    !snapshotEvidence ||
    !implementationEvidence ||
    !runnerEvidence
  ) {
    throw new Error('Controlled Vue correctness evidence bundle is incomplete');
  }
  assertEvidenceDescriptor(manifestEvidence.definition, {
    kind: 'local-json',
    path: `${CONTROLLED_VUE_BUNDLE_ROOT}/manifest.json`,
    bytes: 1_992,
    sha256: 'bb3bd66b00f3795f1dd6dd3704770e7a5fbfd42c259e7f1ff3f242edb4783e9d',
  });
  assertEvidenceDescriptor(admissionRawEvidence.definition, {
    kind: 'local-json',
    path: `${CONTROLLED_VUE_BUNDLE_ROOT}/raw/admission.json`,
    bytes: 25_158,
    sha256: '403247c6b953ffd7fef71a77e4bd06ce00952014a63eff8f449b157b6c850f58',
  });
  assertEvidenceDescriptor(admissionPointerEvidence.definition, {
    kind: 'local-json',
    path: `${CONTROLLED_VUE_BUNDLE_ROOT}/admission.json`,
    bytes: 2_499,
    sha256: 'b2d0dfa20a162bb11755cf4a8fd6c15a69c1be212a9e03f6ce91436ec93b517f',
  });
  assertEvidenceDescriptor(rawEvidence.definition, {
    kind: 'local-json',
    path: `${CONTROLLED_VUE_BUNDLE_ROOT}/raw/correctness.json`,
    bytes: 9_720_974,
    sha256: '2aa03aab0d6247853e43e519232b21288c20d3c0a941122564600bd3110f1420',
  });
  assertEvidenceDescriptor(pointerEvidence.definition, {
    kind: 'local-json',
    path: `${CONTROLLED_VUE_BUNDLE_ROOT}/correctness.json`,
    bytes: 12_413,
    sha256: 'c37b43d1afc1da47ead9a1c612f22dbf1a8a6a53e7b33fa83f76e72c1fd09a5b',
  });
  assertEvidenceDescriptor(snapshotEvidence.definition, {
    kind: 'local-json',
    path: `${CONTROLLED_VUE_BUNDLE_ROOT}/harness-snapshot.json`,
    bytes: 3_782_868,
    sha256: '6cf1d80822e6cb1315947d4a29f5b3c1f9f39c645739f8e74ea3de28a0d8ce08',
  });
  assertEvidenceDescriptor(implementationEvidence.definition, {
    kind: 'local-source',
    path: `${CONTROLLED_VUE_BUNDLE_ROOT}/source/parallel-vue-plugin-impl.js`,
    bytes: 5_791,
    sha256: '7c30524ba7e9eed355ef55d381133271be9bdc6fe3e8f5b525b06ef7f80808b5',
  });
  assertEvidenceDescriptor(runnerEvidence.definition, {
    kind: 'local-source',
    path: `${CONTROLLED_VUE_BUNDLE_ROOT}/source/vue-scale-run-case.mjs`,
    bytes: 12_132,
    sha256: 'd91acc051a30b4015d49f388261e3e7c3d8a2e7d7ff4e9537fc1549269da0ff6',
  });
  await validateControlledVueBundle(manifestEvidence, {
    admissionRawEvidence,
    admissionPointerEvidence,
    rawEvidence,
    pointerEvidence,
    snapshotEvidence,
    implementationEvidence,
    runnerEvidence,
  });
  validateControlledVueAdmission(
    admissionRawEvidence.document,
    admissionPointerEvidence.document,
    admissionRawEvidence.definition,
  );
  validateControlledVueRawAndPointer(raw, pointer, rawEvidence.definition);
  validateControlledVueSourceBoundary(
    raw,
    snapshotEvidence.document,
    implementationEvidence,
    runnerEvidence,
  );
  const expected = {
    code: 'pass',
    sourceMaps: 'product-failure',
    metadata: 'not-tested',
    diagnostics: 'not-tested',
    state: 'not-tested',
    pluginContext: 'not-tested',
    hookOrder: 'not-tested',
    lifecycle: 'not-tested',
    virtualModules: 'product-failure',
    cacheDeterminism: 'not-tested',
    failure: 'not-tested',
    shutdown: 'not-tested',
  };
  const expectedEvidence = Object.fromEntries(
    PRODUCT_CAPABILITIES.map((capability) => [
      capability,
      capability === 'code'
        ? [
            'controlledVueBundleManifest',
            'controlledVueCorrectnessRaw',
            'controlledVueCorrectnessPointer',
          ]
        : capability === 'sourceMaps'
          ? [
              'controlledVueBundleManifest',
              'controlledVueCorrectnessRaw',
              'controlledVueCorrectnessPointer',
              'controlledVueHarnessSnapshot',
              'controlledVuePluginImplementation',
            ]
          : capability === 'virtualModules'
            ? [
                'controlledVueBundleManifest',
                'controlledVueCorrectnessRaw',
                'controlledVueCorrectnessPointer',
                'controlledVueHarnessSnapshot',
                'controlledVuePluginImplementation',
                'controlledVueCaseRunner',
              ]
            : [],
    ]),
  );
  assertCapabilityFacts(family, expected, expectedEvidence);
}

async function validateControlledVueBundle(manifestEvidence, sources) {
  const manifest = manifestEvidence.document;
  const roles = {
    'admission-pointer': sources.admissionPointerEvidence,
    'admission-raw': sources.admissionRawEvidence,
    'case-runner': sources.runnerEvidence,
    'correctness-pointer': sources.pointerEvidence,
    'correctness-raw': sources.rawEvidence,
    'harness-snapshot': sources.snapshotEvidence,
    'plugin-implementation': sources.implementationEvidence,
  };
  const artifacts = Object.entries(roles)
    .map(([role, { definition }]) => ({
      role,
      path: nodePath.posix.relative(
        CONTROLLED_VUE_BUNDLE_ROOT,
        definition.path,
      ),
      bytes: definition.bytes,
      sha256: definition.sha256,
    }))
    .sort((left, right) => Buffer.from(left.role).compare(Buffer.from(right.role)));
  const records = artifacts.map(
    ({ role, bytes, sha256 }) => `${role}\0${bytes}\0${sha256}\n`,
  );
  const contentSha256 = createHash('sha256').update(records.join('')).digest('hex');
  const actualFiles = await listRelativeFiles(nodePath.dirname(manifestEvidence.path));
  const expectedFiles = ['manifest.json', ...artifacts.map(({ path }) => path)].sort((left, right) =>
    Buffer.from(left).compare(Buffer.from(right)),
  );
  if (
    manifest?.schema !== 1 ||
    manifest.kind !== 'controlled-vue-product-evidence-bundle' ||
    manifest.repository !== 'github.com/hyf0/rolldown-parallel-js-plugin' ||
    manifest.root !== CONTROLLED_VUE_BUNDLE_ROOT ||
    manifest.contentSha256 !== CONTROLLED_VUE_CONTENT_SHA256 ||
    contentSha256 !== CONTROLLED_VUE_CONTENT_SHA256 ||
    manifest.fixtureCommit !== '5b5beee821978656f3be423c4afb6c0d0d3f593d' ||
    manifest.harnessAggregateSha256 !==
      '5d31d3f7c34ebce5255faa853c121b7933294055769c74daa69a98a4840a44a5' ||
    !same(manifest.artifacts, artifacts) ||
    !same(actualFiles, expectedFiles)
  ) {
    throw new Error('Controlled Vue content-addressed evidence bundle changed');
  }
}

async function listRelativeFiles(root, directory = root) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)));
  for (const entry of entries) {
    const path = nodePath.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error('Controlled Vue evidence bundle contains a symbolic link');
    }
    if (entry.isDirectory()) files.push(...(await listRelativeFiles(root, path)));
    else if (entry.isFile()) files.push(nodePath.relative(root, path).split(nodePath.sep).join('/'));
    else throw new Error('Controlled Vue evidence bundle contains an unsupported entry');
  }
  return files;
}

function validateControlledVueAdmission(raw, pointer, rawDefinition) {
  const expectedFixtureCommit = '68073d92d9a4d33d313f14228a35a1a15c18f5fa';
  const expectedHarness = {
    files: 56,
    bytes: 2_803_690,
    aggregateSha256: '5d31d3f7c34ebce5255faa853c121b7933294055769c74daa69a98a4840a44a5',
  };
  const expectedRuntimePin = {
    kind: 'lifecycle-corrected-baseline',
    sourceCommit: 'b144106882fe244b19b738fc0acf3ffa07c7c9f3',
    nativeBindingSha256: '7b8863bb28aefd2e2eb7409f8be6dae57a252fe4a2688383007be7ea2f847bf7',
    distributionSha256: '1efffd0b63483e77cd2854fe716941000ae9548768691d7b5a64dceb011f3c45',
  };
  if (
    raw?.schema !== 1 ||
    raw.kind !== 'vue-scale-admission-audit' ||
    raw.measurementClass !== 'untimed compile admission; not performance evidence' ||
    raw.fixture?.commit !== expectedFixtureCommit ||
    raw.fixture?.worktreeStatus !== '' ||
    !same(projectHarness(raw.harnessSourceManifest), expectedHarness) ||
    raw.runtime?.repositoryCommit !== expectedRuntimePin.sourceCommit ||
    raw.runtime?.worktreeStatus !== '' ||
    !same(raw.runtime?.runtimePin, expectedRuntimePin) ||
    raw.audits?.length !== 2 ||
    raw.audits[0]?.phase !== 'quasar-pre-exclusion' ||
    raw.audits[0]?.selection?.files !== 1_112 ||
    raw.audits[0]?.errorCount !== 3 ||
    raw.audits[1]?.phase !== 'final-pool' ||
    raw.audits[1]?.selection?.files !== 5_650 ||
    raw.audits[1]?.errorCount !== 0
  ) {
    throw new Error('Controlled Vue admission raw evidence changed');
  }
  if (
    pointer?.schema !== 2 ||
    pointer.kind !== 'vue-scale-admission-evidence-pointer' ||
    pointer.passed !== true ||
    pointer.fixtureCommit !== expectedFixtureCommit ||
    !same(projectHarness(pointer.harnessSourceManifest), expectedHarness) ||
    !same(pointer.runtimePin, expectedRuntimePin) ||
    !same(pointer.raw, {
      path: 'raw/admission.json',
      bytes: rawDefinition.bytes,
      sha256: rawDefinition.sha256,
    }) ||
    pointer.quasarPreExclusion?.files !== 1_112 ||
    pointer.quasarPreExclusion?.errors !== 3 ||
    pointer.finalPool?.files !== 5_650 ||
    pointer.finalPool?.admitted !== true
  ) {
    throw new Error('Controlled Vue admission pointer no longer binds the raw audit');
  }
}

function validateControlledVueRawAndPointer(raw, pointer, rawDefinition) {
  const expectedFixtureCommit = '5b5beee821978656f3be423c4afb6c0d0d3f593d';
  const expectedHarness = {
    files: 56,
    bytes: 2_803_690,
    aggregateSha256: '5d31d3f7c34ebce5255faa853c121b7933294055769c74daa69a98a4840a44a5',
  };
  const expectedRuntimePin = {
    kind: 'lifecycle-corrected-baseline',
    sourceCommit: 'b144106882fe244b19b738fc0acf3ffa07c7c9f3',
    nativeBindingSha256: '7b8863bb28aefd2e2eb7409f8be6dae57a252fe4a2688383007be7ea2f847bf7',
    distributionSha256: '1efffd0b63483e77cd2854fe716941000ae9548768691d7b5a64dceb011f3c45',
  };
  if (
    raw?.schema !== 1 ||
    raw.measurementClass !== 'untimed correctness; not performance evidence' ||
    raw.fixture?.commit !== expectedFixtureCommit ||
    raw.fixture?.worktreeStatus !== '' ||
    !same(projectHarness(raw.harnessSourceManifest), expectedHarness) ||
    raw.runtime?.repositoryCommit !== expectedRuntimePin.sourceCommit ||
    raw.runtime?.worktreeStatus !== '' ||
    !same(raw.runtime?.runtimePin, expectedRuntimePin) ||
    raw.matrix?.lane !== 'correctness-smoke' ||
    raw.runs?.length !== 11 ||
    raw.runs.some(
      (run) =>
        run.measurementClass !== 'correctness-only' ||
        ['totalElapsedMs', 'cpuUserMs', 'cpuSystemMs', 'peakRssBytes'].some((field) =>
          Object.hasOwn(run, field),
        ),
    )
  ) {
    throw new Error('Controlled Vue raw correctness provenance or classification changed');
  }
  if (
    pointer?.schema !== 2 ||
    pointer.kind !== 'vue-scale-correctness-evidence-pointer' ||
    pointer.passed !== true ||
    pointer.fixtureCommit !== expectedFixtureCommit ||
    !same(projectHarness(pointer.harnessSourceManifest), expectedHarness) ||
    !same(pointer.runtimePin, expectedRuntimePin) ||
    !same(pointer.raw, {
      path: 'raw/correctness.json',
      bytes: rawDefinition.bytes,
      sha256: rawDefinition.sha256,
    }) ||
    !same(Object.keys(pointer.goldens ?? {}).map(Number).sort((a, b) => a - b), [
      32, 128, 256, 512, 1024, 2048, 4096, 5000,
    ])
  ) {
    throw new Error('Controlled Vue correctness pointer no longer binds the raw report');
  }
  const golden = pointer.goldens['5000'];
  const runs = raw.runs.filter(({ componentCount }) => componentCount === 5_000);
  const expectedVariants = ['ordinary', 'worker-1', 'worker-4', 'worker-8'];
  const expectedCodeHash = '3c75f3f59574b030eefc7f7b4aafdb2f9433d8a16ca3cea22c8d67739f2b53b7';
  const expectedMapHash = 'c4269cfb0d904ca08411122f4e2dea352f13adbce2f545ed715cb6db94754aa9';
  if (
    golden?.selection?.files !== 5_000 ||
    golden.selection.bytes !== 12_970_626 ||
    golden.output?.outputCodeHash !== expectedCodeHash ||
    golden.output?.outputMapHash !== expectedMapHash ||
    runs.length !== 4 ||
    !same(runs.map(({ variant }) => variant).sort(), expectedVariants) ||
    runs.some(
      (run) =>
        run.selectionHash !== golden.selection.selectionSha256 ||
        run.selectedSourceBytes !== golden.input.bytes ||
        run.sourceAudit?.calls !== 5_000 ||
        run.sourceAudit?.distinctIds !== 5_000 ||
        run.sourceAudit?.inputAggregateSha256 !== golden.input.aggregateSha256 ||
        run.sourceAudit?.exactOnceSha256 !== golden.input.exactOnceSha256 ||
        run.outputCodeHash !== expectedCodeHash ||
        run.outputMapHash !== expectedMapHash ||
        run.totalExports !== 5_000
    )
  ) {
    throw new Error('Controlled Vue 5,000-SFC correctness equality changed');
  }
}

function validateControlledVueSourceBoundary(
  raw,
  snapshot,
  implementationEvidence,
  runnerEvidence,
) {
  validateControlledHarnessSourceSnapshot(snapshot, 'controlled Vue product bundle');
  if (
    snapshot.commit !== '5b5beee821978656f3be423c4afb6c0d0d3f593d' ||
    !same(snapshot.harnessSourceManifest, raw.harnessSourceManifest) ||
    !Buffer.from(snapshot.gitCommitObject.contentBase64, 'base64')
      .toString('utf8')
      .includes('parent 68073d92d9a4d33d313f14228a35a1a15c18f5fa\n')
  ) {
    throw new Error('Controlled Vue harness snapshot does not bind the evidence commits');
  }
  const expectedEntries = [
    {
      evidence: implementationEvidence,
      sourcePath: 'examples/par-plugin/parallel-vue-plugin/impl.js',
    },
    {
      evidence: runnerEvidence,
      sourcePath: 'examples/par-plugin/cases/vue-scale/run-case.mjs',
    },
  ];
  for (const { evidence, sourcePath } of expectedEntries) {
    const manifestEntry = raw.harnessSourceManifest.entries.find(({ path }) => path === sourcePath);
    const snapshotBlob = snapshot.blobs.find(({ path }) => path === sourcePath);
    if (
      manifestEntry?.kind !== 'file' ||
      manifestEntry.bytes !== evidence.definition.bytes ||
      manifestEntry.sha256 !== evidence.definition.sha256 ||
      snapshotBlob?.bytes !== evidence.definition.bytes ||
      snapshotBlob.sha256 !== evidence.definition.sha256 ||
      !Buffer.from(snapshotBlob.contentBase64, 'base64').equals(evidence.source)
    ) {
      throw new Error(`Controlled Vue source evidence does not match ${sourcePath}`);
    }
  }
  const implementation = implementationEvidence.source.toString('utf8');
  const runner = runnerEvidence.source.toString('utf8');
  if (
    !implementation.includes('sourceMap: false') ||
    !implementation.includes("name: 'parallel-vue-transform'") ||
    !implementation.includes('buildStart,\n    transform:')
  ) {
    throw new Error('Controlled Vue transform source-map boundary changed');
  }
  if (
    !runner.includes("const vueExportHelperId = '\\0/plugin-vue/export-helper'") ||
    !runner.includes('const vueExportHelperPlugin = {') ||
    !runner.includes('[sourceAuditPlugin, vueExportHelperPlugin, plugin]') ||
    !runner.includes('[vueExportHelperPlugin, plugin]')
  ) {
    throw new Error('Controlled Vue coordinator-owned virtual-module boundary changed');
  }
}

function projectHarness(value) {
  return value
    ? {
        files: value.files,
        bytes: value.bytes,
        aggregateSha256: value.aggregateSha256,
      }
    : undefined;
}

function assertEvidenceDescriptor(actual, expected) {
  if (!same(actual, expected)) throw new Error('Controlled Vue evidence descriptor changed');
}

function assertCapabilityFacts(family, expected, expectedEvidence) {
  for (const capability of PRODUCT_CAPABILITIES) {
    if (
      family.capabilities[capability].status !== expected[capability] ||
      !same(family.capabilities[capability].evidence, expectedEvidence[capability])
    ) {
      throw new Error(`${family.id}/${capability} contradicts its bound source evidence`);
    }
  }
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
