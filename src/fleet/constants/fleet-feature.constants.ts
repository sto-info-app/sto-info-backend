/**
 * The runtime kill switch for the whole Fleet Community feature.
 *
 * Held in `app_setting` rather than an environment variable so it can be thrown
 * during an incident without a redeployment, exactly as Storytime and Custom
 * Tracking are. Seeded disabled: plan section 10 requires that production v1 is
 * enabled only once the full scope is ready, so an environment that has somehow
 * lost the setting must hide the feature rather than reveal it half-built.
 */
export const FLEET_COMMUNITIES_ENABLED_SETTING_KEY =
  'FLEET_COMMUNITIES_ENABLED';

/**
 * Capability flags, held in environment variables.
 *
 * These stage a rollout across environments rather than responding to an
 * incident, which is what environment variables are for. Each defaults to
 * enabled, so switching the feature on switches its parts on unless an
 * environment has deliberately said otherwise.
 *
 * Nothing about file scanning, quarantine or retention appears here. Those are
 * site-wide services that happen to be exercised by Fleet uploads, and
 * requirement R24 makes the file gate unconditional — a Fleet flag that could
 * stand any of them down would be a way to make unscanned files reachable.
 */
export const FLEET_FEATURE_FLAGS = {
  /** Whether a user may register a Community, Fleet or Armada. */
  REGISTRATION_ENABLED: 'FLEET_REGISTRATION_ENABLED',
  /** Whether roster CSV imports may be submitted. */
  IMPORTS_ENABLED: 'FLEET_IMPORTS_ENABLED',
  /** Whether scoped chat channels and direct messages are served. */
  CHAT_ENABLED: 'FLEET_CHAT_ENABLED',
} as const;

/**
 * A Fleet capability flag key.
 */
export type FleetFeatureFlag =
  (typeof FLEET_FEATURE_FLAGS)[keyof typeof FLEET_FEATURE_FLAGS];
