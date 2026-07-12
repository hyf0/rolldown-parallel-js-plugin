import { parentPort, workerData } from 'node:worker_threads';
import { createCloudflareMdxTransform } from './create-transform.mjs';

if (!parentPort) throw new Error('Managed Cloudflare MDX worker requires a parent port');

const { projectRoot, fixedNow, threadNumber } = workerData;

try {
  const kernel = await createCloudflareMdxTransform({ projectRoot, fixedNow });
  parentPort.on('message', async (message) => {
    const { requestId, type } = message;
    try {
      if (type === 'transform') {
        const result = await kernel.transform(message.code, message.id);
        parentPort.postMessage({ type: 'result', requestId, result });
        return;
      }
      if (type === 'buildEnd') {
        await kernel.buildEnd?.();
        parentPort.postMessage({ type: 'result', requestId });
        return;
      }
      throw new Error('Unknown managed Cloudflare MDX worker request: ' + type);
    } catch (error) {
      parentPort.postMessage({
        type: 'error',
        requestId,
        error: serializeError(error),
      });
    }
  });
  parentPort.postMessage({ type: 'ready', threadNumber });
} catch (error) {
  parentPort.postMessage({ type: 'initializationError', error: serializeError(error) });
  parentPort.close();
}

function serializeError(error) {
  const value = error instanceof Error ? error : new Error(String(error));
  const serialized = {
    name: value.name,
    message: value.message,
    stack: value.stack,
  };
  for (const key of [
    'code',
    'id',
    'plugin',
    'hook',
    'pluginCode',
    'loc',
    'frame',
    'line',
    'column',
  ]) {
    if (value[key] !== undefined) serialized[key] = value[key];
  }
  return serialized;
}
