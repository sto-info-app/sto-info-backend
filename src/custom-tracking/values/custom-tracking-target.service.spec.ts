import { NotFoundException } from '@nestjs/common';

import { IsNull } from 'typeorm';

import { AccountEntity } from 'src/sto/account/entities/account.entity';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';

import { CustomTrackingTargetScope } from '../enums/custom-tracking-target-scope.enum';
import { createRepositoryDouble } from '../testing/custom-tracking-test.doubles';
import { CustomTrackingTargetService } from './custom-tracking-target.service';

describe('CustomTrackingTargetService', () => {
  const userId = 'user-1';

  let service: CustomTrackingTargetService;
  let accounts: ReturnType<typeof createRepositoryDouble<AccountEntity>>;
  let characters: ReturnType<typeof createRepositoryDouble<CharacterEntity>>;

  beforeEach(() => {
    accounts = createRepositoryDouble<AccountEntity>();
    characters = createRepositoryDouble<CharacterEntity>();

    service = new CustomTrackingTargetService(
      accounts.repository,
      characters.repository,
    );
  });

  const account = (overrides: Partial<AccountEntity> = {}): AccountEntity =>
    ({
      id: 'account-1',
      userId,
      handle: 'ares',
      publiclyVisible: true,
      ...overrides,
    }) as AccountEntity;

  const character = (
    overrides: Partial<CharacterEntity> = {},
  ): CharacterEntity =>
    ({
      id: 'character-1',
      fullHandle: 'Kira@ares',
      publiclyVisible: false,
      ...overrides,
    }) as CharacterEntity;

  describe('findOwned', () => {
    it('finds one of the caller’s accounts', async () => {
      accounts.double.findOne.mockResolvedValue(account());

      await expect(
        service.findOwned(
          userId,
          CustomTrackingTargetScope.ACCOUNT,
          'account-1',
        ),
      ).resolves.toEqual({
        scope: CustomTrackingTargetScope.ACCOUNT,
        id: 'account-1',
        label: 'ares',
        publiclyVisible: true,
      });
    });

    it('finds one of the caller’s characters', async () => {
      characters.double.findOne.mockResolvedValue(character());

      await expect(
        service.findOwned(
          userId,
          CustomTrackingTargetScope.CHARACTER,
          'character-1',
        ),
      ).resolves.toEqual({
        scope: CustomTrackingTargetScope.CHARACTER,
        id: 'character-1',
        label: 'Kira@ares',
        publiclyVisible: false,
      });
    });

    // Absent and belonging to somebody else are the same answer, so nobody can
    // discover which identifiers exist by watching which are refused
    // differently.
    it('reports another user’s account as simply not found', async () => {
      accounts.double.findOne.mockResolvedValue(null);

      await expect(
        service.findOwned(
          userId,
          CustomTrackingTargetScope.ACCOUNT,
          'account-1',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(accounts.double.findOne).toHaveBeenCalledWith({
        where: { id: 'account-1', userId, deletedAt: IsNull() },
      });
    });

    it('reports another user’s character as simply not found', async () => {
      characters.double.findOne.mockResolvedValue(null);

      await expect(
        service.findOwned(
          userId,
          CustomTrackingTargetScope.CHARACTER,
          'character-1',
        ),
      ).rejects.toThrow('That character could not be found.');
    });

    // A Character has no owner of its own, so ownership runs through the
    // Account it belongs to.
    it('establishes character ownership through the account', async () => {
      characters.double.findOne.mockResolvedValue(character());

      await service.findOwned(
        userId,
        CustomTrackingTargetScope.CHARACTER,
        'character-1',
      );

      expect(characters.double.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'character-1',
            deletedAt: IsNull(),
            account: { userId, deletedAt: IsNull() },
          },
        }),
      );
    });

    // A soft-deleted account is on its way out under the retention policy;
    // recording against it would keep making rows for something nobody sees.
    it('excludes records that are on their way out', async () => {
      accounts.double.findOne.mockResolvedValue(null);

      await expect(
        service.findOwned(
          userId,
          CustomTrackingTargetScope.ACCOUNT,
          'account-1',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(accounts.double.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ deletedAt: IsNull() }),
        }),
      );
    });
  });

  describe('whereFor', () => {
    // Getting this wrong means reading or writing another record's answers,
    // which is why it lives here rather than in each service that needs it.
    it('selects an account’s values by account', () => {
      expect(
        service.whereFor({
          scope: CustomTrackingTargetScope.ACCOUNT,
          id: 'account-1',
          label: 'ares',
          publiclyVisible: true,
        }),
      ).toEqual({ accountId: 'account-1', deletedAt: IsNull() });
    });

    it('selects a character’s values by character', () => {
      expect(
        service.whereFor({
          scope: CustomTrackingTargetScope.CHARACTER,
          id: 'character-1',
          label: 'Kira@ares',
          publiclyVisible: false,
        }),
      ).toEqual({ characterId: 'character-1', deletedAt: IsNull() });
    });
  });

  describe('listOwned', () => {
    it('lists the caller’s accounts', async () => {
      accounts.double.find.mockResolvedValue([
        account(),
        account({ id: 'account-2', handle: 'brahms' }),
      ]);

      await expect(
        service.listOwned(userId, CustomTrackingTargetScope.ACCOUNT),
      ).resolves.toEqual([
        expect.objectContaining({ id: 'account-1', label: 'ares' }),
        expect.objectContaining({ id: 'account-2', label: 'brahms' }),
      ]);
    });

    it('lists the caller’s characters across every account', async () => {
      characters.double.find.mockResolvedValue([character()]);

      await expect(
        service.listOwned(userId, CustomTrackingTargetScope.CHARACTER),
      ).resolves.toEqual([
        expect.objectContaining({
          id: 'character-1',
          label: 'Kira@ares',
          scope: CustomTrackingTargetScope.CHARACTER,
        }),
      ]);
      expect(characters.double.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            deletedAt: IsNull(),
            account: { userId, deletedAt: IsNull() },
          },
        }),
      );
    });

    it('orders each list stably', async () => {
      await service.listOwned(userId, CustomTrackingTargetScope.ACCOUNT);
      await service.listOwned(userId, CustomTrackingTargetScope.CHARACTER);

      expect(accounts.double.find).toHaveBeenCalledWith(
        expect.objectContaining({ order: { handle: 'ASC', id: 'ASC' } }),
      );
      expect(characters.double.find).toHaveBeenCalledWith(
        expect.objectContaining({ order: { fullHandle: 'ASC', id: 'ASC' } }),
      );
    });
  });
});
