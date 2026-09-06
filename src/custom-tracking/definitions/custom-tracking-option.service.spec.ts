import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { jest } from '@jest/globals';
import { DataSource, Not } from 'typeorm';

import { CUSTOM_TRACKING_LIMITS } from '../constants/custom-tracking-limits.constants';
import { CustomTrackingFieldEntity } from '../entities/custom-tracking-field.entity';
import { CustomTrackingOptionEntity } from '../entities/custom-tracking-option.entity';
import { CustomTrackingFieldType } from '../enums/custom-tracking-field-type.enum';
import {
  createDataSourceDouble,
  createEntityManagerDouble,
  createRepositoryDouble,
  createSupportService,
} from '../testing/custom-tracking-test.doubles';
import { CustomTrackingFieldService } from './custom-tracking-field.service';
import { CustomTrackingOptionService } from './custom-tracking-option.service';

describe('CustomTrackingOptionService', () => {
  const userId = 'user-1';

  let service: CustomTrackingOptionService;
  let options: ReturnType<
    typeof createRepositoryDouble<CustomTrackingOptionEntity>
  >;
  let findOwnedField: jest.Mock<
    (userId: string, fieldId: string) => Promise<CustomTrackingFieldEntity>
  >;
  let managerDouble: ReturnType<typeof createEntityManagerDouble>;

  const field = (
    fieldType = CustomTrackingFieldType.DROPDOWN,
  ): CustomTrackingFieldEntity =>
    ({ id: 'field-1', userId, fieldType }) as CustomTrackingFieldEntity;

  beforeEach(() => {
    options = createRepositoryDouble<CustomTrackingOptionEntity>();
    findOwnedField = jest
      .fn<
        (userId: string, fieldId: string) => Promise<CustomTrackingFieldEntity>
      >()
      .mockResolvedValue(field());
    managerDouble = createEntityManagerDouble();

    service = new CustomTrackingOptionService(
      options.repository,
      { findOwned: findOwnedField } as unknown as CustomTrackingFieldService,
      createSupportService().support,
      createDataSourceDouble(managerDouble.manager) as unknown as DataSource,
    );
  });

  const existing = (
    overrides: Partial<CustomTrackingOptionEntity> = {},
  ): CustomTrackingOptionEntity =>
    ({
      id: 'option-1',
      fieldId: 'field-1',
      label: 'Fleet ship',
      labelNormalized: 'fleet ship',
      orderIndex: 1000,
      isDefault: false,
      deletedAt: null,
      ...overrides,
    }) as CustomTrackingOptionEntity;

  describe('findOwned', () => {
    it('returns the option and the Field offering it', async () => {
      options.double.findOne.mockResolvedValue(existing());

      await expect(
        service.findOwned(userId, 'option-1'),
      ).resolves.toMatchObject({
        option: { id: 'option-1' },
        field: { id: 'field-1' },
      });
    });

    it('refuses an option that does not exist', async () => {
      options.double.findOne.mockResolvedValue(null);

      await expect(service.findOwned(userId, 'option-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuses an option whose Field is not the caller’s', async () => {
      options.double.findOne.mockResolvedValue(existing());
      findOwnedField.mockRejectedValue(new NotFoundException());

      await expect(service.findOwned(userId, 'option-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('list', () => {
    it('lists a Field’s options in order', async () => {
      await service.list(userId, 'field-1');

      expect(options.double.find).toHaveBeenCalledWith(
        expect.objectContaining({ order: { orderIndex: 'ASC', id: 'ASC' } }),
      );
    });
  });

  describe('create', () => {
    it('adds an option at the end of the list', async () => {
      options.double.findOne.mockResolvedValue(null);

      await service.create(userId, 'field-1', {
        label: 'Fleet ship',
        isDefault: false,
      });

      expect(options.double.create).toHaveBeenCalledWith(
        expect.objectContaining({
          fieldId: 'field-1',
          label: 'Fleet ship',
          labelNormalized: 'fleet ship',
          orderIndex: 1000,
        }),
      );
    });

    // Read from the catalogue rather than a list here, so a type added with
    // options cannot be forgotten in this one place.
    it.each([
      CustomTrackingFieldType.TEXT_SINGLE_LINE,
      CustomTrackingFieldType.INTEGER,
      CustomTrackingFieldType.TOGGLE,
      CustomTrackingFieldType.COLOUR,
      CustomTrackingFieldType.IMAGE,
    ])('refuses an option on a %s field', async fieldType => {
      findOwnedField.mockResolvedValue(field(fieldType));

      await expect(
        service.create(userId, 'field-1', { label: 'Nope', isDefault: false }),
      ).rejects.toThrow(BadRequestException);
    });

    it.each([
      CustomTrackingFieldType.RADIO,
      CustomTrackingFieldType.DROPDOWN,
      CustomTrackingFieldType.CHECKBOX_LIST,
      CustomTrackingFieldType.MULTI_SELECT,
      CustomTrackingFieldType.TAGS,
    ])('allows an option on a %s field', async fieldType => {
      findOwnedField.mockResolvedValue(field(fieldType));
      options.double.findOne.mockResolvedValue(null);

      await expect(
        service.create(userId, 'field-1', { label: 'Yes', isDefault: false }),
      ).resolves.toBeDefined();
    });

    it('refuses a label a live sibling already has', async () => {
      options.double.findOne.mockResolvedValue(existing());

      await expect(
        service.create(userId, 'field-1', {
          label: 'fleet ship',
          isDefault: false,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('refuses an option once the Field is full', async () => {
      options.double.count.mockResolvedValue(
        CUSTOM_TRACKING_LIMITS.MAX_OPTIONS_PER_FIELD,
      );

      await expect(
        service.create(userId, 'field-1', {
          label: 'One too many',
          isDefault: false,
        }),
      ).rejects.toThrow(/most allowed/);
    });

    // A dropdown cannot open on two answers at once, so the most recent choice
    // wins rather than the second being refused.
    it('clears any other default on a single-answer field', async () => {
      options.double.findOne.mockResolvedValue(null);
      options.double.save.mockResolvedValue(existing({ isDefault: true }));

      await service.create(userId, 'field-1', {
        label: 'Fleet ship',
        isDefault: true,
      });

      expect(options.double.update).toHaveBeenCalledWith(
        { fieldId: 'field-1', id: Not('option-1'), isDefault: true },
        { isDefault: false },
      );
    });

    // A tick-box list may sensibly open with several answers chosen.
    it('leaves other defaults alone on a multiple-answer field', async () => {
      findOwnedField.mockResolvedValue(
        field(CustomTrackingFieldType.CHECKBOX_LIST),
      );
      options.double.findOne.mockResolvedValue(null);

      await service.create(userId, 'field-1', {
        label: 'Fleet ship',
        isDefault: true,
      });

      expect(options.double.update).not.toHaveBeenCalled();
    });

    it('does not disturb defaults when the new option is not one', async () => {
      options.double.findOne.mockResolvedValue(null);

      await service.create(userId, 'field-1', {
        label: 'Fleet ship',
        isDefault: false,
      });

      expect(options.double.update).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('changes only what it was given', async () => {
      const option = existing();

      options.double.findOne.mockResolvedValue(option);
      options.double.save.mockResolvedValue(option);

      await service.update(userId, 'option-1', { isDefault: true });

      expect(option.isDefault).toBe(true);
      expect(option.label).toBe('Fleet ship');
    });

    it('allows a rename that only changes capitalisation', async () => {
      const option = existing();

      options.double.findOne.mockResolvedValue(option);
      options.double.save.mockResolvedValue(option);

      await service.update(userId, 'option-1', { label: 'FLEET SHIP' });

      expect(option.label).toBe('FLEET SHIP');
      expect(option.labelNormalized).toBe('fleet ship');
    });

    it('refuses a rename onto a label a sibling has', async () => {
      options.double.findOne
        .mockResolvedValueOnce(existing())
        .mockResolvedValueOnce(existing({ id: 'option-2' }));

      await expect(
        service.update(userId, 'option-1', { label: 'Event ship' }),
      ).rejects.toThrow(ConflictException);
    });

    it('clears any other default when one is newly marked', async () => {
      const option = existing();

      options.double.findOne.mockResolvedValue(option);
      options.double.save.mockResolvedValue(option);

      await service.update(userId, 'option-1', { isDefault: true });

      expect(options.double.update).toHaveBeenCalledWith(
        { fieldId: 'field-1', id: Not('option-1'), isDefault: true },
        { isDefault: false },
      );
    });

    it('does not disturb defaults when one is unmarked', async () => {
      const option = existing({ isDefault: true });

      options.double.findOne.mockResolvedValue(option);
      options.double.save.mockResolvedValue(option);

      await service.update(userId, 'option-1', { isDefault: false });

      expect(option.isDefault).toBe(false);
      expect(options.double.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    // Soft, always. A value that already chose it keeps displaying the wording
    // it had; what changes is that nobody can choose it again.
    it('withdraws the option rather than deleting the row', async () => {
      options.double.findOne.mockResolvedValue(existing());

      await service.remove(userId, 'option-1');

      expect(options.double.update).toHaveBeenCalledWith(
        { id: 'option-1' },
        { deletedAt: expect.any(Date) },
      );
    });

    it('refuses to withdraw an option that is not the caller’s', async () => {
      options.double.findOne.mockResolvedValue(null);

      await expect(service.remove(userId, 'option-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(options.double.update).not.toHaveBeenCalled();
    });
  });

  describe('reorder', () => {
    it('renumbers the Field’s options', async () => {
      managerDouble.double.find.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);

      await service.reorder(userId, 'field-1', ['b', 'a']);

      expect(managerDouble.double.update).toHaveBeenCalledTimes(2);
    });
  });
});
