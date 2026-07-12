import { writeFile } from 'node:fs/promises';
import nodePath from 'node:path';
import {
  SCALE_MANIFEST_FILE,
  prepareScaleManifest,
} from './scale-corpus.mjs';

if (!process.argv[2]) throw new Error('Expected a Cloudflare Docs project root');
const projectRoot = nodePath.resolve(process.argv[2]);
const outputPath = process.argv[3]
  ? nodePath.resolve(process.argv[3])
  : SCALE_MANIFEST_FILE;
const manifest = await prepareScaleManifest(projectRoot);
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  JSON.stringify({
    outputPath,
    algorithm: manifest.algorithm,
    sources: manifest.entries.length,
    fullSelectionSha256: manifest.fullSelectionSha256,
  }),
);
