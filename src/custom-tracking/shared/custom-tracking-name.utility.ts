/**
 * Runs of whitespace, including the tabs and newlines a paste can carry in.
 */
const WHITESPACE_RUN = /\s+/g;

/**
 * Reduces a name to the form sibling names are compared in.
 *
 * Names are unique without regard to case within their parent, and this is the
 * text the unique index actually holds. Two things are done to it, and both
 * matter for the same reason: a user who types `Ship names` and later `ship
 * names` means the same Section, and so does one who pastes `Ship  names` with
 * a doubled space they cannot see. Comparing the raw text would let both
 * through and leave two Sections nobody can tell apart.
 *
 * Case folding uses `toLowerCase` rather than a locale-aware fold. The
 * database index holds this exact string and compares it byte for byte, so the
 * transform has to be the same everywhere it is applied; a fold that varied
 * with the server's locale would make uniqueness depend on where the request
 * landed.
 *
 * @param name - The name as the user typed it.
 * @returns The comparable form.
 */
export function normaliseName(name: string): string {
  return name.trim().replace(WHITESPACE_RUN, ' ').toLowerCase();
}

/**
 * Tidies a name into the form it is stored and displayed in.
 *
 * The user's capitalisation is theirs and is kept. Only the whitespace they
 * did not intend is removed, so what they see back is what they wrote.
 *
 * @param name - The name as the user typed it.
 * @returns The name as it will be shown.
 */
export function tidyName(name: string): string {
  return name.trim().replace(WHITESPACE_RUN, ' ');
}
