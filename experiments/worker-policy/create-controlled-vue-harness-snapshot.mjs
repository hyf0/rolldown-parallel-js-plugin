import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { renameSync, writeFileSync } from 'node:fs';
import nodePath from 'node:path';
import { pathToFileURL } from 'node:url';

const REPOSITORY = 'github.com/rolldown/rolldown';
const ROOTS = Object.freeze([
  'examples/par-plugin/cases/vue-scale',
  'examples/par-plugin/parallel-vue-plugin',
]);
const EXPLICIT_FILES = Object.freeze([
  'examples/par-plugin/package.json',
  'pnpm-lock.yaml',
]);
const IGNORED_DIRECTORIES = new Set(['.corpus', '.results', 'evidence']);
const MANIFEST_ALGORITHM =
  'SHA-256 over UTF-8-sorted repository-relative path + NUL + kind + NUL + bytes + NUL + content SHA-256 + LF records';

export function createControlledVueHarnessSnapshot(repositoryPath, revision) {
  const repositoryRoot = nodePath.resolve(repositoryPath);
  const commit = git(repositoryRoot, [
    'rev-parse',
    '--verify',
    `${revision}^{commit}`,
  ])
    .toString('utf8')
    .trim();
  const objectFormat = git(repositoryRoot, [
    'rev-parse',
    '--show-object-format',
  ])
    .toString('utf8')
    .trim();
  if (objectFormat !== 'sha1') {
    throw new Error(
      `controlled Vue snapshots require SHA-1 Git objects, got ${objectFormat}`,
    );
  }
  const origin = normalizeRepository(
    git(repositoryRoot, ['remote', 'get-url', 'origin'])
      .toString('utf8')
      .trim(),
  );
  if (origin !== REPOSITORY) {
    throw new Error(
      `controlled Vue snapshot origin must be ${REPOSITORY}, got ${origin}`,
    );
  }

  const commitContent = git(repositoryRoot, ['cat-file', 'commit', commit]);
  const rootTreeOid = /^tree ([a-f0-9]{40})\n/.exec(
    commitContent.toString('utf8'),
  )?.[1];
  if (!rootTreeOid) {
    throw new Error(`controlled Vue commit ${commit} has no SHA-1 root tree`);
  }
  const { entries: treeEntries, treeObjects } = collectHarnessTreeProof(
    repositoryRoot,
    rootTreeOid,
  );
  const entries = treeEntries.sort((left, right) =>
    compareUtf8(left.path, right.path),
  );
  if (
    entries.length === 0 ||
    EXPLICIT_FILES.some(
      (requiredPath) => !entries.some(({ path }) => path === requiredPath),
    ) ||
    ROOTS.some(
      (root) => !entries.some(({ path }) => path.startsWith(`${root}/`)),
    )
  ) {
    throw new Error(`controlled Vue harness is incomplete at ${commit}`);
  }

  const blobs = entries.map(({ mode, type, oid, path }) => {
    if (type !== 'blob' || !['100644', '100755', '120000'].includes(mode)) {
      throw new Error(
        `unsupported controlled Vue tree entry ${mode} ${type} ${path}`,
      );
    }
    const content = git(repositoryRoot, ['cat-file', 'blob', oid]);
    return {
      path,
      kind: mode === '120000' ? 'symlink' : 'file',
      bytes: content.byteLength,
      sha256: sha256(content),
      gitBlobOid: oid,
      contentBase64: content.toString('base64'),
    };
  });
  const harnessSourceManifest = createManifest(
    blobs.map(({ path, kind, bytes, sha256: contentSha256 }) => ({
      path,
      kind,
      bytes,
      sha256: contentSha256,
    })),
  );
  return {
    schema: 1,
    kind: 'vue-controlled-harness-source-snapshot',
    repository: REPOSITORY,
    commit,
    gitObjectFormat: objectFormat,
    gitCommitObject: {
      oid: commit,
      contentBase64: commitContent.toString('base64'),
    },
    gitTreeObjects: [...treeObjects]
      .sort((left, right) => compareUtf8(left.oid, right.oid))
      .map(({ oid, content }) => ({
        oid,
        contentBase64: content.toString('base64'),
      })),
    harnessSourceManifest,
    blobs,
  };
}

export function writeControlledVueHarnessSnapshot(outputPath, snapshot) {
  const target = nodePath.resolve(outputPath);
  const temporary = `${target}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(snapshot, null, 2)}\n`);
  renameSync(temporary, target);
}

function collectHarnessTreeProof(repositoryRoot, rootTreeOid) {
  const treeObjects = new Map();
  const entries = [];
  const walk = (treeOid, prefix) => {
    let content = treeObjects.get(treeOid);
    if (!content) {
      content = git(repositoryRoot, ['cat-file', 'tree', treeOid]);
      treeObjects.set(treeOid, content);
    }
    for (const entry of parseTreeObject(content)) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.mode === '40000') {
        if (shouldTraverseHarnessDirectory(path)) walk(entry.oid, path);
      } else if (includedHarnessPath(path)) {
        entries.push({ ...entry, type: 'blob', path });
      }
    }
  };
  walk(rootTreeOid, '');
  return {
    entries,
    treeObjects: [...treeObjects].map(([oid, content]) => ({ oid, content })),
  };
}

function parseTreeObject(content) {
  const entries = [];
  let offset = 0;
  while (offset < content.length) {
    const space = content.indexOf(0x20, offset);
    const nul = content.indexOf(0, space + 1);
    if (space < 0 || nul < 0 || nul + 21 > content.length) {
      throw new Error('Git returned an invalid tree object');
    }
    const mode = content.subarray(offset, space).toString('ascii');
    const nameBytes = content.subarray(space + 1, nul);
    const name = nameBytes.toString('utf8');
    if (!Buffer.from(name).equals(nameBytes)) {
      throw new Error('controlled Vue harness contains a non-UTF-8 Git path');
    }
    entries.push({
      mode,
      name,
      oid: content.subarray(nul + 1, nul + 21).toString('hex'),
    });
    offset = nul + 21;
  }
  return entries;
}

function shouldTraverseHarnessDirectory(path) {
  if (path.split('/').some((component) => IGNORED_DIRECTORIES.has(component))) {
    return false;
  }
  return (
    ROOTS.some(
      (root) =>
        root === path ||
        root.startsWith(`${path}/`) ||
        path.startsWith(`${root}/`),
    ) || EXPLICIT_FILES.some((file) => file.startsWith(`${path}/`))
  );
}

function includedHarnessPath(path) {
  if (
    !ROOTS.some((root) => path === root || path.startsWith(`${root}/`)) &&
    !EXPLICIT_FILES.includes(path)
  ) {
    return false;
  }
  return !path
    .split('/')
    .some((component) => IGNORED_DIRECTORIES.has(component));
}

function createManifest(entries) {
  const aggregate = createHash('sha256');
  for (const entry of entries) {
    aggregate.update(entry.path);
    aggregate.update('\0');
    aggregate.update(entry.kind);
    aggregate.update('\0');
    aggregate.update(String(entry.bytes));
    aggregate.update('\0');
    aggregate.update(entry.sha256);
    aggregate.update('\n');
  }
  return {
    algorithm: MANIFEST_ALGORITHM,
    files: entries.length,
    bytes: entries.reduce((total, entry) => total + entry.bytes, 0),
    aggregateSha256: aggregate.digest('hex'),
    entries,
  };
}

function normalizeRepository(value) {
  return value
    .replace(/^git@github\.com:/, 'github.com/')
    .replace(/^ssh:\/\/git@github\.com\//, 'github.com/')
    .replace(/^https?:\/\/github\.com\//, 'github.com/')
    .replace(/\.git$/, '')
    .replace(/\/$/, '');
}

function git(repositoryRoot, arguments_) {
  return execFileSync('git', ['-C', repositoryRoot, ...arguments_], {
    encoding: 'buffer',
    maxBuffer: 128 * 1024 * 1024,
  });
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function compareUtf8(left, right) {
  return Buffer.from(left).compare(Buffer.from(right));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [, , repositoryPath, revision, outputPath] = process.argv;
  if (!repositoryPath || !revision || !outputPath) {
    throw new Error(
      'usage: node create-controlled-vue-harness-snapshot.mjs <rolldown-repository> <commit> <output.json>',
    );
  }
  writeControlledVueHarnessSnapshot(
    outputPath,
    createControlledVueHarnessSnapshot(repositoryPath, revision),
  );
}
