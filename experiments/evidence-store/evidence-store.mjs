import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';
import nodePath from 'node:path';

export const EVIDENCE_KINDS = Object.freeze(['initialization', 'attribution']);
export const EVIDENCE_REPOSITORY = 'github.com/hyf0/rolldown-parallel-js-plugin';
export const EVIDENCE_STORE_ROOT = 'research/artifacts/evidence';
export const REQUIRED_NODE_VERSION = 'v24.18.0';

const HASH = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40,64}$/;
const POINTER_KIND = 'rolldown-content-addressed-evidence-pointer';
const STORE_KIND = 'git-head-content-addressed';
const CONTENT_RECORD_FORMAT =
  'raw + NUL + bytes + NUL + sha256 + LF + summary + NUL + bytes + NUL + sha256 + LF';

export async function createAttributionSummaryFile(rawPath, summaryPath) {
  assertExactNode();
  const rawAbsolute = nodePath.resolve(rawPath);
  const summaryAbsolute = nodePath.resolve(summaryPath);
  if (rawAbsolute === summaryAbsolute) {
    throw new Error('attribution raw and summary paths must be distinct');
  }
  const [rawBytes, rawStat] = await Promise.all([readFile(rawAbsolute), lstat(rawAbsolute)]);
  if (!rawStat.isFile() || rawStat.isSymbolicLink()) {
    throw new Error('attribution raw input must be a regular non-symlink file');
  }
  const raw = parseJson(rawBytes, 'attribution raw input');
  await requireCurrentRawNode(raw, 'attribution');
  const nodeArtifact = await captureCurrentNodeArtifact();
  const rawArtifact = {
    path: toSlash(nodePath.relative(nodePath.dirname(summaryAbsolute), rawAbsolute)),
    bytes: rawBytes.byteLength,
    sha256: sha256(rawBytes),
  };
  requireSafeSourcePath(rawArtifact.path);
  const summary = buildAttributionSummary(raw, rawArtifact, nodeArtifact);
  const summaryBytes = serialize(summary);
  await assertBytesUnchanged(rawAbsolute, rawBytes, 'attribution raw input');
  await writeFileAtomically(summaryAbsolute, summaryBytes);
  await assertBytesUnchanged(rawAbsolute, rawBytes, 'attribution raw input');
  return { rawArtifact, summary, summaryBytes };
}

export async function promoteEvidence({
  kind,
  rawPath,
  summaryPath,
  repositoryRoot,
  expectedRepository = EVIDENCE_REPOSITORY,
} = {}) {
  assertEvidenceKind(kind);
  assertExactNode();
  const repoRoot = await requireCleanRepository(repositoryRoot, expectedRepository);
  const rawAbsolute = await requireRegularInput(rawPath, 'raw input');
  const summaryAbsolute = await requireRegularInput(summaryPath, 'summary input');
  if (rawAbsolute === summaryAbsolute) {
    throw new Error('raw and summary inputs must be distinct');
  }
  const [rawBytes, summaryBytes] = await Promise.all([
    readFile(rawAbsolute),
    readFile(summaryAbsolute),
  ]);
  const validated = await validateDocuments({
    kind,
    rawBytes,
    summaryBytes,
    rawSourcePath: rawAbsolute,
    summarySourcePath: summaryAbsolute,
    verifyCurrentNode: true,
  });
  const pointer = buildPointer({
    kind,
    rawBytes,
    summaryBytes,
    identity: validated.identity,
    summaryRawBinding: validated.summaryRawBinding,
    repository: expectedRepository,
  });
  const relativeRoot = pointer.artifactStore.root;
  const bundleRoot = nodePath.join(repoRoot, ...relativeRoot.split('/'));
  const pointerPath = nodePath.join(bundleRoot, 'pointer.json');
  const existing = await pathExists(bundleRoot);
  if (existing) {
    const verified = await verifyEvidencePointer(pointerPath, {
      repositoryRoot: repoRoot,
      expectedRepository,
      verifyCurrentNode: true,
    });
    if (!deepEqual(verified.pointer, pointer)) {
      throw new Error(`content-addressed bundle collision at ${relativeRoot}`);
    }
    await Promise.all([
      assertBytesUnchanged(rawAbsolute, rawBytes, 'raw input'),
      assertBytesUnchanged(summaryAbsolute, summaryBytes, 'summary input'),
    ]);
    return { alreadyPresent: true, repoRoot, pointerPath, pointer };
  }

  const shaRoot = nodePath.dirname(bundleRoot);
  await mkdir(shaRoot, { recursive: true });
  const staging = await mkdtemp(nodePath.join(shaRoot, '.tmp-evidence-'));
  try {
    const rawOutput = nodePath.join(staging, pointer.raw.path);
    const summaryOutput = nodePath.join(staging, pointer.summary.path);
    await Promise.all([
      mkdir(nodePath.dirname(rawOutput), { recursive: true }),
      mkdir(nodePath.dirname(summaryOutput), { recursive: true }),
    ]);
    await Promise.all([
      writeDurableFile(rawOutput, rawBytes),
      writeDurableFile(summaryOutput, summaryBytes),
      writeDurableFile(nodePath.join(staging, 'pointer.json'), serialize(pointer)),
    ]);
    await Promise.all([
      assertBytesUnchanged(rawAbsolute, rawBytes, 'raw input'),
      assertBytesUnchanged(summaryAbsolute, summaryBytes, 'summary input'),
    ]);
    try {
      await rename(staging, bundleRoot);
    } catch (error) {
      if (!['EEXIST', 'ENOTEMPTY'].includes(error?.code)) throw error;
      await rm(staging, { recursive: true, force: true });
      const verified = await verifyEvidencePointer(pointerPath, {
        repositoryRoot: repoRoot,
        expectedRepository,
        verifyCurrentNode: true,
      });
      if (!deepEqual(verified.pointer, pointer)) {
        throw new Error(`concurrent content-addressed bundle collision at ${relativeRoot}`);
      }
      return { alreadyPresent: true, repoRoot, pointerPath, pointer };
    }
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  return { alreadyPresent: false, repoRoot, pointerPath, pointer };
}

export async function verifyEvidencePointer(
  pointerPath,
  {
    repositoryRoot,
    expectedRepository = EVIDENCE_REPOSITORY,
    verifyCurrentNode = false,
  } = {},
) {
  const repoRoot = await requireCleanRepository(repositoryRoot, expectedRepository);
  const suppliedPointerPath = nodePath.resolve(pointerPath);
  await requireRegularPath(suppliedPointerPath, 'evidence pointer');
  const pointerAbsolute = await realpath(suppliedPointerPath);
  requireInside(repoRoot, pointerAbsolute, 'evidence pointer');
  await requireTrackedHeadBytes(repoRoot, pointerAbsolute, 'evidence pointer');
  const pointerBytes = await readFile(pointerAbsolute);
  const pointer = parseJson(pointerBytes, 'evidence pointer');
  validatePointerHeader(pointer, expectedRepository);

  const expectedPointerPath = nodePath.join(
    repoRoot,
    ...pointer.artifactStore.root.split('/'),
    'pointer.json',
  );
  if (pointerAbsolute !== expectedPointerPath) {
    throw new Error('evidence pointer is outside its canonical content-addressed path');
  }
  const bundleRoot = nodePath.dirname(pointerAbsolute);
  const rawAbsolute = canonicalArtifactPath(bundleRoot, pointer.raw, 'raw');
  const summaryAbsolute = canonicalArtifactPath(bundleRoot, pointer.summary, 'summary');
  await Promise.all([
    requireRegularPath(rawAbsolute, 'promoted raw artifact'),
    requireRegularPath(summaryAbsolute, 'promoted summary artifact'),
    requireTrackedHeadBytes(repoRoot, rawAbsolute, 'promoted raw artifact'),
    requireTrackedHeadBytes(repoRoot, summaryAbsolute, 'promoted summary artifact'),
  ]);
  const [rawBytes, summaryBytes] = await Promise.all([
    readFile(rawAbsolute),
    readFile(summaryAbsolute),
  ]);
  const validated = await validateDocuments({
    kind: pointer.evidenceKind,
    rawBytes,
    summaryBytes,
    verifyCurrentNode,
  });
  const expected = buildPointer({
    kind: pointer.evidenceKind,
    rawBytes,
    summaryBytes,
    identity: validated.identity,
    summaryRawBinding: validated.summaryRawBinding,
    repository: expectedRepository,
  });
  if (!deepEqual(pointer, expected)) {
    throw new Error('evidence pointer is not rederived from its exact raw and summary bytes');
  }
  return {
    repoRoot,
    head: git(repoRoot, ['rev-parse', 'HEAD']),
    pointerPath: pointerAbsolute,
    pointer,
    rawBytes,
    summaryBytes,
  };
}

export function buildAttributionSummary(raw, rawArtifact, nodeArtifact) {
  const identity = deriveEvidenceIdentity(raw, 'attribution', nodeArtifact);
  requireRawBinding(rawArtifact);
  return {
    schemaVersion: 1,
    kind: 'rolldown-attribution-evidence-summary',
    measurementClass: raw.measurementClass ?? 'instrumented attribution; not wall evidence',
    source: {
      harnessManifestSha256: identity.harness.manifestSha256,
      runtimeCommit: identity.runtime.commit,
      bindingSha256: identity.runtime.bindingSha256,
      distributionSha256: identity.runtime.distributionSha256,
      nodeArtifact: identity.nodeArtifact,
      rawArtifact,
      rawRuns: raw.runs.length,
      matrixSha256: identity.report.matrixSha256,
      correctnessGateSha256: identity.report.correctnessGateSha256,
    },
    variants: raw.runs.map((run) => ({
      variant: run.variant,
      attributionSummary: run.attributionSummary,
    })),
  };
}

export function deriveEvidenceIdentity(raw, kind, attributionNodeArtifact) {
  assertEvidenceKind(kind);
  if (kind === 'initialization') return deriveInitializationIdentity(raw);
  return deriveAttributionIdentity(raw, attributionNodeArtifact);
}

function deriveInitializationIdentity(raw) {
  if (
    raw?.schemaVersion !== 1 ||
    raw.kind !== 'rolldown-runtime-initialization-matrix' ||
    raw.matrix?.lane !== 'formal-attribution' ||
    !Array.isArray(raw.runs) ||
    raw.runs.length === 0 ||
    raw.harnessProvenance?.worktree?.status !== '' ||
    raw.runtimeProvenance?.worktree?.status !== ''
  ) {
    throw new Error('initialization raw report is not admitted formal attribution evidence');
  }
  const harness = validateInitializationHarness(raw.harnessProvenance);
  const runtime = raw.runtimeProvenance;
  const nodeArtifact = validateNodeArtifact(runtime.node, 'initialization raw Node artifact');
  if (
    raw.matrix.runtime?.sourceCommit !== runtime.worktree?.commit ||
    raw.matrix.runtime?.bindingSha256 !== runtime.binding?.sha256 ||
    raw.matrix.runtime?.distributionSha256 !== runtime.distribution?.aggregateSha256 ||
    raw.matrix.runtime?.packageEntrySha256 !== runtime.packageEntry?.sha256
  ) {
    throw new Error('initialization matrix runtime pin differs from runtime provenance');
  }
  const packageEnvironmentSha256 = sha256(Buffer.from(canonicalJson(runtime.packageEnvironment)));
  return {
    schemaVersion: 1,
    evidenceKind: 'initialization',
    report: {
      kind: raw.kind,
      measurementClass: requireString(raw.measurementClass, 'initialization measurementClass'),
      matrixSha256: sha256(Buffer.from(canonicalJson(raw.matrix))),
      runs: raw.runs.length,
    },
    harness,
    runtime: {
      kind: 'instrumented-attribution',
      commit: requireCommit(runtime.worktree?.commit, 'initialization runtime commit'),
      bindingSha256: requireHash(runtime.binding?.sha256, 'initialization binding'),
      distributionSha256: requireHash(
        runtime.distribution?.aggregateSha256,
        'initialization distribution',
      ),
      packageEntrySha256: requireHash(
        runtime.packageEntry?.sha256,
        'initialization package entry',
      ),
      packageEnvironmentSha256,
    },
    nodeArtifact,
  };
}

function deriveAttributionIdentity(raw, nodeArtifactValue) {
  if (
    raw?.schema !== 1 ||
    raw.evidenceKind !== 'attribution' ||
    raw.timingEligible !== false ||
    raw.conclusionEligible !== false ||
    raw.executionScope !== 'local-only' ||
    raw.environment?.correctnessGate?.status !== 'passed' ||
    raw.hostPolicyViolations?.length !== 0 ||
    raw.validationErrors?.length !== 0 ||
    !Array.isArray(raw.runs) ||
    raw.runs.length === 0
  ) {
    throw new Error('attribution raw report is not admitted attribution evidence');
  }
  const harness = validateAttributionHarness(raw.environment.harnessSourceManifest);
  const runtime = raw.environment.runtimeProfile;
  if (!deepEqual(raw.matrix?.runtimeProfile, runtime)) {
    throw new Error('attribution matrix runtime pin differs from runtime provenance');
  }
  const nodeArtifact = validateNodeArtifact(nodeArtifactValue, 'attribution Node artifact');
  if (nodeArtifact.version !== raw.node) {
    throw new Error('attribution Node artifact version differs from the raw report');
  }
  for (const run of raw.runs) {
    if (typeof run.variant !== 'string' || !run.attributionSummary) {
      throw new Error('attribution raw run omits its derived attribution summary');
    }
  }
  return {
    schemaVersion: 1,
    evidenceKind: 'attribution',
    report: {
      kind: 'rolldown-attribution-report',
      measurementClass: requireString(
        raw.measurementClass ?? 'instrumented attribution; not wall evidence',
        'attribution measurementClass',
      ),
      matrixSha256: sha256(Buffer.from(canonicalJson(raw.matrix))),
      correctnessGateSha256: requireHash(
        raw.environment.correctnessGate.sha256,
        'attribution correctness gate',
      ),
      runs: raw.runs.length,
      runnerSha256: requireHash(raw.runner?.sha256, 'attribution runner'),
      caseRunnerSha256: requireHash(raw.caseRunner?.sha256, 'attribution case runner'),
    },
    harness,
    runtime: {
      kind: requireString(runtime?.kind, 'attribution runtime kind'),
      commit: requireCommit(runtime?.rolldownCommit, 'attribution runtime commit'),
      bindingSha256: requireHash(runtime?.bindingSha256, 'attribution binding'),
      distributionSha256: requireHash(runtime?.distSha256, 'attribution distribution'),
      packageEntrySha256: null,
      packageEnvironmentSha256: null,
    },
    nodeArtifact,
  };
}

async function validateDocuments({
  kind,
  rawBytes,
  summaryBytes,
  rawSourcePath,
  summarySourcePath,
  verifyCurrentNode,
}) {
  const raw = parseJson(rawBytes, `${kind} raw artifact`);
  const summary = parseJson(summaryBytes, `${kind} summary artifact`);
  const binding = summary?.source?.rawArtifact;
  requireRawBinding(binding);
  if (binding.bytes !== rawBytes.byteLength || binding.sha256 !== sha256(rawBytes)) {
    throw new Error('summary.source.rawArtifact does not bind the exact raw bytes and hash');
  }
  requireSafeSourcePath(binding.path);
  if (rawSourcePath && summarySourcePath) {
    const boundPath = nodePath.resolve(nodePath.dirname(summarySourcePath), binding.path);
    if ((await realpath(boundPath)) !== (await realpath(rawSourcePath))) {
      throw new Error('summary.source.rawArtifact.path does not resolve to the promoted raw input');
    }
  }

  const nodeArtifact = summary?.source?.nodeArtifact;
  const identity = deriveEvidenceIdentity(raw, kind, nodeArtifact);
  validateSummaryIdentity(summary, identity, raw);
  if (kind === 'attribution') {
    const expected = buildAttributionSummary(raw, binding, identity.nodeArtifact);
    if (!deepEqual(summary, expected)) {
      throw new Error('attribution summary is not derived from the exact raw report');
    }
  }
  if (verifyCurrentNode) {
    await requireCurrentRawNode(raw, kind);
    const current = await captureCurrentNodeArtifact();
    if (!deepEqual(identity.nodeArtifact, current)) {
      throw new Error('evidence Node artifact differs from the current exact Node executable');
    }
  }
  return { raw, summary, identity, summaryRawBinding: binding };
}

function validateSummaryIdentity(summary, identity, raw) {
  const expectedKind =
    identity.evidenceKind === 'initialization'
      ? 'rolldown-runtime-initialization-summary'
      : 'rolldown-attribution-evidence-summary';
  if (
    summary?.kind !== expectedKind ||
    summary.measurementClass !== identity.report.measurementClass
  ) {
    throw new Error(`${identity.evidenceKind} summary kind is invalid`);
  }
  const source = summary.source;
  if (
    source.harnessManifestSha256 !== identity.harness.manifestSha256 ||
    source.runtimeCommit !== identity.runtime.commit ||
    source.bindingSha256 !== identity.runtime.bindingSha256 ||
    source.distributionSha256 !== identity.runtime.distributionSha256 ||
    !deepEqual(source.nodeArtifact, identity.nodeArtifact)
  ) {
    throw new Error('summary provenance differs from raw runtime, harness, or Node identities');
  }
  if (identity.evidenceKind === 'initialization') {
    if (
      source.packageEntrySha256 !== identity.runtime.packageEntrySha256 ||
      sha256(Buffer.from(canonicalJson(source.packageEnvironment))) !==
        identity.runtime.packageEnvironmentSha256 ||
      source.rawRuns !== raw.runs.length ||
      source.repeats !== raw.matrix.repeats
    ) {
      throw new Error('initialization summary provenance differs from its raw report');
    }
  } else if (
    source.matrixSha256 !== identity.report.matrixSha256 ||
    source.correctnessGateSha256 !== identity.report.correctnessGateSha256 ||
    source.rawRuns !== raw.runs.length
  ) {
    throw new Error('attribution summary provenance differs from its raw report');
  }
}

function buildPointer({
  kind,
  rawBytes,
  summaryBytes,
  identity,
  summaryRawBinding,
  repository,
}) {
  const raw = { bytes: rawBytes.byteLength, sha256: sha256(rawBytes) };
  const summary = { bytes: summaryBytes.byteLength, sha256: sha256(summaryBytes) };
  const contentSha256 = contentAddress(raw, summary);
  const root = `${EVIDENCE_STORE_ROOT}/${kind}/sha256/${contentSha256}`;
  return {
    schemaVersion: 1,
    kind: POINTER_KIND,
    evidenceKind: kind,
    artifactStore: {
      kind: STORE_KIND,
      repository,
      root,
      contentSha256,
      recordFormat: CONTENT_RECORD_FORMAT,
    },
    raw: { path: `raw/${raw.sha256}.json`, ...raw },
    summary: { path: `summary/${summary.sha256}.json`, ...summary },
    summarySourceBinding: {
      path: summaryRawBinding.path,
      bytes: summaryRawBinding.bytes,
      sha256: summaryRawBinding.sha256,
    },
    provenance: identity,
  };
}

function validatePointerHeader(pointer, expectedRepository) {
  assertEvidenceKind(pointer?.evidenceKind);
  if (
    pointer.schemaVersion !== 1 ||
    pointer.kind !== POINTER_KIND ||
    pointer.artifactStore?.kind !== STORE_KIND ||
    pointer.artifactStore.repository !== expectedRepository ||
    pointer.artifactStore.recordFormat !== CONTENT_RECORD_FORMAT ||
    !HASH.test(pointer.artifactStore?.contentSha256 ?? '') ||
    pointer.artifactStore.root !==
      `${EVIDENCE_STORE_ROOT}/${pointer.evidenceKind}/sha256/${pointer.artifactStore.contentSha256}` ||
    contentAddress(pointer.raw, pointer.summary) !== pointer.artifactStore.contentSha256
  ) {
    throw new Error('evidence pointer header or content address is invalid');
  }
  requireArtifactDescriptor(pointer.raw, 'raw');
  requireArtifactDescriptor(pointer.summary, 'summary');
  requireRawBinding(pointer.summarySourceBinding);
}

function canonicalArtifactPath(bundleRoot, descriptor, role) {
  requireArtifactDescriptor(descriptor, role);
  const expected = `${role}/${descriptor.sha256}.json`;
  if (descriptor.path !== expected) {
    throw new Error(`${role} artifact path is not canonical`);
  }
  const absolute = nodePath.resolve(bundleRoot, descriptor.path);
  requireInside(bundleRoot, absolute, `${role} artifact`);
  return absolute;
}

function validateInitializationHarness(value) {
  const manifest = value?.sourceManifest;
  if (
    !COMMIT.test(value?.worktree?.commit ?? '') ||
    manifest?.algorithm !==
      'SHA-256 over UTF-8-sorted path + NUL + kind + NUL + bytes + NUL + content SHA-256 + LF records' ||
    !Array.isArray(manifest?.entries) ||
    manifest.entries.length === 0
  ) {
    throw new Error('initialization harness provenance is incomplete');
  }
  const entries = validateSortedEntries(manifest.entries, ({ path, kind, bytes, sha256: hash }) => {
    if (
      typeof path !== 'string' ||
      !['file', 'symlink'].includes(kind) ||
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      !HASH.test(hash ?? '')
    ) {
      throw new Error('initialization harness manifest entry is invalid');
    }
    return `${path}\0${kind}\0${bytes}\0${hash}\n`;
  });
  const aggregateSha256 = sha256(Buffer.from(entries.records.join('')));
  if (
    manifest.files !== manifest.entries.length ||
    manifest.bytes !== entries.bytes ||
    manifest.aggregateSha256 !== aggregateSha256
  ) {
    throw new Error('initialization harness manifest is not derived from its entries');
  }
  return {
    kind: 'git-committed-source-manifest',
    commit: value.worktree.commit,
    files: manifest.files,
    bytes: manifest.bytes,
    manifestSha256: aggregateSha256,
  };
}

function validateAttributionHarness(manifest) {
  if (
    manifest?.schema !== 1 ||
    manifest.recordFormat !== 'relativePath + NUL + bytes + NUL + sourceSha256 + LF' ||
    !Array.isArray(manifest.entries) ||
    manifest.entries.length === 0
  ) {
    throw new Error('attribution harness manifest is incomplete');
  }
  const entries = validateSortedEntries(
    manifest.entries,
    ({ relativePath, bytes, sourceSha256 }) => {
      if (
        typeof relativePath !== 'string' ||
        !Number.isSafeInteger(bytes) ||
        bytes < 0 ||
        !HASH.test(sourceSha256 ?? '')
      ) {
        throw new Error('attribution harness manifest entry is invalid');
      }
      return `${relativePath}\0${bytes}\0${sourceSha256}\n`;
    },
    'relativePath',
  );
  const selectionSha256 = sha256(Buffer.from(entries.records.join('')));
  if (manifest.sourceCount !== manifest.entries.length || manifest.selectionSha256 !== selectionSha256) {
    throw new Error('attribution harness manifest is not derived from its entries');
  }
  return {
    kind: 'source-manifest',
    commit: null,
    files: manifest.sourceCount,
    bytes: entries.bytes,
    manifestSha256: selectionSha256,
  };
}

function validateSortedEntries(entries, toRecord, pathField = 'path') {
  const paths = entries.map((entry) => entry[pathField]);
  if (
    new Set(paths).size !== paths.length ||
    !deepEqual(paths, [...paths].sort((left, right) => Buffer.from(left).compare(Buffer.from(right))))
  ) {
    throw new Error('harness manifest paths are duplicated or not UTF-8 sorted');
  }
  return {
    records: entries.map(toRecord),
    bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
  };
}

function contentAddress(raw, summary) {
  requireArtifactDescriptor(raw, 'raw');
  requireArtifactDescriptor(summary, 'summary');
  return sha256(
    Buffer.from(
      `raw\0${raw.bytes}\0${raw.sha256}\nsummary\0${summary.bytes}\0${summary.sha256}\n`,
    ),
  );
}

function requireArtifactDescriptor(value, label) {
  if (
    !Number.isSafeInteger(value?.bytes) ||
    value.bytes < 1 ||
    !HASH.test(value?.sha256 ?? '')
  ) {
    throw new Error(`${label} artifact descriptor is invalid`);
  }
}

function requireRawBinding(value) {
  requireArtifactDescriptor(value, 'summary raw binding');
  requireSafeSourcePath(value.path);
  return value;
}

function requireSafeSourcePath(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\0') ||
    nodePath.isAbsolute(value) ||
    toSlash(nodePath.normalize(value)).startsWith('../')
  ) {
    throw new Error('summary raw source path must be a non-escaping relative path');
  }
}

function validateNodeArtifact(value, label) {
  if (
    typeof value?.version !== 'string' ||
    value.version.length === 0 ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes < 1 ||
    !HASH.test(value.sha256 ?? '')
  ) {
    throw new Error(`${label} is incomplete`);
  }
  return { version: value.version, bytes: value.bytes, sha256: value.sha256 };
}

async function captureCurrentNodeArtifact() {
  const content = await readFile(process.execPath);
  return { version: process.version, bytes: content.byteLength, sha256: sha256(content) };
}

async function requireCurrentRawNode(raw, kind) {
  const node = kind === 'initialization' ? raw.runtimeProvenance?.node : undefined;
  const version = kind === 'initialization' ? node?.version : raw.node;
  const path = kind === 'initialization' ? node?.path : raw.nodeBinary;
  if (version !== process.version || typeof path !== 'string') {
    throw new Error(`${kind} raw report does not name the current exact Node executable`);
  }
  let actual;
  try {
    actual = await realpath(path);
  } catch {
    throw new Error(`${kind} raw report Node executable does not exist`);
  }
  if (actual !== (await realpath(process.execPath))) {
    throw new Error(`${kind} raw report does not name the current exact Node executable`);
  }
}

async function requireCleanRepository(repositoryRoot, expectedRepository) {
  const candidate = repositoryRoot
    ? nodePath.resolve(repositoryRoot)
    : git(process.cwd(), ['rev-parse', '--show-toplevel']);
  const root = await realpath(candidate);
  const discovered = await realpath(git(root, ['rev-parse', '--show-toplevel']));
  if (root !== discovered) throw new Error('evidence repository root is not canonical');
  const remote = normalizeRemote(git(root, ['remote', 'get-url', 'origin']));
  if (expectedRepository && remote !== expectedRepository) {
    throw new Error(`evidence repository remote is ${remote}, expected ${expectedRepository}`);
  }
  const status = git(root, ['status', '--short', '--untracked-files=all']);
  if (status !== '') {
    throw new Error(`evidence repository must be clean, including untracked files:\n${status}`);
  }
  git(root, ['rev-parse', '--verify', 'HEAD']);
  return root;
}

async function requireTrackedHeadBytes(repoRoot, path, label) {
  const relative = toSlash(nodePath.relative(repoRoot, path));
  requireInside(repoRoot, path, label);
  git(repoRoot, ['ls-files', '--error-unmatch', '--', relative]);
  const head = gitBuffer(repoRoot, ['show', `HEAD:${relative}`]);
  const working = await readFile(path);
  if (!head.equals(working)) {
    throw new Error(`${label} working bytes differ from tracked HEAD bytes`);
  }
}

async function requireRegularInput(path, label) {
  if (!path) throw new Error(`${label} path is required`);
  const absolute = nodePath.resolve(path);
  await requireRegularPath(absolute, label);
  return absolute;
}

async function requireRegularPath(path, label) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-symlink file`);
  }
}

async function writeFileAtomically(path, bytes) {
  await mkdir(nodePath.dirname(path), { recursive: true });
  if (await pathExists(path)) {
    if ((await readFile(path)).equals(bytes)) return;
    throw new Error(`refuse to replace existing artifact with different bytes: ${path}`);
  }
  const staging = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeDurableFile(staging, bytes);
    try {
      await link(staging, path);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (!(await readFile(path)).equals(bytes)) {
        throw new Error(`concurrent artifact differs at ${path}`);
      }
    }
  } finally {
    await rm(staging, { force: true });
  }
}

async function writeDurableFile(path, bytes) {
  const handle = await open(path, 'wx', 0o644);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function assertBytesUnchanged(path, expected, label) {
  if (!(await readFile(path)).equals(expected)) throw new Error(`${label} changed during promotion`);
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)))
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function normalizeRemote(value) {
  const trimmed = value.trim().replace(/\.git$/, '');
  for (const pattern of [
    /^https?:\/\/github\.com\/(.+)$/,
    /^git@github\.com:(.+)$/,
    /^ssh:\/\/git@github\.com\/(.+)$/,
  ]) {
    const match = trimmed.match(pattern);
    if (match) return `github.com/${match[1]}`;
  }
  return trimmed;
}

function git(root, args) {
  return gitBuffer(root, args).toString('utf8').trim();
}

function gitBuffer(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: 'buffer',
    maxBuffer: 512 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed:\n${result.stderr.toString('utf8')}`);
  }
  return result.stdout;
}

function requireInside(root, path, label) {
  const relative = nodePath.relative(root, path);
  if (relative === '' || (!relative.startsWith('..') && !nodePath.isAbsolute(relative))) return;
  throw new Error(`${label} escapes the evidence repository`);
}

function requireHash(value, label) {
  if (!HASH.test(value ?? '')) throw new Error(`${label} SHA-256 is invalid`);
  return value;
}

function requireCommit(value, label) {
  if (!COMMIT.test(value ?? '')) throw new Error(`${label} is invalid`);
  return value;
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} is missing`);
  return value;
}

function assertEvidenceKind(kind) {
  if (!EVIDENCE_KINDS.includes(kind)) {
    throw new Error(`evidence kind must be one of: ${EVIDENCE_KINDS.join(', ')}`);
  }
}

function assertExactNode() {
  if (process.version !== REQUIRED_NODE_VERSION) {
    throw new Error(`evidence promotion requires Node.js ${REQUIRED_NODE_VERSION}, got ${process.version}`);
  }
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function serialize(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function toSlash(value) {
  return value.split(nodePath.sep).join('/');
}

function deepEqual(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}
