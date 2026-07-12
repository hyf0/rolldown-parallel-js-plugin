import nodePath from 'node:path';
import { createAttributionSummaryFile } from './evidence-store.mjs';

const [rawPath, summaryPath] = process.argv.slice(2);
if (!rawPath || !summaryPath) {
  throw new Error('usage: node create-attribution-summary.mjs RAW.json SUMMARY.json');
}

const result = await createAttributionSummaryFile(rawPath, summaryPath);
console.log(
  JSON.stringify({
    rawPath: nodePath.resolve(rawPath),
    summaryPath: nodePath.resolve(summaryPath),
    raw: result.rawArtifact,
    variants: result.summary.variants.map(({ variant }) => variant),
  }),
);
