/**
 * Orders two strings by UTF-16 code unit, the same on every machine.
 *
 * Not `localeCompare`: a projection has to come out the same wherever it is
 * built, and a collation that depends on the server's locale would let two
 * replays of one Fleet order its identities, and so its rows, differently.
 * Ledger keys and the two members of a direct conversation sort the same way,
 * which for lower-case UUIDs is also PostgreSQL's order.
 *
 * @param a - One string.
 * @param b - The other.
 * @returns Negative, zero or positive.
 */
export function compareText(a: string, b: string): number {
  return Number(a > b) - Number(a < b);
}
