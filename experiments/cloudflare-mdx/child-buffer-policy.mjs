export const CHILD_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

export function assertChildCaptureComplete(result, context) {
  if (result.error?.code === 'ENOBUFS') {
    throw new Error(
      `${context} exceeded the explicit ${CHILD_MAX_BUFFER_BYTES}-byte child buffer; captured output is incomplete`,
    );
  }
  if (result.error) throw result.error;
}
