import { jest } from '@jest/globals';

import { CustomTrackingOptionEntity } from '../entities/custom-tracking-option.entity';
import { CustomTrackingDefinitionMapper } from './custom-tracking-definition.mapper';
import { CustomTrackingOptionService } from './custom-tracking-option.service';
import { CustomTrackingOptionsController } from './custom-tracking-options.controller';

describe('CustomTrackingOptionsController', () => {
  const userId = 'user-1';

  const option = (
    overrides: Partial<CustomTrackingOptionEntity> = {},
  ): CustomTrackingOptionEntity =>
    ({
      id: 'option-1',
      fieldId: 'field-1',
      label: 'Escort',
      orderIndex: 1000,
      isDefault: false,
      deletedAt: null,
      ...overrides,
    }) as CustomTrackingOptionEntity;

  let controller: CustomTrackingOptionsController;
  let options: {
    list: jest.Mock<() => Promise<CustomTrackingOptionEntity[]>>;
    create: jest.Mock<() => Promise<CustomTrackingOptionEntity>>;
    update: jest.Mock<() => Promise<CustomTrackingOptionEntity>>;
    remove: jest.Mock<() => Promise<void>>;
    reorder: jest.Mock<() => Promise<void>>;
  };

  beforeEach(() => {
    options = {
      list: jest
        .fn<() => Promise<CustomTrackingOptionEntity[]>>()
        .mockResolvedValue([
          option(),
          option({ id: 'option-2', deletedAt: new Date() }),
        ]),
      create: jest
        .fn<() => Promise<CustomTrackingOptionEntity>>()
        .mockResolvedValue(option()),
      update: jest
        .fn<() => Promise<CustomTrackingOptionEntity>>()
        .mockResolvedValue(option({ isDefault: true })),
      remove: jest.fn<() => Promise<void>>().mockResolvedValue(),
      reorder: jest.fn<() => Promise<void>>().mockResolvedValue(),
    };

    controller = new CustomTrackingOptionsController(
      options as unknown as CustomTrackingOptionService,
      new CustomTrackingDefinitionMapper(),
    );
  });

  // A withdrawn option still appears, because a value that already chose it
  // has to go on reading correctly and its editor has to say what it was.
  it('lists withdrawn options alongside live ones, marked as withdrawn', async () => {
    const listed = await controller.list(userId, 'field-1');

    expect(listed).toEqual([
      expect.objectContaining({ id: 'option-1', withdrawn: false }),
      expect.objectContaining({ id: 'option-2', withdrawn: true }),
    ]);
  });

  it('adds an option to the field named by the path', async () => {
    await controller.create(userId, 'field-1', {
      label: 'Escort',
      isDefault: false,
    });

    expect(options.create).toHaveBeenCalledWith(userId, 'field-1', {
      label: 'Escort',
      isDefault: false,
    });
  });

  // The deletion timestamp is what the retention job counts from; the
  // interface is told only whether the option is withdrawn.
  it('returns the mapped option rather than the stored row', async () => {
    const created = await controller.create(userId, 'field-1', {
      label: 'Escort',
      isDefault: false,
    });

    expect(created).not.toHaveProperty('deletedAt');
    expect(created).toHaveProperty('withdrawn', false);
  });

  it('passes a change through and maps the result', async () => {
    await expect(
      controller.update(userId, 'option-1', { isDefault: true }),
    ).resolves.toMatchObject({ isDefault: true });
    expect(options.update).toHaveBeenCalledWith(userId, 'option-1', {
      isDefault: true,
    });
  });

  it('withdraws an option', async () => {
    await expect(
      controller.remove(userId, 'option-1'),
    ).resolves.toBeUndefined();
    expect(options.remove).toHaveBeenCalledWith(userId, 'option-1');
  });

  it('hands the whole requested order to the service', async () => {
    await controller.reorder(userId, 'field-1', { orderedIds: ['b', 'a'] });

    expect(options.reorder).toHaveBeenCalledWith(userId, 'field-1', ['b', 'a']);
  });
});
