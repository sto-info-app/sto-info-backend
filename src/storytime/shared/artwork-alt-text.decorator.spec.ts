import { validateDto } from '../../utils/testing/dto-validation.util';
import { STORYTIME_IMAGE_ALT_MAX_LENGTH } from '../constants/storytime-image.constants';
import {
  ArtworkAltTextProperty,
  trimArtworkAltText,
} from './artwork-alt-text.decorator';

/** Swagger's per-property metadata key, as `@ApiProperty` writes it. */
const API_MODEL_PROPERTIES = 'swagger/apiModelProperties';

class ArtworkUpdate {
  @ArtworkAltTextProperty('banner')
  readonly bannerImageAlt?: string;
}

describe('ArtworkAltTextProperty', () => {
  it('accepts an update that leaves the text out', async () => {
    const { errors } = await validateDto(ArtworkUpdate, {});

    expect(errors).toHaveLength(0);
  });

  it('trims the text before it is checked', async () => {
    const { dto, errors } = await validateDto(ArtworkUpdate, {
      bannerImageAlt: '  A starship at dawn  ',
    });

    expect(errors).toHaveLength(0);
    expect(dto.bannerImageAlt).toBe('A starship at dawn');
  });

  it('refuses text that is only whitespace, naming the slot', async () => {
    const { errors } = await validateDto(ArtworkUpdate, {
      bannerImageAlt: '   ',
    });

    expect(errors[0].constraints).toEqual({
      isNotEmpty: 'Please describe what the banner shows',
    });
  });

  it('refuses text longer than the column holds', async () => {
    const { errors } = await validateDto(ArtworkUpdate, {
      bannerImageAlt: 'x'.repeat(STORYTIME_IMAGE_ALT_MAX_LENGTH + 1),
    });

    expect(Object.keys(errors[0].constraints ?? {})).toEqual(['maxLength']);
  });

  it('refuses something other than text', async () => {
    const { errors } = await validateDto(ArtworkUpdate, {
      bannerImageAlt: 42,
    });

    expect(errors[0].constraints).toEqual(
      expect.objectContaining({ isString: expect.any(String) }),
    );
  });

  it('leaves a value that is not a string to the validators', () => {
    expect(trimArtworkAltText({ value: 42 })).toBe(42);
  });

  it('documents the field as optional, naming the slot', () => {
    expect(
      Reflect.getMetadata(
        API_MODEL_PROPERTIES,
        ArtworkUpdate.prototype,
        'bannerImageAlt',
      ),
    ).toEqual(
      expect.objectContaining({
        required: false,
        description:
          'Alternative text for the banner. Rejected when there is no banner to describe.',
        maxLength: STORYTIME_IMAGE_ALT_MAX_LENGTH,
      }),
    );
  });
});
