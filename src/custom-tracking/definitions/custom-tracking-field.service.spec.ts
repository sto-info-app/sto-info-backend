import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { jest } from '@jest/globals';
import { DataSource } from 'typeorm';

import { CUSTOM_TRACKING_LIMITS } from '../constants/custom-tracking-limits.constants';
import { CustomTrackingFieldEntity } from '../entities/custom-tracking-field.entity';
import { CustomTrackingSectionEntity } from '../entities/custom-tracking-section.entity';
import { CustomTrackingTabEntity } from '../entities/custom-tracking-tab.entity';
import { CustomTrackingEmptyMode } from '../enums/custom-tracking-empty-mode.enum';
import { CustomTrackingFieldType } from '../enums/custom-tracking-field-type.enum';
import { CustomTrackingTargetScope } from '../enums/custom-tracking-target-scope.enum';
import {
  createDataSourceDouble,
  createEntityManagerDouble,
  createRepositoryDouble,
  createSupportService,
} from '../testing/custom-tracking-test.doubles';
import { CustomTrackingCascadeService } from './custom-tracking-cascade.service';
import { CustomTrackingFieldConfigurationService } from './custom-tracking-field-configuration.service';
import { CustomTrackingFieldService } from './custom-tracking-field.service';
import { CustomTrackingTabService } from './custom-tracking-tab.service';

describe('CustomTrackingFieldService', () => {
  const userId = 'user-1';
  const scope = CustomTrackingTargetScope.ACCOUNT;

  let service: CustomTrackingFieldService;
  let fields: ReturnType<
    typeof createRepositoryDouble<CustomTrackingFieldEntity>
  >;
  let findOwnedTab: jest.Mock<() => Promise<CustomTrackingTabEntity>>;
  let sectionOf: jest.Mock<() => Promise<CustomTrackingSectionEntity>>;
  let deleteFields: jest.Mock<() => Promise<void>>;
  let describeFieldDeletion: jest.Mock<
    () => Promise<{ tabs: number; fields: number; values: number }>
  >;
  let managerDouble: ReturnType<typeof createEntityManagerDouble>;

  const input = (
    overrides: Partial<
      Parameters<CustomTrackingFieldService['create']>[2]
    > = {},
  ): Parameters<CustomTrackingFieldService['create']>[2] => ({
    fieldType: CustomTrackingFieldType.TEXT_SINGLE_LINE,
    name: 'Ship name',
    description: null,
    publiclyVisible: false,
    required: false,
    ownerEmptyMode: CustomTrackingEmptyMode.SHOW_LABEL,
    publicEmptyMode: CustomTrackingEmptyMode.HIDE,
    emptyPlaceholder: null,
    configuration: {},
    ...overrides,
  });

  beforeEach(() => {
    fields = createRepositoryDouble<CustomTrackingFieldEntity>();
    findOwnedTab = jest
      .fn<() => Promise<CustomTrackingTabEntity>>()
      .mockResolvedValue({
        id: 'tab-1',
        sectionId: 'section-1',
      } as CustomTrackingTabEntity);
    sectionOf = jest
      .fn<() => Promise<CustomTrackingSectionEntity>>()
      .mockResolvedValue({
        id: 'section-1',
        userId,
        targetScope: scope,
      } as CustomTrackingSectionEntity);
    deleteFields = jest.fn<() => Promise<void>>().mockResolvedValue();
    describeFieldDeletion = jest
      .fn<() => Promise<{ tabs: number; fields: number; values: number }>>()
      .mockResolvedValue({ tabs: 0, fields: 0, values: 19 });
    managerDouble = createEntityManagerDouble();

    service = new CustomTrackingFieldService(
      fields.repository,
      {
        findOwned: findOwnedTab,
        sectionOf,
      } as unknown as CustomTrackingTabService,
      createSupportService().support,
      {
        deleteFields,
        describeFieldDeletion,
      } as unknown as CustomTrackingCascadeService,
      new CustomTrackingFieldConfigurationService(),
      createDataSourceDouble(managerDouble.manager) as unknown as DataSource,
    );
  });

  const existing = (
    overrides: Partial<CustomTrackingFieldEntity> = {},
  ): CustomTrackingFieldEntity =>
    ({
      id: 'field-1',
      tabId: 'tab-1',
      userId,
      targetScope: scope,
      fieldType: CustomTrackingFieldType.TEXT_SINGLE_LINE,
      name: 'Ship name',
      nameNormalized: 'ship name',
      description: null,
      orderIndex: 1000,
      publiclyVisible: false,
      required: false,
      ownerEmptyMode: CustomTrackingEmptyMode.SHOW_LABEL,
      publicEmptyMode: CustomTrackingEmptyMode.HIDE,
      emptyPlaceholder: null,
      configuration: {},
      deletedAt: null,
      ...overrides,
    }) as unknown as CustomTrackingFieldEntity;

  describe('findOwned', () => {
    // A Field carries its owner, so this is one indexed read rather than a
    // walk back up through the Tab and the Section.
    it('finds a Field by owner without walking up the hierarchy', async () => {
      fields.double.findOne.mockResolvedValue(existing());

      await service.findOwned(userId, 'field-1');

      expect(fields.double.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'field-1', userId }),
        }),
      );
      expect(findOwnedTab).not.toHaveBeenCalled();
    });

    it('reports another user’s Field as simply not found', async () => {
      fields.double.findOne.mockResolvedValue(null);

      await expect(service.findOwned(userId, 'field-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('list', () => {
    it('lists a Tab’s Fields in order', async () => {
      await service.list(userId, 'tab-1');

      expect(findOwnedTab).toHaveBeenCalledWith(userId, 'tab-1');
      expect(fields.double.find).toHaveBeenCalledWith(
        expect.objectContaining({ order: { orderIndex: 'ASC', id: 'ASC' } }),
      );
    });
  });

  describe('create', () => {
    it('copies the owner and scope from the Section', async () => {
      fields.double.findOne.mockResolvedValue(null);

      await service.create(userId, 'tab-1', input());

      expect(fields.double.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tabId: 'tab-1',
          userId,
          targetScope: scope,
          fieldType: CustomTrackingFieldType.TEXT_SINGLE_LINE,
          orderIndex: 1000,
        }),
      );
    });

    it('stores the configuration in its normalised form', async () => {
      fields.double.findOne.mockResolvedValue(null);

      await service.create(
        userId,
        'tab-1',
        input({
          fieldType: CustomTrackingFieldType.DECIMAL,
          configuration: { precision: 2, minimum: '0.50' },
        }),
      );

      expect(fields.double.create).toHaveBeenCalledWith(
        expect.objectContaining({
          configuration: expect.objectContaining({ minimum: '0.5' }),
        }),
      );
    });

    it('refuses a configuration that does not suit the type', async () => {
      fields.double.findOne.mockResolvedValue(null);

      await expect(
        service.create(
          userId,
          'tab-1',
          input({
            fieldType: CustomTrackingFieldType.RATING,
            configuration: { maximum: 4 },
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses a name a live sibling already has', async () => {
      fields.double.findOne.mockResolvedValue(existing());

      await expect(service.create(userId, 'tab-1', input())).rejects.toThrow(
        ConflictException,
      );
    });

    it('refuses a Field once the Tab is full', async () => {
      fields.double.count.mockResolvedValue(
        CUSTOM_TRACKING_LIMITS.MAX_FIELDS_PER_TAB,
      );

      await expect(service.create(userId, 'tab-1', input())).rejects.toThrow(
        /Add another tab/,
      );
    });

    it('refuses a Field once the scope is full', async () => {
      fields.double.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(CUSTOM_TRACKING_LIMITS.MAX_FIELDS_PER_SCOPE);

      await expect(service.create(userId, 'tab-1', input())).rejects.toThrow(
        /most allowed/,
      );
    });

    // Deleted Fields are kept for their retention period, so without this a
    // user could build and delete indefinitely and never appear to exceed the
    // live ceiling.
    it('counts deleted Fields against the storage ceiling', async () => {
      fields.double.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(
          CUSTOM_TRACKING_LIMITS.MAX_FIELDS_PER_SCOPE_INCLUDING_DELETED,
        );

      await expect(service.create(userId, 'tab-1', input())).rejects.toThrow(
        /180 days/,
      );
      expect(fields.double.count).toHaveBeenLastCalledWith({
        where: { userId, targetScope: scope },
        withDeleted: true,
      });
    });

    // A Field set to show placeholder text and given none would render a label
    // followed by nothing, which the "show the label alone" mode already does
    // and says so.
    it.each([
      [
        'the owner view',
        { ownerEmptyMode: CustomTrackingEmptyMode.SHOW_PLACEHOLDER },
      ],
      [
        'the public view',
        { publicEmptyMode: CustomTrackingEmptyMode.SHOW_PLACEHOLDER },
      ],
    ])(
      'refuses placeholder mode with no text for %s',
      async (_d, overrides) => {
        fields.double.findOne.mockResolvedValue(null);

        await expect(
          service.create(userId, 'tab-1', input(overrides)),
        ).rejects.toThrow(/needs some text to show/);
      },
    );

    it('accepts placeholder mode when text is given', async () => {
      fields.double.findOne.mockResolvedValue(null);

      await expect(
        service.create(
          userId,
          'tab-1',
          input({
            ownerEmptyMode: CustomTrackingEmptyMode.SHOW_PLACEHOLDER,
            emptyPlaceholder: 'Not recorded',
          }),
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('update', () => {
    it('changes only what it was given', async () => {
      const field = existing({ description: 'Unchanged' });

      fields.double.findOne.mockResolvedValue(field);

      await service.update(userId, 'field-1', { required: true });

      expect(field.required).toBe(true);
      expect(field.name).toBe('Ship name');
      expect(field.description).toBe('Unchanged');
    });

    it.each([
      ['a description', { description: null }, 'description', null],
      ['visibility', { publiclyVisible: true }, 'publiclyVisible', true],
      [
        'the owner empty mode',
        { ownerEmptyMode: CustomTrackingEmptyMode.HIDE },
        'ownerEmptyMode',
        CustomTrackingEmptyMode.HIDE,
      ],
      [
        'the public empty mode',
        { publicEmptyMode: CustomTrackingEmptyMode.SHOW_LABEL },
        'publicEmptyMode',
        CustomTrackingEmptyMode.SHOW_LABEL,
      ],
      [
        'the placeholder',
        { emptyPlaceholder: 'Nothing yet' },
        'emptyPlaceholder',
        'Nothing yet',
      ],
    ])('changes %s', async (_description, changes, property, expected) => {
      const field = existing({ description: 'Something' });

      fields.double.findOne.mockResolvedValue(field);

      await service.update(userId, 'field-1', changes);

      expect((field as unknown as Record<string, unknown>)[property]).toEqual(
        expected,
      );
    });

    it('allows a rename that only changes capitalisation', async () => {
      const field = existing();

      fields.double.findOne.mockResolvedValue(field);

      await service.update(userId, 'field-1', { name: 'SHIP NAME' });

      expect(field.name).toBe('SHIP NAME');
      expect(field.nameNormalized).toBe('ship name');
    });

    it('refuses a rename onto a name a sibling has', async () => {
      fields.double.findOne
        .mockResolvedValueOnce(existing())
        .mockResolvedValueOnce(existing({ id: 'field-2' }));

      await expect(
        service.update(userId, 'field-1', { name: 'Registry' }),
      ).rejects.toThrow(ConflictException);
    });

    // Trusting a type from the request would let a caller have a decimal's
    // settings checked as though they were a date's.
    it('checks new settings against the type the Field already has', async () => {
      fields.double.findOne.mockResolvedValue(
        existing({ fieldType: CustomTrackingFieldType.RATING }),
      );

      await expect(
        service.update(userId, 'field-1', { configuration: { maximum: 4 } }),
      ).rejects.toThrow(BadRequestException);

      fields.double.findOne.mockResolvedValue(
        existing({ fieldType: CustomTrackingFieldType.RATING }),
      );

      await expect(
        service.update(userId, 'field-1', { configuration: { maximum: 5 } }),
      ).resolves.toBeDefined();
    });

    it('refuses a change leaving placeholder mode with no text', async () => {
      fields.double.findOne.mockResolvedValue(existing());

      await expect(
        service.update(userId, 'field-1', {
          publicEmptyMode: CustomTrackingEmptyMode.SHOW_PLACEHOLDER,
        }),
      ).rejects.toThrow(/needs some text to show/);
    });

    it('refuses to change a Field that is not the caller’s', async () => {
      fields.double.findOne.mockResolvedValue(null);

      await expect(
        service.update(userId, 'field-1', { required: true }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('cascades the deletion inside a transaction', async () => {
      fields.double.findOne.mockResolvedValue(existing());

      await service.remove(userId, 'field-1');

      expect(deleteFields).toHaveBeenCalledWith(
        expect.anything(),
        ['field-1'],
        expect.any(Date),
      );
    });
  });

  describe('describeDeletion', () => {
    // Nothing goes with a Field but the answers recorded against it, and those
    // are exactly what cannot be typed again from memory.
    it('reports how many answers would go with it', async () => {
      fields.double.findOne.mockResolvedValue(existing());

      await expect(
        service.describeDeletion(userId, 'field-1'),
      ).resolves.toEqual({ tabs: 0, fields: 0, values: 19 });
      expect(describeFieldDeletion).toHaveBeenCalledWith(
        expect.anything(),
        'field-1',
      );
    });

    it('reports nothing about a Field that is not theirs', async () => {
      fields.double.findOne.mockResolvedValue(null);

      await expect(service.describeDeletion(userId, 'field-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('reorder', () => {
    it('renumbers the Tab’s Fields', async () => {
      managerDouble.double.find.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);

      await service.reorder(userId, 'tab-1', ['b', 'a']);

      expect(findOwnedTab).toHaveBeenCalledWith(userId, 'tab-1');
      expect(managerDouble.double.update).toHaveBeenCalledTimes(2);
    });
  });
});
