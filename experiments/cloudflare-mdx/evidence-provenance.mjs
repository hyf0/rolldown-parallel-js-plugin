import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import nodePath from 'node:path';
import { captureHarnessSourceManifest } from './environment-provenance.mjs';

export async function requireCurrentEvidenceProvenance(
  environment,
  runnerRecord,
  caseRunnerRecord,
  runnerName,
  caseRunnerName,
  additionalSourceRecords = [],
) {
  const harness = await captureHarnessSourceManifest();
  if (JSON.stringify(environment?.harnessSourceManifest) !== JSON.stringify(harness)) {
    throw new Error('Evidence harness source manifest differs from the current complete manifest');
  }
  await requireSourceRecord(runnerRecord, runnerName, harness);
  await requireSourceRecord(caseRunnerRecord, caseRunnerName, harness);
  for (const [record, name] of additionalSourceRecords) {
    await requireSourceRecord(record, name, harness);
  }
}

async function requireSourceRecord(record, name, harness) {
  const path = nodePath.join(import.meta.dirname, name);
  const hash = createHash('sha256').update(await readFile(path)).digest('hex');
  const manifest = harness.entries.find(({ relativePath }) => relativePath === name);
  if (
    record?.path !== path ||
    record?.sha256 !== hash ||
    manifest?.sourceSha256 !== hash
  ) {
    throw new Error(`Evidence source record differs from current ${name}`);
  }
}
