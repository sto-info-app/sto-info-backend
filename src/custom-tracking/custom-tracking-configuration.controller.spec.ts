import { jest } from '@jest/globals';

import { CUSTOM_TRACKING_IMAGE_SHAPES } from './constants/custom-tracking-image.constants';
import {
  CUSTOM_TRACKING_FIELD_BOUNDS,
  CUSTOM_TRACKING_LIMITS,
} from './constants/custom-tracking-limits.constants';
import { CustomTrackingConfigurationController } from './custom-tracking-configuration.controller';
import {
  CustomTrackingFeatureService,
  CustomTrackingFeatureState,
} from './custom-tracking-feature.service';
import { CustomTrackingFieldType } from './enums/custom-tracking-field-type.enum';
import { CustomTrackingImageShape } from './enums/custom-tracking-image-shape.enum';

describe('CustomTrackingConfigurationController', () => {
  const state: CustomTrackingFeatureState = {
    isEnabled: true,
    publicReadEnabled: true,
    definitionEditingEnabled: true,
    valueEditingEnabled: true,
    imagesEnabled: true,
    youTubeEnabled: false,
  };

  let controller: CustomTrackingConfigurationController;
  let getState: jest.Mock<() => Promise<CustomTrackingFeatureState>>;

  beforeEach(() => {
    getState = jest
      .fn<() => Promise<CustomTrackingFeatureState>>()
      .mockResolvedValue(state);

    controller = new CustomTrackingConfigurationController({
      getState,
    } as unknown as CustomTrackingFeatureService);
  });

  it('reports which parts of the feature are available', async () => {
    await expect(controller.getConfiguration()).resolves.toMatchObject({
      features: state,
    });
  });

  // Every type has to appear, because a type absent here is one the builder
  // cannot offer even though the server would accept it.
  it('describes every field type exactly once', async () => {
    const { fieldTypes } = await controller.getConfiguration();
    const described = fieldTypes.map(type => type.fieldType);

    expect(new Set(described).size).toBe(described.length);
    expect(described.sort()).toEqual(
      Object.values(CustomTrackingFieldType).sort(),
    );
  });

  it('says what each type can do', async () => {
    const { fieldTypes } = await controller.getConfiguration();
    const dropdown = fieldTypes.find(
      type => type.fieldType === CustomTrackingFieldType.DROPDOWN,
    );

    expect(dropdown).toMatchObject({
      usesOptions: true,
      allowsMultipleOptions: false,
      usesTimezone: false,
    });
  });

  it('reports the tag field as drawing from a user-defined list', async () => {
    const { fieldTypes } = await controller.getConfiguration();
    const tags = fieldTypes.find(
      type => type.fieldType === CustomTrackingFieldType.TAGS,
    );

    expect(tags).toMatchObject({
      usesOptions: true,
      allowsMultipleOptions: true,
    });
  });

  // A colour is named rather than written out, so a value recorded against a
  // palette colour follows the palette if it is ever adjusted. Only the name
  // and the custom property travel; the colour itself stays in the stylesheet.
  it('offers palette colours by name and custom property, never by value', async () => {
    const { palette } = await controller.getConfiguration();

    expect(palette.length).toBeGreaterThan(0);

    for (const colour of palette) {
      expect(colour.token).toMatch(/^LCARS_[A-Z_]+$/);
      expect(colour.cssVariable).toMatch(/^--lcars-[a-z-]+$/);
      expect(colour).not.toHaveProperty('value');
    }
  });

  it('publishes the limits the interface warns against', async () => {
    await expect(controller.getConfiguration()).resolves.toMatchObject({
      limits: CUSTOM_TRACKING_LIMITS,
    });
  });

  // Without these the builder could not offer a rating scale or bound a year
  // box, and the only alternative would be a second copy of them in the
  // frontend that could disagree with this one.
  it('publishes the bounds each type is configured within', async () => {
    await expect(controller.getConfiguration()).resolves.toMatchObject({
      fieldBounds: CUSTOM_TRACKING_FIELD_BOUNDS,
    });
  });

  // The cropper has to be locked to the ratio the server holds a picture to,
  // and the picture has to be fetched back through the variant it was filed
  // under. Both are the server's to decide, so both travel with the rest.
  it('publishes the image shapes and how each is delivered', async () => {
    const configuration = await controller.getConfiguration();

    expect(configuration.imageShapes).toEqual(CUSTOM_TRACKING_IMAGE_SHAPES);
    expect(configuration.imageShapes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          shape: CustomTrackingImageShape.SQUARE,
          aspectWidth: 1,
          aspectHeight: 1,
        }),
      ]),
    );
  });

  // The tag a picture is filed under in Cloudflare is nobody's business but
  // the server's, and publishing it would invite a caller to file one itself.
  it('keeps the Cloudflare entity tag to itself', async () => {
    const configuration = await controller.getConfiguration();

    for (const shape of configuration.imageShapes) {
      expect(shape).not.toHaveProperty('entityTag');
    }
  });
});
