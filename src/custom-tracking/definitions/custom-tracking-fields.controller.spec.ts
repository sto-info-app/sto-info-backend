import { jest } from '@jest/globals';

import { CustomTrackingFieldEntity } from '../entities/custom-tracking-field.entity';
import { CustomTrackingOptionEntity } from '../entities/custom-tracking-option.entity';
import { CustomTrackingEmptyMode } from '../enums/custom-tracking-empty-mode.enum';
import { CustomTrackingFieldType } from '../enums/custom-tracking-field-type.enum';
import { CustomTrackingTargetScope } from '../enums/custom-tracking-target-scope.enum';
import { CustomTrackingDefinitionMapper } from './custom-tracking-definition.mapper';
import { CustomTrackingFieldService } from './custom-tracking-field.service';
import { CustomTrackingFieldsController } from './custom-tracking-fields.controller';
import { CustomTrackingOptionService } from './custom-tracking-option.service';

describe('CustomTrackingFieldsController', () => {
  const userId = 'user-1';

  const field = (
    overrides: Partial<CustomTrackingFieldEntity> = {},
  ): CustomTrackingFieldEntity =>
    ({
      id: 'field-1',
      tabId: 'tab-1',
      userId,
      targetScope: CustomTrackingTargetScope.ACCOUNT,
      fieldType: CustomTrackingFieldType.DROPDOWN,
      name: 'Ship class',
      description: null,
      orderIndex: 1000,
      publiclyVisible: false,
      required: false,
      ownerEmptyMode: CustomTrackingEmptyMode.SHOW_LABEL,
      publicEmptyMode: CustomTrackingEmptyMode.HIDE,
      emptyPlaceholder: null,
      configuration: {},
      suppressedAt: null,
      ...overrides,
    }) as unknown as CustomTrackingFieldEntity;

  const option = (id: string, label: string): CustomTrackingOptionEntity =>
    ({
      id,
      fieldId: 'field-1',
      label,
      orderIndex: 1000,
      isDefault: false,
      deletedAt: null,
    }) as CustomTrackingOptionEntity;

  let controller: CustomTrackingFieldsController;
  let fields: {
    list: jest.Mock<() => Promise<CustomTrackingFieldEntity[]>>;
    create: jest.Mock<() => Promise<CustomTrackingFieldEntity>>;
    update: jest.Mock<() => Promise<CustomTrackingFieldEntity>>;
    remove: jest.Mock<() => Promise<void>>;
    reorder: jest.Mock<() => Promise<void>>;
    describeDeletion: jest.Mock<
      () => Promise<{ tabs: number; fields: number; values: number }>
    >;
  };
  let listOptions: jest.Mock<() => Promise<CustomTrackingOptionEntity[]>>;

  const body = {
    fieldType: CustomTrackingFieldType.DROPDOWN,
    name: 'Ship class',
    description: null,
    publiclyVisible: false,
    required: false,
    ownerEmptyMode: CustomTrackingEmptyMode.SHOW_LABEL,
    publicEmptyMode: CustomTrackingEmptyMode.HIDE,
    emptyPlaceholder: null,
    configuration: {},
  };

  beforeEach(() => {
    fields = {
      list: jest
        .fn<() => Promise<CustomTrackingFieldEntity[]>>()
        .mockResolvedValue([field()]),
      create: jest
        .fn<() => Promise<CustomTrackingFieldEntity>>()
        .mockResolvedValue(field()),
      update: jest
        .fn<() => Promise<CustomTrackingFieldEntity>>()
        .mockResolvedValue(field({ required: true })),
      remove: jest.fn<() => Promise<void>>().mockResolvedValue(),
      reorder: jest.fn<() => Promise<void>>().mockResolvedValue(),
      describeDeletion: jest
        .fn<() => Promise<{ tabs: number; fields: number; values: number }>>()
        .mockResolvedValue({ tabs: 0, fields: 0, values: 19 }),
    };
    listOptions = jest
      .fn<() => Promise<CustomTrackingOptionEntity[]>>()
      .mockResolvedValue([option('option-1', 'Escort')]);

    controller = new CustomTrackingFieldsController(
      fields as unknown as CustomTrackingFieldService,
      { list: listOptions } as unknown as CustomTrackingOptionService,
      new CustomTrackingDefinitionMapper(),
    );
  });

  // A choice Field is unusable without knowing what it offers, so the options
  // travel with it rather than needing a second request per field.
  it('lists each field with the options it offers', async () => {
    const listed = await controller.list(userId, 'tab-1');

    expect(listed[0].options).toEqual([
      expect.objectContaining({ id: 'option-1', label: 'Escort' }),
    ]);
    expect(listOptions).toHaveBeenCalledWith(userId, 'field-1');
  });

  it('creates a field in the tab named by the path', async () => {
    await controller.create(userId, 'tab-1', body);

    expect(fields.create).toHaveBeenCalledWith(userId, 'tab-1', body);
  });

  // A newly created Field has no options yet, so none are fetched for it.
  it('returns a new field without asking for options it cannot have', async () => {
    const created = await controller.create(userId, 'tab-1', body);

    expect(created.options).toEqual([]);
    expect(listOptions).not.toHaveBeenCalled();
  });

  it('returns the mapped field rather than the stored row', async () => {
    const created = await controller.create(userId, 'tab-1', body);

    expect(created).not.toHaveProperty('userId');
    expect(created).not.toHaveProperty('suppressedAt');
    expect(created).toHaveProperty('suppressed', false);
  });

  it('passes a change through and returns the field with its options', async () => {
    const updated = await controller.update(userId, 'field-1', {
      required: true,
    });

    expect(updated).toMatchObject({ required: true });
    expect(updated.options).toHaveLength(1);
    expect(fields.update).toHaveBeenCalledWith(userId, 'field-1', {
      required: true,
    });
  });

  it('deletes a field', async () => {
    await expect(controller.remove(userId, 'field-1')).resolves.toBeUndefined();
    expect(fields.remove).toHaveBeenCalledWith(userId, 'field-1');
  });

  it('hands the whole requested order to the service', async () => {
    await controller.reorder(userId, 'tab-1', { orderedIds: ['b', 'a'] });

    expect(fields.reorder).toHaveBeenCalledWith(userId, 'tab-1', ['b', 'a']);
  });

  // "Delete this field" and "delete this field and the nineteen answers
  // recorded against it" are different decisions, and only one of them is the
  // one being made.
  it('reports how many answers a deletion would remove', async () => {
    await expect(
      controller.describeDeletion('user-1', 'field-1'),
    ).resolves.toEqual({ tabs: 0, fields: 0, values: 19 });
    expect(fields.describeDeletion).toHaveBeenCalledWith('user-1', 'field-1');
  });
});
