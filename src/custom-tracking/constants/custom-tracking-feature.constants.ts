/**
 * The runtime kill switch for Custom Tracking.
 *
 * Held in the database rather than an environment variable so an administrator
 * can take the feature offline without a redeployment — the material reason
 * being that this feature stores content users write themselves, and an
 * incident may need it stopped in minutes rather than at the next deploy.
 *
 * It defaults to disabled, so an environment that has never been configured
 * keeps the feature hidden rather than exposing an unfinished one.
 */
export const CUSTOM_TRACKING_ENABLED_SETTING_KEY = 'CUSTOM_TRACKING_ENABLED';

/**
 * Capability flags, held in environment variables.
 *
 * These stage the rollout and vary per environment, which is what environment
 * variables are for; only the master switch above needs to change at runtime,
 * because only it is an emergency control.
 *
 * Each defaults to enabled: once Custom Tracking itself is switched on, its
 * parts should work unless an environment has deliberately turned one off.
 */
export const CUSTOM_TRACKING_FEATURE_FLAGS = {
  /** Whether anonymous visitors may read public custom content. */
  PUBLIC_READ_ENABLED: 'CUSTOM_TRACKING_PUBLIC_READ_ENABLED',
  /** Whether users may create and edit definitions. */
  DEFINITION_EDITING_ENABLED: 'CUSTOM_TRACKING_DEFINITION_EDITING_ENABLED',
  /** Whether users may record and edit values. */
  VALUE_EDITING_ENABLED: 'CUSTOM_TRACKING_VALUE_EDITING_ENABLED',
  /** Whether image Fields may be uploaded to and rendered. */
  IMAGES_ENABLED: 'CUSTOM_TRACKING_IMAGES_ENABLED',
  /** Whether YouTube Fields may be filled in and rendered. */
  YOUTUBE_ENABLED: 'CUSTOM_TRACKING_YOUTUBE_ENABLED',
} as const;

/**
 * A Custom Tracking capability flag key.
 */
export type CustomTrackingFeatureFlag =
  (typeof CUSTOM_TRACKING_FEATURE_FLAGS)[keyof typeof CUSTOM_TRACKING_FEATURE_FLAGS];
