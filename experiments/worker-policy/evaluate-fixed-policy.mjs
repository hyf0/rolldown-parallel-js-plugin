import { writeFile } from 'node:fs/promises';
import { verifyCommittedEvidence } from './evidence-artifacts.mjs';
import { evaluateFixedWorkerPolicies } from './evaluator.mjs';

assertExactNode();
const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath)
  throw new Error(
    'expected <committed-policy-evidence.json> [evaluation.json]',
  );
const { evidence } = await verifyCommittedEvidence(inputPath);
const evaluation = evaluateFixedWorkerPolicies(evidence, {
  sourceBindingsVerified: true,
});
const serialized = `${JSON.stringify(evaluation, null, 2)}\n`;
if (outputPath) {
  await writeFile(outputPath, serialized);
  console.log(
    JSON.stringify({
      outputPath,
      localFixedPolicyGatePassed: evaluation.localFixedPolicyGate.passed,
      shippableAutomaticFixedPolicy: evaluation.shippableAutomaticFixedPolicy,
    }),
  );
} else {
  process.stdout.write(serialized);
}

function assertExactNode() {
  if (process.version !== 'v24.18.0') {
    throw new Error(
      `fixed-policy artifacts require Node.js v24.18.0, got ${process.version}`,
    );
  }
}
