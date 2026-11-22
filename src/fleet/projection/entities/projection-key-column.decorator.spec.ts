import { getMetadataArgsStorage } from 'typeorm';

import { ProjectionKeyColumn } from './projection-key-column.decorator';

/** Swagger's per-property metadata key, as `@ApiProperty` writes it. */
const API_MODEL_PROPERTIES = 'swagger/apiModelProperties';

class ProjectionRow {
  @ProjectionKeyColumn('The Fleet.', 'uuid')
  fleetId: string;

  @ProjectionKeyColumn('The revision.', 'integer')
  revision: number;
}

const columnOptions = (propertyName: string) =>
  getMetadataArgsStorage().columns.find(
    column =>
      column.target === ProjectionRow && column.propertyName === propertyName,
  )?.options;

describe('ProjectionKeyColumn', () => {
  it('declares a required column of the type given', () => {
    expect(columnOptions('fleetId')).toEqual({
      type: 'uuid',
      nullable: false,
    });
    expect(columnOptions('revision')).toEqual({
      type: 'integer',
      nullable: false,
    });
  });

  it('documents the column with the description given', () => {
    expect(
      Reflect.getMetadata(
        API_MODEL_PROPERTIES,
        ProjectionRow.prototype,
        'revision',
      ),
    ).toEqual(expect.objectContaining({ description: 'The revision.' }));
  });
});
