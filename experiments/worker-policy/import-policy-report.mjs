import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import nodePath from 'node:path';

assertExactNode();
const sourcePath = process.argv[2];
if (!sourcePath)
  throw new Error('usage: node import-policy-report.mjs SOURCE.json');
const bytes = await readFile(nodePath.resolve(sourcePath));
JSON.parse(bytes);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const dataRoot = nodePath.join(import.meta.dirname, 'data');
const outputPath = nodePath.join(
  dataRoot,
  'reports',
  'sha256',
  `${sha256}.json`,
);
await mkdir(nodePath.dirname(outputPath), { recursive: true });
let existing;
try {
  existing = await readFile(outputPath);
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
if (existing && !existing.equals(bytes)) {
  throw new Error(`content-address collision at ${outputPath}`);
}
if (!existing) await writeFile(outputPath, bytes);
console.log(
  JSON.stringify({
    sourcePath: nodePath.resolve(sourcePath),
    path: nodePath.relative(dataRoot, outputPath).split(nodePath.sep).join('/'),
    sha256,
    bytes: bytes.byteLength,
    alreadyPresent: Boolean(existing),
  }),
);

function assertExactNode() {
  if (process.version !== 'v24.18.0') {
    throw new Error(
      `fixed-policy artifacts require Node.js v24.18.0, got ${process.version}`,
    );
  }
}
