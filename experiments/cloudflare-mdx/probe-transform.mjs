import { readFile } from 'node:fs/promises';
import nodePath from 'node:path';
import { createCloudflareMdxTransform } from './create-transform.mjs';

const projectRoot = nodePath.resolve(process.argv[2] ?? '');
const id = nodePath.resolve(
  projectRoot,
  process.argv[3] ?? 'src/content/docs/workers/index.mdx',
);
process.chdir(projectRoot);
const plugin = await createCloudflareMdxTransform({ projectRoot });
const result = await plugin.transform(await readFile(id, 'utf8'), id);
console.log(JSON.stringify({ id, codeBytes: Buffer.byteLength(result.code), map: result.map }));
