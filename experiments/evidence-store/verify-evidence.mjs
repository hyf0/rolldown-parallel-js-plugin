import { verifyEvidencePointer } from './evidence-store.mjs';

const pointerPath = process.argv[2];
if (!pointerPath || process.argv.length !== 3) {
  throw new Error('usage: node verify-evidence.mjs POINTER.json');
}

const result = await verifyEvidencePointer(pointerPath);
console.log(
  JSON.stringify({
    verified: true,
    head: result.head,
    pointerPath: result.pointerPath,
    evidenceKind: result.pointer.evidenceKind,
    contentSha256: result.pointer.artifactStore.contentSha256,
    rawSha256: result.pointer.raw.sha256,
    summarySha256: result.pointer.summary.sha256,
  }),
);
