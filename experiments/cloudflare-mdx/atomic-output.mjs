import { randomUUID } from 'node:crypto';
import { link, open, rm } from 'node:fs/promises';
import nodePath from 'node:path';

export async function writeFileAtomic(path, data, { publishFile = link } = {}) {
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
    await publishFile(temporary, target);
    await rm(temporary);
    const directory = await open(nodePath.dirname(target), 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (error) {
    await handle?.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}
