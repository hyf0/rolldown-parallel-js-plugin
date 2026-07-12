import { createCloudflareMdxTransform } from './create-transform.mjs';
import { createInstrumentedKernel } from './metrics.mjs';

export async function createOrdinaryCloudflareMdxPlugin(options) {
  const kernel = await createInstrumentedKernel(options, 0, createCloudflareMdxTransform);
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
}
