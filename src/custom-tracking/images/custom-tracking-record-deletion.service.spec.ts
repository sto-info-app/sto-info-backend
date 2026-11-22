import { Logger } from '@nestjs/common';

import { DataSource, EntityManager, In } from 'typeorm';

import { CharacterEntity } from 'src/sto/character/entities/character.entity';

import {
  CustomTrackingFieldPicture,
  CustomTrackingFieldPictureService,
} from './custom-tracking-field-picture.service';
import { CustomTrackingRecordDeletionService } from './custom-tracking-record-deletion.service';

const PICTURE: CustomTrackingFieldPicture = {
  imageValueId: 'image-value-1',
  valueId: 'value-1',
  fieldId: 'field-1',
  targetId: 'character-1',
  imageId: 'image-1',
  reason: 'Its Character was deleted',
};

describe('CustomTrackingRecordDeletionService', () => {
  let service: CustomTrackingRecordDeletionService;
  let manager: { find: jest.Mock };
  let dataSource: { manager: typeof manager; transaction: jest.Mock };
  let pictures: { detachForRecords: jest.Mock; withdrawEach: jest.Mock };
  let failed: jest.SpyInstance;

  beforeEach(() => {
    manager = { find: jest.fn().mockResolvedValue([]) };
    dataSource = {
      manager,
      transaction: jest.fn((body: (m: EntityManager) => Promise<unknown>) =>
        body(manager as unknown as EntityManager),
      ),
    };
    pictures = {
      detachForRecords: jest.fn().mockResolvedValue([PICTURE]),
      withdrawEach: jest.fn().mockResolvedValue(1),
    };
    service = new CustomTrackingRecordDeletionService(
      dataSource as unknown as DataSource,
      pictures as unknown as CustomTrackingFieldPictureService,
    );
    failed = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('charactersDeleted', () => {
    // The answers go in a transaction; the pictures once it has committed.
    it("removes the Characters' picture answers, then withdraws the pictures", async () => {
      await service.charactersDeleted(
        ['character-1'],
        'Its Character was deleted',
      );

      expect(pictures.detachForRecords).toHaveBeenCalledWith(
        manager,
        { accountIds: [], characterIds: ['character-1'] },
        'Its Character was deleted',
      );
      expect(pictures.withdrawEach).toHaveBeenCalledWith([PICTURE]);
      expect(
        pictures.detachForRecords.mock.invocationCallOrder[0],
      ).toBeLessThan(pictures.withdrawEach.mock.invocationCallOrder[0]);
    });

    // The deletion has already happened; the sweep finds what is left.
    it('logs a failure rather than undoing the deletion', async () => {
      pictures.detachForRecords.mockRejectedValueOnce(new Error('deadlock'));

      await expect(
        service.charactersDeleted(['character-1'], 'Its Character was deleted'),
      ).resolves.toBeUndefined();

      expect(pictures.withdrawEach).not.toHaveBeenCalled();
      expect(failed).toHaveBeenCalledWith(
        '[recordsDeleted] Custom Tracking pictures not taken down',
        expect.stringContaining('deadlock'),
      );
    });
  });

  describe('accountsDeleted', () => {
    it('does nothing for no accounts', async () => {
      await service.accountsDeleted([], 'Its STO account was deleted');

      expect(manager.find).not.toHaveBeenCalled();
      expect(pictures.detachForRecords).not.toHaveBeenCalled();
    });

    // Its Characters cannot be reached once it has gone, even if they were
    // never deleted themselves.
    it('takes the Characters on the accounts with them', async () => {
      manager.find.mockResolvedValue([{ id: 'character-1' }]);

      await service.accountsDeleted(
        ['account-1'],
        'Its STO account was deleted',
      );

      expect(manager.find).toHaveBeenCalledWith(CharacterEntity, {
        where: { accountId: In(['account-1']) },
        withDeleted: true,
        select: { id: true },
      });
      expect(pictures.detachForRecords).toHaveBeenCalledWith(
        manager,
        { accountIds: ['account-1'], characterIds: ['character-1'] },
        'Its STO account was deleted',
      );
    });

    it('logs a failure to read the Characters as it is', async () => {
      manager.find.mockRejectedValueOnce('no database');

      await expect(
        service.accountsDeleted(['account-1'], 'Its STO account was deleted'),
      ).resolves.toBeUndefined();

      expect(failed).toHaveBeenCalledWith(expect.any(String), 'no database');
    });
  });
});
