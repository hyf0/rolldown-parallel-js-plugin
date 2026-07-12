import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import nodePath from 'node:path';
import { requireCurrentEvidenceProvenance } from './evidence-provenance.mjs';
import { loadScaleManifest } from './scale-corpus.mjs';
import { planScaleFollowup } from './scale-followup.mjs';

const { command, screenPath, followupPaths, outputPath, validateOnly } = parseArguments(
  process.argv.slice(2),
);
const screenRecord = await readRecord(screenPath);
const followupRecords = await Promise.all(followupPaths.map(readRecord));
await requireCurrentEvidenceProvenance(
  screenRecord.report.environment,
  screenRecord.report.runner,
  screenRecord.report.caseRunner,
  'run-matrix.mjs',
  'run-case.mjs',
);
for (const record of followupRecords) {
  await requireCurrentEvidenceProvenance(
    record.report.environment,
    record.report.runner,
    record.report.caseRunner,
    'run-matrix.mjs',
    'run-case.mjs',
  );
}
const manifest = await loadScaleManifest();
const plan = planScaleFollowup({ screenRecord, followupRecords, manifest });
if (command === 'confirmation' && followupRecords.length > 0) {
  throw new Error('confirmation accepts only the base screen; use refine after the first report');
}
if (command === 'confirmation' && plan.stage !== 'initial-confirmation') {
  throw new Error(`Expected initial confirmation, got ${plan.stage}`);
}
if (command === 'refine' && followupRecords.length === 0) {
  throw new Error('refine requires the passed initial confirmation report');
}

const artifact = plan.matrix ?? plan;
if (outputPath && !validateOnly) {
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
}
console.log(
  JSON.stringify({
    valid: true,
    command,
    validateOnly,
    status: plan.status,
    stage: plan.stage,
    outputPath: outputPath && !validateOnly ? outputPath : null,
    nextScales: plan.matrix?.cases?.map(({ selectionScale }) => selectionScale) ?? [],
    mechanicalCrossover: plan.decision?.mechanical ?? null,
    resourceCrossover: plan.decision?.resource ?? null,
  }),
);

async function readRecord(path) {
  const absolutePath = nodePath.resolve(path);
  const source = await readFile(absolutePath);
  return {
    path: absolutePath,
    sha256: createHash('sha256').update(source).digest('hex'),
    report: JSON.parse(source),
  };
}

function parseArguments(args) {
  const command = args.shift();
  if (command !== 'confirmation' && command !== 'refine') {
    throw new Error(
      'Usage: generate-scale-followup.mjs <confirmation|refine> <base-screen.raw.json> [followup.raw.json ...] [--output path] [--validate-only]',
    );
  }
  let outputPath;
  let validateOnly = false;
  const paths = [];
  while (args.length > 0) {
    const argument = args.shift();
    if (argument === '--output') {
      const value = args.shift();
      if (!value || outputPath) throw new Error('--output requires exactly one path');
      outputPath = nodePath.resolve(value);
    } else if (argument === '--validate-only') {
      validateOnly = true;
    } else if (argument.startsWith('--')) {
      throw new Error(`Unknown option: ${argument}`);
    } else {
      paths.push(argument);
    }
  }
  if (paths.length === 0) throw new Error('A passed base-screen artifact is required');
  return {
    command,
    screenPath: paths[0],
    followupPaths: paths.slice(1),
    outputPath,
    validateOnly,
  };
}
