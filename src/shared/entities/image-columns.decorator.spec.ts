import { getMetadataArgsStorage } from 'typeorm';

import {
  IMAGE_ALT_TEXT_COLUMN_LENGTH,
  IMAGE_REFERENCE_COLUMN_LENGTH,
  ImageAltTextColumn,
  ImageReferenceColumn,
} from './image-columns.decorator';

/** Swagger's per-property metadata key, as `@ApiProperty` writes it. */
const API_MODEL_PROPERTIES = 'swagger/apiModelProperties';

class ArtworkHolder {
  @ImageReferenceColumn('Reference of the banner.')
  bannerImageId: string | null;

  @ImageAltTextColumn('What the banner shows.')
  bannerImageAlt: string | null;
}

const columnOptions = (propertyName: string) =>
  getMetadataArgsStorage().columns.find(
    column =>
      column.target === ArtworkHolder && column.propertyName === propertyName,
  )?.options;

const documented = (propertyName: string): unknown =>
  Reflect.getMetadata(
    API_MODEL_PROPERTIES,
    ArtworkHolder.prototype,
    propertyName,
  );

describe('image column decorators', () => {
  it('declares an image reference as an optional varchar of the shared width', () => {
    expect(columnOptions('bannerImageId')).toEqual({
      type: 'varchar',
      length: IMAGE_REFERENCE_COLUMN_LENGTH,
      nullable: true,
      default: null,
    });
  });

  it('declares alternative text as an optional varchar of the shared width', () => {
    expect(columnOptions('bannerImageAlt')).toEqual({
      type: 'varchar',
      length: IMAGE_ALT_TEXT_COLUMN_LENGTH,
      nullable: true,
      default: null,
    });
  });

  it('documents both as nullable, with the description given', () => {
    expect(documented('bannerImageId')).toEqual(
      expect.objectContaining({
        description: 'Reference of the banner.',
        nullable: true,
      }),
    );
    expect(documented('bannerImageAlt')).toEqual(
      expect.objectContaining({
        description: 'What the banner shows.',
        nullable: true,
      }),
    );
  });
});
