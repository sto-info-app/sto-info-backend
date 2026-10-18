import { Logger } from '@nestjs/common';

import { DataSource } from 'typeorm';

import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';

import { StorytimeArcEntity } from '../arcs/entities/storytime-arc.entity';
import { StorytimeChapterEntity } from '../chapters/entities/storytime-chapter.entity';
import { StorytimeCharacterEntity } from '../characters/entities/storytime-character.entity';
import { STORYTIME_DELETION_REASONS } from '../constants/storytime-deletion.constants';
import { StorytimeImageSlot } from '../enums/storytime-image-slot.enum';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import {
  DeletedWorkPicture,
  STORYTIME_DELETED_ARTWORK_SWEEP_LOCK,
  StorytimeDeletedArtworkSweepService,
} from './storytime-deleted-artwork-sweep.service';
import { StorytimeImageService } from './storytime-image.service';

/** Where each entity's table is, as the database metadata would say. */
const TABLES = new Map<unknown, { schema?: string; tableName: string }>([
  [
    StorytimeStoryEntity,
    { schema: 'sto_info_app', tableName: 'storytime_story' },
  ],
  [
    StorytimeChapterEntity,
    { schema: 'sto_info_app', tableName: 'storytime_chapter' },
  ],
  [
    StorytimeCharacterEntity,
    { schema: 'sto_info_app', tableName: 'storytime_character' },
  ],
  [StorytimeArcEntity, { schema: 'sto_info_app', tableName: 'storytime_arc' }],
  [FileAssetEntity, { schema: 'sto_info_app', tableName: 'file_asset' }],
]);

const BANNER: DeletedWorkPicture = {
  slot: StorytimeImageSlot.STORY_BANNER,
  entityId: 'story-1',
  imageId: 'banner-1',
  reason: STORYTIME_DELETION_REASONS.STORY,
};

const PORTRAIT: DeletedWorkPicture = {
  slot: StorytimeImageSlot.CHARACTER_PORTRAIT,
  entityId: 'character-1',
  imageId: 'portrait-1',
  reason: STORYTIME_DELETION_REASONS.CHARACTER,
};

describe('StorytimeDeletedArtworkSweepService', () => {
  let service: StorytimeDeletedArtworkSweepService;
  let runner: {
    connect: jest.Mock;
    query: jest.Mock;
    release: jest.Mock;
  };
  let dataSource: {
    createQueryRunner: jest.Mock;
    getMetadata: jest.Mock;
    query: jest.Mock;
  };
  let images: { withdraw: jest.Mock };
  let locked: boolean;

  beforeEach(() => {
    locked = true;
    runner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string) =>
        Promise.resolve(
          sql.includes('pg_try_advisory_lock') ? [{ locked }] : [],
        ),
      ),
      release: jest.fn().mockResolvedValue(undefined),
    };
    dataSource = {
      createQueryRunner: jest.fn(() => runner),
      getMetadata: jest.fn((entity: unknown) => TABLES.get(entity)),
      query: jest.fn().mockResolvedValue([]),
    };
    images = { withdraw: jest.fn().mockResolvedValue(undefined) };
    service = new StorytimeDeletedArtworkSweepService(
      dataSource as unknown as DataSource,
      images as unknown as StorytimeImageService,
    );
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('findPictures', () => {
    it('looks for still-served pictures on deleted Stories, Chapters, Characters and Arcs', async () => {
      await service.findPictures();

      const [sql, parameters] = dataSource.query.mock.calls[0] as [
        string,
        unknown[],
      ];

      expect(sql).toContain('"sto_info_app"."storytime_story" s');
      expect(sql).toContain('"sto_info_app"."storytime_chapter" c');
      expect(sql).toContain('"sto_info_app"."storytime_character" ch');
      expect(sql).toContain('"sto_info_app"."storytime_arc" r');
      expect(sql).toContain('JOIN "sto_info_app"."file_asset" a');
      expect(sql).toContain('s."bannerImageId"');
      expect(sql).toContain('s."profileImageId"');
      expect(sql).toContain('c."coverImageId"');
      expect(sql).toContain('ch."portraitImageId"');
      expect(sql).toContain('r."bannerImageId"');
      expect(sql).toContain('r."profileImageId"');
      expect(sql).toContain('a."state"::text = ANY($8::text[])');
      expect(parameters).toEqual([
        StorytimeImageSlot.STORY_BANNER,
        StorytimeImageSlot.STORY_PROFILE,
        StorytimeImageSlot.CHAPTER_COVER,
        StorytimeImageSlot.CHARACTER_PORTRAIT,
        STORYTIME_DELETION_REASONS.STORY,
        STORYTIME_DELETION_REASONS.CHAPTER,
        STORYTIME_DELETION_REASONS.CHARACTER,
        [FileAssetState.AVAILABLE, FileAssetState.UNVERIFIED],
        StorytimeImageSlot.ARC_BANNER,
        StorytimeImageSlot.ARC_PROFILE,
        STORYTIME_DELETION_REASONS.ARC,
      ]);
    });

    // A Chapter or Character deleted with its Story is put down to the Story.
    it('blames the Story for what was deleted with it', async () => {
      await service.findPictures();

      const [sql] = dataSource.query.mock.calls[0] as [string];

      expect(sql).toContain(
        'CASE WHEN s."deletedAt" IS NOT NULL THEN $5::text ELSE $6::text END',
      );
      expect(sql).toContain(
        'CASE WHEN s."deletedAt" IS NOT NULL THEN $5::text ELSE $7::text END',
      );
    });

    it('names a table without a schema on its own', async () => {
      dataSource.getMetadata.mockImplementation((entity: unknown) => ({
        tableName: TABLES.get(entity)?.tableName,
      }));

      await service.findPictures();

      expect(dataSource.query.mock.calls[0][0]).toContain(
        'FROM "storytime_story" s',
      );
    });
  });

  describe('sweep', () => {
    it('withdraws each picture with the reason found for it', async () => {
      dataSource.query.mockResolvedValue([BANNER, PORTRAIT]);

      await expect(service.sweep()).resolves.toBe(2);

      expect(images.withdraw.mock.calls).toEqual([
        [BANNER.slot, BANNER.entityId, BANNER.imageId, BANNER.reason],
        [PORTRAIT.slot, PORTRAIT.entityId, PORTRAIT.imageId, PORTRAIT.reason],
      ]);
      expect(Logger.prototype.log).toHaveBeenCalledWith(
        '[sweep] Deleted Storytime artwork withdrawn - Withdrawn: 2, Failed: 0',
      );
    });

    it('logs a picture it cannot withdraw and goes on to the next', async () => {
      const failed = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      dataSource.query.mockResolvedValue([BANNER, PORTRAIT]);
      images.withdraw.mockRejectedValueOnce(new Error('registry down'));

      await expect(service.sweep()).resolves.toBe(1);

      expect(failed).toHaveBeenCalledWith(
        '[sweep] Not withdrawn - Slot: STORY_BANNER, EntityId: story-1, ImageId: banner-1',
        expect.stringContaining('registry down'),
      );
      expect(images.withdraw).toHaveBeenCalledTimes(2);
    });

    it('logs a failure that is not an Error as it is', async () => {
      const failed = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      dataSource.query.mockResolvedValue([BANNER]);
      images.withdraw.mockRejectedValueOnce('refused');

      await service.sweep();

      expect(failed).toHaveBeenCalledWith(expect.any(String), 'refused');
    });

    it('says nothing when there is nothing to withdraw', async () => {
      jest.mocked(Logger.prototype.log).mockClear();

      await expect(service.sweep()).resolves.toBe(0);

      expect(Logger.prototype.log).not.toHaveBeenCalledWith(
        expect.stringContaining('[sweep]'),
      );
    });
  });

  describe('run', () => {
    it('sweeps under the lock and lets it go', async () => {
      dataSource.query.mockResolvedValue([BANNER]);

      await expect(service.run()).resolves.toBe(1);

      expect(runner.query).toHaveBeenCalledWith(
        'SELECT pg_try_advisory_lock($1::bigint) AS "locked"',
        [STORYTIME_DELETED_ARTWORK_SWEEP_LOCK],
      );
      expect(runner.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_unlock($1::bigint)',
        [STORYTIME_DELETED_ARTWORK_SWEEP_LOCK],
      );
      expect(runner.release).toHaveBeenCalled();
    });

    // Instances starting together take turns.
    it('leaves it to the instance holding the lock', async () => {
      locked = false;

      await expect(service.run()).resolves.toBeNull();

      expect(dataSource.query).not.toHaveBeenCalled();
      expect(runner.release).toHaveBeenCalled();
    });

    it('lets the lock go even when the sweep fails, and never throws', async () => {
      const failed = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      dataSource.query.mockRejectedValue(new Error('connection lost'));

      await expect(service.run()).resolves.toBeNull();

      expect(runner.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_unlock($1::bigint)',
        [STORYTIME_DELETED_ARTWORK_SWEEP_LOCK],
      );
      expect(failed).toHaveBeenCalledWith(
        '[run] Deleted Storytime artwork not swept',
        expect.stringContaining('connection lost'),
      );
      expect(runner.release).toHaveBeenCalled();
    });

    it('logs a failure that is not an Error as it is', async () => {
      const failed = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      runner.connect.mockRejectedValueOnce('no database');

      await expect(service.run()).resolves.toBeNull();

      expect(failed).toHaveBeenCalledWith(expect.any(String), 'no database');
    });
  });

  // In the background, so a slow Cloudflare never holds the start up.
  it('starts a run at start-up without waiting for it', () => {
    const run = jest.spyOn(service, 'run').mockResolvedValue(0);

    expect(service.onApplicationBootstrap()).toBeUndefined();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
