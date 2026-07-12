import nodePath from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function createParallelCloudflareMdxPlugin(options) {
  const packageRoot = process.env.ROLLDOWN_RESEARCH_PACKAGE_ROOT;
  if (!packageRoot) throw new Error('ROLLDOWN_RESEARCH_PACKAGE_ROOT is required');
  const { defineParallelPlugin } = await import(
    pathToFileURL(nodePath.join(packageRoot, 'dist/experimental-index.mjs'))
  );
  const defineCloudflareMdxPlugin = defineParallelPlugin(
    fileURLToPath(new URL('./worker-impl.mjs', import.meta.url)),
  );
  return defineCloudflareMdxPlugin(options);
}
