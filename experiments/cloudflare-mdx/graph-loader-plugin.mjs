import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, stat } from 'node:fs/promises';
import nodePath from 'node:path';
import { pathToFileURL } from 'node:url';
import './raw-jsonc-loader.mjs';
import {
  assetExtensions,
  graphBoundary,
  localResolutionExtensions,
} from './graph-config.mjs';

const JAVASCRIPT_TO_TYPESCRIPT = new Map([
  ['.js', ['.ts', '.tsx']],
  ['.jsx', ['.tsx', '.ts']],
  ['.mjs', ['.mts']],
  ['.cjs', ['.cts']],
]);

export async function createCloudflareGraphLoaderPlugin({ projectRoot }) {
  const root = nodePath.resolve(projectRoot);
  const compiler = await createAstroCompiler(root);
  const state = createState();

  const resolveLocal = async (source, importer) => {
    const { path: sourcePath, suffix } = splitId(source);
    const importerPath = importer ? splitId(importer).path : undefined;
    const bases = [];
    if (sourcePath.startsWith('~/')) {
      bases.push(nodePath.join(root, 'src', sourcePath.slice(2)));
    } else if (sourcePath === '~') {
      bases.push(nodePath.join(root, 'src'));
    } else if (sourcePath.startsWith('src/')) {
      bases.push(nodePath.join(root, sourcePath));
    } else if (sourcePath.startsWith('.')) {
      bases.push(
        nodePath.resolve(
          importerPath ? nodePath.dirname(importerPath) : root,
          sourcePath,
        ),
      );
    } else if (nodePath.isAbsolute(sourcePath)) {
      if (isInside(root, sourcePath)) bases.push(sourcePath);
      else {
        bases.push(nodePath.join(root, sourcePath.slice(1)));
        bases.push(nodePath.join(root, 'public', sourcePath.slice(1)));
      }
    } else {
      return undefined;
    }

    for (const base of bases) {
      const resolved = await resolveFile(base);
      if (!resolved) continue;
      if (!isInside(root, resolved)) {
        throw new Error(
          `Project-local edge escaped the Cloudflare root: ${source} from ${importer}`,
        );
      }
      return `${resolved}${suffix}`;
    }
    return undefined;
  };

  const resolveBaseUrlLocal = async (source) => {
    const { path: sourcePath, suffix } = splitId(source);
    if (
      !sourcePath.includes('/') ||
      sourcePath.startsWith('@') ||
      sourcePath.startsWith('#') ||
      /^[a-z][a-z+.-]*:/i.test(sourcePath)
    ) {
      return undefined;
    }
    const resolved = await resolveFile(nodePath.join(root, sourcePath));
    return resolved && isInside(root, resolved)
      ? `${resolved}${suffix}`
      : undefined;
  };

  const plugin = {
    name: 'cloudflare-mdx-server-graph',

    async resolveId(source, importer) {
      if (source.startsWith('\0')) return null;
      if (isLocalSpecifier(source)) {
        const resolved = await resolveLocal(source, importer);
        if (!resolved) {
          state.unresolvedLocalEdges++;
          throw new Error(
            `Unresolved project-local edge: ${source} from ${importer ?? '<entry>'}`,
          );
        }
        if (importer) state.resolvedLocalEdges++;
        state.resolvedLocalModules.add(normalizeId(resolved, root));
        return resolved;
      }

      const baseUrlResolved = await resolveBaseUrlLocal(source);
      if (baseUrlResolved) {
        if (importer) state.resolvedLocalEdges++;
        state.resolvedLocalModules.add(normalizeId(baseUrlResolved, root));
        return baseUrlResolved;
      }
      if (
        /^[a-z][a-z+.-]*:/i.test(source) &&
        !source.startsWith('astro:') &&
        !source.startsWith('node:')
      ) {
        throw new Error(
          `Unsupported non-package external edge: ${source} from ${importer ?? '<entry>'}`,
        );
      }
      recordExternal(state, source);
      return { id: source, external: true };
    },

    async load(id) {
      if (!isProjectId(id, root)) return null;
      const { path, suffix } = splitId(id);
      const extension = nodePath.extname(path).toLowerCase();

      if (hasRawQuery(suffix)) {
        const source = await readFile(path, 'utf8');
        state.rawLeafModules.add(normalizeId(id, root));
        state.rawLeafBytes += Buffer.byteLength(source);
        return {
          code: `export default ${JSON.stringify(source)};`,
          moduleType: 'js',
        };
      }

      if (extension === '.astro') {
        const source = await readFile(path, 'utf8');
        const result = await compiler.transform(source, path);
        const compilerError = result.diagnostics?.find(
          ({ severity }) => severity === 1,
        );
        if (compilerError) {
          const location = compilerError.location;
          const at = location ? `:${location.line}:${location.column}` : '';
          throw new Error(`${path}${at}: ${compilerError.text}`);
        }
        await recordAstroBoundary(
          state,
          result,
          source,
          id,
          path,
          root,
          resolveLocal,
        );
        return { code: result.code, map: result.map ?? null, moduleType: 'ts' };
      }

      if (extension === '.css') {
        const source = await readFile(path, 'utf8');
        state.cssLeafModules.add(normalizeId(id, root));
        state.cssLeafBytes += Buffer.byteLength(source);
        await recordCssReferences(state, source, path, root, resolveLocal);
        const publicId = `/${normalizeId(path, root)}`;
        return {
          code: `export default ${JSON.stringify(publicId)};`,
          moduleType: 'js',
        };
      }

      if (assetExtensions.has(extension)) {
        const source = await readFile(path);
        const publicId = `/${normalizeId(path, root)}`;
        state.assetLeafModules.add(normalizeId(id, root));
        state.assetLeafBytes += source.byteLength;
        return {
          code: `const src = ${JSON.stringify(publicId)}; export { src }; export default src;`,
          moduleType: 'js',
        };
      }

      if (
        extension === '.jsonc' ||
        extension === '.yaml' ||
        extension === '.yml' ||
        extension === '.txt'
      ) {
        const source = await readFile(path, 'utf8');
        state.dataLeafModules.add(normalizeId(id, root));
        state.dataLeafBytes += Buffer.byteLength(source);
        return {
          code: `export default ${JSON.stringify(source)};`,
          moduleType: 'js',
        };
      }

      return null;
    },

    transform(code, id) {
      if (isProjectId(id, root)) {
        state.code.set(normalizeId(id, root), sha256(code));
      }
      return null;
    },

    moduleParsed(info) {
      if (!isProjectId(info.id, root)) return;
      const id = normalizeId(info.id, root);
      const importedIds = [...info.importedIds]
        .map((value) => normalizeId(value, root))
        .sort();
      const dynamicallyImportedIds = [...info.dynamicallyImportedIds]
        .map((value) => normalizeId(value, root))
        .sort();
      state.graph.set(id, { id, importedIds, dynamicallyImportedIds });
      if (id.endsWith('.mdx') && info.meta?.astro) state.mdxAstroMetaModules++;
    },
  };

  return {
    plugin,
    report() {
      return createReport(state);
    },
  };
}

async function createAstroCompiler(projectRoot) {
  const projectRequire = createRequire(
    pathToFileURL(nodePath.join(projectRoot, 'package.json')),
  );
  const astroRequire = createRequire(
    projectRequire.resolve('astro/package.json'),
  );
  const [{ register }, { validateConfig }, { transform }] = await Promise.all([
    import(pathToFileURL(projectRequire.resolve('tsx/esm/api'))),
    import(pathToFileURL(projectRequire.resolve('astro/config'))),
    import(pathToFileURL(astroRequire.resolve('@astrojs/compiler'))),
  ]);
  register();
  const userConfig = (
    await import(
      pathToFileURL(nodePath.join(projectRoot, 'astro.config.ts')).href
    )
  ).default;
  const astroConfig = await validateConfig(userConfig, projectRoot, 'build');
  const normalizedRoot = normalizeSlashes(projectRoot).replace(/\/$/, '');

  return {
    async transform(source, filename) {
      const normalizedFilename = normalizeSlashes(filename);
      return transform(source, {
        compact: astroConfig.compressHTML,
        filename,
        normalizedFilename: normalizedFilename.startsWith(normalizedRoot)
          ? normalizedFilename.slice(normalizedRoot.length)
          : normalizedFilename,
        sourcemap: 'both',
        internalURL: 'astro/compiler-runtime',
        astroGlobalArgs: JSON.stringify(astroConfig.site),
        scopedStyleStrategy: astroConfig.scopedStyleStrategy,
        resultScopedSlot: true,
        transitionsAnimationURL: 'astro/components/viewtransitions.css',
        annotateSourceFile: false,
        async resolvePath(specifier) {
          if (!specifier.startsWith('.')) return specifier;
          const absolute = nodePath.resolve(
            nodePath.dirname(filename),
            specifier,
          );
          return (await resolveFile(absolute)) ?? absolute;
        },
      });
    },
  };
}

function createState() {
  return {
    resolvedLocalEdges: 0,
    unresolvedLocalEdges: 0,
    resolvedLocalModules: new Set(),
    externalEdges: 0,
    externalAstroEdges: 0,
    externalNodeEdges: 0,
    externalPackageEdges: 0,
    externalProtocolEdges: 0,
    externalSpecifiers: new Set(),
    rawLeafModules: new Set(),
    rawLeafBytes: 0,
    assetLeafModules: new Set(),
    assetLeafBytes: 0,
    cssLeafModules: new Set(),
    cssLeafBytes: 0,
    dataLeafModules: new Set(),
    dataLeafBytes: 0,
    astroModuleInstances: new Set(),
    astroSourceFiles: new Set(),
    astroSourceBytes: 0,
    astroOutputBytes: 0,
    astroCssBlocks: 0,
    astroCssBytes: 0,
    cssDependencyReferences: 0,
    cssLocalDependencyReferences: 0,
    cssExternalDependencyReferences: 0,
    cssLocalDependencies: new Set(),
    astroClientScriptBlocks: 0,
    astroInlineClientScriptBlocks: 0,
    astroExternalClientScriptBlocks: 0,
    astroInlineClientScriptBytes: 0,
    astroInlineClientScriptImportEdges: 0,
    astroClientSpecifierEdges: 0,
    astroClientLocalImportEdges: 0,
    astroClientExternalImportEdges: 0,
    astroClientLocalModules: new Set(),
    astroClientExternalSpecifiers: new Set(),
    hydratedComponents: 0,
    clientOnlyComponents: 0,
    serverComponents: 0,
    code: new Map(),
    graph: new Map(),
    mdxAstroMetaModules: 0,
  };
}

async function recordAstroBoundary(
  state,
  result,
  source,
  id,
  filename,
  root,
  resolveLocal,
) {
  state.astroModuleInstances.add(normalizeId(id, root));
  state.astroSourceFiles.add(normalizeId(filename, root));
  state.astroSourceBytes += Buffer.byteLength(source);
  state.astroOutputBytes += Buffer.byteLength(result.code);
  state.hydratedComponents += result.hydratedComponents?.length ?? 0;
  state.clientOnlyComponents += result.clientOnlyComponents?.length ?? 0;
  state.serverComponents += result.serverComponents?.length ?? 0;

  for (const css of result.css ?? []) {
    state.astroCssBlocks++;
    state.astroCssBytes += Buffer.byteLength(css);
    await recordCssReferences(state, css, filename, root, resolveLocal);
  }

  for (const script of result.scripts ?? []) {
    state.astroClientScriptBlocks++;
    if (script.type === 'external') {
      state.astroExternalClientScriptBlocks++;
      if (script.src)
        await recordClientSpecifier(
          state,
          script.src,
          filename,
          root,
          resolveLocal,
        );
      continue;
    }
    state.astroInlineClientScriptBlocks++;
    state.astroInlineClientScriptBytes += Buffer.byteLength(script.code ?? '');
    for (const specifier of extractJavaScriptImports(script.code ?? '')) {
      state.astroInlineClientScriptImportEdges++;
      await recordClientSpecifier(
        state,
        specifier,
        filename,
        root,
        resolveLocal,
      );
    }
  }
}

async function recordClientSpecifier(
  state,
  specifier,
  importer,
  root,
  resolveLocal,
) {
  state.astroClientSpecifierEdges++;
  if (isLocalSpecifier(specifier)) {
    const resolved = await resolveLocal(specifier, importer);
    if (!resolved)
      throw new Error(
        `Unresolved excluded Astro client edge: ${specifier} from ${importer}`,
      );
    state.astroClientLocalImportEdges++;
    state.astroClientLocalModules.add(normalizeId(resolved, root));
  } else {
    state.astroClientExternalImportEdges++;
    state.astroClientExternalSpecifiers.add(specifier);
  }
}

async function recordCssReferences(state, css, importer, root, resolveLocal) {
  for (const specifier of extractCssReferences(css)) {
    state.cssDependencyReferences++;
    if (isCssLocalSpecifier(specifier)) {
      const resolved = await resolveLocal(specifier, importer);
      if (!resolved)
        throw new Error(
          `Unresolved excluded CSS edge: ${specifier} from ${importer}`,
        );
      state.cssLocalDependencyReferences++;
      state.cssLocalDependencies.add(normalizeId(resolved, root));
    } else {
      state.cssExternalDependencyReferences++;
    }
  }
}

function recordExternal(state, source) {
  state.externalEdges++;
  state.externalSpecifiers.add(source);
  if (
    source.startsWith('astro:') ||
    source.startsWith('astro/') ||
    source.startsWith('@astrojs/')
  ) {
    state.externalAstroEdges++;
  } else if (source.startsWith('node:')) {
    state.externalNodeEdges++;
  } else if (/^[a-z][a-z+.-]*:/i.test(source)) {
    state.externalProtocolEdges++;
  } else {
    state.externalPackageEdges++;
  }
}

function createReport(state) {
  const code = [...state.code].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const graph = [...state.graph.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const graphIds = new Set(graph.map(({ id }) => id));
  const externalIds = state.externalSpecifiers;
  const codeIds = new Set(code.map(([id]) => id));
  const codeOnlyModules = [...codeIds].filter((id) => !graphIds.has(id)).sort();
  const graphWithoutObservedCode = [...graphIds]
    .filter((id) => !codeIds.has(id))
    .sort();
  const moduleKindCounts = {};
  const nonProjectInternalIds = new Set();
  for (const { id } of graph) {
    const kind = moduleKind(id);
    moduleKindCounts[kind] = (moduleKindCounts[kind] ?? 0) + 1;
  }
  for (const item of graph) {
    for (const id of item.importedIds) {
      if (!graphIds.has(id) && !externalIds.has(id))
        nonProjectInternalIds.add(id);
    }
  }
  const boundary = {
    definition: graphBoundary,
    localResolutionCalls: state.resolvedLocalEdges,
    unresolvedLocalEdges: state.unresolvedLocalEdges,
    resolvedLocalModuleCount: state.resolvedLocalModules.size,
    externalResolutionCalls: state.externalEdges,
    externalAstroResolutionCalls: state.externalAstroEdges,
    externalNodeResolutionCalls: state.externalNodeEdges,
    externalPackageResolutionCalls: state.externalPackageEdges,
    externalProtocolResolutionCalls: state.externalProtocolEdges,
    externalSpecifiers: [...state.externalSpecifiers].sort(),
    rawLeafModules: state.rawLeafModules.size,
    rawLeafBytes: state.rawLeafBytes,
    assetLeafModules: state.assetLeafModules.size,
    assetLeafBytes: state.assetLeafBytes,
    cssLeafModules: state.cssLeafModules.size,
    cssLeafBytes: state.cssLeafBytes,
    dataLeafModules: state.dataLeafModules.size,
    dataLeafBytes: state.dataLeafBytes,
    astroModuleInstances: state.astroModuleInstances.size,
    astroSourceFiles: state.astroSourceFiles.size,
    astroCompiledSourceBytes: state.astroSourceBytes,
    astroCompiledOutputBytes: state.astroOutputBytes,
    omittedAstroCssBlocks: state.astroCssBlocks,
    omittedAstroCssBytes: state.astroCssBytes,
    omittedCssDependencyReferences: state.cssDependencyReferences,
    omittedCssLocalDependencyReferences: state.cssLocalDependencyReferences,
    omittedCssExternalDependencyReferences:
      state.cssExternalDependencyReferences,
    omittedCssLocalDependencies: [...state.cssLocalDependencies].sort(),
    omittedAstroClientScriptBlocks: state.astroClientScriptBlocks,
    omittedAstroInlineClientScriptBlocks: state.astroInlineClientScriptBlocks,
    omittedAstroExternalClientScriptBlocks:
      state.astroExternalClientScriptBlocks,
    omittedAstroInlineClientScriptBytes: state.astroInlineClientScriptBytes,
    omittedAstroInlineClientScriptImportEdges:
      state.astroInlineClientScriptImportEdges,
    omittedAstroClientSpecifierEdges: state.astroClientSpecifierEdges,
    omittedAstroClientLocalImportEdges: state.astroClientLocalImportEdges,
    omittedAstroClientExternalImportEdges: state.astroClientExternalImportEdges,
    omittedAstroClientLocalModules: [...state.astroClientLocalModules].sort(),
    omittedAstroClientExternalSpecifiers: [
      ...state.astroClientExternalSpecifiers,
    ].sort(),
    omittedHydratedComponents: state.hydratedComponents,
    omittedClientOnlyComponents: state.clientOnlyComponents,
    omittedServerComponents: state.serverComponents,
  };
  return {
    codeModuleCount: code.length,
    codeHash: sha256(JSON.stringify(code)),
    codeOnlyModules,
    graphWithoutObservedCode,
    graphModuleCount: graph.length,
    graphStaticEdges: graph.reduce(
      (sum, item) => sum + item.importedIds.length,
      0,
    ),
    graphDynamicEdges: graph.reduce(
      (sum, item) => sum + item.dynamicallyImportedIds.length,
      0,
    ),
    graphProjectStaticEdges: graph.reduce(
      (sum, item) =>
        sum + item.importedIds.filter((id) => graphIds.has(id)).length,
      0,
    ),
    graphExternalStaticEdges: graph.reduce(
      (sum, item) =>
        sum + item.importedIds.filter((id) => externalIds.has(id)).length,
      0,
    ),
    graphNonProjectInternalStaticEdges: graph.reduce(
      (sum, item) =>
        sum +
        item.importedIds.filter(
          (id) => !graphIds.has(id) && !externalIds.has(id),
        ).length,
      0,
    ),
    graphNonProjectInternalIds: [...nonProjectInternalIds].sort(),
    graphHash: sha256(JSON.stringify(graph)),
    moduleKindCounts: Object.fromEntries(
      Object.entries(moduleKindCounts).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    mdxAstroMetaModules: state.mdxAstroMetaModules,
    boundaryHash: sha256(JSON.stringify(boundary)),
    boundary,
  };
}

async function resolveFile(base) {
  const candidates = [base];
  const extension = nodePath.extname(base).toLowerCase();
  for (const replacement of JAVASCRIPT_TO_TYPESCRIPT.get(extension) ?? []) {
    candidates.push(base.slice(0, -extension.length) + replacement);
  }
  if (!extension) {
    for (const candidateExtension of localResolutionExtensions) {
      candidates.push(`${base}${candidateExtension}`);
    }
  }
  for (const candidate of candidates) {
    if (await isFile(candidate)) return candidate;
  }
  if (await isDirectory(base)) {
    for (const candidateExtension of localResolutionExtensions) {
      const candidate = nodePath.join(base, `index${candidateExtension}`);
      if (await isFile(candidate)) return candidate;
    }
  }
  return undefined;
}

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function isLocalSpecifier(source) {
  const { path } = splitId(source);
  return (
    path === '~' ||
    path.startsWith('~/') ||
    path.startsWith('.') ||
    path.startsWith('src/') ||
    nodePath.isAbsolute(path)
  );
}

function isCssLocalSpecifier(source) {
  return (
    isLocalSpecifier(source) &&
    !source.startsWith('#') &&
    !source.startsWith('data:') &&
    !source.startsWith('http:') &&
    !source.startsWith('https:') &&
    !source.startsWith('var(')
  );
}

function isProjectId(id, root) {
  return isInside(root, splitId(id).path);
}

function isInside(root, path) {
  if (!nodePath.isAbsolute(path)) return false;
  const relative = nodePath.relative(root, path);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !nodePath.isAbsolute(relative))
  );
}

function splitId(id) {
  const query = id.indexOf('?');
  const hash = id.indexOf('#');
  const index =
    query === -1 ? hash : hash === -1 ? query : Math.min(query, hash);
  return index === -1
    ? { path: id, suffix: '' }
    : { path: id.slice(0, index), suffix: id.slice(index) };
}

function hasRawQuery(suffix) {
  return /(?:^\?|&)raw(?:[=&]|$)/.test(suffix);
}

function normalizeId(id, root) {
  const { path, suffix } = splitId(id);
  if (!isInside(root, path)) return id;
  return `${normalizeSlashes(nodePath.relative(root, path))}${suffix}`;
}

function normalizeSlashes(value) {
  return value.split(nodePath.sep).join('/');
}

function extractJavaScriptImports(code) {
  const imports = [];
  const pattern =
    /\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of code.matchAll(pattern))
    imports.push(match[1] ?? match[2]);
  return imports;
}

function extractCssReferences(css) {
  const references = [];
  const pattern =
    /@import\s+(?:url\(\s*)?["']?([^\s"')]+)|url\(\s*["']?([^\s"')]+)["']?\s*\)/g;
  for (const match of css.matchAll(pattern))
    references.push(match[1] ?? match[2]);
  return references;
}

function moduleKind(id) {
  const { path, suffix } = splitId(id);
  if (hasRawQuery(suffix)) return 'raw';
  const extension = nodePath.extname(path).toLowerCase();
  if (assetExtensions.has(extension)) return 'asset';
  if (extension === '.astro') return 'astro';
  if (extension === '.mdx') return 'mdx';
  if (extension === '.css') return 'css';
  if (
    extension === '.json' ||
    extension === '.jsonc' ||
    extension === '.yaml' ||
    extension === '.yml'
  ) {
    return 'data';
  }
  if (
    ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'].includes(
      extension,
    )
  ) {
    return 'javascript';
  }
  return extension || 'unknown';
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
