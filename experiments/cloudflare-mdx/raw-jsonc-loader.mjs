import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.jsonc?raw')) {
      const value = readFileSync(new URL(url.slice(0, -4)), 'utf8');
      return {
        format: 'module',
        source: `export default ${JSON.stringify(value)};`,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});
