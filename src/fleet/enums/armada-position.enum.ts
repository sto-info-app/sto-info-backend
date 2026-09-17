/**
 * A Fleet's position within an Armada's fixed three-tier topology.
 *
 * Star Trek Online's own structure: one Alpha, its Betas, and each Beta's
 * Gammas. The tier is a property of the association rather than of the Fleet,
 * because the same Fleet can hold different positions over time and in
 * different Armadas.
 */
export enum ArmadaPosition {
  /** The Armada's single leading Fleet. Has no parent. */
  ALPHA = 'ALPHA',
  /** Reports to the Alpha. */
  BETA = 'BETA',
  /** Reports to a Beta. */
  GAMMA = 'GAMMA',
}
