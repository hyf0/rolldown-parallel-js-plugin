import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, readdir, realpath } from 'node:fs/promises';
import nodePath from 'node:path';
import { pathToFileURL } from 'node:url';

const PACKAGE_REQUESTS = Object.freeze([
  { name: '@astrojs/mdx', from: 'project' },
  { name: '@mdx-js/mdx', from: '@astrojs/mdx' },
  { name: '@astrojs/markdown-remark', from: 'project' },
  { name: 'astro', from: 'project' },
  { name: '@astrojs/compiler', from: 'astro' },
  { name: 'tsx', from: 'project' },
]);

export const EXPECTED_COMPILER_ENVIRONMENT = Object.freeze({
  schema: 1,
  node: 'v24.18.0',
  installedBy: 'pnpm@11.12.0',
  projectFiles: {
    'package.json': '9109282fc31d22ca3391f480cc993df5be41b834457f6ea04c0356320c205812',
    'pnpm-lock.yaml': 'f908eb3dab7cd3346887a6a6cc9b26c8f49015d891900612eb69b5bd94829e7c',
    'pnpm-workspace.yaml': '456b838b834f7ee2d60d0835d099b94c0d205180869d188048d7327005b25dec',
    'node_modules/.modules.yaml':
      '60f64721c5cacfa8ec58d148e21b96a57096f3051cfd2ec6675e13bd3324edcd',
  },
  packages: [
    {
      name: '@astrojs/mdx',
      version: '6.0.3',
      treeSha256: 'd285e9789d38b57ad2032056479becbe9c99199a530939e3ed3a77fcf0fdd30a',
    },
    {
      name: '@mdx-js/mdx',
      version: '3.1.1',
      treeSha256: 'cb7ceda2117e895ea5c3edb4b653fe98cc0ea073e84f1696def46f58c4c6f3bd',
    },
    {
      name: '@astrojs/markdown-remark',
      version: '7.2.0',
      treeSha256: '6d5c17aea60bbd693c3decfbd87979e416ae5a5158a2f3d3dff12caee7175e34',
    },
    {
      name: 'astro',
      version: '6.4.7',
      treeSha256: '01963858fd74530b7c506612d986fcc9dcead02192059656a1515e46316bd7cc',
    },
    {
      name: '@astrojs/compiler',
      version: '4.0.0',
      treeSha256: '29cc6b785e8cf5ffabe9bebfd4092113e742ee16c7d20434cc6fd4f123c930f4',
    },
    {
      name: 'tsx',
      version: '4.22.4',
      treeSha256: 'c0034f2c67037e35d8489f568c171e9c48256e47243ddb8b5fa77980e9643f1e',
    },
  ],
  dependencyClosure: {
    schema: 1,
    roots: [
      '@astrojs/compiler@4.0.0:29cc6b785e8cf5ffabe9bebfd4092113e742ee16c7d20434cc6fd4f123c930f4',
      '@astrojs/markdown-remark@7.2.0:6d5c17aea60bbd693c3decfbd87979e416ae5a5158a2f3d3dff12caee7175e34',
      '@astrojs/mdx@6.0.3:d285e9789d38b57ad2032056479becbe9c99199a530939e3ed3a77fcf0fdd30a',
      '@mdx-js/mdx@3.1.1:cb7ceda2117e895ea5c3edb4b653fe98cc0ea073e84f1696def46f58c4c6f3bd',
      'astro@6.4.7:01963858fd74530b7c506612d986fcc9dcead02192059656a1515e46316bd7cc',
      'tsx@4.22.4:c0034f2c67037e35d8489f568c171e9c48256e47243ddb8b5fa77980e9643f1e',
    ],
    packageCount: 309,
    edgeCount: 760,
    selectionSha256: '3161bd51e7644136252a45c09b4c79e5a7abda901ce0c5e3f101f1c4abf3eeec',
  },
});

export async function captureCompilerEnvironment(projectRoot) {
  const root = nodePath.resolve(projectRoot);
  const projectRequire = createRequire(pathToFileURL(nodePath.join(root, 'package.json')));
  const packageRoots = new Map();
  const packages = [];
  for (const request of PACKAGE_REQUESTS) {
    const resolver =
      request.from === 'project'
        ? projectRequire
        : createRequire(pathToFileURL(nodePath.join(packageRoots.get(request.from), 'package.json')));
    const packageRoot = await resolvePackageRoot(resolver, request.name);
    packageRoots.set(request.name, packageRoot);
    const manifest = JSON.parse(await readFile(nodePath.join(packageRoot, 'package.json'), 'utf8'));
    packages.push({
      name: request.name,
      version: manifest.version,
      treeSha256: await hashPackageTree(packageRoot),
    });
  }
  const modulesYaml = await readFile(nodePath.join(root, 'node_modules/.modules.yaml'));
  const installedBy = modulesYaml
    .toString('utf8')
    .match(/^\s*"packageManager":\s*"([^"]+)"\s*,?\s*$/m)?.[1];
  if (!installedBy) throw new Error('Installed pnpm package-manager version is missing');
  return {
    schema: 1,
    node: process.version,
    installedBy,
    projectFiles: Object.fromEntries(
      await Promise.all(
        Object.keys(EXPECTED_COMPILER_ENVIRONMENT.projectFiles).map(async (relativePath) => [
          relativePath,
          sha256(await readFile(nodePath.join(root, relativePath))),
        ]),
      ),
    ),
    packages,
    dependencyClosure: await captureDependencyClosure([...new Set(packageRoots.values())]),
  };
}

export async function requirePinnedCompilerEnvironment(projectRoot) {
  const actual = await captureCompilerEnvironment(projectRoot);
  if (JSON.stringify(actual) !== JSON.stringify(EXPECTED_COMPILER_ENVIRONMENT)) {
    throw new Error(`Compiler environment differs from the frozen pin: ${JSON.stringify(actual)}`);
  }
  return actual;
}

export async function captureHarnessSourceManifest() {
  const files = [];
  for (const entry of await readdir(import.meta.dirname, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.mjs')) files.push(entry.name);
  }
  files.push(
    'astro-mdx-counter.patch',
    'fixtures/invalid-diagnostic.mdx',
    'data/cloudflare-mdx-scale-v1.json',
  );
  files.sort(compareUtf8);
  const entries = [];
  const selection = createHash('sha256');
  for (const relativePath of files) {
    const source = await readFile(nodePath.join(import.meta.dirname, relativePath));
    const sourceSha256 = sha256(source);
    entries.push({ relativePath, bytes: source.byteLength, sourceSha256 });
    selection.update(relativePath);
    selection.update('\0');
    selection.update(String(source.byteLength));
    selection.update('\0');
    selection.update(sourceSha256);
    selection.update('\n');
  }
  return {
    schema: 1,
    recordFormat: 'relativePath + NUL + bytes + NUL + sourceSha256 + LF',
    sourceCount: entries.length,
    selectionSha256: selection.digest('hex'),
    entries,
  };
}

async function resolvePackageRoot(resolver, name) {
  let resolved;
  try {
    resolved = resolver.resolve(`${name}/package.json`);
  } catch {
    resolved = resolver.resolve(name);
  }
  let directory = nodePath.dirname(await realpath(resolved));
  while (directory !== nodePath.dirname(directory)) {
    try {
      const manifest = JSON.parse(await readFile(nodePath.join(directory, 'package.json'), 'utf8'));
      if (manifest.name === name) return directory;
    } catch {
      // Continue to the package root.
    }
    directory = nodePath.dirname(directory);
  }
  throw new Error(`Could not locate package root for ${name} from ${resolved}`);
}

async function hashPackageTree(root) {
  const files = await listPackageFiles(root);
  const hash = createHash('sha256');
  for (const path of files) {
    const relativePath = nodePath.relative(root, path).split(nodePath.sep).join('/');
    hash.update(relativePath);
    hash.update('\0');
    hash.update(await readFile(path));
    hash.update('\0');
  }
  return hash.digest('hex');
}

async function captureDependencyClosure(rootDirectories) {
  const nodes = new Map();
  const queue = [...rootDirectories];
  while (queue.length > 0) {
    const root = queue.shift();
    if (nodes.has(root)) continue;
    const manifest = JSON.parse(await readFile(nodePath.join(root, 'package.json'), 'utf8'));
    const resolver = createRequire(pathToFileURL(nodePath.join(root, 'package.json')));
    const dependencies = [];
    const specifiers = Object.keys({
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
      ...manifest.peerDependencies,
    }).sort(compareUtf8);
    for (const specifier of specifiers) {
      let dependencyRoot;
      try {
        dependencyRoot = await resolvePackageRoot(resolver, specifier);
      } catch {
        continue;
      }
      const dependencyManifest = JSON.parse(
        await readFile(nodePath.join(dependencyRoot, 'package.json'), 'utf8'),
      );
      dependencies.push({
        specifier,
        name: dependencyManifest.name,
        version: dependencyManifest.version,
        root: dependencyRoot,
      });
      queue.push(dependencyRoot);
    }
    nodes.set(root, {
      name: manifest.name,
      version: manifest.version,
      treeSha256: await hashPackageTree(root),
      dependencies,
    });
  }
  const records = [...nodes.values()]
    .map((node) => ({
      name: node.name,
      version: node.version,
      treeSha256: node.treeSha256,
      dependencies: node.dependencies
        .map(({ specifier, root }) => {
          const target = nodes.get(root);
          return {
            specifier,
            name: target.name,
            version: target.version,
            treeSha256: target.treeSha256,
          };
        })
        .sort((left, right) => compareUtf8(JSON.stringify(left), JSON.stringify(right))),
    }))
    .sort((left, right) => compareUtf8(JSON.stringify(left), JSON.stringify(right)));
  const selection = createHash('sha256');
  for (const record of records) {
    selection.update(JSON.stringify(record));
    selection.update('\n');
  }
  const roots = rootDirectories
    .map((root) => {
      const node = nodes.get(root);
      return `${node.name}@${node.version}:${node.treeSha256}`;
    })
    .sort(compareUtf8);
  return {
    schema: 1,
    roots,
    packageCount: records.length,
    edgeCount: records.reduce((sum, { dependencies }) => sum + dependencies.length, 0),
    selectionSha256: selection.digest('hex'),
  };
}

async function listPackageFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const path = nodePath.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listPackageFiles(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort(compareUtf8);
}

function compareUtf8(left, right) {
  return Buffer.from(left).compare(Buffer.from(right));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
