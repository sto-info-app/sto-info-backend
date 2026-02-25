/**
 * Utility functions for handling errors.
 */

/**
 * Stringifies an unknown error into a human-readable message.
 * If the error is an instance of Error, returns its message.
 * If it's a string, returns the string.
 * Otherwise, attempts to JSON.stringify the error, falling back to String(error).
 *
 * @param error - The error to stringify.
 * @returns A string representation of the error.
 */
export function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    // Check if it's an object before stringifying
    if (typeof error === 'object' && error !== null) {
      return JSON.stringify(error);
    }
    return String(error);
  } catch {
    /* istanbul ignore next */
    return String(error);
  }
}

/**
 * Ensures that an unknown error is wrapped in an Error object.
 * If the error is already an instance of Error, it is returned as-is.
 * Otherwise, the error is stringified and wrapped in a new Error object.
 *
 * @param error - The error to wrap.
 * @returns An Error object.
 */
export function ensureError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(stringifyError(error));
}
