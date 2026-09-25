/**
 * Orders two strings by UTF-16 code unit, the same on every machine.
 *
 * Not `localeCompare`: a projection has to come out the same wherever it is
 * built, and a collation that depends on the server's locale would let two
 * replays of one Fleet order its identities, and so its rows, differently.
 *
 * @param a - One string.
 * @param b - The other.
 * @returns Negative, zero or positive.
 */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
