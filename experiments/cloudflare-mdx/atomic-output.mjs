import { randomUUID } from 'node:crypto';
import { open, rename, rm } from 'node:fs/promises';
import nodePath from 'node:path';

export async function writeFileAtomic(path, data, { renameFile = rename } = {}) {
  const target = nodePath.resolve(path);
  const temporary = nodePath.join(
    nodePath.dirname(target),
    `.${nodePath.basename(target)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await renameFile(temporary, target);
  } catch (error) {
    await handle?.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}
