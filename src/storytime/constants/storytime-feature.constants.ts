/**
 * The runtime kill switch for the whole feature.
 *
 * Held in the database rather than an environment variable so an administrator
 * can take Storytime offline without a redeployment. It defaults to disabled:
 * a fresh environment, or one where the setting has somehow been lost, should
 * not surface an unfinished feature to the public.
 */
export const STORYTIME_ENABLED_SETTING_KEY = 'STORYTIME_ENABLED';

/**
 * Capability flags, held in environment variables.
 *
 * These stage the rollout of parts of the feature and change per environment,
 * which is exactly what environment variables are for. Only the master switch
 * above needs to be changeable at runtime, because only it is an emergency
 * control.
 *
 * Each defaults to enabled: once Storytime itself is switched on, the parts of
 * it should work unless an environment has deliberately turned one off.
 */
export const STORYTIME_FEATURE_FLAGS = {
  /** Whether anonymous and authenticated readers may read Storytime content. */
  PUBLIC_READ_ENABLED: 'STORYTIME_PUBLIC_READ_ENABLED',
  /** Whether creators may create and edit Stories. */
  CREATION_ENABLED: 'STORYTIME_CREATION_ENABLED',
  /** Whether YouTube media may be attached and rendered. */
  YOUTUBE_ENABLED: 'STORYTIME_YOUTUBE_ENABLED',
  /** Whether the Spotlight is surfaced. */
  SPOTLIGHT_ENABLED: 'STORYTIME_SPOTLIGHT_ENABLED',
} as const;

/**
 * A Storytime capability flag key.
 */
export type StorytimeFeatureFlag =
  (typeof STORYTIME_FEATURE_FLAGS)[keyof typeof STORYTIME_FEATURE_FLAGS];
