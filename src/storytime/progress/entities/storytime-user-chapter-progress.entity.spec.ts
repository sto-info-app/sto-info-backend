import { getMetadataArgsStorage, ValueTransformer } from 'typeorm';
import { ReaderChapterStatus } from '../../enums/reader-chapter-status.enum';
import { StorytimeUserChapterProgressEntity } from './storytime-user-chapter-progress.entity';

describe('StorytimeUserChapterProgressEntity', () => {
  it('stores assigned fields', () => {
    const progress = new StorytimeUserChapterProgressEntity();
    progress.status = ReaderChapterStatus.IN_PROGRESS;
    progress.lastPositionType = 'BLOCK';
    progress.lastPositionValue = 'b12';

    expect(progress.status).toBe(ReaderChapterStatus.IN_PROGRESS);
    expect(progress.lastPositionValue).toBe('b12');
  });

  // Postgres returns `numeric` as a string so precision is not lost in the
  // driver. Left alone, the API would emit "42.00" where the reader page
  // expects a number, and every comparison against it would be a string
  // comparison.
  describe('the progressPercent transformer', () => {
    const column = getMetadataArgsStorage().columns.find(
      candidate =>
        candidate.target === StorytimeUserChapterProgressEntity &&
        candidate.propertyName === 'progressPercent',
    );
    const transformer = column?.options.transformer as ValueTransformer;

    it('is applied to the column', () => {
      expect(transformer).toBeDefined();
    });

    it('reads a stored percentage back as a number', () => {
      expect(transformer.from('42.00')).toBe(42);
    });

    it('keeps a fractional percentage', () => {
      expect(transformer.from('42.50')).toBe(42.5);
    });

    it('reads an unrecorded percentage as nothing', () => {
      expect(transformer.from(null)).toBeNull();
    });

    it('stores a percentage unchanged', () => {
      expect(transformer.to(42.5)).toBe(42.5);
    });

    it('stores nothing for an unrecorded percentage', () => {
      expect(transformer.to(null)).toBeNull();
    });
  });
});
