import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  CUSTOM_TRACKING_PALETTE,
  CustomTrackingPaletteColour,
} from './constants/custom-tracking-colour.constants';
import {
  CUSTOM_TRACKING_FIELD_CATALOGUE,
  CustomTrackingFieldTypeSpec,
} from './constants/custom-tracking-field-catalogue.constants';
import {
  CUSTOM_TRACKING_IMAGE_SHAPES,
  CustomTrackingImageShapeDescription,
} from './constants/custom-tracking-image.constants';
import {
  CUSTOM_TRACKING_FIELD_BOUNDS,
  CUSTOM_TRACKING_LIMITS,
} from './constants/custom-tracking-limits.constants';
import {
  CustomTrackingFeatureService,
  CustomTrackingFeatureState,
} from './custom-tracking-feature.service';
import { CustomTrackingFieldType } from './enums/custom-tracking-field-type.enum';

/** One Field type, as the interface offering it needs to know about it. */
interface CustomTrackingFieldTypeDescription extends CustomTrackingFieldTypeSpec {
  /** The stored identifier. */
  fieldType: CustomTrackingFieldType;
}

/** Everything the interface needs before it can draw the builder. */
interface CustomTrackingConfiguration {
  /** Which parts of the feature are available. */
  features: CustomTrackingFeatureState;
  /** The Field types on offer, and what each can do. */
  fieldTypes: CustomTrackingFieldTypeDescription[];
  /** The colours a colour Field offers by name. */
  palette: readonly CustomTrackingPaletteColour[];
  /** The ceilings the interface warns against before the server refuses. */
  limits: typeof CUSTOM_TRACKING_LIMITS;
  /** The bounds one Field type's settings are chosen within. */
  fieldBounds: typeof CUSTOM_TRACKING_FIELD_BOUNDS;
  /** The shapes a picture may be cropped to, and how each is delivered. */
  imageShapes: readonly CustomTrackingImageShapeDescription[];
}

/**
 * What the interface needs to know before it can draw anything.
 *
 * Served in one request rather than several, and served rather than compiled
 * into the frontend. The field catalogue, the limits and the palette are all
 * things the backend is authoritative about; a copy in the frontend would be a
 * second statement of them that could disagree, and the disagreement would
 * show up as a form that accepts what the server then refuses.
 *
 * Anonymous, because none of it is about any particular user. It is the shape
 * of the feature, not anybody's data.
 */
@ApiTags('Custom Tracking')
@Controller('custom-tracking')
export class CustomTrackingConfigurationController {
  /**
   * Creates an instance of CustomTrackingConfigurationController.
   *
   * @param _features - Which parts of the feature are switched on.
   */
  constructor(private readonly _features: CustomTrackingFeatureService) {}

  /**
   * Describes the feature to the interface.
   *
   * @returns The capabilities, field catalogue, palette and limits.
   */
  @Get('configuration')
  @ApiOperation({ summary: 'Describe the Custom Tracking feature' })
  @ApiOkResponse({
    description: 'Capabilities, the field catalogue, the palette and limits.',
  })
  async getConfiguration(): Promise<CustomTrackingConfiguration> {
    return {
      features: await this._features.getState(),
      fieldTypes: Object.entries(CUSTOM_TRACKING_FIELD_CATALOGUE).map(
        ([fieldType, spec]) => ({
          fieldType: fieldType as CustomTrackingFieldType,
          ...spec,
        }),
      ),
      palette: CUSTOM_TRACKING_PALETTE,
      limits: CUSTOM_TRACKING_LIMITS,
      fieldBounds: CUSTOM_TRACKING_FIELD_BOUNDS,
      imageShapes: CUSTOM_TRACKING_IMAGE_SHAPES,
    };
  }
}
