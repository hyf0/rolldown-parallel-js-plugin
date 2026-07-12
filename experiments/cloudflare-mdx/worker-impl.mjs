import nodePath from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCloudflareMdxTransform } from './create-transform.mjs';
import { createInstrumentedKernel } from './metrics.mjs';

const packageRoot = process.env.ROLLDOWN_RESEARCH_PACKAGE_ROOT;
if (!packageRoot) throw new Error('ROLLDOWN_RESEARCH_PACKAGE_ROOT is required');
const { defineParallelPluginImplementation } = await import(
  pathToFileURL(nodePath.join(packageRoot, 'dist/parallel-plugin.mjs'))
);

export default defineParallelPluginImplementation(async (options, context) => {
  const kernel = await createInstrumentedKernel(
    options,
    context.threadNumber,
    createCloudflareMdxTransform,
  );
  return {
    name: 'cloudflare-mdx',
    transform: {
      filter: { id: { include: [/\.mdx$/] } },
      handler(code, id) {
        return kernel.transform(code, id);
      },
    },
    buildEnd() {
      return kernel.buildEnd?.();
    },
  };
});
