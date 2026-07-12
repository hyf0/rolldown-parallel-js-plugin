import {
  assertChildCaptureComplete,
  CHILD_MAX_BUFFER_BYTES,
} from './child-buffer-policy.mjs';

if (CHILD_MAX_BUFFER_BYTES !== 64 * 1024 * 1024) {
  throw new Error(`Child buffer changed to ${CHILD_MAX_BUFFER_BYTES} bytes`);
}
assertChildCaptureComplete({ status: 0 }, 'synthetic complete child');
let rejected = false;
try {
  assertChildCaptureComplete(
    { error: Object.assign(new Error('stdout maxBuffer length exceeded'), { code: 'ENOBUFS' }) },
    'synthetic instrumented child',
  );
} catch (error) {
  rejected =
    error.message.includes('67108864-byte') &&
    error.message.includes('captured output is incomplete');
}
if (!rejected) throw new Error('ENOBUFS did not fail the instrumentation capture gate');

console.log(
  JSON.stringify({
    valid: true,
    childMaxBufferBytes: CHILD_MAX_BUFFER_BYTES,
    enobufsRejected: true,
  }),
);
