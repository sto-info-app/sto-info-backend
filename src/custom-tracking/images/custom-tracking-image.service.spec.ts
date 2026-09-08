import { BadRequestException, NotFoundException } from '@nestjs/common';

import { jest } from '@jest/globals';
import { DataSource } from 'typeorm';

import { ImageSlotService } from 'src/shared/images/image-slot.service';

import { CUSTOM_TRACKING_IMAGE_SPECS } from '../constants/custom-tracking-image.constants';
import { CustomTrackingFieldService } from '../definitions/custom-tracking-field.service';
import { CustomTrackingFieldEntity } from '../entities/custom-tracking-field.entity';
import { CustomTrackingImageValueEntity } from '../entities/custom-tracking-image-value.entity';
import { CustomTrackingValueEntity } from '../entities/custom-tracking-value.entity';
import { CustomTrackingFieldType } from '../enums/custom-tracking-field-type.enum';
import { CustomTrackingImageCleanupReason } from '../enums/custom-tracking-image-cleanup-reason.enum';
import { CustomTrackingImageShape } from '../enums/custom-tracking-image-shape.enum';
import { CustomTrackingTargetScope } from '../enums/custom-tracking-target-scope.enum';
import { CustomTrackingObservabilityService } from '../observability/custom-tracking-observability.service';
import { CustomTrackingImageCleanupService } from '../retention/custom-tracking-image-cleanup.service';
import { createRepositoryDouble } from '../testing/custom-tracking-test.doubles';
import {
  CustomTrackingTarget,
  CustomTrackingTargetService,
} from '../values/custom-tracking-target.service';
import { CustomTrackingImageService } from './custom-tracking-image.service';

describe('CustomTrackingImageService', () => {
  const userId = 'user-1';

  const target: CustomTrackingTarget = {
    scope: CustomTrackingTargetScope.ACCOUNT,
    id: 'account-1',
    label: 'ares',
    publiclyVisible: true,
  };

  let service: CustomTrackingImageService;
  let imageValues: ReturnType<
    typeof createRepositoryDouble<CustomTrackingImageValueEntity>
  >;
  let findOwnedField: jest.Mock<() => Promise<CustomTrackingFieldEntity>>;
  let findOwnedTarget: jest.Mock<() => Promise<CustomTrackingTarget>>;
  let store: jest.Mock<() => Promise<string>>;
  let release: jest.Mock<(imageId: string | null) => Promise<void>>;
  let enqueue: jest.Mock<(...args: unknown[]) => Promise<void>>;
  let flush: jest.Mock<(imageIds: string[]) => Promise<void>>;
  let uploadRefused: jest.Mock<(...args: unknown[]) => void>;
  let uploadAbandoned: jest.Mock<(imageId: string) => void>;
  let transaction: jest.Mock<
    (body: (manager: unknown) => Promise<unknown>) => Promise<unknown>
  >;
  let manager: {
    findOne: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
    create: jest.Mock<(entity: unknown, input: unknown) => unknown>;
    save: jest.Mock<(entity: unknown, row: unknown) => Promise<unknown>>;
    delete: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  };

  const field = (
    overrides: Partial<CustomTrackingFieldEntity> = {},
  ): CustomTrackingFieldEntity =>
    ({
      id: 'field-1',
      name: 'Ship picture',
      fieldType: CustomTrackingFieldType.IMAGE,
      targetScope: CustomTrackingTargetScope.ACCOUNT,
      configuration: { shape: CustomTrackingImageShape.LANDSCAPE },
      ...overrides,
    }) as unknown as CustomTrackingFieldEntity;

  const file = { size: 1024, buffer: Buffer.alloc(0) } as Express.Multer.File;

  beforeEach(() => {
    imageValues = createRepositoryDouble<CustomTrackingImageValueEntity>();
    findOwnedField = jest
      .fn<() => Promise<CustomTrackingFieldEntity>>()
      .mockResolvedValue(field());
    findOwnedTarget = jest
      .fn<() => Promise<CustomTrackingTarget>>()
      .mockResolvedValue(target);
    store = jest.fn<() => Promise<string>>().mockResolvedValue('new-image');
    release = jest
      .fn<(imageId: string | null) => Promise<void>>()
      .mockResolvedValue();

    manager = {
      findOne: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue(null),
      create: jest.fn((_entity: unknown, input: unknown) => ({
        ...(input as object),
      })),
      save: jest.fn((_entity: unknown, row: unknown) =>
        Promise.resolve({ id: 'row-1', ...(row as object) }),
      ),
      delete: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue(undefined),
    };

    transaction = jest.fn((body: (m: unknown) => Promise<unknown>) =>
      body(manager),
    );
    enqueue = jest.fn(async () => undefined);
    flush = jest.fn(async () => undefined);
    uploadRefused = jest.fn();
    uploadAbandoned = jest.fn();

    service = new CustomTrackingImageService(
      imageValues.repository,
      { findOwned: findOwnedField } as unknown as CustomTrackingFieldService,
      {
        findOwned: findOwnedTarget,
        whereFor: (t: CustomTrackingTarget) =>
          t.scope === CustomTrackingTargetScope.ACCOUNT
            ? { accountId: t.id }
            : { characterId: t.id },
      } as unknown as CustomTrackingTargetService,
      { store, release } as unknown as ImageSlotService,
      {
        enqueue,
        flush,
      } as unknown as CustomTrackingImageCleanupService,
      {
        uploadRefused,
        uploadAbandoned,
      } as unknown as CustomTrackingObservabilityService,
      { manager, transaction } as unknown as DataSource,
    );
  });

  const upload = (altText = 'The USS Ares at warp') =>
    service.store({
      userId,
      fieldId: 'field-1',
      scope: CustomTrackingTargetScope.ACCOUNT,
      targetId: 'account-1',
      altText,
      file,
    });

  describe('store', () => {
    it('checks the picture against the shape the field asked for', async () => {
      await upload();

      expect(store).toHaveBeenCalledWith(
        expect.objectContaining({
          spec: CUSTOM_TRACKING_IMAGE_SPECS.LANDSCAPE,
          userId,
          entityId: 'field-1:account-1',
        }),
      );
    });

    it('stores the picture with its description and shape', async () => {
      await upload();

      expect(manager.save).toHaveBeenCalledWith(
        CustomTrackingImageValueEntity,
        expect.objectContaining({
          cloudflareImageId: 'new-image',
          altText: 'The USS Ares at warp',
          shape: CustomTrackingImageShape.LANDSCAPE,
        }),
      );
    });

    it('creates the value row a picture hangs from', async () => {
      await upload();

      expect(manager.create).toHaveBeenCalledWith(
        CustomTrackingValueEntity,
        expect.objectContaining({
          fieldId: 'field-1',
          accountId: 'account-1',
          characterId: null,
          value: null,
        }),
      );
    });

    it('records a character picture against the character', async () => {
      findOwnedField.mockResolvedValue(
        field({ targetScope: CustomTrackingTargetScope.CHARACTER }),
      );
      findOwnedTarget.mockResolvedValue({
        scope: CustomTrackingTargetScope.CHARACTER,
        id: 'character-1',
        label: 'Kira@ares',
        publiclyVisible: false,
      });

      await service.store({
        userId,
        fieldId: 'field-1',
        scope: CustomTrackingTargetScope.CHARACTER,
        targetId: 'character-1',
        altText: 'The USS Ares at warp',
        file,
      });

      expect(manager.create).toHaveBeenCalledWith(
        CustomTrackingValueEntity,
        expect.objectContaining({
          accountId: null,
          characterId: 'character-1',
        }),
      );
    });

    it('reuses the value row when one is already there', async () => {
      manager.findOne.mockResolvedValueOnce({ id: 'value-1' });

      await upload();

      expect(manager.create).not.toHaveBeenCalledWith(
        CustomTrackingValueEntity,
        expect.anything(),
      );
    });

    // Releasing first would leave a record pointing at an image that no longer
    // exists, which is worse than leaving one behind that nothing points at.
    // Queued inside the transaction and deleted after it commits. The other
    // order leaves a window in which the site has forgotten a picture that
    // still exists, and nothing would ever look for it again.
    it('queues the picture it replaced before deleting it', async () => {
      manager.findOne
        .mockResolvedValueOnce({ id: 'value-1' })
        .mockResolvedValueOnce({
          id: 'row-1',
          valueId: 'value-1',
          cloudflareImageId: 'old-image',
        });

      await upload();

      expect(enqueue).toHaveBeenCalledWith(
        manager,
        ['old-image'],
        CustomTrackingImageCleanupReason.REPLACED,
      );
      expect(flush).toHaveBeenCalledWith(['old-image']);
      expect(enqueue.mock.invocationCallOrder[0]).toBeLessThan(
        flush.mock.invocationCallOrder[0],
      );
    });

    it('queues nothing when there was no picture before', async () => {
      await upload();

      expect(enqueue).toHaveBeenCalledWith(
        manager,
        [],
        CustomTrackingImageCleanupReason.REPLACED,
      );
      expect(flush).toHaveBeenCalledWith([]);
    });

    it('records the class of a refused upload', async () => {
      store.mockRejectedValue(new BadRequestException('wrong shape'));

      await expect(upload()).rejects.toThrow('wrong shape');

      expect(uploadRefused).toHaveBeenCalledWith(
        'user-1',
        'field-1',
        'BadRequestException',
      );
    });

    // The upload has already happened by then, so the picture exists and
    // nothing points at it. This is the last moment anything knows it is
    // there.
    it('queues a picture whose write did not commit', async () => {
      transaction.mockRejectedValueOnce(new Error('the database said no'));

      await expect(upload()).rejects.toThrow('the database said no');

      expect(enqueue).toHaveBeenCalledWith(
        manager,
        ['new-image'],
        CustomTrackingImageCleanupReason.ABANDONED_UPLOAD,
      );
      expect(uploadAbandoned).toHaveBeenCalledWith('new-image');
      expect(flush).toHaveBeenCalledWith(['new-image']);
    });

    // A picture that turns out to be the wrong shape must not disturb what is
    // already stored.
    it('writes nothing when the upload is refused', async () => {
      store.mockRejectedValue(new BadRequestException('wrong shape'));

      await expect(upload()).rejects.toThrow('wrong shape');
      expect(manager.save).not.toHaveBeenCalled();
      expect(release).not.toHaveBeenCalled();
    });

    it('refuses a field that takes no picture', async () => {
      findOwnedField.mockResolvedValue(
        field({ fieldType: CustomTrackingFieldType.TEXT_SINGLE_LINE }),
      );

      await expect(upload()).rejects.toThrow('does not take a picture');
      expect(store).not.toHaveBeenCalled();
    });

    // The database refuses this through a composite foreign key, but catching
    // it here turns a constraint violation into a sentence — and does so
    // before a picture is uploaded to Cloudflare and left there.
    it('refuses a field describing the other kind of record', async () => {
      findOwnedField.mockResolvedValue(
        field({ targetScope: CustomTrackingTargetScope.CHARACTER }),
      );

      await expect(upload()).rejects.toThrow(
        'does not describe this kind of record',
      );
      expect(store).not.toHaveBeenCalled();
    });

    // A picture nobody can describe is one some readers cannot use at all, and
    // upload is the only moment its author certainly knows what it shows.
    it.each([
      ['nothing', ''],
      ['only spaces', '   '],
    ])('refuses a description of %s', async (_name, altText) => {
      await expect(upload(altText)).rejects.toThrow(
        'Describe what the picture shows',
      );
      expect(store).not.toHaveBeenCalled();
    });

    it('refuses a description longer than is stored', async () => {
      await expect(upload('x'.repeat(301))).rejects.toThrow(
        'at most 300 characters',
      );
    });

    it('trims the description', async () => {
      await upload('  The USS Ares  ');

      expect(manager.save).toHaveBeenCalledWith(
        CustomTrackingImageValueEntity,
        expect.objectContaining({ altText: 'The USS Ares' }),
      );
    });

    it('refuses a field that is not the caller’s', async () => {
      findOwnedField.mockRejectedValue(new NotFoundException());

      await expect(upload()).rejects.toThrow(NotFoundException);
      expect(store).not.toHaveBeenCalled();
    });

    it('refuses a record that is not the caller’s', async () => {
      findOwnedTarget.mockRejectedValue(new NotFoundException());

      await expect(upload()).rejects.toThrow(NotFoundException);
      expect(store).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    const remove = () =>
      service.remove(
        userId,
        'field-1',
        CustomTrackingTargetScope.ACCOUNT,
        'account-1',
      );

    it('removes the picture and the value row it hung from', async () => {
      manager.findOne.mockResolvedValue({ id: 'value-1' });
      imageValues.double.findOne.mockResolvedValue({
        id: 'row-1',
        valueId: 'value-1',
        cloudflareImageId: 'old-image',
      } as CustomTrackingImageValueEntity);

      await remove();

      expect(manager.delete).toHaveBeenCalledWith(
        CustomTrackingImageValueEntity,
        { id: 'row-1' },
      );
      expect(manager.delete).toHaveBeenCalledWith(CustomTrackingValueEntity, {
        id: 'value-1',
      });
      expect(enqueue).toHaveBeenCalledWith(
        manager,
        ['old-image'],
        CustomTrackingImageCleanupReason.REMOVED,
      );
      expect(flush).toHaveBeenCalledWith(['old-image']);
    });

    it('reports no picture to remove when the value row is absent', async () => {
      manager.findOne.mockResolvedValue(null);

      await expect(remove()).rejects.toThrow('no picture there to remove');
    });

    it('reports no picture to remove when only the picture is absent', async () => {
      manager.findOne.mockResolvedValue({ id: 'value-1' });
      imageValues.double.findOne.mockResolvedValue(null);

      await expect(remove()).rejects.toThrow(NotFoundException);
      expect(release).not.toHaveBeenCalled();
    });

    it('refuses a record that is not the caller’s', async () => {
      findOwnedTarget.mockRejectedValue(new NotFoundException());

      await expect(remove()).rejects.toThrow(NotFoundException);
    });
  });
});
