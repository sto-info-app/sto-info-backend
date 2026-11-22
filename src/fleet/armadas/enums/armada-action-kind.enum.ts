/**
 * One change to an Armada's shape, as its history records it (FC-024).
 */
export enum ArmadaActionKind {
  /** A Fleet was placed, on approval of its request. */
  PLACED = 'PLACED',
  /** A placed Fleet changed position or parent. Needs a reason. */
  MOVED = 'MOVED',
  /** A Fleet's own managers took it out. Needs a reason. */
  LEFT = 'LEFT',
  /** An Armada manager took a Fleet out. Needs a reason. */
  REMOVED = 'REMOVED',
  /** The placement ended because the Armada closed. */
  CLOSED = 'CLOSED',
}
