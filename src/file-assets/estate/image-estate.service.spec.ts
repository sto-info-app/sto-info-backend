import { ConflictException, Logger } from '@nestjs/common';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';

import { SiteAdminActionEntity } from 'src/audit/site-admin/site-admin-action.entity';
import { SiteAdminActionKind } from 'src/audit/site-admin/site-admin-action.enum';
import { ImageUploadsService } from 'src/shared/utilities/image-uploads.service';

import { FileAssetPlacementEntity } from '../entities/file-asset-placement.entity';
import { FileAssetEntity } from '../entities/file-asset.entity';
import { FileAssetKind } from '../enums/file-asset-kind.enum';
import { FileAssetState } from '../enums/file-asset-state.enum';
import { FileAssetStorage } from '../enums/file-asset-storage.enum';
import { ImageEstateRunEntity } from './image-estate-run.entity';
import { ImageEstateStepEntity } from './image-estate-step.entity';
import { IMAGE_ESTATE_BATCH_SIZE } from './image-estate.constants';
import {
  ImageEstateRunKind,
  ImageEstateRunState,
  ImageEstateStepState,
} from './image-estate.enums';
import { ImageEstateService } from './image-estate.service';
import { IMAGE_REFERENCE_COLUMNS } from './image-references';

type Fn = jest.Mock<(...args: any[]) => any>;

const GENERATED = '0b8f3a52-6b1c-4d2e-9f00-1a2b3c4d5e6f';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/**
 * A run.
 *
 * @param overrides - What differs.
 * @returns It.
 */
const runOf = (
  overrides: Partial<ImageEstateRunEntity> = {},
): ImageEstateRunEntity =>
  ({
    id: 'run-1',
    kind: ImageEstateRunKind.COPY,
    state: ImageEstateRunState.RUNNING,
    startedByUserId: 'admin-1',
    cursor: null,
    counts: {},
    lastError: null,
    finishedAt: null,
    ...overrides,
  }) as ImageEstateRunEntity;

/**
 * A published picture.
 *
 * @param overrides - What differs.
 * @returns It.
 */
const assetOf = (overrides: Partial<FileAssetEntity> = {}): FileAssetEntity =>
  ({
    id: 'asset-1',
    kind: FileAssetKind.PROFILE_IMAGE,
    state: FileAssetState.UNVERIFIED,
    storage: FileAssetStorage.PUBLIC_IMAGES,
    deliveryReference: 'local-user-1-profile',
    deliveryPrivate: false,
    ...overrides,
  }) as FileAssetEntity;

/**
 * A copy.
 *
 * @param overrides - What differs.
 * @returns It.
 */
const stepOf = (
  overrides: Partial<ImageEstateStepEntity> = {},
): ImageEstateStepEntity =>
  ({
    id: 'step-1',
    runId: 'run-1',
    assetId: 'asset-1',
    state: ImageEstateStepState.COPIED,
    fromReference: 'local-user-1-profile',
    fromStorage: FileAssetStorage.PUBLIC_IMAGES,
    toReference: 'private-1',
    references: [
      { table: 'user_profile', column: 'profilePictureId', rowId: 'user-1' },
    ],
    placementIds: ['placement-1'],
    ...overrides,
  }) as ImageEstateStepEntity;

describe('ImageEstateService (FC-040)', () => {
  let manager: Record<string, Fn>;
  let images: Record<string, Fn | boolean>;
  let add: Fn;
  let service: ImageEstateService;

  /** The rows each kind of query answers, by what its SQL contains. */
  let answers: { match: string; rows: unknown }[];

  beforeEach(() => {
    answers = [];
    manager = {
      find: jest.fn(() => Promise.resolve([])),
      findOne: jest.fn(() => Promise.resolve(null)),
      exists: jest.fn(() => Promise.resolve(false)),
      count: jest.fn(() => Promise.resolve(0)),
      update: jest.fn(() => Promise.resolve({ affected: 1 })),
      insert: jest.fn(() =>
        Promise.resolve({ identifiers: [{ id: 'placement-new' }] }),
      ),
      save: jest.fn((_entity: unknown, value: unknown) =>
        Promise.resolve({ id: 'saved-1', ...(value as object) }),
      ),
      create: jest.fn((_entity: unknown, value: unknown) => ({
        ...(value as object),
      })),
      delete: jest.fn(() => Promise.resolve({ affected: 1 })),
      query: jest.fn((sql: string) =>
        Promise.resolve(
          answers.find(answer => sql.includes(answer.match))?.rows ?? [],
        ),
      ),
    };
    images = {
      publishesPrivate: true,
      readImage: jest.fn(() => Promise.resolve(PNG)),
      readR2Object: jest.fn(() => Promise.resolve(PNG)),
      publishImageToCloudflareImages: jest.fn(() =>
        Promise.resolve('private-1'),
      ),
      setImageRequiresSignature: jest.fn(() => Promise.resolve()),
      deleteImageFromCloudflareImages: jest.fn(() => Promise.resolve()),
      deleteR2Object: jest.fn(() => Promise.resolve()),
    };
    add = jest.fn(() => Promise.resolve());
    service = new ImageEstateService(
      {
        manager,
        query: manager.query,
        transaction: (work: (m: unknown) => Promise<unknown>) => work(manager),
      } as unknown as DataSource,
      images as unknown as ImageUploadsService,
      { add } as unknown as Queue,
    );
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  /** Every row the site admin log was given. */
  const logged = () =>
    manager.insert.mock.calls
      .filter(([entity]) => entity === SiteAdminActionEntity)
      .map(([, row]) => row);

  /** Every update to the run. */
  const runUpdates = () =>
    manager.update.mock.calls
      .filter(([entity]) => entity === ImageEstateRunEntity)
      .map(([, where, values]) => ({ where, values }));

  describe('status', () => {
    it('reads the last run, the copies by state and what is left', async () => {
      manager.find.mockResolvedValue([runOf()]);
      answers.push({
        match: 'image_estate_step',
        rows: [{ state: ImageEstateStepState.COPIED, count: 3 }],
      });
      manager.count.mockResolvedValue(5);

      await expect(service.status()).resolves.toEqual({
        signingEnabled: true,
        run: runOf(),
        steps: { COPIED: 3 },
        remaining: 5,
      });
    });

    it('has no run before the first', async () => {
      await expect(service.status()).resolves.toEqual(
        expect.objectContaining({ run: null, steps: {} }),
      );
    });
  });

  describe('start', () => {
    it('starts a copy, logged, and queues its first batch', async () => {
      await expect(
        service.start(ImageEstateRunKind.COPY, 'admin-1', 'Go private'),
      ).resolves.toEqual(expect.objectContaining({ id: 'saved-1' }));

      expect(logged()).toEqual([
        expect.objectContaining({
          action: SiteAdminActionKind.IMAGE_COPY_STARTED,
          actorUserId: 'admin-1',
          subjectKind: 'IMAGE_ESTATE_RUN',
          subjectId: 'saved-1',
          reason: 'Go private',
        }),
      ]);
      expect(add).toHaveBeenCalledWith(
        'batch',
        { runId: 'saved-1' },
        expect.anything(),
      );
    });

    it('refuses a copy with no signing key', async () => {
      images.publishesPrivate = false;

      await expect(
        service.start(ImageEstateRunKind.COPY, 'admin-1', 'Go private'),
      ).rejects.toThrow(ConflictException);
    });

    it.each([ImageEstateRunKind.UNDO, ImageEstateRunKind.RETIRE])(
      'refuses to %s with nothing copied',
      async kind => {
        await expect(service.start(kind, 'admin-1', 'Why')).rejects.toThrow(
          'No copied picture is waiting for that.',
        );
      },
    );

    it('starts an undo or retirement when there are copies', async () => {
      manager.exists.mockImplementation((entity: unknown) =>
        Promise.resolve(entity === ImageEstateStepEntity),
      );

      await service.start(ImageEstateRunKind.RETIRE, 'admin-1', 'Checked');

      expect(logged()).toEqual([
        expect.objectContaining({
          action: SiteAdminActionKind.IMAGE_RETIRE_STARTED,
        }),
      ]);
    });

    it('refuses while another run is open', async () => {
      manager.exists.mockResolvedValue(true);

      await expect(
        service.start(ImageEstateRunKind.COPY, 'admin-1', 'Go'),
      ).rejects.toThrow('Another run is open. Finish it first.');
      expect(add).not.toHaveBeenCalled();
    });
  });

  describe('pause and resume', () => {
    it('pauses the running run, logged', async () => {
      manager.findOne.mockResolvedValue(runOf());

      await expect(service.pause('admin-1', 'Checking')).resolves.toEqual(
        expect.objectContaining({ state: ImageEstateRunState.PAUSED }),
      );
      expect(logged()).toEqual([
        expect.objectContaining({
          action: SiteAdminActionKind.IMAGE_RUN_PAUSED,
          reason: 'Checking',
        }),
      ]);
      expect(add).not.toHaveBeenCalled();
    });

    it('resumes a paused or failed run, logged, and queues it', async () => {
      manager.findOne.mockResolvedValue(
        runOf({ state: ImageEstateRunState.FAILED, lastError: 'down' }),
      );

      await expect(service.resume('admin-1', 'Back up')).resolves.toEqual(
        expect.objectContaining({
          state: ImageEstateRunState.RUNNING,
          lastError: null,
        }),
      );
      expect(logged()).toEqual([
        expect.objectContaining({
          action: SiteAdminActionKind.IMAGE_RUN_RESUMED,
        }),
      ]);
      expect(add).toHaveBeenCalledTimes(1);
    });

    it('refuses when no run is waiting for it', async () => {
      await expect(service.pause('admin-1', 'Why')).rejects.toThrow(
        'No run is waiting for that.',
      );
    });
  });

  describe('processBatch', () => {
    it.each([
      ['a run that has gone', null],
      ['a paused run', runOf({ state: ImageEstateRunState.PAUSED })],
    ])('does nothing for %s', async (_case, run) => {
      manager.findOne.mockResolvedValue(run);

      await service.processBatch('run-1');

      expect(manager.find).not.toHaveBeenCalled();
      expect(runUpdates()).toEqual([]);
    });

    describe('a copy', () => {
      beforeEach(() => {
        manager.findOne.mockResolvedValue(runOf());
      });

      it('registers unknown references once, and finishes when nothing is left', async () => {
        answers.push({ match: 'INSERT INTO', rows: [{ id: 'new-1' }] });

        await service.processBatch('run-1');

        const inserts = manager.query.mock.calls.filter(([sql]) =>
          String(sql).includes('INSERT INTO'),
        );

        expect(inserts).toHaveLength(IMAGE_REFERENCE_COLUMNS.length);
        expect(String(inserts[0][0])).toContain(`'UNVERIFIED'`);
        expect(runUpdates()).toEqual([
          {
            where: { id: 'run-1', state: ImageEstateRunState.RUNNING },
            values: expect.objectContaining({
              state: ImageEstateRunState.DONE,
              finishedAt: expect.any(Date),
              counts: { registered: IMAGE_REFERENCE_COLUMNS.length },
            }),
          },
        ]);
        expect(add).not.toHaveBeenCalled();
      });

      it('registers nothing on a later batch, and resumes after its cursor', async () => {
        manager.findOne.mockResolvedValue(
          runOf({ counts: { registered: 0 }, cursor: 'asset-0' }),
        );

        await service.processBatch('run-1');

        expect(
          manager.query.mock.calls.some(([sql]) =>
            String(sql).includes('INSERT INTO'),
          ),
        ).toBe(false);
        expect(manager.find).toHaveBeenCalledWith(
          FileAssetEntity,
          expect.objectContaining({
            where: expect.objectContaining({ id: expect.anything() }),
          }),
        );
      });

      it('clears copies a crash left half made', async () => {
        manager.find.mockImplementation((entity: unknown) =>
          Promise.resolve(
            entity === ImageEstateStepEntity
              ? [
                  stepOf({
                    id: 'pending-1',
                    state: ImageEstateStepState.PENDING,
                  }),
                  stepOf({
                    id: 'pending-2',
                    state: ImageEstateStepState.PENDING,
                    toReference: null,
                  }),
                ]
              : [],
          ),
        );

        await service.processBatch('run-1');

        expect(images.deleteImageFromCloudflareImages).toHaveBeenCalledTimes(1);
        expect(images.deleteImageFromCloudflareImages).toHaveBeenCalledWith(
          'private-1',
        );
        expect(manager.delete).toHaveBeenCalledWith(ImageEstateStepEntity, {
          id: 'pending-1',
        });
        expect(manager.delete).toHaveBeenCalledWith(ImageEstateStepEntity, {
          id: 'pending-2',
        });
      });

      /**
       * Answers the batch with some pictures, and each column's rows.
       *
       * @param assets - The pictures.
       */
      const batchOf = (assets: FileAssetEntity[]) => {
        manager.find.mockImplementation((entity: unknown) =>
          Promise.resolve(entity === FileAssetEntity ? assets : []),
        );
        answers.push(
          {
            match: 'UPDATE "sto_info_app"."user_profile"',
            rows: [[{ rowId: 'user-1' }], 1],
          },
          {
            match: 'SELECT row."userId"::text AS "rowId"',
            rows: [{ rowId: 'user-1' }],
          },
          { match: 'AS "subjectId"', rows: [{ subjectId: 'user-1' }] },
        );
      };

      it('copies a custom-ID picture to a private one and repoints its rows', async () => {
        manager.findOne.mockResolvedValue(runOf({ counts: { registered: 0 } }));
        batchOf([assetOf()]);

        await service.processBatch('run-1');

        expect(images.readImage).toHaveBeenCalledWith('local-user-1-profile');
        expect(images.publishImageToCloudflareImages).toHaveBeenCalledWith(
          expect.objectContaining({
            private: true,
            entityType: FileAssetKind.PROFILE_IMAGE,
            entityId: 'asset-1',
            contentType: 'image/png',
            userId: null,
          }),
        );
        expect(manager.update).toHaveBeenCalledWith(
          FileAssetEntity,
          {
            id: 'asset-1',
            deliveryReference: 'local-user-1-profile',
            deliveryPrivate: false,
          },
          {
            deliveryReference: 'private-1',
            deliveryPrivate: true,
            storage: FileAssetStorage.PUBLIC_IMAGES,
          },
        );
        expect(manager.insert).toHaveBeenCalledWith(
          FileAssetPlacementEntity,
          expect.objectContaining({
            assetId: 'asset-1',
            subjectId: 'user-1',
            state: 'ACTIVE',
          }),
        );
        expect(manager.update).toHaveBeenCalledWith(
          ImageEstateStepEntity,
          { id: 'saved-1' },
          expect.objectContaining({
            state: ImageEstateStepState.COPIED,
            toReference: 'private-1',
            sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
            byteSize: PNG.length,
            references: [
              {
                table: 'user_profile',
                column: 'profilePictureId',
                rowId: 'user-1',
              },
            ],
            placementIds: ['placement-new'],
          }),
        );
        expect(runUpdates()[0].values).toEqual(
          expect.objectContaining({
            counts: { registered: 0, copied: 1 },
            cursor: 'asset-1',
          }),
        );
      });

      it('makes a generated-ID picture private in place', async () => {
        manager.findOne.mockResolvedValue(runOf({ counts: { registered: 0 } }));
        batchOf([assetOf({ deliveryReference: GENERATED })]);
        // The row already has a placement.
        manager.exists.mockResolvedValue(true);

        await service.processBatch('run-1');

        expect(images.setImageRequiresSignature).toHaveBeenCalledWith(
          GENERATED,
          true,
        );
        expect(images.publishImageToCloudflareImages).not.toHaveBeenCalled();
        expect(manager.insert).not.toHaveBeenCalledWith(
          FileAssetPlacementEntity,
          expect.anything(),
        );
        expect(manager.update).toHaveBeenCalledWith(
          ImageEstateStepEntity,
          { id: 'saved-1' },
          expect.objectContaining({
            toReference: GENERATED,
            references: [],
          }),
        );
      });

      it('copies a legacy R2 portrait into Cloudflare Images', async () => {
        manager.findOne.mockResolvedValue(runOf({ counts: { registered: 0 } }));
        batchOf([
          assetOf({
            storage: FileAssetStorage.LEGACY_PUBLIC_R2,
            deliveryReference: 'user-1/character-1/portrait.webp',
          }),
        ]);
        (images.readR2Object as Fn).mockResolvedValue(Buffer.from('not png'));

        await service.processBatch('run-1');

        expect(images.readR2Object).toHaveBeenCalledWith(
          'user-1/character-1/portrait.webp',
        );
        expect(images.publishImageToCloudflareImages).toHaveBeenCalledWith(
          expect.objectContaining({ contentType: null }),
        );
      });

      it('skips a row with no placement subject', async () => {
        manager.findOne.mockResolvedValue(runOf({ counts: { registered: 0 } }));
        batchOf([assetOf()]);
        answers.unshift({
          match: 'AS "subjectId"',
          rows: [{ subjectId: null }],
        });

        await service.processBatch('run-1');

        expect(manager.insert).not.toHaveBeenCalledWith(
          FileAssetPlacementEntity,
          expect.anything(),
        );
      });

      it.each([
        ['an error', new Error('Cloudflare is down')],
        ['something that is not an error', 'down'],
      ])(
        'leaves a picture as it was when its copy fails with %s',
        async (_case, failure) => {
          manager.findOne.mockResolvedValue(
            runOf({ counts: { registered: 0 } }),
          );
          batchOf([assetOf()]);
          (images.readImage as Fn).mockRejectedValue(failure);

          await service.processBatch('run-1');

          expect(manager.update).toHaveBeenCalledWith(
            ImageEstateStepEntity,
            { id: 'saved-1' },
            expect.objectContaining({ state: ImageEstateStepState.FAILED }),
          );
          expect(runUpdates()[0].values).toEqual(
            expect.objectContaining({
              counts: { registered: 0, failed: 1 },
            }),
          );
        },
      );

      it('drops the private copy when the picture changed while it was copied', async () => {
        manager.findOne.mockResolvedValue(runOf({ counts: { registered: 0 } }));
        batchOf([assetOf()]);
        manager.update.mockImplementation((entity: unknown) =>
          Promise.resolve({ affected: entity === FileAssetEntity ? 0 : 1 }),
        );

        await service.processBatch('run-1');

        expect(images.deleteImageFromCloudflareImages).toHaveBeenCalledWith(
          'private-1',
        );
        expect(manager.update).toHaveBeenCalledWith(
          ImageEstateStepEntity,
          { id: 'saved-1' },
          expect.objectContaining({
            state: ImageEstateStepState.FAILED,
            error: 'The picture changed while it was being copied.',
          }),
        );
      });

      it('leaves an unused private copy it cannot delete for the inventory', async () => {
        manager.findOne.mockResolvedValue(runOf({ counts: { registered: 0 } }));
        batchOf([assetOf()]);
        manager.update.mockImplementation((entity: unknown) =>
          Promise.resolve({ affected: entity === FileAssetEntity ? 0 : 1 }),
        );
        (images.deleteImageFromCloudflareImages as Fn).mockRejectedValue(
          new Error('down'),
        );

        await expect(service.processBatch('run-1')).resolves.toBeUndefined();
      });

      it('queues the next batch after a full one', async () => {
        manager.findOne.mockResolvedValue(runOf({ counts: { registered: 0 } }));
        batchOf(
          Array.from({ length: IMAGE_ESTATE_BATCH_SIZE }, (_each, index) =>
            assetOf({ id: `asset-${index}`, deliveryReference: GENERATED }),
          ),
        );

        await service.processBatch('run-1');

        expect(runUpdates()[0].values).not.toHaveProperty('state');
        expect(add).toHaveBeenCalledWith(
          'batch',
          { runId: 'run-1' },
          expect.anything(),
        );
      });

      it('keeps its progress and stops when a pause landed meanwhile', async () => {
        manager.findOne.mockResolvedValue(runOf({ counts: { registered: 0 } }));
        batchOf(
          Array.from({ length: IMAGE_ESTATE_BATCH_SIZE }, (_each, index) =>
            assetOf({ id: `asset-${index}`, deliveryReference: GENERATED }),
          ),
        );
        manager.update.mockImplementation(
          (entity: unknown, where: { state?: unknown }) =>
            Promise.resolve({
              affected:
                entity === ImageEstateRunEntity && where.state !== undefined
                  ? 0
                  : 1,
            }),
        );

        await service.processBatch('run-1');

        expect(runUpdates()[1]).toEqual({
          where: { id: 'run-1' },
          values: expect.objectContaining({
            cursor: `asset-${IMAGE_ESTATE_BATCH_SIZE - 1}`,
          }),
        });
        expect(add).not.toHaveBeenCalled();
      });

      it.each([
        ['an error', new Error('database gone')],
        ['something that is not an error', 'gone'],
      ])('fails the run on %s, to be resumed', async (_case, failure) => {
        manager.find.mockRejectedValue(failure);
        manager.findOne.mockResolvedValue(runOf({ counts: { registered: 0 } }));

        await service.processBatch('run-1');

        expect(runUpdates()).toEqual([
          {
            where: { id: 'run-1', state: ImageEstateRunState.RUNNING },
            values: expect.objectContaining({
              state: ImageEstateRunState.FAILED,
              lastError: expect.stringContaining('gone'),
            }),
          },
        ]);
      });
    });

    describe('an undo', () => {
      beforeEach(() => {
        manager.findOne.mockResolvedValue(
          runOf({ kind: ImageEstateRunKind.UNDO }),
        );
      });

      it('puts each picture and row back, and deletes the private copy', async () => {
        manager.find.mockResolvedValue([stepOf()]);

        await service.processBatch('run-1');

        expect(manager.update).toHaveBeenCalledWith(
          FileAssetEntity,
          expect.objectContaining({
            id: 'asset-1',
            deliveryReference: 'private-1',
          }),
          {
            deliveryReference: 'local-user-1-profile',
            deliveryPrivate: false,
            storage: FileAssetStorage.PUBLIC_IMAGES,
          },
        );
        expect(manager.query).toHaveBeenCalledWith(
          expect.stringContaining('UPDATE "sto_info_app"."user_profile"'),
          ['local-user-1-profile', 'user-1', 'private-1'],
        );
        expect(manager.delete).toHaveBeenCalledWith(
          FileAssetPlacementEntity,
          expect.objectContaining({ assetId: 'asset-1' }),
        );
        expect(images.deleteImageFromCloudflareImages).toHaveBeenCalledWith(
          'private-1',
        );
        expect(runUpdates()[0].values).toEqual(
          expect.objectContaining({
            counts: { undone: 1 },
            cursor: 'step-1',
          }),
        );
      });

      it('makes a picture copied in place public again, and deletes nothing', async () => {
        manager.find.mockResolvedValue([
          stepOf({
            fromReference: GENERATED,
            toReference: GENERATED,
            references: [],
            placementIds: [],
          }),
        ]);

        await service.processBatch('run-1');

        expect(images.setImageRequiresSignature).toHaveBeenCalledWith(
          GENERATED,
          false,
        );
        expect(images.deleteImageFromCloudflareImages).not.toHaveBeenCalled();
        expect(manager.delete).not.toHaveBeenCalled();
      });

      it('never puts back a picture that may no longer be shown', async () => {
        manager.find.mockResolvedValue([stepOf()]);
        manager.update.mockImplementation((entity: unknown) =>
          Promise.resolve({ affected: entity === FileAssetEntity ? 0 : 1 }),
        );

        await service.processBatch('run-1');

        expect(images.deleteImageFromCloudflareImages).not.toHaveBeenCalled();
        expect(runUpdates()[0].values).toEqual(
          expect.objectContaining({ counts: {} }),
        );
      });

      it.each([
        ['an error', new Error('down')],
        ['something that is not an error', 'down'],
      ])('counts a copy it cannot undo, with %s', async (_case, failure) => {
        manager.find.mockResolvedValue([stepOf()]);
        (images.deleteImageFromCloudflareImages as Fn).mockRejectedValue(
          failure,
        );
        (images.setImageRequiresSignature as Fn).mockRejectedValue(failure);
        manager.find.mockResolvedValue([
          stepOf({ fromReference: GENERATED, toReference: GENERATED }),
        ]);

        await service.processBatch('run-1');

        expect(runUpdates()[0].values).toEqual(
          expect.objectContaining({ counts: { failed: 1 } }),
        );
      });
    });

    describe('a retirement', () => {
      beforeEach(() => {
        manager.findOne.mockResolvedValue(
          runOf({ kind: ImageEstateRunKind.RETIRE, cursor: 'step-0' }),
        );
      });

      it('deletes each old public copy, image or R2 object', async () => {
        manager.find.mockResolvedValue([
          stepOf(),
          stepOf({
            id: 'step-2',
            fromReference: 'user-1/portrait.webp',
            fromStorage: FileAssetStorage.LEGACY_PUBLIC_R2,
          }),
          stepOf({
            id: 'step-3',
            fromReference: GENERATED,
            toReference: GENERATED,
          }),
        ]);

        await service.processBatch('run-1');

        expect(images.deleteImageFromCloudflareImages).toHaveBeenCalledTimes(1);
        expect(images.deleteImageFromCloudflareImages).toHaveBeenCalledWith(
          'local-user-1-profile',
        );
        expect(images.deleteR2Object).toHaveBeenCalledWith(
          'user-1/portrait.webp',
        );
        expect(runUpdates()[0].values).toEqual(
          expect.objectContaining({ counts: { retired: 3 } }),
        );
      });

      it('counts an old copy already gone as retired', async () => {
        manager.find.mockResolvedValue([stepOf()]);
        (images.deleteImageFromCloudflareImages as Fn).mockRejectedValue({
          response: { status: 404 },
        });

        await service.processBatch('run-1');

        expect(runUpdates()[0].values).toEqual(
          expect.objectContaining({ counts: { retired: 1 } }),
        );
      });

      it.each([
        ['an error', new Error('down')],
        ['something that is not an error', 'down'],
      ])(
        'keeps a copy it cannot retire, with %s, for another run',
        async (_case, failure) => {
          manager.find.mockResolvedValue([stepOf()]);
          (images.deleteImageFromCloudflareImages as Fn).mockRejectedValue(
            failure,
          );

          await service.processBatch('run-1');

          expect(manager.update).toHaveBeenCalledWith(
            ImageEstateStepEntity,
            { id: 'step-1' },
            { error: 'down' },
          );
          expect(runUpdates()[0].values).toEqual(
            expect.objectContaining({ counts: { failed: 1 } }),
          );
        },
      );
    });
  });

  describe('retireFor', () => {
    it('retires a withdrawn picture’s old copy', async () => {
      manager.findOne.mockResolvedValue(stepOf());

      await service.retireFor('asset-1');

      expect(images.deleteImageFromCloudflareImages).toHaveBeenCalledWith(
        'local-user-1-profile',
      );
      expect(manager.update).toHaveBeenCalledWith(
        ImageEstateStepEntity,
        { id: 'step-1', state: ImageEstateStepState.COPIED },
        expect.objectContaining({ state: ImageEstateStepState.RETIRED }),
      );
    });

    it('does nothing for a picture never copied', async () => {
      await service.retireFor('asset-1');

      expect(images.deleteImageFromCloudflareImages).not.toHaveBeenCalled();
    });
  });
});
