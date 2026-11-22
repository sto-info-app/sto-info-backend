/**
 * Whether an S3 error says the object is not there: `NoSuchKey`, or a
 * `NotFound` or 404 from a request that carries no body to name it.
 *
 * Shared by the two readers that must tell a missing object from a bucket
 * that could not answer: publication, which refuses for good only the
 * first (FC-042), and erasure, which a missing file cannot stop (FC-043).
 *
 * @param error - What the client threw.
 * @returns True only for a missing object.
 */
export function isMissingObject(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const { name, $metadata } = error as {
    name?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };

  return (
    name === 'NoSuchKey' ||
    name === 'NotFound' ||
    $metadata?.httpStatusCode === 404
  );
}
