import { readFile, writeFile } from 'node:fs/promises';
import nodePath from 'node:path';

const [outputArgument, ...inputArguments] = process.argv.slice(2);
if (!outputArgument || inputArguments.length < 2) {
  throw new Error('Usage: node merge-matrix-reports.mjs <output> <input> <input> [...]');
}
const outputPath = nodePath.resolve(outputArgument);
const reports = await Promise.all(
  inputArguments.map(async (path) =>
    JSON.parse(await readFile(nodePath.resolve(path), 'utf8')),
  ),
);
const first = reports[0];
const executionScopes = new Set(
  reports.map((report) => report.executionScope ?? 'unrecorded'),
);
if (executionScopes.size !== 1) {
  throw new Error(
    `Matrix reports used different execution scopes: ${[...executionScopes].join(', ')}`,
  );
}
for (const report of reports.slice(1)) {
  if (report.node !== first.node || report.nodeBinary !== first.nodeBinary) {
    throw new Error('Matrix reports used different Node runtimes');
  }
  const firstCases = first.matrix.cases.map(
    ({ startIndex: _start, repeats: _repeats, warmups: _warmups, ...value }) => value,
  );
  const currentCases = report.matrix.cases.map(
    ({ startIndex: _start, repeats: _repeats, warmups: _warmups, ...value }) => value,
  );
  if (JSON.stringify(currentCases) !== JSON.stringify(firstCases)) {
    throw new Error('Matrix reports used different case definitions');
  }
}
const runs = reports
  .flatMap((report) => report.runs)
  .sort(
    (left, right) =>
      left.name.localeCompare(right.name) ||
      left.index - right.index ||
      left.sequence - right.sequence,
  );
for (const name of new Set(runs.map((run) => run.name))) {
  const selected = runs.filter((run) => run.name === name);
  for (const index of new Set(selected.map((run) => run.index))) {
    const variants = selected.filter((run) => run.index === index).map((run) => run.variant);
    if (new Set(variants).size !== variants.length) {
      throw new Error(`${name} block ${index} contains duplicate variants`);
    }
  }
}
const merged = {
  schema: 1,
  kind: 'merged-matrix-reports',
  executionScope: [...executionScopes][0],
  startedAt: reports[0].startedAt,
  finishedAt: reports.at(-1).finishedAt,
  node: first.node,
  nodeBinary: first.nodeBinary,
  host: first.host,
  matrix: first.matrix,
  sourceReports: inputArguments.map((path, index) => ({
    path: nodePath.resolve(path),
    startedAt: reports[index].startedAt,
    finishedAt: reports[index].finishedAt,
    executionScope: reports[index].executionScope ?? 'unrecorded',
    runner: reports[index].runner ?? null,
    caseRunner: reports[index].caseRunner ?? null,
    environment: reports[index].environment ?? null,
    host: reports[index].host,
    hostPolicyViolations: reports[index].hostPolicyViolations,
  })),
  hostPolicyViolations: reports.flatMap((report) => report.hostPolicyViolations ?? []),
  validationErrors: reports.flatMap((report) => report.validationErrors ?? []),
  rawOutputDifferences: reports.flatMap((report) => report.rawOutputDifferences ?? []),
  runs,
};
await writeFile(outputPath, `${JSON.stringify(merged, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, reports: reports.length, runs: runs.length }));
