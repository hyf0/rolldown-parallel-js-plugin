import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  loadCommittedBuildInputs,
  verifyCommittedEvidence,
} from './evidence-artifacts.mjs';
import { buildFixedPolicyEvidence } from './evidence-builder.mjs';
import {
  EVIDENCE_REQUIRED_BUILDER_SOURCES,
  EVIDENCE_REQUIRED_PROTOCOL_DOCUMENTS,
} from './evaluator.mjs';

const root = await mkdtemp(nodePath.join(tmpdir(), 'fixed-policy-artifacts-'));
try {
  git(root, ['init', '-q']);
  git(root, ['config', 'user.name', 'Fixture']);
  git(root, ['config', 'user.email', 'fixture@example.test']);
  const dataRoot = nodePath.join(root, 'experiments/worker-policy/data');
  const source = {
    schema: 1,
    admitted: true,
    host: {
      logicalCpuCount: 12,
      cpuModel: 'Apple M3 Pro',
      performanceCores: 6,
      efficiencyCores: 6,
    },
    node: 'v24.18.0',
    project: {
      reachedSfcCount: 4,
      policyEvidence: {
        schema: 1,
        selectedOracleWorkerCount: 0,
        variants: {
          ordinary: variant(100, 100, 1000, true, 1, 0),
          'worker-4': variant(120, 130, 1300, false, 1.25, 0),
          'worker-8': variant(140, 150, 1500, false, 1.45, 0),
        },
      },
    },
  };
  const sourceBytes = Buffer.from(`${JSON.stringify(source, null, 2)}\n`);
  const sourceSha256 = digest(sourceBytes);
  const sourceRelativePath = `reports/sha256/${sourceSha256}.json`;
  const sourcePath = nodePath.join(dataRoot, sourceRelativePath);
  await mkdir(nodePath.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, sourceBytes);
  for (const relativePath of EVIDENCE_REQUIRED_PROTOCOL_DOCUMENTS) {
    const path = nodePath.join(root, relativePath);
    await mkdir(nodePath.dirname(path), { recursive: true });
    await writeFile(path, `# ${relativePath}\n`);
  }
  for (const relativePath of EVIDENCE_REQUIRED_BUILDER_SOURCES) {
    const path = nodePath.join(root, relativePath);
    await mkdir(nodePath.dirname(path), { recursive: true });
    await writeFile(path, `// ${relativePath}\n`);
  }
  const plan = {
    schemaVersion: 1,
    kind: 'rolldown-fixed-worker-policy-build-plan',
    protocol: 'scale-crossover-v1-amended-6',
    formalCoverage: false,
    candidatePolicy: {
      fittedFromEvidence: false,
      frozenBeforeEvidence: true,
      frozenBy: '.agents/docs/scale-crossover-protocol-amendment-1.md',
      fixedFourWorkerCount: 4,
      hardwareCapFormula: 'min(availableParallelism, workerSafetyCap)',
      workerSafetyCap: 8,
    },
    sources: [
      {
        id: 'independent-small',
        path: sourceRelativePath,
        assertions: [
          { pointer: '/schema', equals: 1 },
          { pointer: '/admitted', equals: true },
        ],
        links: [],
      },
    ],
    machine: {
      sourceId: 'independent-small',
      workerSafetyCap: 8,
      bindings: {
        availableParallelism: '/host/logicalCpuCount',
        performanceCores: '/host/performanceCores',
        efficiencyCores: '/host/efficiencyCores',
        cpuModel: '/host/cpuModel',
        node: '/node',
      },
    },
    cases: [
      {
        id: 'independent-small',
        family: 'vue-project',
        study: 'baseline',
        scaleRole: 'independent-small',
        sourceId: 'independent-small',
        scaleValuePointer: '/project/reachedSfcCount',
        policyEvidencePointer: '/project/policyEvidence',
        policyEvidenceSchemaPointer: '/project/policyEvidence/schema',
        oracleWorkerCountPointer:
          '/project/policyEvidence/selectedOracleWorkerCount',
      },
    ],
  };
  const planPath = nodePath.join(dataRoot, 'build-plan.json');
  const evidencePath = nodePath.join(dataRoot, 'fixed-policy-evidence.json');
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'freeze inputs']);
  const inputs = await loadCommittedBuildInputs(planPath, evidencePath);
  const evidence = buildFixedPolicyEvidence(inputs);
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'record evidence']);

  const verified = await verifyCommittedEvidence(evidencePath);
  assert.equal(verified.evidence.sourceReports[0].sha256, sourceSha256);
  assert.equal(verified.evidence.cases[0].variants[1].wallMedianMs, 120);

  await writeFile(sourcePath, `${sourceBytes.toString('utf8')} `);
  await assert.rejects(
    () => verifyCommittedEvidence(evidencePath),
    /artifact differs from/,
  );
  await writeFile(sourcePath, sourceBytes);

  const evidenceBytes = await readFile(evidencePath);
  const forged = JSON.parse(evidenceBytes);
  forged.cases[0].variants[1].wallMedianMs = 1;
  await writeFile(evidencePath, `${JSON.stringify(forged, null, 2)}\n`);
  await assert.rejects(
    () => verifyCommittedEvidence(evidencePath),
    /artifact differs from/,
  );
  await writeFile(evidencePath, evidenceBytes);

  const noncanonicalPlan = structuredClone(plan);
  noncanonicalPlan.sources[0].path = `../outside/${sourceSha256}.json`;
  await writeFile(planPath, `${JSON.stringify(noncanonicalPlan, null, 2)}\n`);
  await assert.rejects(
    () => loadCommittedBuildInputs(planPath, evidencePath),
    /artifact differs from/,
  );
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  const planForgedEvidence = JSON.parse(evidenceBytes);
  planForgedEvidence.cases[0].scale = '999 SFCs';
  await writeFile(
    evidencePath,
    `${JSON.stringify(planForgedEvidence, null, 2)}\n`,
  );
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'forge normalized evidence']);
  await assert.rejects(
    () => verifyCommittedEvidence(evidencePath),
    /differs from its deterministic build plan/,
  );

  console.log(
    JSON.stringify({
      valid: [
        'content-addressed-source',
        'source-commit-ancestor',
        'evidence-head-identity',
      ],
      rejected: [
        'dirty-source',
        'dirty-evidence',
        'dirty-build-plan',
        'committed-plan-divergence',
      ],
    }),
  );
} finally {
  await rm(root, { recursive: true, force: true });
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

function git(cwd, args) {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
