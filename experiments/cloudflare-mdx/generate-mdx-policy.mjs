import { writeFile } from 'node:fs/promises';
import nodePath from 'node:path';
import { requireCurrentEvidenceProvenance } from './evidence-provenance.mjs';
import {
  planAllocationPolicy,
  planQuotaPolicy,
  readArtifactRecord,
  requireCompletedMdxCrossover,
  requirePassedCpulimitCalibration,
  validatePolicyMatrix,
} from './mdx-policy.mjs';
import { loadScaleManifest } from './scale-corpus.mjs';

const options = parseArguments(process.argv.slice(2));
const manifest = await loadScaleManifest();
const screenRecord = await readArtifactRecord(options.baseScreenPath);
const crossoverRecords = await Promise.all(options.crossoverPaths.map(readArtifactRecord));
for (const record of [screenRecord, ...crossoverRecords]) {
  await requireCurrentEvidenceProvenance(
    record.report.environment,
    record.report.runner,
    record.report.caseRunner,
    'run-matrix.mjs',
    'run-case.mjs',
  );
}
const crossover = requireCompletedMdxCrossover(screenRecord, crossoverRecords, manifest);
const policyRecords = await Promise.all(options.policyPaths.map(readArtifactRecord));
for (const record of policyRecords) {
  await requireCurrentEvidenceProvenance(
    record.report.environment,
    record.report.runner,
    record.report.caseRunner,
    'run-policy-matrix.mjs',
    'run-case.mjs',
    [[record.report.launcher, 'policy-node-launcher.mjs']],
  );
}
const template = crossover.executionTemplate;
let calibration;
if (options.command === 'quota') {
  if (!options.calibrationPath) throw new Error('quota requires --calibration <passed.raw.json>');
  calibration = await requirePassedCpulimitCalibration(
    await readArtifactRecord(options.calibrationPath),
  );
} else if (options.calibrationPath) {
  throw new Error('allocation does not consume a CPU-rate calibration');
}
const plan = options.command === 'allocation'
  ? planAllocationPolicy({ crossover, policyRecords, template, manifest })
  : planQuotaPolicy({ crossover, policyRecords, template, manifest, calibration });
if (plan.matrix) validatePolicyMatrix(plan.matrix, manifest);
const artifact = plan.matrix ?? plan;
if (options.outputPath && !options.validateOnly) {
  await writeFile(options.outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
}
console.log(
  JSON.stringify({
    valid: true,
    command: options.command,
    status: plan.status,
    stage: plan.stage,
    validateOnly: options.validateOnly,
    outputPath: options.outputPath && !options.validateOnly ? options.outputPath : null,
    cases: plan.matrix?.cases.length ?? 0,
    runs:
      plan.matrix?.cases.reduce(
        (sum, definition) => sum + definition.variants.length * definition.repeats,
        0,
      ) ?? 0,
    crossoverPoints: crossover.points,
    quotaPoints: crossover.quotaPoints,
  }),
);

function parseArguments(args) {
  const command = args.shift();
  if (command !== 'allocation' && command !== 'quota') {
    throw new Error(
      'Usage: generate-mdx-policy.mjs <allocation|quota> --base-screen path --crossover path... [--policy path...] [--calibration path] [--output path] [--validate-only]',
    );
  }
  const value = {
    command,
    baseScreenPath: undefined,
    crossoverPaths: [],
    policyPaths: [],
    calibrationPath: undefined,
    outputPath: undefined,
    validateOnly: false,
  };
  while (args.length > 0) {
    const option = args.shift();
    if (option === '--base-screen') value.baseScreenPath = requiredValue(args, option);
    else if (option === '--crossover') value.crossoverPaths.push(requiredValue(args, option));
    else if (option === '--policy') value.policyPaths.push(requiredValue(args, option));
    else if (option === '--calibration') value.calibrationPath = requiredValue(args, option);
    else if (option === '--output') value.outputPath = nodePath.resolve(requiredValue(args, option));
    else if (option === '--validate-only') value.validateOnly = true;
    else throw new Error(`Unknown option: ${option}`);
  }
  if (!value.baseScreenPath || value.crossoverPaths.length === 0) {
    throw new Error('--base-screen and at least one ordered --crossover artifact are required');
  }
  return value;
}

function requiredValue(args, option) {
  const value = args.shift();
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a path`);
  return nodePath.resolve(value);
}
