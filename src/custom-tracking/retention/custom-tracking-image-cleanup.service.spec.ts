import { jest } from '@jest/globals';
import { EntityManager, Repository } from 'typeorm';

import {
  ImageReleaseOutcome,
  ImageSlotService,
} from 'src/shared/images/image-slot.service';

import { CustomTrackingImageCleanupEntity } from '../entities/custom-tracking-image-cleanup.entity';
import { CustomTrackingImageCleanupReason } from '../enums/custom-tracking-image-cleanup-reason.enum';
import { CustomTrackingObservabilityService } from '../observability/custom-tracking-observability.service';
import { CustomTrackingImageCleanupService } from './custom-tracking-image-cleanup.service';

describe('CustomTrackingImageCleanupService', () => {
  let service: CustomTrackingImageCleanupService;
  let find: jest.Mock<
    (...args: unknown[]) => Promise<CustomTrackingImageCleanupEntity[]>
  >;
  let count: jest.Mock<() => Promise<number>>;
  let remove: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  let update: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  let tryRelease: jest.Mock<(imageId: string) => Promise<ImageReleaseOutcome>>;
  let imagesReconciled: jest.Mock<(...args: unknown[]) => void>;
  let imageCleanupStuck: jest.Mock<(...args: unknown[]) => void>;

  let insertValues: unknown;
  let orIgnored: boolean;
  let manager: EntityManager;

  const queued = (
    overrides: Partial<CustomTrackingImageCleanupEntity> = {},
  ): CustomTrackingImageCleanupEntity =>
    ({
      id: 'queue-1',
      cloudflareImageId: 'image-1',
      reason: CustomTrackingImageCleanupReason.REPLACED,
      attempts: 0,
      lastAttemptedAt: null,
      lastError: null,
      ...overrides,
    }) as CustomTrackingImageCleanupEntity;

  beforeEach(() => {
    find = jest.fn(async () => []);
    count = jest.fn(async () => 0);
    remove = jest.fn(async () => undefined);
    update = jest.fn(async () => undefined);
    tryRelease = jest.fn(async () => ({ released: true, error: null }));
    imagesReconciled = jest.fn();
    imageCleanupStuck = jest.fn();

    insertValues = undefined;
    orIgnored = false;

    manager = {
      createQueryBuilder: () => ({
        insert: () => ({
          into: () => ({
            values: (rows: unknown) => {
              insertValues = rows;

              return {
                orIgnore: () => {
                  orIgnored = true;

                  return { execute: async () => undefined };
                },
              };
            },
          }),
        }),
      }),
    } as unknown as EntityManager;

    service = new CustomTrackingImageCleanupService(
      {
        find,
        count,
        delete: remove,
        update,
      } as unknown as Repository<CustomTrackingImageCleanupEntity>,
      { tryRelease } as unknown as ImageSlotService,
      {
        imagesReconciled,
        imageCleanupStuck,
      } as unknown as CustomTrackingObservabilityService,
    );
  });

  describe('enqueue', () => {
    it('writes one row per picture, through the caller’s transaction', async () => {
      await service.enqueue(
        manager,
        ['image-1', 'image-2'],
        CustomTrackingImageCleanupReason.RETENTION,
      );

      expect(insertValues).toEqual([
        {
          cloudflareImageId: 'image-1',
          reason: CustomTrackingImageCleanupReason.RETENTION,
        },
        {
          cloudflareImageId: 'image-2',
          reason: CustomTrackingImageCleanupReason.RETENTION,
        },
      ]);
    });

    // A replacement that is retried, or a sweep that runs twice over the same
    // night, has to write the same row rather than a second one to delete
    // twice.
    it('is safe to repeat', async () => {
      await service.enqueue(
        manager,
        ['image-1'],
        CustomTrackingImageCleanupReason.REPLACED,
      );

      expect(orIgnored).toBe(true);
    });

    it('writes nothing when there is nothing to queue', async () => {
      await service.enqueue(
        manager,
        [],
        CustomTrackingImageCleanupReason.REPLACED,
      );

      expect(insertValues).toBeUndefined();
    });
  });

  describe('flush', () => {
    it('deletes the picture and tears up the note', async () => {
      find.mockResolvedValue([queued()]);

      await service.flush(['image-1']);

      expect(tryRelease).toHaveBeenCalledWith('image-1');
      expect(remove).toHaveBeenCalledWith({ id: 'queue-1' });
    });

    // The note is the only record that the picture is there, so a failure has
    // to leave it where it is.
    it('leaves the note when Cloudflare refuses', async () => {
      find.mockResolvedValue([queued()]);
      tryRelease.mockResolvedValue({
        released: false,
        error: 'Cloudflare said no',
      });

      await service.flush(['image-1']);

      expect(remove).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledWith(
        { id: 'queue-1' },
        expect.objectContaining({
          attempts: 1,
          lastError: 'Cloudflare said no',
        }),
      );
    });

    it('asks nothing when there is nothing to flush', async () => {
      await service.flush([]);

      expect(find).not.toHaveBeenCalled();
    });
  });

  describe('reconcile', () => {
    it('works the queue oldest first and reports what it managed', async () => {
      count.mockResolvedValue(3);
      find.mockResolvedValue([queued(), queued({ id: 'queue-2' })]);

      await expect(service.reconcile()).resolves.toEqual({
        queued: 3,
        attempted: 2,
        deleted: 2,
        failed: 0,
      });

      expect(find).toHaveBeenCalledWith(
        expect.objectContaining({ order: { createdAt: 'ASC' } }),
      );
      expect(imagesReconciled).toHaveBeenCalled();
    });

    it('counts the ones that would not go', async () => {
      count.mockResolvedValue(1);
      find.mockResolvedValue([queued()]);
      tryRelease.mockResolvedValue({ released: false, error: 'no' });

      await expect(service.reconcile()).resolves.toEqual({
        queued: 1,
        attempted: 1,
        deleted: 0,
        failed: 1,
      });
    });

    // Ten consecutive failures is not a passing fault, and repeating a warning
    // forever at the same level as a timeout is how it gets ignored.
    it('reports a picture that has failed too often as a fault', async () => {
      count.mockResolvedValue(1);
      find.mockResolvedValue([queued({ attempts: 9 })]);
      tryRelease.mockResolvedValue({ released: false, error: 'still no' });

      await service.reconcile();

      expect(imageCleanupStuck).toHaveBeenCalledWith(
        'image-1',
        CustomTrackingImageCleanupReason.REPLACED,
        10,
      );
    });

    it('says nothing about a picture on its first failure', async () => {
      count.mockResolvedValue(1);
      find.mockResolvedValue([queued()]);
      tryRelease.mockResolvedValue({ released: false, error: 'no' });

      await service.reconcile();

      expect(imageCleanupStuck).not.toHaveBeenCalled();
    });

    it('cuts a very long error short', async () => {
      count.mockResolvedValue(1);
      find.mockResolvedValue([queued()]);
      tryRelease.mockResolvedValue({
        released: false,
        error: 'x'.repeat(400),
      });

      await service.reconcile();

      expect(
        (update.mock.calls[0][1] as { lastError: string }).lastError,
      ).toHaveLength(300);
    });
  });
});
