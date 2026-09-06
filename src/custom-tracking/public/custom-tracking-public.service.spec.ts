import { jest } from '@jest/globals';

import { AccountEntity } from 'src/sto/account/entities/account.entity';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';
import { UserProfileEntity } from 'src/user/entities/user-profile.entity';

import { CUSTOM_TRACKING_FEATURE_FLAGS } from '../constants/custom-tracking-feature.constants';
import { CustomTrackingFeatureService } from '../custom-tracking-feature.service';
import {
  CustomTrackingDefinitionTreeService,
  CustomTrackingSectionNode,
} from '../definitions/custom-tracking-definition-tree.service';
import { CustomTrackingFieldEntity } from '../entities/custom-tracking-field.entity';
import { CustomTrackingOptionEntity } from '../entities/custom-tracking-option.entity';
import { CustomTrackingSectionEntity } from '../entities/custom-tracking-section.entity';
import { CustomTrackingTabEntity } from '../entities/custom-tracking-tab.entity';
import { CustomTrackingEmptyMode } from '../enums/custom-tracking-empty-mode.enum';
import { CustomTrackingFieldType } from '../enums/custom-tracking-field-type.enum';
import { CustomTrackingTargetScope } from '../enums/custom-tracking-target-scope.enum';
import { createRepositoryDouble } from '../testing/custom-tracking-test.doubles';
import {
  CustomTrackingStoredAnswer,
  CustomTrackingValueService,
} from '../values/custom-tracking-value.service';
import { CustomTrackingPublicService } from './custom-tracking-public.service';

describe('CustomTrackingPublicService', () => {
  let service: CustomTrackingPublicService;
  let accounts: ReturnType<typeof createRepositoryDouble<AccountEntity>>;
  let characters: ReturnType<typeof createRepositoryDouble<CharacterEntity>>;
  let profiles: ReturnType<typeof createRepositoryDouble<UserProfileEntity>>;
  let isFlagEnabled: jest.Mock<(flag: string) => Promise<boolean>>;
  let load: jest.Mock<() => Promise<CustomTrackingSectionNode[]>>;
  let readAnswers: jest.Mock<() => Promise<CustomTrackingStoredAnswer[]>>;

  const section = (
    overrides: Partial<CustomTrackingSectionEntity> = {},
  ): CustomTrackingSectionEntity =>
    ({
      id: 'section-1',
      name: 'Fleet duties',
      description: null,
      publiclyVisible: true,
      suppressedAt: null,
      ...overrides,
    }) as CustomTrackingSectionEntity;

  const tab = (
    overrides: Partial<CustomTrackingTabEntity> = {},
  ): CustomTrackingTabEntity =>
    ({
      id: 'tab-1',
      name: 'Provisioning',
      description: null,
      publiclyVisible: true,
      suppressedAt: null,
      ...overrides,
    }) as CustomTrackingTabEntity;

  const field = (
    overrides: Partial<CustomTrackingFieldEntity> = {},
  ): CustomTrackingFieldEntity =>
    ({
      id: 'field-1',
      fieldType: CustomTrackingFieldType.TEXT_SINGLE_LINE,
      name: 'Ship name',
      description: null,
      publiclyVisible: true,
      suppressedAt: null,
      publicEmptyMode: CustomTrackingEmptyMode.HIDE,
      emptyPlaceholder: null,
      configuration: {},
      ...overrides,
    }) as CustomTrackingFieldEntity;

  const tree = (
    fields: CustomTrackingFieldEntity[],
    options: CustomTrackingOptionEntity[] = [],
    overrides: {
      section?: Partial<CustomTrackingSectionEntity>;
      tab?: Partial<CustomTrackingTabEntity>;
    } = {},
  ): CustomTrackingSectionNode[] => [
    {
      section: section(overrides.section),
      tabs: [
        {
          tab: tab(overrides.tab),
          fields: fields.map(one => ({ field: one, options })),
        },
      ],
    },
  ];

  const answer = (
    overrides: Partial<CustomTrackingStoredAnswer> = {},
  ): CustomTrackingStoredAnswer => ({
    fieldId: 'field-1',
    fragment: { text: 'Bellerophon' },
    optionIds: [],
    image: null,
    ...overrides,
  });

  const publicAccount = (
    overrides: Partial<AccountEntity> = {},
  ): AccountEntity =>
    ({
      id: 'account-1',
      userId: 'user-1',
      publiclyVisible: true,
      ...overrides,
    }) as AccountEntity;

  const publicProfile = (
    overrides: Partial<UserProfileEntity> = {},
  ): UserProfileEntity =>
    ({
      userId: 'user-1',
      publiclyVisible: true,
      user: { deletedAt: null, isAccountDisabled: false },
      ...overrides,
    }) as UserProfileEntity;

  const project = (
    scope = CustomTrackingTargetScope.ACCOUNT,
    targetId = 'account-1',
  ): ReturnType<CustomTrackingPublicService['project']> =>
    service.project(scope, targetId);

  beforeEach(() => {
    accounts = createRepositoryDouble<AccountEntity>();
    characters = createRepositoryDouble<CharacterEntity>();
    profiles = createRepositoryDouble<UserProfileEntity>();

    isFlagEnabled = jest
      .fn<(flag: string) => Promise<boolean>>()
      .mockResolvedValue(true);
    load = jest
      .fn<() => Promise<CustomTrackingSectionNode[]>>()
      .mockResolvedValue([]);
    readAnswers = jest
      .fn<() => Promise<CustomTrackingStoredAnswer[]>>()
      .mockResolvedValue([]);

    accounts.double.findOne.mockResolvedValue(publicAccount());
    profiles.double.findOne.mockResolvedValue(publicProfile());

    service = new CustomTrackingPublicService(
      accounts.repository,
      characters.repository,
      profiles.repository,
      { isFlagEnabled } as unknown as CustomTrackingFeatureService,
      { load } as unknown as CustomTrackingDefinitionTreeService,
      { readAnswers } as unknown as CustomTrackingValueService,
    );
  });

  describe('the visibility chain', () => {
    it('publishes an answered, public field', async () => {
      load.mockResolvedValue(tree([field()]));
      readAnswers.mockResolvedValue([answer()]);

      const sections = await project();

      expect(sections).toHaveLength(1);
      expect(sections[0].tabs[0].fields[0].answer).toEqual(answer());
    });

    // A switched-off feature must look like a feature that was never built,
    // not like a member who has recorded nothing.
    it('publishes nothing while public reading is switched off', async () => {
      isFlagEnabled.mockImplementation(flag =>
        Promise.resolve(
          flag !== CUSTOM_TRACKING_FEATURE_FLAGS.PUBLIC_READ_ENABLED,
        ),
      );
      load.mockResolvedValue(tree([field()]));

      await expect(project()).resolves.toEqual([]);
      expect(load).not.toHaveBeenCalled();
    });

    it('publishes nothing for an account that is not public', async () => {
      accounts.double.findOne.mockResolvedValue(null);
      load.mockResolvedValue(tree([field()]));

      await expect(project()).resolves.toEqual([]);
      expect(load).not.toHaveBeenCalled();
    });

    it('asks only for a public, undeleted account', async () => {
      await project();

      expect(accounts.double.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'account-1',
            publiclyVisible: true,
          }),
        }),
      );
    });

    it('publishes nothing for a character that is not public', async () => {
      characters.double.findOne.mockResolvedValue(null);
      load.mockResolvedValue(tree([field()]));

      await expect(
        project(CustomTrackingTargetScope.CHARACTER, 'character-1'),
      ).resolves.toEqual([]);
    });

    // A captain marked public on an account that is not cannot be reached, so
    // neither may anything recorded against them.
    it('publishes nothing for a public character on a private account', async () => {
      characters.double.findOne.mockResolvedValue({
        id: 'character-1',
        accountId: 'account-1',
      } as CharacterEntity);
      accounts.double.findOne.mockResolvedValue(null);
      load.mockResolvedValue(tree([field()]));

      await expect(
        project(CustomTrackingTargetScope.CHARACTER, 'character-1'),
      ).resolves.toEqual([]);
    });

    it('publishes a public character on a public account', async () => {
      characters.double.findOne.mockResolvedValue({
        id: 'character-1',
        accountId: 'account-1',
      } as CharacterEntity);
      load.mockResolvedValue(tree([field()]));
      readAnswers.mockResolvedValue([answer()]);

      await expect(
        project(CustomTrackingTargetScope.CHARACTER, 'character-1'),
      ).resolves.toHaveLength(1);
      expect(load).toHaveBeenCalledWith(
        'user-1',
        CustomTrackingTargetScope.CHARACTER,
      );
    });

    it('publishes nothing where the member is not publicly listed', async () => {
      profiles.double.findOne.mockResolvedValue(null);
      load.mockResolvedValue(tree([field()]));

      await expect(project()).resolves.toEqual([]);
    });

    // Disabling a member has to take their public custom content with it, or a
    // ban would depend on the banned user tidying up after themselves.
    it('publishes nothing for a disabled member', async () => {
      profiles.double.findOne.mockResolvedValue(
        publicProfile({
          user: { deletedAt: null, isAccountDisabled: true },
        } as Partial<UserProfileEntity>),
      );
      load.mockResolvedValue(tree([field()]));

      await expect(project()).resolves.toEqual([]);
    });

    it('publishes nothing for a closed member', async () => {
      profiles.double.findOne.mockResolvedValue(
        publicProfile({
          user: { deletedAt: new Date(), isAccountDisabled: false },
        } as unknown as Partial<UserProfileEntity>),
      );
      load.mockResolvedValue(tree([field()]));

      await expect(project()).resolves.toEqual([]);
    });

    it('publishes nothing where the profile has no user behind it', async () => {
      profiles.double.findOne.mockResolvedValue({
        userId: 'user-1',
        publiclyVisible: true,
      } as UserProfileEntity);
      load.mockResolvedValue(tree([field()]));

      await expect(project()).resolves.toEqual([]);
    });
  });

  describe('each level of the hierarchy', () => {
    it('withholds a private section and everything under it', async () => {
      load.mockResolvedValue(
        tree([field()], [], { section: { publiclyVisible: false } }),
      );
      readAnswers.mockResolvedValue([answer()]);

      await expect(project()).resolves.toEqual([]);
    });

    it('withholds a private tab and everything under it', async () => {
      load.mockResolvedValue(
        tree([field()], [], { tab: { publiclyVisible: false } }),
      );
      readAnswers.mockResolvedValue([answer()]);

      await expect(project()).resolves.toEqual([]);
    });

    it('withholds a private field', async () => {
      load.mockResolvedValue(tree([field({ publiclyVisible: false })]));
      readAnswers.mockResolvedValue([answer()]);

      await expect(project()).resolves.toEqual([]);
    });

    it('withholds a suppressed section', async () => {
      load.mockResolvedValue(
        tree([field()], [], { section: { suppressedAt: new Date() } }),
      );
      readAnswers.mockResolvedValue([answer()]);

      await expect(project()).resolves.toEqual([]);
    });

    it('withholds a suppressed tab', async () => {
      load.mockResolvedValue(
        tree([field()], [], { tab: { suppressedAt: new Date() } }),
      );
      readAnswers.mockResolvedValue([answer()]);

      await expect(project()).resolves.toEqual([]);
    });

    it('withholds a suppressed field', async () => {
      load.mockResolvedValue(tree([field({ suppressedAt: new Date() })]));
      readAnswers.mockResolvedValue([answer()]);

      await expect(project()).resolves.toEqual([]);
    });

    // Nothing is read against the target until something is left to answer, so
    // an entirely private hierarchy costs one query rather than four.
    it('reads no values where nothing survives the chain', async () => {
      load.mockResolvedValue(tree([field({ publiclyVisible: false })]));

      await project();

      expect(readAnswers).not.toHaveBeenCalled();
    });
  });

  describe('what is left when a field has no answer', () => {
    it('leaves out an unanswered field configured to hide', async () => {
      load.mockResolvedValue(tree([field()]));

      await expect(project()).resolves.toEqual([]);
    });

    it('keeps an unanswered field configured to show its label', async () => {
      load.mockResolvedValue(
        tree([field({ publicEmptyMode: CustomTrackingEmptyMode.SHOW_LABEL })]),
      );

      const sections = await project();

      expect(sections[0].tabs[0].fields[0].answer).toBeNull();
      expect(sections[0].tabs[0].fields[0].chosen).toEqual([]);
    });

    it('keeps an unanswered field configured to show a placeholder', async () => {
      load.mockResolvedValue(
        tree([
          field({
            publicEmptyMode: CustomTrackingEmptyMode.SHOW_PLACEHOLDER,
            emptyPlaceholder: 'Not yet decided',
          }),
        ]),
      );

      const sections = await project();

      expect(sections[0].tabs[0].fields[0].field.emptyPlaceholder).toBe(
        'Not yet decided',
      );
    });

    // The owner's own empty rule is theirs alone. Reading it here would put
    // their private view of a gap onto a public page.
    it('ignores the owner’s empty rule', async () => {
      load.mockResolvedValue(
        tree([
          field({
            ownerEmptyMode: CustomTrackingEmptyMode.SHOW_LABEL,
            publicEmptyMode: CustomTrackingEmptyMode.HIDE,
          }),
        ]),
      );

      await expect(project()).resolves.toEqual([]);
    });

    it('drops a tab and section left with nothing to show', async () => {
      load.mockResolvedValue(
        tree([field({ id: 'field-1' }), field({ id: 'field-2' })]),
      );

      await expect(project()).resolves.toEqual([]);
    });
  });

  describe('the options an answer chose', () => {
    const option = (
      overrides: Partial<CustomTrackingOptionEntity> = {},
    ): CustomTrackingOptionEntity =>
      ({
        id: 'option-1',
        label: 'Escort',
        deletedAt: null,
        ...overrides,
      }) as CustomTrackingOptionEntity;

    it('resolves them in the order they were chosen', async () => {
      load.mockResolvedValue(
        tree(
          [field({ fieldType: CustomTrackingFieldType.MULTI_SELECT })],
          [option(), option({ id: 'option-2', label: 'Cruiser' })],
        ),
      );
      readAnswers.mockResolvedValue([
        answer({ fragment: null, optionIds: ['option-2', 'option-1'] }),
      ]);

      const sections = await project();

      expect(
        sections[0].tabs[0].fields[0].chosen.map(chosen => chosen.label),
      ).toEqual(['Cruiser', 'Escort']);
    });

    // A withdrawn label still has to read correctly: the value said this, and
    // its owner having since retired the word does not change what they said.
    it('resolves an option that has since been withdrawn', async () => {
      load.mockResolvedValue(
        tree(
          [field({ fieldType: CustomTrackingFieldType.DROPDOWN })],
          [option({ deletedAt: new Date() })],
        ),
      );
      readAnswers.mockResolvedValue([
        answer({ fragment: null, optionIds: ['option-1'] }),
      ]);

      const sections = await project();

      expect(sections[0].tabs[0].fields[0].chosen).toHaveLength(1);
    });

    it('skips an identifier no option matches', async () => {
      load.mockResolvedValue(
        tree([field({ fieldType: CustomTrackingFieldType.TAGS })], [option()]),
      );
      readAnswers.mockResolvedValue([
        answer({ fragment: null, optionIds: ['option-1', 'option-gone'] }),
      ]);

      const sections = await project();

      expect(sections[0].tabs[0].fields[0].chosen).toHaveLength(1);
    });
  });

  describe('the types that can be switched off', () => {
    it('leaves out image fields while pictures are switched off', async () => {
      isFlagEnabled.mockImplementation(flag =>
        Promise.resolve(flag !== CUSTOM_TRACKING_FEATURE_FLAGS.IMAGES_ENABLED),
      );
      load.mockResolvedValue(
        tree([field({ fieldType: CustomTrackingFieldType.IMAGE })]),
      );
      readAnswers.mockResolvedValue([answer()]);

      await expect(project()).resolves.toEqual([]);
    });

    it('leaves out YouTube fields while videos are switched off', async () => {
      isFlagEnabled.mockImplementation(flag =>
        Promise.resolve(flag !== CUSTOM_TRACKING_FEATURE_FLAGS.YOUTUBE_ENABLED),
      );
      load.mockResolvedValue(
        tree([field({ fieldType: CustomTrackingFieldType.YOUTUBE })]),
      );
      readAnswers.mockResolvedValue([answer()]);

      await expect(project()).resolves.toEqual([]);
    });

    it('keeps both while they are switched on', async () => {
      load.mockResolvedValue(
        tree([
          field({ id: 'field-1', fieldType: CustomTrackingFieldType.IMAGE }),
          field({ id: 'field-2', fieldType: CustomTrackingFieldType.YOUTUBE }),
        ]),
      );
      readAnswers.mockResolvedValue([
        answer({ fieldId: 'field-1', fragment: null }),
        answer({ fieldId: 'field-2' }),
      ]);

      const sections = await project();

      expect(sections[0].tabs[0].fields).toHaveLength(2);
    });
  });
});
