/**
 * The three professions a Character may hold.
 *
 * Fixed by the game and unchanged since launch, which is why they are an enum
 * here and three rows in `character_class` rather than a catalogue either
 * place has to be kept in step with the other.
 *
 * A roster export does not write these words on their own. It writes a Class
 * value like `Starfleet Tactical Officer` or `KDF Engineering Officer`, from
 * which one of these is read — and sometimes cannot be, because two rows in
 * the analysed corpus carry a ship name in that column instead. That is what
 * an unknown Class is: the exact text is always kept, and this is null.
 */
export enum RosterProfession {
  /** Tactical. */
  TACTICAL = 'TACTICAL',

  /** Engineering. */
  ENGINEERING = 'ENGINEERING',

  /** Science. */
  SCIENCE = 'SCIENCE',
}
