import {
  CUSTOM_TRACKING_ENABLED_SETTING_KEY,
  CUSTOM_TRACKING_FEATURE_FLAGS,
} from 'src/custom-tracking/constants/custom-tracking-feature.constants';
import {
  FLEET_COMMUNITIES_ENABLED_SETTING_KEY,
  FLEET_FEATURE_FLAGS,
} from 'src/fleet/constants/fleet-feature.constants';
import {
  STORYTIME_ENABLED_SETTING_KEY,
  STORYTIME_FEATURE_FLAGS,
} from 'src/storytime/constants/storytime-feature.constants';

/**
 * A site feature with a master switch a site admin may throw from the Admin
 * page (FC-045).
 */
export enum FeatureSwitch {
  FLEET_COMMUNITIES = 'FLEET_COMMUNITIES',
  STORYTIME = 'STORYTIME',
  CUSTOM_TRACKING = 'CUSTOM_TRACKING',
}

/** What the site admin log names a switch's change as. */
export const FEATURE_SWITCH_SUBJECT_KIND = 'FEATURE_SWITCH';

/** One of a feature's capability flags, which the environment sets. */
export interface FeatureSubFlagDefinition {
  /** The environment variable. */
  readonly key: string;
  /** What it lets people do, in words. */
  readonly label: string;
}

/** A feature's master switch and the capability flags beneath it. */
export interface FeatureSwitchDefinition {
  readonly feature: FeatureSwitch;
  /** The feature's name, as the Admin page shows it. */
  readonly label: string;
  /** The `app_setting` key that holds the master switch. */
  readonly settingKey: string;
  readonly subFlags: readonly FeatureSubFlagDefinition[];
}

/**
 * Every switch, in the order the Admin page lists them.
 *
 * The keys are the features' own constants, so a renamed setting or flag
 * cannot leave this list reading one that no longer exists.
 */
export const FEATURE_SWITCHES: readonly FeatureSwitchDefinition[] = [
  {
    feature: FeatureSwitch.FLEET_COMMUNITIES,
    label: 'Fleet Communities',
    settingKey: FLEET_COMMUNITIES_ENABLED_SETTING_KEY,
    subFlags: [
      {
        key: FLEET_FEATURE_FLAGS.REGISTRATION_ENABLED,
        label: 'Registering Communities, Fleets and Armadas',
      },
      {
        key: FLEET_FEATURE_FLAGS.IMPORTS_ENABLED,
        label: 'Roster imports',
      },
      {
        key: FLEET_FEATURE_FLAGS.CHAT_ENABLED,
        label: 'Chat and direct messages',
      },
    ],
  },
  {
    feature: FeatureSwitch.STORYTIME,
    label: 'Storytime',
    settingKey: STORYTIME_ENABLED_SETTING_KEY,
    subFlags: [
      {
        key: STORYTIME_FEATURE_FLAGS.PUBLIC_READ_ENABLED,
        label: 'Reading Stories',
      },
      {
        key: STORYTIME_FEATURE_FLAGS.CREATION_ENABLED,
        label: 'Writing Stories',
      },
      {
        key: STORYTIME_FEATURE_FLAGS.YOUTUBE_ENABLED,
        label: 'YouTube media',
      },
      {
        key: STORYTIME_FEATURE_FLAGS.SPOTLIGHT_ENABLED,
        label: 'The Spotlight',
      },
    ],
  },
  {
    feature: FeatureSwitch.CUSTOM_TRACKING,
    label: 'Custom Tracking',
    settingKey: CUSTOM_TRACKING_ENABLED_SETTING_KEY,
    subFlags: [
      {
        key: CUSTOM_TRACKING_FEATURE_FLAGS.PUBLIC_READ_ENABLED,
        label: 'Reading published tracking',
      },
      {
        key: CUSTOM_TRACKING_FEATURE_FLAGS.DEFINITION_EDITING_ENABLED,
        label: 'Editing what is tracked',
      },
      {
        key: CUSTOM_TRACKING_FEATURE_FLAGS.VALUE_EDITING_ENABLED,
        label: 'Recording values',
      },
      {
        key: CUSTOM_TRACKING_FEATURE_FLAGS.IMAGES_ENABLED,
        label: 'Pictures',
      },
      {
        key: CUSTOM_TRACKING_FEATURE_FLAGS.YOUTUBE_ENABLED,
        label: 'YouTube videos',
      },
    ],
  },
];
