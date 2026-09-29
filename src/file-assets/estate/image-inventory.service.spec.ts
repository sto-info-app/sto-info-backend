import { ConflictException, Logger } from '@nestjs/common';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';

import { ImageUploadsService } from 'src/shared/utilities/image-uploads.service';

import { ImageInventoryRunState } from './image-estate.enums';
import { ImageInventoryRunEntity } from './image-inventory-run.entity';
import { ImageInventoryService } from './image-inventory.service';
import { IMAGE_REFERENCE_COLUMNS } from './image-references';

type Fn = jest.Mock<(...args: any[]) => any>;

describe('ImageInventoryService (FC-040)', () => {
  let manager: Record<string, Fn>;
  let query: Fn;
  let listImages: Fn;
  let add: Fn;
  let service: ImageInventoryService;
  let answers: { match: string; rows: unknown }[];

  beforeEach(() => {
    answers = [];
    query = jest.fn((sql: string) =>
      Promise.resolve(
        answers.find(answer => sql.includes(answer.match))?.rows ?? [],
      ),
    );
    manager = {
      find: jest.fn(() => Promise.resolve([])),
      exists: jest.fn(() => Promise.resolve(false)),
      save: jest.fn((_entity: unknown, value: unknown) =>
        Promise.resolve({ id: 'inventory-1', ...(value as object) }),
      ),
      create: jest.fn((_entity: unknown, value: unknown) => ({
        ...(value as object),
      })),
      update: jest.fn(() => Promise.resolve({ affected: 1 })),
    };
    listImages = jest.fn(() =>
      Promise.resolve({ images: [], continuationToken: null }),
    );
    add = jest.fn(() => Promise.resolve());
    service = new ImageInventoryService(
      { manager, query } as unknown as DataSource,
      { listImages, environment: 'local' } as unknown as ImageUploadsService,
      { add } as unknown as Queue,
    );
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  /** What the inventory was saved with. */
  const saved = () =>
    manager.update.mock.calls[0][2] as {
      state: ImageInventoryRunState;
      report: Record<string, any>;
      error: string | null;
    };

  it('reads the latest inventory, or none', async () => {
    await expect(service.latest()).resolves.toBeNull();

    manager.find.mockResolvedValue([{ id: 'inventory-1' }]);

    await expect(service.latest()).resolves.toEqual({ id: 'inventory-1' });
  });

  it('starts one inventory at a time, and queues it', async () => {
    await expect(service.start('admin-1')).resolves.toEqual(
      expect.objectContaining({ id: 'inventory-1' }),
    );
    expect(add).toHaveBeenCalledWith(
      'inventory',
      { inventoryId: 'inventory-1' },
      expect.anything(),
    );

    manager.exists.mockResolvedValue(true);

    await expect(service.start('admin-1')).rejects.toThrow(ConflictException);
  });

  it('counts every column, the registry and the copies, and reconciles Cloudflare', async () => {
    answers.push(
      {
        match: 'FILTER (WHERE EXISTS',
        rows: [{ rows: 4, registered: 3, r2: 1 }],
      },
      {
        match: 'GROUP BY 1, 2, 3, 4',
        rows: [
          {
            kind: 'PROFILE_IMAGE',
            state: 'UNVERIFIED',
            storage: 'PUBLIC_IMAGES',
            deliveryPrivate: false,
            count: 2,
          },
        ],
      },
      {
        match: 'FROM "sto_info_app"."image_estate_step" GROUP BY',
        rows: [{ state: 'COPIED', count: 1 }],
      },
      {
        match: 'SELECT "deliveryReference" AS "reference"',
        rows: [{ reference: 'known-1' }, { reference: 'private-1' }],
      },
      {
        match: 'SELECT "fromReference" AS "reference"',
        rows: [{ reference: 'local-old-1' }],
      },
      {
        match: 'SELECT "id", "deliveryReference" AS "reference"',
        rows: [
          { id: 'asset-1', reference: 'known-1' },
          { id: 'asset-2', reference: 'vanished-1' },
        ],
      },
    );
    listImages
      .mockResolvedValueOnce({
        images: [
          { id: 'known-1', requireSignedURLs: false, meta: { env: 'local' } },
          { id: 'local-old-1', requireSignedURLs: false, meta: {} },
          { id: 'orphan-1', requireSignedURLs: true, meta: { env: 'local' } },
        ],
        continuationToken: 'next',
      })
      .mockResolvedValueOnce({
        images: [
          { id: 'private-1', requireSignedURLs: true, meta: { env: 'local' } },
          { id: 'dev-other', requireSignedURLs: false, meta: {} },
          { id: 'site-icon', requireSignedURLs: false, meta: {} },
        ],
        continuationToken: null,
      });

    await service.run('inventory-1');

    expect(listImages).toHaveBeenNthCalledWith(2, 'next');
    expect(manager.update).toHaveBeenCalledWith(
      ImageInventoryRunEntity,
      { id: 'inventory-1' },
      expect.objectContaining({
        state: ImageInventoryRunState.DONE,
        error: null,
        finishedAt: expect.any(Date),
      }),
    );

    const { report } = saved();

    expect(report.references).toHaveLength(IMAGE_REFERENCE_COLUMNS.length);
    expect(report.references[0]).toEqual({
      table: 'user_profile',
      column: 'profilePictureId',
      rows: 4,
      registered: 3,
      r2: 1,
    });
    expect(report.registry).toHaveLength(1);
    expect(report.steps).toEqual({ COPIED: 1 });
    expect(report.cloudflare).toEqual({
      listed: 4,
      private: 2,
      public: 2,
      orphans: 1,
      orphanIds: ['orphan-1'],
      awaitingRetirement: 1,
      missing: 1,
      missingAssetIds: ['asset-2'],
      elsewhere: 2,
    });
  });

  it.each([
    ['an error', new Error('Cloudflare is down')],
    ['something that is not an error', 'down'],
  ])(
    'still reports the database when Cloudflare fails with %s',
    async (_case, failure) => {
      listImages.mockRejectedValue(failure);

      await service.run('inventory-1');

      expect(saved()).toEqual(
        expect.objectContaining({
          state: ImageInventoryRunState.FAILED,
          error: expect.stringContaining('down'),
          report: expect.objectContaining({ cloudflare: null }),
        }),
      );
    },
  );
});
