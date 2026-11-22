/**
 * Which of the three scoped objects an authorisation question is about.
 *
 * Scope is always a *kind plus a typed identifier*, never an object ID and a
 * type string — plan section 4.1. This enum names the kind so a caller cannot
 * hand the policy a bare UUID and let it guess what the UUID is; guessing is
 * how a Fleet ID gets answered as though it were an Armada.
 */
export enum FleetScopeKind {
  /** The umbrella Community. The widest scope, and the only one always present. */
  COMMUNITY = 'COMMUNITY',
  /** One Fleet inside a Community. */
  FLEET = 'FLEET',
  /** One Armada inside a Community. */
  ARMADA = 'ARMADA',
}
