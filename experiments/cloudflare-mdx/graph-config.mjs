export const graphSmokeEntries = Object.freeze([
  'src/content/docs/workers/index.mdx',
  'src/content/docs/style-guide/components/render.mdx',
  'src/content/docs/images/optimization/draw-overlays.mdx',
  'src/content/docs/style-guide/components/subtract-ip-calculator.mdx',
  'src/content/docs/realtime/realtimekit/ui-kit/index.mdx',
]);

export const localResolutionExtensions = Object.freeze([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.astro',
  '.mdx',
  '.json',
  '.jsonc',
  '.yaml',
  '.yml',
  '.css',
  '.txt',
]);

export const assetExtensions = new Set([
  '.apng',
  '.avif',
  '.bmp',
  '.gif',
  '.ico',
  '.jpeg',
  '.jpg',
  '.png',
  '.svg',
  '.webp',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.mp3',
  '.mp4',
  '.webm',
  '.wav',
  '.pdf',
  '.zip',
]);

export const graphBoundary = Object.freeze({
  included: Object.freeze([
    'all selected production MDX transforms',
    'project-local server-side JS, TS, TSX, JSON, MDX, and Astro imports',
    'raw imports as exact string modules',
    'local CSS and asset imports as internal leaf modules',
  ]),
  excluded: Object.freeze([
    'Astro compiler CSS virtual modules and CSS dependency traversal',
    'Astro hoisted and client script modules',
    'hydration and client build inputs',
    'route rendering and final asset emission',
  ]),
});

export const graphProfile = Object.freeze({
  runLinkCheck: false,
  publicCiRunLinkCheck: true,
  sameConfigurationAsPublicCi: false,
  linkValidatorBoundary:
    'The link-check profile used by public CI enables starlight-links-validator. Its rehype plugin writes a globalThis Map that remains worker-local under ParallelPlugin and cannot currently be merged into the coordinator state.',
});

export const expectedPins = Object.freeze({
  node: 'v24.18.0',
  projectCommit: '2b08a67a41da1a521aecbcf465893abae1e9a6df',
  rolldownCommit: '0aa600b5721b852cdc4095c7122a929a8cb4a798',
  bindingHash:
    'deec0b2cb7a12e507ff223e12535c3280ab5fe8371f2fcc92f9db206163f1c5d',
  distHash: 'e30311e764bae7fba9afe27665db741d556a7c3728eb67cfbe7ce0fed3135ebc',
  sourceManifestHash:
    '84077a08f660782274d5502be25f0ec9297cec9c52508e2c5e9e2a3e8bedc12b',
});
