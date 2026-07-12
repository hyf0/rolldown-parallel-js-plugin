import nodePath from 'node:path';
import { promoteEvidence } from './evidence-store.mjs';

const options = parseArguments(process.argv.slice(2));
const result = await promoteEvidence(options);
console.log(
  JSON.stringify({
    alreadyPresent: result.alreadyPresent,
    pointerPath: result.pointerPath,
    pointerRelativePath: nodePath
      .relative(result.repoRoot, result.pointerPath)
      .split(nodePath.sep)
      .join('/'),
    contentSha256: result.pointer.artifactStore.contentSha256,
    raw: result.pointer.raw,
    summary: result.pointer.summary,
  }),
);

function parseArguments(arguments_) {
  const value = { kind: undefined, rawPath: undefined, summaryPath: undefined };
  while (arguments_.length > 0) {
    const option = arguments_.shift();
    if (option === '--kind') value.kind = requiredValue(arguments_, option);
    else if (option === '--raw') value.rawPath = requiredValue(arguments_, option);
    else if (option === '--summary') value.summaryPath = requiredValue(arguments_, option);
    else throw new Error(`unknown option: ${option}`);
  }
  if (!value.kind || !value.rawPath || !value.summaryPath) {
    throw new Error(
      'usage: node promote-evidence.mjs --kind <initialization|attribution> --raw RAW.json --summary SUMMARY.json',
    );
  }
  return value;
}

function requiredValue(arguments_, option) {
  const value = arguments_.shift();
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
  return value;
}
