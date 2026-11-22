/**
 * How an Armada association came to be recorded.
 *
 * Only `MANUAL` exists in v1. STO exports carry no Armada information at all,
 * so there is nothing to derive one from — ADR-0004. The column exists so that
 * a later derived source is an added value rather than a migration of every
 * historical row.
 */
export enum ArmadaMembershipSource {
  /** Entered by a person with the capability to manage the topology. */
  MANUAL = 'MANUAL',
}
