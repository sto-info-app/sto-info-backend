import { jest } from '@jest/globals';

import { CustomTrackingTabEntity } from '../entities/custom-tracking-tab.entity';
import { CustomTrackingDefinitionMapper } from './custom-tracking-definition.mapper';
import { CustomTrackingTabService } from './custom-tracking-tab.service';
import { CustomTrackingTabsController } from './custom-tracking-tabs.controller';

describe('CustomTrackingTabsController', () => {
  const userId = 'user-1';

  const tab = (
    overrides: Partial<CustomTrackingTabEntity> = {},
  ): CustomTrackingTabEntity =>
    ({
      id: 'tab-1',
      sectionId: 'section-1',
      name: 'Escorts',
      description: null,
      orderIndex: 1000,
      publiclyVisible: false,
      suppressedAt: null,
      ...overrides,
    }) as CustomTrackingTabEntity;

  let controller: CustomTrackingTabsController;
  let tabs: {
    list: jest.Mock<() => Promise<CustomTrackingTabEntity[]>>;
    create: jest.Mock<() => Promise<CustomTrackingTabEntity>>;
    update: jest.Mock<() => Promise<CustomTrackingTabEntity>>;
    remove: jest.Mock<() => Promise<void>>;
    describeDeletion: jest.Mock<
      () => Promise<{ tabs: number; fields: number }>
    >;
    reorder: jest.Mock<() => Promise<void>>;
  };

  beforeEach(() => {
    tabs = {
      list: jest
        .fn<() => Promise<CustomTrackingTabEntity[]>>()
        .mockResolvedValue([tab()]),
      create: jest
        .fn<() => Promise<CustomTrackingTabEntity>>()
        .mockResolvedValue(tab()),
      update: jest
        .fn<() => Promise<CustomTrackingTabEntity>>()
        .mockResolvedValue(tab({ publiclyVisible: true })),
      remove: jest.fn<() => Promise<void>>().mockResolvedValue(),
      describeDeletion: jest
        .fn<() => Promise<{ tabs: number; fields: number }>>()
        .mockResolvedValue({ tabs: 0, fields: 7 }),
      reorder: jest.fn<() => Promise<void>>().mockResolvedValue(),
    };

    controller = new CustomTrackingTabsController(
      tabs as unknown as CustomTrackingTabService,
      new CustomTrackingDefinitionMapper(),
    );
  });

  it('lists the tabs of the section named by the path', async () => {
    await expect(controller.list(userId, 'section-1')).resolves.toEqual([
      expect.objectContaining({ id: 'tab-1', sectionId: 'section-1' }),
    ]);
    expect(tabs.list).toHaveBeenCalledWith(userId, 'section-1');
  });

  // A Tab cannot move between Sections, so its parent belongs to the route
  // rather than to what the body may say about it.
  it('creates a tab inside the section named by the path', async () => {
    await controller.create(userId, 'section-1', {
      name: 'Escorts',
      description: null,
      publiclyVisible: false,
    });

    expect(tabs.create).toHaveBeenCalledWith(userId, 'section-1', {
      name: 'Escorts',
      description: null,
      publiclyVisible: false,
    });
  });

  it('returns the mapped tab rather than the stored row', async () => {
    const created = await controller.create(userId, 'section-1', {
      name: 'Escorts',
      description: null,
      publiclyVisible: false,
    });

    expect(created).not.toHaveProperty('suppressedAt');
    expect(created).toHaveProperty('suppressed', false);
  });

  it('passes a change through and maps the result', async () => {
    await expect(
      controller.update(userId, 'tab-1', { publiclyVisible: true }),
    ).resolves.toMatchObject({ publiclyVisible: true });
    expect(tabs.update).toHaveBeenCalledWith(userId, 'tab-1', {
      publiclyVisible: true,
    });
  });

  it('reports what a deletion would remove', async () => {
    await expect(controller.describeDeletion(userId, 'tab-1')).resolves.toEqual(
      {
        tabs: 0,
        fields: 7,
      },
    );
  });

  it('deletes a tab', async () => {
    await expect(controller.remove(userId, 'tab-1')).resolves.toBeUndefined();
    expect(tabs.remove).toHaveBeenCalledWith(userId, 'tab-1');
  });

  it('hands the whole requested order to the service', async () => {
    await controller.reorder(userId, 'section-1', { orderedIds: ['b', 'a'] });

    expect(tabs.reorder).toHaveBeenCalledWith(userId, 'section-1', ['b', 'a']);
  });
});
