import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import nodePath from 'node:path';
import { spawnSync } from 'node:child_process';

export const SCALE_ALGORITHM = 'cloudflare-mdx-scale-v1';
export const SCALE_MANIFEST_FILE = nodePath.join(
  import.meta.dirname,
  'data/cloudflare-mdx-scale-v1.json',
);
export const EXPECTED_PROJECT_COMMIT =
  '2b08a67a41da1a521aecbcf465893abae1e9a6df';
export const EXPECTED_SOURCE_MANIFEST_SHA256 =
  '84077a08f660782274d5502be25f0ec9297cec9c52508e2c5e9e2a3e8bedc12b';
export const BASE_SCALES = Object.freeze([
  32, 128, 256, 512, 1_024, 2_048, 4_096, 9_157,
]);
export const REFINEMENT_SCALES = Object.freeze([
  64, 96, 160, 192, 224, 320, 384, 448, 640, 768, 896, 1_280,
  1_536, 1_792, 2_560, 3_072, 3_584, 5_120, 6_144, 7_168, 8_192,
]);
export const FROZEN_SCALES = Object.freeze(
  [...new Set([...BASE_SCALES, ...REFINEMENT_SCALES])].sort((left, right) => left - right),
);

const COLLECTION_ORDER = Object.freeze(['docs', 'partials', 'changelog']);
const FEATURE_ORDER = Object.freeze([
  'playground',
  'mermaid',
  'fence-5+',
  'fence-2-4',
  'fence-1',
  'fence-0',
]);
const COMPATIBILITY_PATH = 'src/content/compatibility-flags/nodejs-compat.mdx';
const PREFIX_RECORD_FORMAT = 'relativePath + NUL + sourceSha256 + NUL + bytes + LF';

export async function prepareScaleManifest(projectRoot) {
  const root = nodePath.resolve(projectRoot);
  if (!root) throw new Error('Expected a Cloudflare Docs project root');
  const commit = git(root, ['rev-parse', 'HEAD']);
  const status = git(root, ['status', '--short']);
  if (commit !== EXPECTED_PROJECT_COMMIT || status !== '') {
    throw new Error(`Cloudflare source is not the clean pin: ${commit}\n${status}`);
  }

  const paths = await listMdxFiles(nodePath.join(root, 'src/content'));
  const sourceManifestHash = createHash('sha256');
  const analyzed = [];
  for (const absolutePath of paths) {
    const source = await readFile(absolutePath);
    const relativePath = toPosix(nodePath.relative(root, absolutePath));
    sourceManifestHash.update(relativePath);
    sourceManifestHash.update('\0');
    sourceManifestHash.update(source);
    sourceManifestHash.update('\0');
    analyzed.push(analyzeSource(relativePath, source));
  }
  const sourceManifestSha256 = sourceManifestHash.digest('hex');
  if (sourceManifestSha256 !== EXPECTED_SOURCE_MANIFEST_SHA256) {
    throw new Error(`Cloudflare MDX source manifest changed: ${sourceManifestSha256}`);
  }
  if (analyzed.length !== 9_157) {
    throw new Error(`Expected 9,157 production MDX sources, got ${analyzed.length}`);
  }

  const compatibility = analyzed.filter(({ collection }) => collection === 'compatibility');
  if (
    compatibility.length !== 1 ||
    compatibility[0].relativePath !== COMPATIBILITY_PATH
  ) {
    throw new Error(`Unexpected compatibility anchor: ${JSON.stringify(compatibility)}`);
  }
  const remaining = analyzed.filter(({ collection }) => collection !== 'compatibility');
  assignByteBands(remaining);
  const ordered = [compatibility[0], ...deficitRoundRobinOrder(remaining)];
  const prefixPoints = Object.fromEntries(
    FROZEN_SCALES.map((scale) => [String(scale), summarizePrefix(ordered, scale)]),
  );
  const selectionSha256 = hashSelectionRecords(ordered);
  const playgroundSources = ordered
    .filter(({ hasPlayground }) => hasPlayground)
    .map(({ relativePath }) => relativePath)
    .sort(compareUtf8);
  const docsMermaidSource = ordered
    .filter(({ collection, hasMermaid }) => collection === 'docs' && hasMermaid)
    .map(({ relativePath }) => relativePath)
    .sort(compareUtf8)[0];
  const partialsMermaidSource = ordered
    .filter(({ collection, hasMermaid }) => collection === 'partials' && hasMermaid)
    .map(({ relativePath }) => relativePath)
    .sort(compareUtf8)[0];
  if (playgroundSources.length !== 6 || !docsMermaidSource || !partialsMermaidSource) {
    throw new Error('Rare-syntax sentinel sources did not match the frozen corpus expectations');
  }

  return {
    schema: 1,
    algorithm: SCALE_ALGORITHM,
    algorithmDescription: {
      compatibilityAnchor: COMPATIBILITY_PATH,
      featurePriority: FEATURE_ORDER,
      byteBands:
        'Within each collection and feature class, sort by bytes then UTF-8 path and assign floor(index * 4 / count).',
      stratumPathOrder:
        'SHA-256("cloudflare-mdx-scale-v1" + NUL + relativePath), with UTF-8 path as the tie-breaker.',
      scheduler:
        'At each level choose the collection or stratum with the greatest ((next selected total * capacity / total capacity) - already selected) deficit; ties use frozen order.',
      prefixRecordFormat: PREFIX_RECORD_FORMAT,
    },
    project: {
      commit,
      sourceManifestSha256,
      sourceCount: analyzed.length,
    },
    frozenScales: {
      base: BASE_SCALES,
      refinement: REFINEMENT_SCALES,
    },
    fullSelectionSha256: selectionSha256,
    prefixes: prefixPoints,
    semanticSentinel: {
      existingGraphSmoke: [
        'src/content/docs/workers/index.mdx',
        'src/content/docs/style-guide/components/render.mdx',
        'src/content/docs/images/optimization/draw-overlays.mdx',
        'src/content/docs/style-guide/components/subtract-ip-calculator.mdx',
        'src/content/docs/realtime/realtimekit/ui-kit/index.mdx',
      ],
      playgroundSources,
      mermaidSources: [docsMermaidSource, partialsMermaidSource],
      invalidDiagnosticFixture:
        'experiments/cloudflare-mdx/fixtures/invalid-diagnostic.mdx',
    },
    entries: ordered.map(({ hasPlayground: _playground, hasMermaid: _mermaid, ...entry }) => entry),
  };
}

export async function loadScaleManifest() {
  const manifest = JSON.parse(await readFile(SCALE_MANIFEST_FILE, 'utf8'));
  validateManifestShape(manifest);
  return manifest;
}

export async function selectScalePrefix({
  projectRoot,
  scale,
  expectedPrefixSha256,
  verifySourceFiles = true,
}) {
  const manifest = await loadScaleManifest();
  if (!Number.isSafeInteger(scale) || !FROZEN_SCALES.includes(scale)) {
    throw new Error(
      `Scale must be a frozen base or refinement point: ${scale}`,
    );
  }
  if (!/^[a-f0-9]{64}$/.test(expectedPrefixSha256 ?? '')) {
    throw new Error('selectionPrefixSha256 must be an explicit SHA-256 value');
  }
  const prefix = manifest.prefixes[String(scale)];
  if (!prefix || prefix.selectionSha256 !== expectedPrefixSha256) {
    throw new Error(
      `Scale ${scale} prefix hash mismatch: expected ${expectedPrefixSha256}, manifest has ${prefix?.selectionSha256}`,
    );
  }
  const selected = manifest.entries.slice(0, scale);
  const computedPrefixHash = hashSelectionRecords(selected);
  if (computedPrefixHash !== expectedPrefixSha256) {
    throw new Error(
      `Scale ${scale} manifest entries hash to ${computedPrefixHash}, not ${expectedPrefixSha256}`,
    );
  }
  if (verifySourceFiles) {
    for (const entry of selected) {
      const source = await readFile(nodePath.join(projectRoot, entry.relativePath));
      const sourceSha256 = sha256(source);
      if (source.byteLength !== entry.bytes || sourceSha256 !== entry.sourceSha256) {
        throw new Error(
          `Scale source changed: ${entry.relativePath} (${source.byteLength}/${sourceSha256})`,
        );
      }
    }
  }
  return {
    algorithm: SCALE_ALGORITHM,
    scale,
    prefixSha256: computedPrefixHash,
    prefixSummary: prefix.summary,
    manifestFullSelectionSha256: manifest.fullSelectionSha256,
    relativePaths: selected.map(({ relativePath }) => relativePath),
    absolutePaths: selected.map(({ relativePath }) =>
      nodePath.resolve(projectRoot, relativePath),
    ),
  };
}

export function hashSelectionRecords(entries) {
  const hash = createHash('sha256');
  for (const entry of entries) {
    hash.update(entry.relativePath);
    hash.update('\0');
    hash.update(entry.sourceSha256);
    hash.update('\0');
    hash.update(String(entry.bytes));
    hash.update('\n');
  }
  return hash.digest('hex');
}

export function summarizePrefix(entries, scale = entries.length) {
  if (!Number.isSafeInteger(scale) || scale < 1 || scale > entries.length) {
    throw new Error(`Invalid prefix scale ${scale}/${entries.length}`);
  }
  const selected = entries.slice(0, scale);
  const summary = {
    sources: selected.length,
    bytes: 0,
    lines: 0,
    fencedBlocks: 0,
    collections: {},
    featureClasses: {},
    languages: {},
  };
  for (const entry of selected) {
    summary.bytes += entry.bytes;
    summary.lines += entry.lines;
    summary.fencedBlocks += entry.fencedBlocks;
    increment(summary.collections, entry.collection);
    increment(summary.featureClasses, entry.featureClass);
    for (const [language, count] of Object.entries(entry.languages)) {
      increment(summary.languages, language, count);
    }
  }
  return {
    selectionSha256: hashSelectionRecords(selected),
    summary: sortObject(summary),
  };
}

export function validateManifestShape(manifest) {
  if (manifest.schema !== 1 || manifest.algorithm !== SCALE_ALGORITHM) {
    throw new Error(`Unsupported scale manifest: ${manifest.schema}/${manifest.algorithm}`);
  }
  if (
    manifest.project?.commit !== EXPECTED_PROJECT_COMMIT ||
    manifest.project?.sourceManifestSha256 !== EXPECTED_SOURCE_MANIFEST_SHA256 ||
    manifest.project?.sourceCount !== 9_157 ||
    manifest.entries?.length !== 9_157
  ) {
    throw new Error('Scale manifest project pin or source count changed');
  }
  const paths = manifest.entries.map(({ relativePath }) => relativePath);
  if (new Set(paths).size !== paths.length || paths[0] !== COMPATIBILITY_PATH) {
    throw new Error('Scale manifest paths are duplicated or the coverage anchor moved');
  }
  const fullHash = hashSelectionRecords(manifest.entries);
  if (fullHash !== manifest.fullSelectionSha256) {
    throw new Error(`Scale manifest full hash mismatch: ${fullHash}`);
  }
  for (const scale of FROZEN_SCALES) {
    const actual = summarizePrefix(manifest.entries, scale);
    const expected = manifest.prefixes?.[String(scale)];
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Scale ${scale} prefix hash or summary changed`);
    }
  }
}

function analyzeSource(relativePath, source) {
  const text = source.toString('utf8');
  const fences = parseFencedBlocks(text);
  const languages = {};
  for (const { language } of fences) increment(languages, language || '<none>');
  const hasPlayground = fences.some(({ info }) => /(^|\s)playground(?:\s|$)/.test(info));
  const hasMermaid = fences.some(({ language }) => language === 'mermaid');
  const featureClass = hasPlayground
    ? 'playground'
    : hasMermaid
      ? 'mermaid'
      : fences.length >= 5
        ? 'fence-5+'
        : fences.length >= 2
          ? 'fence-2-4'
          : fences.length === 1
            ? 'fence-1'
            : 'fence-0';
  return {
    relativePath,
    sourceSha256: sha256(source),
    bytes: source.byteLength,
    lines: text.length === 0 ? 0 : (text.match(/\n/g)?.length ?? 0) + 1,
    collection: collectionForPath(relativePath),
    featureClass,
    byteBand: null,
    fencedBlocks: fences.length,
    unclosedFencedBlocks: fences.filter(({ closed }) => !closed).length,
    languages: sortObject(languages),
    hasPlayground,
    hasMermaid,
  };
}

function parseFencedBlocks(text) {
  const blocks = [];
  let open;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (open) {
      const closing = line.match(/^( {0,3})(`+|~+)[ \t]*$/);
      if (
        closing &&
        closing[2][0] === open.marker &&
        closing[2].length >= open.length
      ) {
        blocks.push({ ...open, closed: true });
        open = undefined;
      }
      continue;
    }
    const opening = line.match(/^( {0,3})(`{3,}|~{3,})(.*)$/);
    if (!opening) continue;
    const marker = opening[2][0];
    const rawInfo = opening[3].trim();
    if (marker === '`' && rawInfo.includes('`')) continue;
    const language = normalizeLanguage(rawInfo.split(/\s+/, 1)[0] ?? '');
    open = {
      marker,
      length: opening[2].length,
      info: rawInfo,
      language,
    };
  }
  if (open) blocks.push({ ...open, closed: false });
  return blocks;
}

function normalizeLanguage(language) {
  return language
    .replace(/^\{?\.?/, '')
    .replace(/[},].*$/, '')
    .replace(/^['"]|['"]$/g, '')
    .toLowerCase();
}

function collectionForPath(relativePath) {
  if (relativePath.startsWith('src/content/docs/')) return 'docs';
  if (relativePath.startsWith('src/content/partials/')) return 'partials';
  if (relativePath.startsWith('src/content/changelog/')) return 'changelog';
  if (relativePath.startsWith('src/content/compatibility-flags/')) return 'compatibility';
  throw new Error(`Unknown production MDX collection: ${relativePath}`);
}

function assignByteBands(entries) {
  const groups = Map.groupBy(entries, ({ collection, featureClass }) =>
    `${collection}\0${featureClass}`,
  );
  for (const group of groups.values()) {
    group.sort((left, right) => left.bytes - right.bytes || compareUtf8(left.relativePath, right.relativePath));
    for (const [index, entry] of group.entries()) {
      entry.byteBand = Math.floor((index * 4) / group.length);
    }
  }
}

function deficitRoundRobinOrder(entries) {
  const collections = Map.groupBy(entries, ({ collection }) => collection);
  const collectionStates = COLLECTION_ORDER.map((key) => {
    const collectionEntries = collections.get(key) ?? [];
    const strata = [...Map.groupBy(collectionEntries, ({ featureClass, byteBand }) =>
      `${featureClass}/${byteBand}`,
    )].map(([stratumKey, stratumEntries]) => ({
      key: stratumKey,
      capacity: stratumEntries.length,
      selected: 0,
      entries: stratumEntries.sort((left, right) => {
        const leftHash = sha256(`${SCALE_ALGORITHM}\0${left.relativePath}`);
        const rightHash = sha256(`${SCALE_ALGORITHM}\0${right.relativePath}`);
        return leftHash.localeCompare(rightHash) || compareUtf8(left.relativePath, right.relativePath);
      }),
    })).sort((left, right) => compareStratumKeys(left.key, right.key));
    return {
      key,
      capacity: collectionEntries.length,
      selected: 0,
      strata,
    };
  });
  const totalCapacity = entries.length;
  const ordered = [];
  while (ordered.length < totalCapacity) {
    const collection = chooseLargestDeficit(
      collectionStates,
      ordered.length + 1,
      totalCapacity,
    );
    const stratum = chooseLargestDeficit(
      collection.strata,
      collection.selected + 1,
      collection.capacity,
    );
    const entry = stratum.entries[stratum.selected++];
    collection.selected++;
    ordered.push(entry);
  }
  return ordered;
}

function chooseLargestDeficit(states, nextTotal, totalCapacity) {
  let best;
  let bestDeficit = -Infinity;
  for (const state of states) {
    if (state.selected >= state.capacity) continue;
    const deficit = (nextTotal * state.capacity) / totalCapacity - state.selected;
    if (deficit > bestDeficit + Number.EPSILON) {
      best = state;
      bestDeficit = deficit;
    }
  }
  if (!best) throw new Error('Deficit scheduler exhausted before the corpus ended');
  return best;
}

function compareStratumKeys(left, right) {
  const [leftFeature, leftBand] = left.split('/');
  const [rightFeature, rightBand] = right.split('/');
  return (
    FEATURE_ORDER.indexOf(leftFeature) - FEATURE_ORDER.indexOf(rightFeature) ||
    Number(leftBand) - Number(rightBand)
  );
}

async function listMdxFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = nodePath.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listMdxFiles(path)));
    else if (entry.isFile() && entry.name.endsWith('.mdx')) files.push(path);
  }
  return files.sort((left, right) => compareUtf8(toPosix(left), toPosix(right)));
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareUtf8(left, right))
      .map(([key, child]) => [key, sortObject(child)]),
  );
}

function increment(object, key, count = 1) {
  object[key] = (object[key] ?? 0) + count;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function toPosix(path) {
  return path.split(nodePath.sep).join('/');
}

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  }
  return result.stdout.trim();
}
