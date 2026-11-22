import { Logger } from '@nestjs/common';

import { FileAssetSlot } from 'src/file-assets/enums/file-asset-slot.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import { AssetWithdrawalService } from 'src/file-assets/services/asset-withdrawal.service';

import {
  PERSONAL_PICTURE_REASONS,
  PersonalPictureWithdrawalService,
} from './personal-picture-withdrawal.service';

describe('PersonalPictureWithdrawalService', () => {
  let service: PersonalPictureWithdrawalService;
  let withdrawal: { withdrawSlot: jest.Mock };

  beforeEach(() => {
    withdrawal = {
      withdrawSlot: jest
        .fn()
        .mockResolvedValue({ deleted: true, revoked: true }),
    };
    service = new PersonalPictureWithdrawalService(
      withdrawal as unknown as AssetWithdrawalService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('pictures', () => {
    it('describes a profile picture', () => {
      expect(
        PersonalPictureWithdrawalService.profilePicture('user-1', 'image-1'),
      ).toEqual({
        subject: FileAssetSubject.USER_PROFILE,
        subjectId: 'user-1',
        imageId: 'image-1',
      });
    });

    it('describes a portrait', () => {
      expect(
        PersonalPictureWithdrawalService.portrait('character-1', 'image-1'),
      ).toEqual({
        subject: FileAssetSubject.STO_CHARACTER,
        subjectId: 'character-1',
        imageId: 'image-1',
      });
    });

    it.each([null, undefined, ''])(
      'has nothing to describe for an empty slot (%p)',
      imageId => {
        expect(
          PersonalPictureWithdrawalService.profilePicture('user-1', imageId),
        ).toBeNull();
        expect(
          PersonalPictureWithdrawalService.portrait('character-1', imageId),
        ).toBeNull();
      },
    );
  });

  describe('withdraw', () => {
    it("empties a profile's picture slot", async () => {
      await service.withdraw(
        PersonalPictureWithdrawalService.profilePicture('user-1', 'image-1')!,
        PERSONAL_PICTURE_REASONS.REMOVED,
      );

      expect(withdrawal.withdrawSlot).toHaveBeenCalledWith(
        FileAssetSubject.USER_PROFILE,
        'user-1',
        FileAssetSlot.PICTURE,
        'image-1',
        'Removed by the owner',
      );
    });

    it("empties a Character's portrait slot", async () => {
      await service.withdraw(
        PersonalPictureWithdrawalService.portrait('character-1', 'image-1')!,
        PERSONAL_PICTURE_REASONS.CHARACTER_DELETED,
      );

      expect(withdrawal.withdrawSlot).toHaveBeenCalledWith(
        FileAssetSubject.STO_CHARACTER,
        'character-1',
        FileAssetSlot.PORTRAIT,
        'image-1',
        'Its Character was deleted',
      );
    });

    it('lets a failure through', async () => {
      withdrawal.withdrawSlot.mockRejectedValueOnce(new Error('registry down'));

      await expect(
        service.withdraw(
          PersonalPictureWithdrawalService.portrait('character-1', 'image-1')!,
          PERSONAL_PICTURE_REASONS.REMOVED,
        ),
      ).rejects.toThrow('registry down');
    });
  });

  describe('withdrawEach', () => {
    it('withdraws each picture, skipping an empty slot', async () => {
      await expect(
        service.withdrawEach(
          [
            PersonalPictureWithdrawalService.profilePicture('user-1', 'p-1'),
            null,
            PersonalPictureWithdrawalService.portrait('character-1', 'c-1'),
          ],
          PERSONAL_PICTURE_REASONS.ACCOUNT_CLOSED,
        ),
      ).resolves.toBe(2);

      expect(withdrawal.withdrawSlot).toHaveBeenCalledTimes(2);
      expect(withdrawal.withdrawSlot).toHaveBeenLastCalledWith(
        FileAssetSubject.STO_CHARACTER,
        'character-1',
        FileAssetSlot.PORTRAIT,
        'c-1',
        'The account was closed',
      );
    });

    // The deletion has already happened, and the sweep finds it again.
    it('logs a picture it cannot withdraw and goes on to the next', async () => {
      const failed = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      withdrawal.withdrawSlot.mockRejectedValueOnce(new Error('registry down'));

      await expect(
        service.withdrawEach(
          [
            PersonalPictureWithdrawalService.portrait('character-1', 'c-1'),
            PersonalPictureWithdrawalService.portrait('character-2', 'c-2'),
          ],
          PERSONAL_PICTURE_REASONS.STO_ACCOUNT_DELETED,
        ),
      ).resolves.toBe(1);

      expect(failed).toHaveBeenCalledWith(
        '[withdrawEach] Not withdrawn - Subject: STO_CHARACTER, SubjectId: character-1, ImageId: c-1',
        expect.stringContaining('registry down'),
      );
      expect(withdrawal.withdrawSlot).toHaveBeenCalledTimes(2);
    });

    it('logs a failure that is not an Error as it is', async () => {
      const failed = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      withdrawal.withdrawSlot.mockRejectedValueOnce('refused');

      await service.withdrawEach(
        [PersonalPictureWithdrawalService.portrait('character-1', 'c-1')],
        PERSONAL_PICTURE_REASONS.CHARACTER_DELETED,
      );

      expect(failed).toHaveBeenCalledWith(expect.any(String), 'refused');
    });
  });
});
