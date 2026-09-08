import { DataSource } from 'typeorm';

import { CustomTrackingFieldEntity } from './custom-tracking-field.entity';
import { CustomTrackingSectionEntity } from './custom-tracking-section.entity';
import { CustomTrackingTabEntity } from './custom-tracking-tab.entity';

/** Builds real ORM metadata without opening a database connection. */
class MetadataSource extends DataSource {
  async build(): Promise<void> {
    await this.buildMetadatas();
  }
}

describe('inherited custom tracking columns', () => {
  const entities = [
    CustomTrackingSectionEntity,
    CustomTrackingTabEntity,
    CustomTrackingFieldEntity,
  ];
  const source = new MetadataSource({ type: 'postgres', entities });

  beforeAll(async () => source.build());

  it.each(entities)(
    'retains identity, ordering, visibility and soft deletion for %p',
    Entity => {
      const metadata = source.getMetadata(Entity);
      const column = (name: string) =>
        metadata.findColumnWithPropertyName(name);
      expect(metadata.primaryColumns.map(item => item.propertyName)).toEqual([
        'id',
      ]);
      expect(column('id')?.generationStrategy).toBe('uuid');
      expect(column('name')?.length).toBe('100');
      expect(column('nameNormalized')?.length).toBe('100');
      expect(column('description')?.isNullable).toBe(true);
      expect(column('description')?.length).toBe('500');
      expect(column('publiclyVisible')?.default).toBe(false);
      expect(column('suppressedAt')?.isNullable).toBe(true);
      expect(column('suppressedByUserId')?.isNullable).toBe(true);
      expect(metadata.createDateColumn?.propertyName).toBe('createdAt');
      expect(metadata.updateDateColumn?.propertyName).toBe('updatedAt');
      expect(metadata.deleteDateColumn?.propertyName).toBe('deletedAt');
      expect(
        metadata.indices.some(index =>
          index.columns.some(item => item.propertyName === 'orderIndex'),
        ),
      ).toBe(true);
      expect(
        metadata.indices.some(
          index =>
            index.isUnique &&
            index.where === '"deletedAt" IS NULL' &&
            index.columns.some(item => item.propertyName === 'nameNormalized'),
        ),
      ).toBe(true);
    },
  );
});
