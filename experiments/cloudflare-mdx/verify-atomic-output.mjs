import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { writeFileAtomic } from './atomic-output.mjs';

const directory = await mkdtemp(nodePath.join(tmpdir(), 'mdx-atomic-output-'));
try {
  const target = nodePath.join(directory, 'report.json');
  await writeFileAtomic(target, 'complete\n');
  if ((await readFile(target, 'utf8')) !== 'complete\n') {
    throw new Error('Atomic output did not publish the complete artifact');
  }

  await expectRejected(async () => {
    await writeFileAtomic(target, 'replacement\n');
  });
  if ((await readFile(target, 'utf8')) !== 'complete\n') {
    throw new Error('Atomic output overwrote an existing complete artifact');
  }

  await rm(target);
  await writeFile(target, 'previous\n');
  await expectRejected(async () => {
    await writeFileAtomic(target, 'partial\n', {
      publishFile: async () => {
        throw new Error('synthetic publish failure');
      },
    });
  });
  if ((await readFile(target, 'utf8')) !== 'previous\n') {
    throw new Error('Failed atomic output replaced the prior complete artifact');
  }
  if ((await readdir(directory)).some((name) => name.endsWith('.tmp'))) {
    throw new Error('Failed atomic output retained a partial temporary file');
  }

  console.log(
    JSON.stringify({
      valid: [
        'complete-link-and-directory-sync',
        'existing-target-no-clobber',
        'failed-publish-preserves-target',
        'failed-publish-cleans-temp',
      ],
    }),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}

async function expectRejected(action) {
  try {
    await action();
  } catch {
    return;
  }
  throw new Error('Expected atomic output failure was accepted');
}
