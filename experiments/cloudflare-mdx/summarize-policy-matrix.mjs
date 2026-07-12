import { writeFile } from 'node:fs/promises';
import nodePath from 'node:path';
import { requireCurrentEvidenceProvenance } from './evidence-provenance.mjs';
import {
  loadAndRequireCrossoverReference,
  planAllocationPolicy,
  planQuotaPolicy,
  readArtifactRecord,
  requirePassedCpulimitCalibration,
  summarizePolicyReport,
} from './mdx-policy.mjs';

const inputPath = nodePath.resolve(process.argv[2] ?? '');
const outputPath = process.argv[3] ? nodePath.resolve(process.argv[3]) : undefined;
if (!inputPath) throw new Error('Expected a raw policy matrix report');
const source = await readArtifactRecord(inputPath);
const report = source.report;
await requireCurrentEvidenceProvenance(
  report.environment,
  report.runner,
  report.caseRunner,
  'run-policy-matrix.mjs',
  'run-case.mjs',
  [[report.launcher, 'policy-node-launcher.mjs']],
);
const context = await loadAndRequireCrossoverReference(report.matrix.policy.crossover);
for (const record of [context.screenRecord, ...context.crossoverRecords]) {
  await requireCurrentEvidenceProvenance(
    record.report.environment,
    record.report.runner,
    record.report.caseRunner,
    'run-matrix.mjs',
    'run-case.mjs',
  );
}
const policyRecords = await Promise.all(
  report.matrix.policy.consumedPolicyArtifacts.map(async (reference) => {
    const record = await readArtifactRecord(reference.path);
    if (record.sha256 !== reference.sha256) throw new Error(`Policy artifact changed: ${reference.path}`);
    await requireCurrentEvidenceProvenance(
      record.report.environment,
      record.report.runner,
      record.report.caseRunner,
      'run-policy-matrix.mjs',
      'run-case.mjs',
      [[record.report.launcher, 'policy-node-launcher.mjs']],
    );
    return record;
  }),
);
const template = context.crossover.executionTemplate;
let calibration;
if (report.matrix.policy.stage.startsWith('quota-')) {
  const reference = report.matrix.policy.calibration;
  const record = await readArtifactRecord(reference.path);
  if (record.sha256 !== reference.sha256) throw new Error('Calibration artifact changed');
  calibration = await requirePassedCpulimitCalibration(record);
}
const expected = report.matrix.policy.stage.startsWith('allocation-')
  ? planAllocationPolicy({
      crossover: context.crossover,
      policyRecords,
      template,
      manifest: context.manifest,
    })
  : planQuotaPolicy({
      crossover: context.crossover,
      policyRecords,
      template,
      manifest: context.manifest,
      calibration,
    });
if (expected.status !== 'matrix-required' || JSON.stringify(expected.matrix) !== JSON.stringify(report.matrix)) {
  throw new Error('Policy report matrix was not the deterministic next chain artifact');
}
const summary = {
  ...summarizePolicyReport(report, context.manifest),
  source: { path: source.path, sha256: source.sha256 },
  crossover: context.crossover,
  calibration: report.matrix.policy.calibration,
};
const serialized = `${JSON.stringify(summary, null, 2)}\n`;
if (outputPath) await writeFile(outputPath, serialized);
else process.stdout.write(serialized);
