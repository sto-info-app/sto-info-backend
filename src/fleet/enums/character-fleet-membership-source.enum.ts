/**
 * What established a personal Character-to-Fleet association.
 *
 * `CONFIRMED_IMPORT` is the load-bearing one: a roster import can *propose* an
 * association, but only the Character's owner confirming it produces a
 * membership row. An import never writes one by itself — ADR-0002.
 */
export enum CharacterFleetMembershipSource {
  /** The owner recorded it directly. */
  MANUAL = 'MANUAL',
  /** It followed an approved Fleet application. */
  APPLICATION = 'APPLICATION',
  /** The owner accepted a proposal raised from roster evidence. */
  CONFIRMED_IMPORT = 'CONFIRMED_IMPORT',
}
