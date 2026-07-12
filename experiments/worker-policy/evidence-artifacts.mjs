import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import nodePath from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  buildFixedPolicyEvidence,
  resolveJsonPointer,
} from './evidence-builder.mjs';
import {
  EVIDENCE_REQUIRED_BUILDER_SOURCES,
  EVIDENCE_REQUIRED_PROTOCOL_DOCUMENTS,
  validateEvidence,
} from './evaluator.mjs';
import { normalizeFormalPoolEnvironment } from './formal-source-contracts.mjs';

const MAX_GIT_ARTIFACT_BYTES = 512 * 1024 * 1024;

export async function loadCommittedBuildInputs(planPath, outputPath) {
  const absolutePlanPath = await realpath(nodePath.resolve(planPath));
  const absoluteOutputPath = await canonicalFuturePath(outputPath);
  const repoRoot = await realpath(
    gitText(nodePath.dirname(absolutePlanPath), [
      'rev-parse',
      '--show-toplevel',
    ]),
  );
  requireInside(repoRoot, absolutePlanPath, 'build plan');
  requireInside(repoRoot, absoluteOutputPath, 'evidence output');
  const sourceCommit = gitText(repoRoot, ['rev-parse', 'HEAD']);
  const planBytes = await requireCommittedBytes(
    repoRoot,
    sourceCommit,
    absolutePlanPath,
  );
  const plan = JSON.parse(planBytes);
  const outputDirectory = nodePath.dirname(absoluteOutputPath);
  const sourceDocuments = new Map();
  for (const source of plan.sources ?? []) {
    if (typeof source?.path !== 'string')
      throw new Error('build plan source path is missing');
    const absolutePath = await realpath(
      nodePath.resolve(outputDirectory, source.path),
    );
    requireCanonicalSourcePath(outputDirectory, absolutePath, source.path);
    const bytes = await requireCommittedBytes(
      repoRoot,
      sourceCommit,
      absolutePath,
    );
    const sha256 = digest(bytes);
    if (nodePath.basename(absolutePath) !== `${sha256}.json`) {
      throw new Error(
        `source report is not named by its SHA-256: ${source.path}`,
      );
    }
    sourceDocuments.set(source.id, {
      path: toSlash(nodePath.relative(outputDirectory, absolutePath)),
      sha256,
      bytes: bytes.byteLength,
      document: JSON.parse(bytes),
    });
  }
  const protocolDocuments = [];
  for (const relativePath of EVIDENCE_REQUIRED_PROTOCOL_DOCUMENTS) {
    const bytes = await requireCommittedBytes(
      repoRoot,
      sourceCommit,
      nodePath.join(repoRoot, relativePath),
    );
    protocolDocuments.push({
      path: relativePath,
      sha256: digest(bytes),
      bytes: bytes.byteLength,
    });
  }
  const builderSources = [];
  for (const relativePath of EVIDENCE_REQUIRED_BUILDER_SOURCES) {
    const bytes = await requireCommittedBytes(
      repoRoot,
      sourceCommit,
      nodePath.join(repoRoot, relativePath),
    );
    builderSources.push({
      path: relativePath,
      sha256: digest(bytes),
      bytes: bytes.byteLength,
    });
  }
  return {
    repoRoot,
    sourceCommit,
    plan,
    planRecord: {
      path: toSlash(nodePath.relative(repoRoot, absolutePlanPath)),
      sha256: digest(planBytes),
      bytes: planBytes.byteLength,
    },
    builderSources,
    protocolDocuments,
    sourceDocuments,
  };
}

export async function verifyCommittedEvidence(evidencePath) {
  const absoluteEvidencePath = await realpath(nodePath.resolve(evidencePath));
  const repoRoot = await realpath(
    gitText(nodePath.dirname(absoluteEvidencePath), [
      'rev-parse',
      '--show-toplevel',
    ]),
  );
  const head = gitText(repoRoot, ['rev-parse', 'HEAD']);
  const evidenceBytes = await requireCommittedBytes(
    repoRoot,
    head,
    absoluteEvidencePath,
  );
  const evidence = JSON.parse(evidenceBytes);
  validateEvidence(evidence);
  requireAncestor(repoRoot, evidence.repository.sourceCommit, head);
  const planPath = nodePath.join(repoRoot, evidence.repository.buildPlan.path);
  const planBytes = await requireRecordedArtifact(
    repoRoot,
    evidence.repository.sourceCommit,
    planPath,
    evidence.repository.buildPlan,
  );
  const plan = JSON.parse(planBytes);
  for (const record of evidence.repository.builderSources) {
    await requireRecordedArtifact(
      repoRoot,
      evidence.repository.sourceCommit,
      nodePath.join(repoRoot, record.path),
      record,
    );
  }
  for (const record of evidence.protocolDocuments) {
    await requireRecordedArtifact(
      repoRoot,
      evidence.repository.sourceCommit,
      nodePath.join(repoRoot, record.path),
      record,
    );
  }
  const outputDirectory = nodePath.dirname(absoluteEvidencePath);
  const documents = [];
  const sourceDocuments = new Map();
  for (const source of evidence.sourceReports) {
    const absolutePath = await realpath(
      nodePath.resolve(outputDirectory, source.path),
    );
    requireCanonicalSourcePath(outputDirectory, absolutePath, source.path);
    const bytes = await requireRecordedArtifact(
      repoRoot,
      evidence.repository.sourceCommit,
      absolutePath,
      source,
    );
    const document = JSON.parse(bytes);
    documents.push(document);
    sourceDocuments.set(source.id, {
      path: source.path,
      sha256: source.sha256,
      bytes: source.bytes,
      document,
    });
  }
  verifySourceAssertionsAndLinks(evidence, documents);
  verifySourceBindings(evidence, documents);
  const rebuilt = buildFixedPolicyEvidence({
    plan,
    planRecord: evidence.repository.buildPlan,
    builderSources: evidence.repository.builderSources,
    sourceCommit: evidence.repository.sourceCommit,
    protocolDocuments: evidence.protocolDocuments,
    sourceDocuments,
  });
  if (!isDeepStrictEqual(rebuilt, evidence)) {
    throw new Error(
      'committed fixed-policy evidence differs from its deterministic build plan',
    );
  }
  return {
    repoRoot,
    head,
    evidence,
    evidenceBytes,
    sourceDocuments: documents,
  };
}

export function verifySourceBindings(evidence, reports) {
  const machineReport = reports[evidence.machine.sourceReportIndex];
  if (
    !machineReport ||
    evidence.machine.sourceReportId !==
      evidence.sourceReports[evidence.machine.sourceReportIndex].id
  ) {
    throw new Error('machine source report is missing');
  }
  for (const field of [
    'availableParallelism',
    'performanceCores',
    'efficiencyCores',
    'cpuModel',
    'node',
  ]) {
    verifyBoundValue(
      machineReport,
      evidence.machine.sourceBindings[field],
      evidence.machine[field],
      `machine/${field}`,
    );
  }
  for (const testCase of evidence.cases) {
    const report = reports[testCase.sourceReportIndex];
    if (
      !report ||
      testCase.sourceReportId !==
        evidence.sourceReports[testCase.sourceReportIndex].id
    ) {
      throw new Error(`${testCase.id} source report is missing`);
    }
    verifyBoundValue(
      report,
      testCase.sourceBindings.scaleValue,
      testCase.scaleValue,
      `${testCase.id}/scaleValue`,
    );
    verifyBoundValue(
      report,
      testCase.sourceBindings.oracleWorkerCount,
      testCase.oracleWorkerCount,
      `${testCase.id}/oracleWorkerCount`,
    );
    verifyBoundValue(
      report,
      testCase.sourceBindings.policyEvidence,
      policyEvidenceProjection(testCase),
      `${testCase.id}/policyEvidence`,
      projectPolicyEvidence,
    );
    verifyBoundValue(
      report,
      testCase.sourceBindings.policyEvidenceSchema,
      1,
      `${testCase.id}/policyEvidenceSchema`,
    );
    if (testCase.sourceBindings.cpuRatePercent !== null) {
      verifyBoundValue(
        report,
        testCase.sourceBindings.cpuRatePercent,
        testCase.cpuRatePercent,
        `${testCase.id}/cpuRatePercent`,
      );
    } else if (testCase.cpuRatePercent !== null) {
      throw new Error(`${testCase.id} CPU rate is not source bound`);
    }
    if (testCase.sourceBindings.poolEnvironment !== null) {
      const binding = testCase.sourceBindings.poolEnvironment;
      const poolReport = reports[binding.sourceReportIndex];
      if (
        !poolReport ||
        binding.sourceReportId !==
          evidence.sourceReports[binding.sourceReportIndex]?.id
      ) {
        throw new Error(`${testCase.id} Rust-pool source report is missing`);
      }
      verifyBoundValue(
        poolReport,
        binding.pointer,
        testCase.poolEnvironment,
        `${testCase.id}/poolEnvironment`,
        (value) => normalizeFormalPoolEnvironment(value, testCase.id),
      );
    } else if (testCase.poolEnvironment !== null) {
      throw new Error(`${testCase.id} pool environment is not source bound`);
    }
    if (testCase.sourceBindings.sourceStudy !== null) {
      verifyBoundValue(
        report,
        testCase.sourceBindings.sourceStudy,
        testCase.sourceStudy,
        `${testCase.id}/sourceStudy`,
      );
    } else if (testCase.sourceStudy !== null) {
      throw new Error(`${testCase.id} policy stage is not source bound`);
    }
    for (const variant of testCase.variants) {
      for (const field of [
        'wallMedianMs',
        'cpuMedianMs',
        'peakRssMedianBytes',
        'resourceEligible',
        'pairedWallRatioToOrdinaryBootstrap95Upper',
      ]) {
        const sourceField =
          field === 'pairedWallRatioToOrdinaryBootstrap95Upper'
            ? 'pairedWallRatioBootstrap95Upper'
            : field;
        verifyBoundValue(
          report,
          variant.sourceBindings[field],
          variant[field],
          `${testCase.id}/worker-${variant.workerCount}/${field}`,
          (value) => value?.[sourceField] ?? value,
        );
      }
    }
  }
}

function verifySourceAssertionsAndLinks(evidence, documents) {
  for (let index = 0; index < evidence.sourceReports.length; index++) {
    const source = evidence.sourceReports[index];
    const document = documents[index];
    for (const assertion of source.assertions) {
      verifyBoundValue(
        document,
        assertion.pointer,
        assertion.equals,
        `${source.id}/assertion${assertion.pointer}`,
      );
    }
    for (const link of source.links) {
      verifyBoundValue(
        document,
        link.sha256Pointer,
        evidence.sourceReports[link.targetSourceReportIndex].sha256,
        `${source.id}/lineage/${link.targetSourceReportId}`,
      );
    }
  }
}

function policyEvidenceProjection(testCase) {
  return {
    oracleWorkerCount: testCase.oracleWorkerCount,
    variants: Object.fromEntries(
      testCase.variants.map((variant) => [
        variant.workerCount === 0
          ? 'ordinary'
          : `worker-${variant.workerCount}`,
        {
          wallMedianMs: variant.wallMedianMs,
          cpuMedianMs: variant.cpuMedianMs,
          peakRssMedianBytes: variant.peakRssMedianBytes,
          resourceEligible: variant.resourceEligible,
          pairedWallRatioBootstrap95Upper:
            variant.pairedWallRatioToOrdinaryBootstrap95Upper,
        },
      ]),
    ),
  };
}

function projectPolicyEvidence(value) {
  if (value?.variants === null || typeof value?.variants !== 'object') {
    return value;
  }
  const oracleWorkerCount =
    value.selectedOracleWorkerCount ??
    value.variants.ordinary?.selectedOracleCount ??
    value.variants.ordinary?.selectedOracleWorkerCount;
  return {
    oracleWorkerCount,
    variants: Object.fromEntries(
      Object.entries(value.variants).map(([name, variant]) => [
        name,
        {
          wallMedianMs: variant.wallMedianMs,
          cpuMedianMs: variant.cpuMedianMs,
          peakRssMedianBytes: variant.peakRssMedianBytes,
          resourceEligible: variant.resourceEligible,
          pairedWallRatioBootstrap95Upper:
            variant.pairedWallRatioBootstrap95Upper,
        },
      ]),
    ),
  };
}

function verifyBoundValue(
  report,
  pointer,
  expected,
  label,
  projection = (value) => value,
) {
  const actual = projection(resolveJsonPointer(report, pointer));
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error(
      `${label} differs from ${pointer}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

async function requireRecordedArtifact(repoRoot, commit, absolutePath, record) {
  const bytes = await requireCommittedBytes(repoRoot, commit, absolutePath);
  if (bytes.byteLength !== record.bytes || digest(bytes) !== record.sha256) {
    throw new Error(`recorded artifact identity changed: ${record.path}`);
  }
  return bytes;
}

async function requireCommittedBytes(repoRoot, commit, absolutePath) {
  requireInside(repoRoot, absolutePath, 'committed artifact');
  const relativePath = toSlash(nodePath.relative(repoRoot, absolutePath));
  const current = await readFile(absolutePath);
  const committed = gitBytes(repoRoot, ['show', `${commit}:${relativePath}`]);
  if (!current.equals(committed)) {
    throw new Error(`artifact differs from ${commit}:${relativePath}`);
  }
  return current;
}

function requireCanonicalSourcePath(
  outputDirectory,
  absolutePath,
  recordedPath,
) {
  const expectedRoot = nodePath.resolve(outputDirectory, 'reports/sha256');
  requireInside(expectedRoot, absolutePath, 'content-addressed source report');
  const relative = toSlash(nodePath.relative(outputDirectory, absolutePath));
  if (
    relative !== recordedPath ||
    !/^reports\/sha256\/[0-9a-f]{64}\.json$/.test(relative)
  ) {
    throw new Error(
      `noncanonical fixed-policy source report path: ${recordedPath}`,
    );
  }
}

function requireInside(root, path, label) {
  const relative = nodePath.relative(
    nodePath.resolve(root),
    nodePath.resolve(path),
  );
  if (
    relative === '' ||
    (!relative.startsWith('..') && !nodePath.isAbsolute(relative))
  )
    return;
  throw new Error(`${label} escapes its repository root: ${path}`);
}

function requireAncestor(repoRoot, ancestor, descendant) {
  const result = spawnSync(
    'git',
    ['-C', repoRoot, 'merge-base', '--is-ancestor', ancestor, descendant],
    {
      encoding: 'utf8',
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `evidence source commit ${ancestor} is not an ancestor of ${descendant}`,
    );
  }
}

function gitText(cwd, args) {
  return gitBytes(cwd, args).toString('utf8').trim();
}

function gitBytes(cwd, args) {
  const result = spawnSync('git', ['-C', cwd, ...args], {
    encoding: null,
    maxBuffer: MAX_GIT_ARTIFACT_BYTES,
  });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed: ${result.stderr?.toString('utf8').trim() ?? ''}`,
    );
  }
  return result.stdout;
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function toSlash(value) {
  return value.split(nodePath.sep).join('/');
}

async function canonicalFuturePath(path) {
  const absolute = nodePath.resolve(path);
  return nodePath.join(
    await realpath(nodePath.dirname(absolute)),
    nodePath.basename(absolute),
  );
}
