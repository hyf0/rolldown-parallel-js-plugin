import { createRequire } from 'node:module';
import nodePath from 'node:path';
import { pathToFileURL } from 'node:url';

const PLAYGROUND_URL =
  /https:\/\/workers\.cloudflare\.com\/playground#([A-Za-z0-9+\-$]+)/g;
const UNDICI_BOUNDARY = /----formdata-undici-[0-9]{12}/g;
const FIXED_BOUNDARY = '----formdata-undici-000000000000';

export async function createCloudflareOutputNormalizer(projectRoot) {
  const projectRequire = createRequire(pathToFileURL(nodePath.join(projectRoot, 'package.json')));
  const { default: lzString } = await import(projectRequire.resolve('lz-string'));
  return (source, enabled) => {
    if (!enabled) return { code: source, playgroundUrls: 0 };
    let playgroundUrls = 0;
    const code = source.replace(PLAYGROUND_URL, (url, encoded) => {
      const decoded = lzString.decompressFromEncodedURIComponent(encoded);
      if (typeof decoded !== 'string') {
        throw new Error('Could not decode a Cloudflare Workers Playground URL');
      }
      const boundaries = decoded.match(UNDICI_BOUNDARY) ?? [];
      if (boundaries.length === 0) return url;
      playgroundUrls++;
      const normalized = decoded.replace(UNDICI_BOUNDARY, FIXED_BOUNDARY);
      return `https://workers.cloudflare.com/playground#${lzString.compressToEncodedURIComponent(normalized)}`;
    });
    return { code, playgroundUrls };
  };
}
