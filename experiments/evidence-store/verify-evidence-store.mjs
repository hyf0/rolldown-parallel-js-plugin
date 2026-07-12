import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import {
  EVIDENCE_REPOSITORY,
  createAttributionSummaryFile,
  promoteEvidence,
  verifyEvidencePointer,
} from './evidence-store.mjs';

assert.equal(
  process.version,
  'v24.18.0',
  `formal evidence-store validation requires Node v24.18.0, received ${process.version}`,
);

const sandbox = await mkdtemp(nodePath.join(tmpdir(), 'rolldown-evidence-store-'));
try {
  const sourceRoot = nodePath.join(sandbox, 'sources');
  const repositoryRoot = nodePath.join(sandbox, 'repository');
  await mkdir(sourceRoot, { recursive: true });
  await initializeRepository(repositoryRoot);

  const initialization = await writeInitializationEvidence(sourceRoot);
  const promotedInitialization = await promoteEvidence({
    kind: 'initialization',
    rawPath: initialization.rawPath,
    summaryPath: initialization.summaryPath,
    repositoryRoot,
  });
  assert.equal(promotedInitialization.alreadyPresent, false);
  assert.deepEqual(
    await readFile(nodePath.join(nodePath.dirname(promotedInitialization.pointerPath), promotedInitialization.pointer.raw.path)),
    initialization.rawBytes,
  );
  assert.deepEqual(
    await readFile(
      nodePath.join(
        nodePath.dirname(promotedInitialization.pointerPath),
        promotedInitialization.pointer.summary.path,
      ),
    ),
    initialization.summaryBytes,
  );
  await assert.rejects(
    () => verifyEvidencePointer(promotedInitialization.pointerPath, { repositoryRoot }),
    /clean|untracked/,
  );
  commitAll(repositoryRoot, 'record initialization evidence');
  const verifiedInitialization = await verifyEvidencePointer(
    promotedInitialization.pointerPath,
    { repositoryRoot },
  );
  assert.equal(verifiedInitialization.pointer.evidenceKind, 'initialization');
  const repeatedInitialization = await promoteEvidence({
    kind: 'initialization',
    rawPath: initialization.rawPath,
    summaryPath: initialization.summaryPath,
    repositoryRoot,
  });
  assert.equal(repeatedInitialization.alreadyPresent, true);

  const attribution = await writeAttributionEvidence(sourceRoot);
  const promotedAttribution = await promoteEvidence({
    kind: 'attribution',
    rawPath: attribution.rawPath,
    summaryPath: attribution.summaryPath,
    repositoryRoot,
  });
  assert.equal(promotedAttribution.alreadyPresent, false);
  commitAll(repositoryRoot, 'record attribution evidence');
  const verifiedAttribution = await verifyEvidencePointer(promotedAttribution.pointerPath, {
    repositoryRoot,
  });
  assert.equal(verifiedAttribution.pointer.evidenceKind, 'attribution');
  assert.deepEqual(
    verifiedAttribution.pointer.provenance.nodeArtifact,
    attribution.nodeArtifact,
  );

  const freshClone = nodePath.join(sandbox, 'fresh-clone');
  runGit(sandbox, ['clone', '--quiet', repositoryRoot, freshClone]);
  runGit(freshClone, ['remote', 'set-url', 'origin', `https://${EVIDENCE_REPOSITORY}.git`]);
  const clonePointer = scenarioPointer(freshClone, promotedAttribution.pointer);
  const freshVerified = await verifyEvidencePointer(clonePointer, {
    repositoryRoot: freshClone,
  });
  assert.equal(freshVerified.pointer.artifactStore.contentSha256, promotedAttribution.pointer.artifactStore.contentSha256);

  await appendFile(nodePath.join(repositoryRoot, 'README.md'), 'dirty\n');
  await assert.rejects(
    () =>
      promoteEvidence({
        kind: 'initialization',
        rawPath: initialization.rawPath,
        summaryPath: initialization.summaryPath,
        repositoryRoot,
      }),
    /must be clean/,
  );
  runGit(repositoryRoot, ['restore', 'README.md']);

  await writeFile(nodePath.join(repositoryRoot, 'untracked.txt'), 'untracked\n');
  await assert.rejects(
    () => verifyEvidencePointer(promotedAttribution.pointerPath, { repositoryRoot }),
    /must be clean|untracked/,
  );
  await rm(nodePath.join(repositoryRoot, 'untracked.txt'));

  const invalidBindingPath = nodePath.join(sourceRoot, 'invalid-binding.summary.json');
  const invalidBinding = structuredClone(initialization.summary);
  invalidBinding.source.rawArtifact.sha256 = '0'.repeat(64);
  await writeJson(invalidBindingPath, invalidBinding);
  const bundleCountBefore = await countBundlePointers(repositoryRoot);
  await assert.rejects(
    () =>
      promoteEvidence({
        kind: 'initialization',
        rawPath: initialization.rawPath,
        summaryPath: invalidBindingPath,
        repositoryRoot,
      }),
    /does not bind the exact raw bytes and hash/,
  );
  assert.equal(await countBundlePointers(repositoryRoot), bundleCountBefore);

  const invalidProvenancePath = nodePath.join(sourceRoot, 'invalid-provenance.summary.json');
  const invalidProvenance = structuredClone(initialization.summary);
  invalidProvenance.source.runtimeCommit = '0'.repeat(40);
  await writeJson(invalidProvenancePath, invalidProvenance);
  await assert.rejects(
    () =>
      promoteEvidence({
        kind: 'initialization',
        rawPath: initialization.rawPath,
        summaryPath: invalidProvenancePath,
        repositoryRoot,
      }),
    /summary provenance differs/,
  );

  const invalidNodePath = nodePath.join(sourceRoot, 'invalid-node.summary.json');
  const invalidNode = structuredClone(initialization.summary);
  invalidNode.source.nodeArtifact.sha256 = 'f'.repeat(64);
  await writeJson(invalidNodePath, invalidNode);
  await assert.rejects(
    () =>
      promoteEvidence({
        kind: 'initialization',
        rawPath: initialization.rawPath,
        summaryPath: invalidNodePath,
        repositoryRoot,
      }),
    /summary provenance differs/,
  );

  const invalidHarnessRawPath = nodePath.join(sourceRoot, 'invalid-harness.raw.json');
  const invalidHarnessRaw = structuredClone(initialization.raw);
  invalidHarnessRaw.harnessProvenance.sourceManifest.aggregateSha256 = 'e'.repeat(64);
  const invalidHarnessRawBytes = await writeJson(invalidHarnessRawPath, invalidHarnessRaw);
  const invalidHarnessSummaryPath = nodePath.join(sourceRoot, 'invalid-harness.summary.json');
  const invalidHarnessSummary = structuredClone(initialization.summary);
  invalidHarnessSummary.source.rawArtifact = {
    path: nodePath.basename(invalidHarnessRawPath),
    bytes: invalidHarnessRawBytes.byteLength,
    sha256: sha256(invalidHarnessRawBytes),
  };
  await writeJson(invalidHarnessSummaryPath, invalidHarnessSummary);
  await assert.rejects(
    () =>
      promoteEvidence({
        kind: 'initialization',
        rawPath: invalidHarnessRawPath,
        summaryPath: invalidHarnessSummaryPath,
        repositoryRoot,
      }),
    /harness manifest is not derived from its entries/,
  );

  const escapingBindingPath = nodePath.join(sourceRoot, 'escaping-binding.summary.json');
  const escapingBinding = structuredClone(initialization.summary);
  escapingBinding.source.rawArtifact.path = '../../outside.raw.json';
  await writeJson(escapingBindingPath, escapingBinding);
  await assert.rejects(
    () =>
      promoteEvidence({
        kind: 'initialization',
        rawPath: initialization.rawPath,
        summaryPath: escapingBindingPath,
        repositoryRoot,
      }),
    /non-escaping relative path/,
  );

  const dirtyClone = await cloneScenario(repositoryRoot, sandbox, 'dirty-clone');
  const dirtyPointer = scenarioPointer(dirtyClone, promotedAttribution.pointer);
  await appendFile(dirtyPointer, '\n');
  await assert.rejects(
    () => verifyEvidencePointer(dirtyPointer, { repositoryRoot: dirtyClone }),
    /must be clean/,
  );

  const untrackedClone = await cloneScenario(repositoryRoot, sandbox, 'untracked-clone');
  const untrackedPointer = scenarioPointer(untrackedClone, promotedAttribution.pointer);
  await writeFile(nodePath.join(untrackedClone, 'untracked.txt'), 'untracked\n');
  await assert.rejects(
    () => verifyEvidencePointer(untrackedPointer, { repositoryRoot: untrackedClone }),
    /must be clean|untracked/,
  );

  const escapeClone = await cloneScenario(repositoryRoot, sandbox, 'escape-clone');
  const canonicalPointerInEscape = scenarioPointer(escapeClone, promotedAttribution.pointer);
  const escapedPointerPath = nodePath.join(escapeClone, 'escaped', 'pointer.json');
  await mkdir(nodePath.dirname(escapedPointerPath), { recursive: true });
  await cp(canonicalPointerInEscape, escapedPointerPath);
  commitAll(escapeClone, 'add escaped pointer');
  await assert.rejects(
    () => verifyEvidencePointer(escapedPointerPath, { repositoryRoot: escapeClone }),
    /outside its canonical content-addressed path/,
  );

  const pathTamperClone = await cloneScenario(repositoryRoot, sandbox, 'path-tamper-clone');
  const pathTamperPointer = scenarioPointer(pathTamperClone, promotedAttribution.pointer);
  const pathTamper = JSON.parse(await readFile(pathTamperPointer, 'utf8'));
  pathTamper.raw.path = '../../outside.json';
  await writeJson(pathTamperPointer, pathTamper);
  commitAll(pathTamperClone, 'tamper canonical path');
  await assert.rejects(
    () => verifyEvidencePointer(pathTamperPointer, { repositoryRoot: pathTamperClone }),
    /raw artifact path is not canonical/,
  );

  const hashTamperClone = await cloneScenario(repositoryRoot, sandbox, 'hash-tamper-clone');
  const hashTamperPointer = scenarioPointer(hashTamperClone, promotedAttribution.pointer);
  const hashPointer = JSON.parse(await readFile(hashTamperPointer, 'utf8'));
  const hashRawPath = nodePath.join(nodePath.dirname(hashTamperPointer), hashPointer.raw.path);
  await appendFile(hashRawPath, ' ');
  commitAll(hashTamperClone, 'tamper raw bytes');
  await assert.rejects(
    () => verifyEvidencePointer(hashTamperPointer, { repositoryRoot: hashTamperClone }),
    /does not bind the exact raw bytes and hash|not rederived/,
  );

  const summaryBindingClone = await cloneScenario(repositoryRoot, sandbox, 'summary-binding-clone');
  const summaryBindingPointer = scenarioPointer(
    summaryBindingClone,
    promotedAttribution.pointer,
  );
  const summaryPointer = JSON.parse(await readFile(summaryBindingPointer, 'utf8'));
  const summaryPath = nodePath.join(
    nodePath.dirname(summaryBindingPointer),
    summaryPointer.summary.path,
  );
  const summary = JSON.parse(await readFile(summaryPath, 'utf8'));
  summary.source.rawArtifact.bytes += 1;
  await writeJson(summaryPath, summary);
  commitAll(summaryBindingClone, 'tamper summary raw binding');
  await assert.rejects(
    () => verifyEvidencePointer(summaryBindingPointer, { repositoryRoot: summaryBindingClone }),
    /does not bind the exact raw bytes and hash/,
  );

  console.log(
    JSON.stringify({
      verified: true,
      positive: ['initialization', 'attribution', 'idempotent-import', 'fresh-clone'],
      rejected: [
        'dirty-promotion',
        'untracked-verification',
        'summary-raw-hash-binding',
        'summary-provenance-drift',
        'summary-node-identity-drift',
        'raw-harness-manifest-drift',
        'summary-source-path-escape',
        'dirty-tracked-pointer',
        'untracked-repository-state',
        'pointer-outside-canonical-root',
        'pointer-artifact-path-escape',
        'raw-byte-hash-tamper',
        'committed-summary-raw-binding-tamper',
      ],
    }),
  );
} finally {
  await rm(sandbox, { recursive: true, force: true });
}

async function writeInitializationEvidence(root) {
  const nodeArtifact = await currentNodeArtifact();
  const entries = [
    {
      path: 'examples/par-plugin/cases/runtime-initialization/run-matrix.mjs',
      kind: 'file',
      bytes: 10,
      sha256: sha256('run-matrix'),
    },
    {
      path: 'examples/par-plugin/cases/runtime-initialization/worker.mjs',
      kind: 'file',
      bytes: 11,
      sha256: sha256('worker'),
    },
  ];
  const manifestText = entries
    .map(({ path, kind, bytes, sha256: hash }) => `${path}\0${kind}\0${bytes}\0${hash}\n`)
    .join('');
  const packageEnvironment = {
    projectFiles: { 'package.json': sha256('package') },
    staticExternalPackages: [],
  };
  const raw = {
    schemaVersion: 1,
    kind: 'rolldown-runtime-initialization-matrix',
    measurementClass:
      'formal local initialization attribution; instrumented elapsed values are not wall benchmark evidence',
    matrix: {
      lane: 'formal-attribution',
      repeats: 10,
      runtime: {
        sourceCommit: '2'.repeat(40),
        bindingSha256: '3'.repeat(64),
        distributionSha256: '4'.repeat(64),
        packageEntrySha256: '5'.repeat(64),
      },
    },
    harnessProvenance: {
      worktree: { commit: '1'.repeat(40), status: '' },
      sourceManifest: {
        algorithm:
          'SHA-256 over UTF-8-sorted path + NUL + kind + NUL + bytes + NUL + content SHA-256 + LF records',
        files: entries.length,
        bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
        aggregateSha256: sha256(manifestText),
        entries,
      },
    },
    runtimeProvenance: {
      worktree: { commit: '2'.repeat(40), status: '' },
      binding: { sha256: '3'.repeat(64) },
      distribution: { aggregateSha256: '4'.repeat(64) },
      packageEntry: { sha256: '5'.repeat(64) },
      packageEnvironment,
      node: { ...nodeArtifact, path: process.execPath },
    },
    runs: [{ sequence: 0, name: 'bare-worker', workerCount: 1 }],
  };
  const rawPath = nodePath.join(root, 'initialization.raw.json');
  const summaryPath = nodePath.join(root, 'initialization.summary.json');
  const rawBytes = await writeJson(rawPath, raw);
  const summary = {
    schemaVersion: 2,
    kind: 'rolldown-runtime-initialization-summary',
    measurementClass: raw.measurementClass,
    source: {
      harnessManifestSha256: raw.harnessProvenance.sourceManifest.aggregateSha256,
      runtimeCommit: raw.runtimeProvenance.worktree.commit,
      bindingSha256: raw.runtimeProvenance.binding.sha256,
      distributionSha256: raw.runtimeProvenance.distribution.aggregateSha256,
      packageEntrySha256: raw.runtimeProvenance.packageEntry.sha256,
      nodeArtifact,
      packageEnvironment,
      rawArtifact: {
        path: nodePath.basename(rawPath),
        bytes: rawBytes.byteLength,
        sha256: sha256(rawBytes),
      },
      rawRuns: raw.runs.length,
      repeats: raw.matrix.repeats,
    },
    cases: [],
  };
  const summaryBytes = await writeJson(summaryPath, summary);
  return { rawPath, summaryPath, rawBytes, summaryBytes, raw, summary };
}

async function writeAttributionEvidence(root) {
  const entries = [
    { relativePath: 'run-attribution-matrix.mjs', bytes: 10, sourceSha256: sha256('runner') },
    { relativePath: 'run-case.mjs', bytes: 11, sourceSha256: sha256('case') },
  ].sort((left, right) => Buffer.from(left.relativePath).compare(Buffer.from(right.relativePath)));
  const manifestText = entries
    .map(({ relativePath, bytes, sourceSha256 }) => `${relativePath}\0${bytes}\0${sourceSha256}\n`)
    .join('');
  const raw = {
    schema: 1,
    evidenceKind: 'attribution',
    executionMode: 'current-evidence',
    measurementFieldsPresent: true,
    timingEligible: false,
    conclusionEligible: false,
    executionScope: 'local-only',
    node: process.version,
    nodeBinary: process.execPath,
    runner: { path: '/runner', sha256: '6'.repeat(64) },
    caseRunner: { path: '/case', sha256: '7'.repeat(64) },
    environment: {
      runtimeProfile: {
        kind: 'instrumented-attribution',
        rolldownCommit: '8'.repeat(40),
        bindingSha256: '9'.repeat(64),
        distSha256: 'a'.repeat(64),
      },
      correctnessGate: { status: 'passed', sha256: 'b'.repeat(64) },
      harnessSourceManifest: {
        schema: 1,
        recordFormat: 'relativePath + NUL + bytes + NUL + sourceSha256 + LF',
        sourceCount: entries.length,
        selectionSha256: sha256(manifestText),
        entries,
      },
    },
    matrix: {
      evidenceKind: 'attribution',
      runtimeProfile: {
        kind: 'instrumented-attribution',
        rolldownCommit: '8'.repeat(40),
        bindingSha256: '9'.repeat(64),
        distSha256: 'a'.repeat(64),
      },
      cases: [{ variants: ['ordinary', 'worker-4'] }],
    },
    hostPolicyViolations: [],
    validationErrors: [],
    runs: [
      { variant: 'ordinary', attributionSummary: { workerCount: 0, throughput: 1 } },
      { variant: 'worker-4', attributionSummary: { workerCount: 4, throughput: 4 } },
    ],
  };
  const rawPath = nodePath.join(root, 'attribution.raw.json');
  const summaryPath = nodePath.join(root, 'attribution.summary.json');
  await writeJson(rawPath, raw);
  const result = await createAttributionSummaryFile(rawPath, summaryPath);
  return {
    rawPath,
    summaryPath,
    raw,
    rawBytes: await readFile(rawPath),
    summaryBytes: result.summaryBytes,
    nodeArtifact: result.summary.source.nodeArtifact,
  };
}

async function initializeRepository(root) {
  await mkdir(root, { recursive: true });
  runGit(root, ['init', '--quiet', '--initial-branch=main']);
  runGit(root, ['config', 'user.name', 'Evidence Test']);
  runGit(root, ['config', 'user.email', 'evidence@example.com']);
  runGit(root, ['remote', 'add', 'origin', `https://${EVIDENCE_REPOSITORY}.git`]);
  await writeFile(nodePath.join(root, 'README.md'), 'fixture\n');
  commitAll(root, 'initialize fixture');
}

async function cloneScenario(source, root, name) {
  const target = nodePath.join(root, name);
  runGit(root, ['clone', '--quiet', source, target]);
  runGit(target, ['config', 'user.name', 'Evidence Test']);
  runGit(target, ['config', 'user.email', 'evidence@example.com']);
  runGit(target, ['remote', 'set-url', 'origin', `https://${EVIDENCE_REPOSITORY}.git`]);
  return target;
}

function scenarioPointer(clone, pointer) {
  return nodePath.join(clone, ...pointer.artifactStore.root.split('/'), 'pointer.json');
}

function commitAll(root, message) {
  runGit(root, ['add', '--all']);
  runGit(root, ['commit', '--quiet', '-m', message]);
}

function runGit(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed in ${root}:\n${result.stderr}`);
  }
  return result.stdout.trim();
}

async function writeJson(path, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  await writeFile(path, bytes);
  return bytes;
}

async function currentNodeArtifact() {
  const bytes = await readFile(process.execPath);
  return { version: process.version, bytes: bytes.byteLength, sha256: sha256(bytes) };
}

async function countBundlePointers(root) {
  const store = nodePath.join(root, 'research/artifacts/evidence');
  try {
    return await walkPointerCount(store);
  } catch (error) {
    if (error?.code === 'ENOENT') return 0;
    throw error;
  }
}

async function walkPointerCount(directory) {
  let count = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = nodePath.join(directory, entry.name);
    if (entry.isDirectory()) count += await walkPointerCount(path);
    else if (entry.name === 'pointer.json') count++;
  }
  return count;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
