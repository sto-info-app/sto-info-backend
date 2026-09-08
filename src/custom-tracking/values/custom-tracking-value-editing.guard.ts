import { Injectable } from '@nestjs/common';

import {
  CUSTOM_TRACKING_FEATURE_FLAGS,
  CustomTrackingFeatureFlag,
} from '../constants/custom-tracking-feature.constants';
import { CustomTrackingEditingGuardBase } from '../custom-tracking-editing.guard';

/**
 * Guards the value editor.
 *
 * Separate from the definition guard because the two are separately
 * switchable: an environment may want the builder frozen while values stay
 * editable, or the reverse during an incident. Everything else about the two
 * is identical and lives in the shared base.
 */
@Injectable()
export class CustomTrackingValueEditingGuard extends CustomTrackingEditingGuardBase {
  /**
   * The capability this guard requires.
   *
   * @returns The value-editing capability.
   */
  protected get flag(): CustomTrackingFeatureFlag {
    return CUSTOM_TRACKING_FEATURE_FLAGS.VALUE_EDITING_ENABLED;
  }
}
