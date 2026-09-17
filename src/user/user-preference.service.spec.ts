import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { jest } from '@jest/globals';

import { UserPreferenceEntity } from './entities/user-preference.entity';
import { NotificationCategory } from './enums/notification-category.enum';
import { PresenceVisibility } from './enums/presence-visibility.enum';
import {
  DEFAULT_USER_PREFERENCES,
  UserPreferenceService,
} from './user-preference.service';

describe('UserPreferenceService', () => {
  let service: UserPreferenceService;
  let repository: {
    findOne: jest.Mock<(...args: any[]) => Promise<any>>;
    create: jest.Mock<(...args: any[]) => any>;
    save: jest.Mock<(...args: any[]) => Promise<any>>;
  };

  const stored = (overrides: Partial<UserPreferenceEntity> = {}) =>
    ({
      userId: 'user-1',
      ...DEFAULT_USER_PREFERENCES,
      ...overrides,
    }) as UserPreferenceEntity;

  beforeEach(async () => {
    repository = {
      findOne: jest.fn<(...args: any[]) => Promise<any>>(),
      create: jest.fn((value: any) => ({ ...value })),
      save: jest.fn(async (value: any) => value),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserPreferenceService,
        {
          provide: getRepositoryToken(UserPreferenceEntity),
          useValue: repository,
        },
      ],
    }).compile();

    service = module.get(UserPreferenceService);
  });

  describe('get', () => {
    it('returns the stored preferences when a row exists', async () => {
      repository.findOne.mockResolvedValue(stored({ appearOffline: true }));

      await expect(service.get('user-1')).resolves.toEqual(
        expect.objectContaining({ appearOffline: true }),
      );
    });

    /**
     * An account that has never opened the settings page has no row. Answering
     * with the defaults rather than null is what lets every caller treat
     * preferences as always present, and is why nothing has to remember to
     * create a row before reading one.
     */
    it('returns the defaults when no row exists', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.get('user-1')).resolves.toEqual({
        userId: 'user-1',
        ...DEFAULT_USER_PREFERENCES,
      });
    });

    it('does not create a row on read', async () => {
      repository.findOne.mockResolvedValue(null);

      await service.get('user-1');

      expect(repository.save).not.toHaveBeenCalled();
    });
  });

  describe('defaults', () => {
    /**
     * Typing is the one preference here that emits information about somebody
     * without them doing anything deliberate, so plan section 8 calls it
     * opt-in. Presence starts at friends for the same reason: a new account
     * should not be visible to strangers before its owner has been asked.
     */
    it('starts typing indicators off and presence at friends', () => {
      expect(DEFAULT_USER_PREFERENCES.typingIndicatorsEnabled).toBe(false);
      expect(DEFAULT_USER_PREFERENCES.presenceVisibility).toBe(
        PresenceVisibility.FRIENDS,
      );
      expect(DEFAULT_USER_PREFERENCES.appearOffline).toBe(false);
    });

    it('starts every notification category on', () => {
      expect(DEFAULT_USER_PREFERENCES.notifyMention).toBe(true);
      expect(DEFAULT_USER_PREFERENCES.notifyReply).toBe(true);
      expect(DEFAULT_USER_PREFERENCES.notifyDirectMessage).toBe(true);
      expect(DEFAULT_USER_PREFERENCES.notifyRosterAssociation).toBe(true);
      expect(DEFAULT_USER_PREFERENCES.notifyEventReminder).toBe(true);
    });

    /**
     * Neither timezone is guessed. The display zone follows the viewer's device
     * until they pin one, and the export zone stays unset until the first
     * import asks — requirement R09 forbids inferring it from the uploader's
     * browser without confirmation, and a wrong guess shifts every date in the
     * file by hours.
     */
    it('leaves both timezones unset', () => {
      expect(DEFAULT_USER_PREFERENCES.displayTimezone).toBeNull();
      expect(DEFAULT_USER_PREFERENCES.stoExportTimezone).toBeNull();
    });
  });

  describe('update', () => {
    it('creates a row from the defaults when none exists', async () => {
      repository.findOne.mockResolvedValue(null);

      await service.update('user-1', { appearOffline: true });

      expect(repository.create).toHaveBeenCalledWith({
        userId: 'user-1',
        ...DEFAULT_USER_PREFERENCES,
      });
      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', appearOffline: true }),
      );
    });

    it('changes only the fields supplied', async () => {
      repository.findOne.mockResolvedValue(
        stored({ typingIndicatorsEnabled: true, notifyMention: false }),
      );

      const result = await service.update('user-1', { appearOffline: true });

      expect(result.typingIndicatorsEnabled).toBe(true);
      expect(result.notifyMention).toBe(false);
      expect(result.appearOffline).toBe(true);
    });

    /**
     * `europe/london` and `Europe/London` name the same place. Storing both
     * spellings would make two rows that mean the same thing compare unequal,
     * so the runtime's own spelling is what lands in the column.
     */
    it('stores timezones in their canonical spelling', async () => {
      repository.findOne.mockResolvedValue(stored());

      const result = await service.update('user-1', {
        displayTimezone: 'europe/london',
        stoExportTimezone: 'america/new_york',
      });

      expect(result.displayTimezone).toBe('Europe/London');
      expect(result.stoExportTimezone).toBe('America/New_York');
    });

    it('accepts null to clear a timezone', async () => {
      repository.findOne.mockResolvedValue(
        stored({ displayTimezone: 'Europe/London' }),
      );

      const result = await service.update('user-1', { displayTimezone: null });

      expect(result.displayTimezone).toBeNull();
    });

    it.each([
      ['displayTimezone', 'BST'],
      ['stoExportTimezone', 'Not/AZone'],
    ])('refuses an unusable %s', async (field, value) => {
      repository.findOne.mockResolvedValue(stored());

      await expect(
        service.update('user-1', { [field]: value }),
      ).rejects.toThrow('is not an IANA timezone');
      expect(repository.save).not.toHaveBeenCalled();
    });
  });

  describe('isCategoryEnabled', () => {
    it.each([
      [NotificationCategory.MENTION, 'notifyMention'],
      [NotificationCategory.REPLY, 'notifyReply'],
      [NotificationCategory.DIRECT_MESSAGE, 'notifyDirectMessage'],
      [NotificationCategory.ROSTER_ASSOCIATION, 'notifyRosterAssociation'],
      [NotificationCategory.EVENT_REMINDER, 'notifyEventReminder'],
    ])('reads %s from its own column', async (category, column) => {
      repository.findOne.mockResolvedValue(stored({ [column]: false }));

      await expect(service.isCategoryEnabled('user-1', category)).resolves.toBe(
        false,
      );
    });

    /**
     * Every category can be switched off, including roster association
     * proposals. Decided by Steve on 17 September 2026: a proposal nobody is
     * told about goes unanswered and expires, and the alternative was a
     * notification the recipient cannot turn off.
     */
    it('lets a user switch off roster association proposals', async () => {
      repository.findOne.mockResolvedValue(
        stored({ notifyRosterAssociation: false }),
      );

      await expect(
        service.isCategoryEnabled(
          'user-1',
          NotificationCategory.ROSTER_ASSOCIATION,
        ),
      ).resolves.toBe(false);
    });

    it('is on for an account with no stored preferences', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(
        service.isCategoryEnabled('user-1', NotificationCategory.MENTION),
      ).resolves.toBe(true);
    });
  });

  describe('resolveExportTimezone', () => {
    it('uses the stored default when no override is given', async () => {
      repository.findOne.mockResolvedValue(
        stored({ stoExportTimezone: 'America/New_York' }),
      );

      await expect(service.resolveExportTimezone('user-1')).resolves.toBe(
        'America/New_York',
      );
    });

    /**
     * The zone belongs to the machine the export came from, not to the person
     * uploading it, so a per-import answer beats the stored default rather than
     * being merged with it (R09).
     */
    it('prefers the override for this import', async () => {
      repository.findOne.mockResolvedValue(
        stored({ stoExportTimezone: 'America/New_York' }),
      );

      await expect(
        service.resolveExportTimezone('user-1', 'europe/london'),
      ).resolves.toBe('Europe/London');
    });

    /**
     * Refused rather than quietly replaced by the stored default. Reading an
     * export in the wrong zone shifts every date in it by hours, and doing that
     * silently is worse than failing.
     */
    it('refuses an unusable override rather than falling back', async () => {
      repository.findOne.mockResolvedValue(
        stored({ stoExportTimezone: 'America/New_York' }),
      );

      await expect(
        service.resolveExportTimezone('user-1', 'EST'),
      ).rejects.toThrow('is not an IANA timezone');
    });

    it('returns null when the user has never chosen one', async () => {
      repository.findOne.mockResolvedValue(stored());

      await expect(service.resolveExportTimezone('user-1')).resolves.toBeNull();
      await expect(
        service.resolveExportTimezone('user-1', null),
      ).resolves.toBeNull();
    });
  });
});
