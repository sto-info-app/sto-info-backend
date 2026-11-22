import { Logger } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Job } from 'bullmq';

import { ROLES_KEY } from 'src/auth/roles.decorator';
import { UserRole } from 'src/user/enums/user-role.enum';

import { ImageEstateRunEntity } from './image-estate-run.entity';
import { ImageEstateController } from './image-estate.controller';
import {
  ImageEstateRunKind,
  ImageEstateRunState,
  ImageInventoryRunState,
} from './image-estate.enums';
import { ImageEstateProcessor } from './image-estate.processor';
import { ImageEstateService } from './image-estate.service';
import { rowsOf } from './image-estate.utility';
import { ImageInventoryRunEntity } from './image-inventory-run.entity';
import { ImageInventoryService } from './image-inventory.service';
import { isGeneratedImageId, isR2Key } from './image-references';

type Fn = jest.Mock<(...args: any[]) => any>;

const RUN = {
  id: 'run-1',
  kind: ImageEstateRunKind.COPY,
  state: ImageEstateRunState.RUNNING,
  startedByUserId: 'admin-1',
  cursor: 'asset-9',
  counts: { copied: 2 },
  lastError: null,
  createdAt: new Date('2026-09-29T10:00:00.000Z'),
  updatedAt: new Date('2026-09-29T10:01:00.000Z'),
  finishedAt: null,
} as ImageEstateRunEntity;

const INVENTORY = {
  id: 'inventory-1',
  state: ImageInventoryRunState.DONE,
  startedByUserId: 'admin-1',
  report: { steps: {} },
  error: null,
  createdAt: new Date('2026-09-29T09:00:00.000Z'),
  finishedAt: new Date('2026-09-29T09:01:00.000Z'),
} as ImageInventoryRunEntity;

const RUN_DTO = {
  id: 'run-1',
  kind: ImageEstateRunKind.COPY,
  state: ImageEstateRunState.RUNNING,
  counts: { copied: 2 },
  lastError: null,
  createdAt: RUN.createdAt,
  finishedAt: null,
};

describe('Image estate routes and jobs (FC-040)', () => {
  let estate: Record<string, Fn>;
  let inventory: Record<string, Fn>;
  let controller: ImageEstateController;

  beforeEach(() => {
    estate = {
      status: jest.fn(() =>
        Promise.resolve({
          signingEnabled: true,
          remaining: 4,
          steps: { COPIED: 2 },
          run: RUN,
        }),
      ),
      start: jest.fn(() => Promise.resolve(RUN)),
      pause: jest.fn(() => Promise.resolve(RUN)),
      resume: jest.fn(() => Promise.resolve(RUN)),
      processBatch: jest.fn(() => Promise.resolve()),
    };
    inventory = {
      latest: jest.fn(() => Promise.resolve(INVENTORY)),
      start: jest.fn(() => Promise.resolve(INVENTORY)),
      run: jest.fn(() => Promise.resolve()),
    };
    controller = new ImageEstateController(
      estate as unknown as ImageEstateService,
      inventory as unknown as ImageInventoryService,
    );
  });

  describe('ImageEstateController', () => {
    it('is for administrators only, at admin/image-estate', () => {
      expect(Reflect.getMetadata(ROLES_KEY, ImageEstateController)).toEqual([
        UserRole.ADMIN,
      ]);
      expect(Reflect.getMetadata(PATH_METADATA, ImageEstateController)).toBe(
        'admin/image-estate',
      );
    });

    it('reads where the estate stands, with the last run and inventory', async () => {
      await expect(controller.status()).resolves.toEqual({
        signingEnabled: true,
        remaining: 4,
        steps: { COPIED: 2 },
        run: RUN_DTO,
        inventory: {
          id: 'inventory-1',
          state: ImageInventoryRunState.DONE,
          report: { steps: {} },
          error: null,
          createdAt: INVENTORY.createdAt,
          finishedAt: INVENTORY.finishedAt,
        },
      });
    });

    it('reads a status with neither', async () => {
      estate.status.mockResolvedValue({
        signingEnabled: false,
        remaining: 0,
        steps: {},
        run: null,
      });
      inventory.latest.mockResolvedValue(null);

      await expect(controller.status()).resolves.toEqual(
        expect.objectContaining({ run: null, inventory: null }),
      );
    });

    it('passes each action to its service, with the admin and reason', async () => {
      await expect(controller.inventory('admin-1')).resolves.toEqual(
        expect.objectContaining({ id: 'inventory-1' }),
      );
      expect(inventory.start).toHaveBeenCalledWith('admin-1');

      await expect(
        controller.start('admin-1', {
          kind: ImageEstateRunKind.UNDO,
          reason: 'Rolling back',
        }),
      ).resolves.toEqual(RUN_DTO);
      expect(estate.start).toHaveBeenCalledWith(
        ImageEstateRunKind.UNDO,
        'admin-1',
        'Rolling back',
      );

      await controller.pause('admin-1', { reason: 'Checking' });
      expect(estate.pause).toHaveBeenCalledWith('admin-1', 'Checking');

      await controller.resume('admin-1', { reason: 'Checked' });
      expect(estate.resume).toHaveBeenCalledWith('admin-1', 'Checked');
    });
  });

  describe('ImageEstateProcessor', () => {
    /**
     * A job.
     *
     * @param name - Its name.
     * @param data - Its payload.
     * @returns It.
     */
    const job = (name: string, data: unknown) =>
      ({ id: 'job-1', name, data }) as Job<unknown>;

    it('runs a batch and an inventory, and drops anything else', async () => {
      const processor = new ImageEstateProcessor(
        estate as unknown as ImageEstateService,
        inventory as unknown as ImageInventoryService,
      );
      const error = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await processor.process(job('batch', { runId: 'run-1' }));
      await processor.process(job('inventory', { inventoryId: 'inventory-1' }));
      await processor.process(job('batch', { runId: 7 }));
      await processor.process(job('inventory', {}));
      await processor.process(job('other', null));

      expect(estate.processBatch).toHaveBeenCalledTimes(1);
      expect(estate.processBatch).toHaveBeenCalledWith('run-1');
      expect(inventory.run).toHaveBeenCalledTimes(1);
      expect(inventory.run).toHaveBeenCalledWith('inventory-1');
      expect(error).toHaveBeenCalledTimes(3);
    });
  });

  describe('helpers', () => {
    it.each([
      ['user-1/character-1/portrait.png', true],
      ['local-user-1-profile', false],
    ])('reads %s as an R2 key: %s', (reference, expected) => {
      expect(isR2Key(reference)).toBe(expected);
    });

    it.each([
      ['0b8f3a52-6b1c-4d2e-9f00-1a2b3c4d5e6f', true],
      ['local-1d730bb8-b732-4f50-af97-a991e0010aa3-user-1', false],
    ])('reads %s as a generated ID: %s', (reference, expected) => {
      expect(isGeneratedImageId(reference)).toBe(expected);
    });

    it.each([
      ['an UPDATE result', [[{ id: 'a' }], 1], [{ id: 'a' }]],
      [
        'a SELECT result',
        [{ id: 'a' }, { id: 'b' }],
        [{ id: 'a' }, { id: 'b' }],
      ],
      ['nothing', undefined, []],
    ])('reads the rows out of %s', (_case, result, rows) => {
      expect(rowsOf(result)).toEqual(rows);
    });
  });
});
