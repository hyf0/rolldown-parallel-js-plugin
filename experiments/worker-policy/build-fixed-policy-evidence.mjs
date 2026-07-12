import { writeFile } from 'node:fs/promises';
import nodePath from 'node:path';
import { loadCommittedBuildInputs } from './evidence-artifacts.mjs';
import { buildFixedPolicyEvidence } from './evidence-builder.mjs';

assertExactNode();
const [planPath, outputPath] = process.argv.slice(2);
if (!planPath || !outputPath) {
  throw new Error(
    'usage: node build-fixed-policy-evidence.mjs BUILD_PLAN.json FIXED_POLICY_EVIDENCE.json',
  );
}
const absoluteOutputPath = nodePath.resolve(outputPath);
const expectedDataRoot = nodePath.join(import.meta.dirname, 'data');
const relativeOutputPath = nodePath.relative(
  expectedDataRoot,
  absoluteOutputPath,
);
if (
  relativeOutputPath.startsWith('..') ||
  nodePath.isAbsolute(relativeOutputPath) ||
  relativeOutputPath === '' ||
  relativeOutputPath.startsWith(`reports${nodePath.sep}`)
) {
  throw new Error(
    'fixed-policy evidence output must be under worker-policy/data, outside reports',
  );
}
const inputs = await loadCommittedBuildInputs(planPath, absoluteOutputPath);
const evidence = buildFixedPolicyEvidence(inputs);
await writeFile(absoluteOutputPath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(
  JSON.stringify({
    outputPath: absoluteOutputPath,
    sourceCommit: evidence.repository.sourceCommit,
    sourceReports: evidence.sourceReports.length,
    cases: evidence.cases.length,
    formalCoverage: evidence.formalCoverage,
  }),
);

function assertExactNode() {
  if (process.version !== 'v24.18.0') {
    throw new Error(
      `fixed-policy artifacts require Node.js v24.18.0, got ${process.version}`,
    );
  }
}
