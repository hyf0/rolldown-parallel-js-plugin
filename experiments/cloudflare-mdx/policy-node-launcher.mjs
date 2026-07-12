import { writeSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const runCasePath = process.argv[2];
const options = process.argv[3];
if (!runCasePath || !options) throw new Error('Expected run-case path and JSON options');
writeSync(2, `[mdx-policy-node-ready] ${process.pid}\n`);
process.kill(process.pid, 'SIGSTOP');
process.argv = [process.execPath, runCasePath, options];
await import(pathToFileURL(runCasePath));
