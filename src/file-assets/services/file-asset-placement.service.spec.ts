import { jest } from '@jest/globals';
import { LessThan, Repository } from 'typeorm';

import { FileAssetPlacementEntity } from '../entities/file-asset-placement.entity';
import { FileAssetPlacementState } from '../enums/file-asset-placement-state.enum';
import { FileAssetSlot } from '../enums/file-asset-slot.enum';
import { FileAssetSubject } from '../enums/file-asset-subject.enum';
import { FileAssetPlacementService } from './file-asset-placement.service';

/**
 * Builds a placement row.
 *
 * @param overrides - Whatever the case is actually about.
 * @returns The placement.
 */
const placement = (
  overrides: Partial<FileAssetPlacementEntity> = {},
): FileAssetPlacementEntity =>
  ({
    id: 'placement-1',
    assetId: 'asset-1',
    state: FileAssetPlacementState.PENDING,
    subject: FileAssetSubject.STORYTIME_STORY,
    subjectId: 'story-1',
    slot: FileAssetSlot.BANNER,
    detail: null,
    settledAt: null,
    createdAt: new Date('2026-09-20T10:00:00.000Z'),
    updatedAt: new Date('2026-09-20T10:00:00.000Z'),
    ...overrides,
  }) as FileAssetPlacementEntity;

describe('FileAssetPlacementService', () => {
  let repository: {
    create: jest.Mock<(...args: any[]) => any>;
    save: jest.Mock<(...args: any[]) => Promise<any>>;
    find: jest.Mock<(...args: any[]) => Promise<any>>;
    findOne: jest.Mock<(...args: any[]) => Promise<any>>;
  };
  let service: FileAssetPlacementService;

  beforeEach(() => {
    repository = {
      create: jest.fn((input: unknown) => ({
        id: 'placement-2',
        ...(input as object),
      })),
      save: jest.fn((row: unknown) => Promise.resolve(row)),
      find: jest.fn(() => Promise.resolve([])),
      findOne: jest.fn(() => Promise.resolve(null)),
    };

    service = new FileAssetPlacementService(
      repository as unknown as Repository<FileAssetPlacementEntity>,
    );
  });

  describe('placePending', () => {
    it('claims the slot for the new upload', async () => {
      const outcome = await service.placePending({
        assetId: 'asset-2',
        subject: FileAssetSubject.STORYTIME_STORY,
        subjectId: 'story-1',
        slot: FileAssetSlot.BANNER,
        detail: { entityTag: 'storytime-story-banner', entityId: 'story-1' },
      });

      expect(outcome.superseded).toBeNull();
      expect(outcome.placement.state).toBe(FileAssetPlacementState.PENDING);
      expect(outcome.placement.settledAt).toBeNull();
    });

    it('records nothing for a feature that asked for nothing', async () => {
      await service.placePending({
        assetId: 'asset-2',
        subject: FileAssetSubject.USER_PROFILE,
        subjectId: 'user-1',
        slot: FileAssetSlot.PICTURE,
      });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ detail: null }),
      );
    });

    // The last thing somebody sent is the thing they get, and the pending
    // index would refuse a second row anyway.
    it('supersedes an upload already on its way to the same slot', async () => {
      const existing = placement();

      repository.findOne.mockResolvedValueOnce(existing);

      const outcome = await service.placePending({
        assetId: 'asset-2',
        subject: FileAssetSubject.STORYTIME_STORY,
        subjectId: 'story-1',
        slot: FileAssetSlot.BANNER,
      });

      expect(outcome.superseded?.state).toBe(
        FileAssetPlacementState.SUPERSEDED,
      );
      expect(outcome.superseded?.settledAt).toBeInstanceOf(Date);
    });
  });

  describe('activate', () => {
    it('makes the placement the one its slot shows', async () => {
      const pending = placement();

      const { active, replaced } = await service.activate(pending);

      expect(active.state).toBe(FileAssetPlacementState.ACTIVE);
      expect(active.settledAt).toBeInstanceOf(Date);
      expect(replaced).toBeNull();
    });

    // The replaced row is how the previous picture's asset is found
    // afterwards, which is what lets a replacement withdraw what it replaced.
    it('supersedes whatever the slot showed before', async () => {
      const previous = placement({
        id: 'placement-0',
        assetId: 'asset-0',
        state: FileAssetPlacementState.ACTIVE,
        settledAt: new Date('2026-09-19T10:00:00.000Z'),
      });

      repository.findOne.mockResolvedValueOnce(previous);

      const { replaced } = await service.activate(placement());

      expect(replaced?.state).toBe(FileAssetPlacementState.SUPERSEDED);
    });
  });

  describe('settle', () => {
    it('records what became of a placement and when', async () => {
      const settled = await service.settle(
        placement(),
        FileAssetPlacementState.REJECTED,
      );

      expect(settled.state).toBe(FileAssetPlacementState.REJECTED);
      expect(settled.settledAt).toBeInstanceOf(Date);
    });
  });

  describe('finding placements', () => {
    it('finds the placement a verdict is about', async () => {
      repository.findOne.mockResolvedValueOnce(placement());

      await expect(service.findByAssetId('asset-1')).resolves.toEqual(
        expect.objectContaining({ assetId: 'asset-1' }),
      );
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { assetId: 'asset-1' },
      });
    });

    it('reports no placement for an asset nothing displays', async () => {
      await expect(service.findByAssetId('asset-9')).resolves.toBeNull();
    });

    // Which of pending, refused or showing matters is decided by which
    // happened last, so the query is ordered rather than filtered.
    it('reports the most recent thing a slot has to say', async () => {
      repository.find.mockResolvedValueOnce([
        placement({ state: FileAssetPlacementState.REJECTED }),
      ]);

      await expect(
        service.findCurrentForSlot(
          FileAssetSubject.STORYTIME_STORY,
          'story-1',
          FileAssetSlot.BANNER,
        ),
      ).resolves.toEqual(
        expect.objectContaining({ state: FileAssetPlacementState.REJECTED }),
      );
      expect(repository.find).toHaveBeenCalledWith(
        expect.objectContaining({ order: { createdAt: 'DESC' }, take: 1 }),
      );
    });

    it('reports nothing for a slot with no history', async () => {
      await expect(
        service.findCurrentForSlot(
          FileAssetSubject.USER_PROFILE,
          'user-1',
          FileAssetSlot.PICTURE,
        ),
      ).resolves.toBeNull();
    });

    it('finds the picture a slot is showing', async () => {
      repository.findOne.mockResolvedValueOnce(
        placement({ state: FileAssetPlacementState.ACTIVE }),
      );

      await expect(
        service.findActiveForSlot(
          FileAssetSubject.STORYTIME_STORY,
          'story-1',
          FileAssetSlot.BANNER,
        ),
      ).resolves.toEqual(
        expect.objectContaining({ state: FileAssetPlacementState.ACTIVE }),
      );
    });

    it('finds uploads that have been pending too long', async () => {
      const before = new Date('2026-09-20T09:00:00.000Z');

      await service.findStalePending(before, 100);

      expect(repository.find).toHaveBeenCalledWith({
        where: {
          state: FileAssetPlacementState.PENDING,
          createdAt: LessThan(before),
        },
        order: { createdAt: 'ASC' },
        take: 100,
      });
    });
  });
});
