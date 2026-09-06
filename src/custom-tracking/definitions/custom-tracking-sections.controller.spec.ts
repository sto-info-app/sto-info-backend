import { jest } from '@jest/globals';

import { CustomTrackingSectionEntity } from '../entities/custom-tracking-section.entity';
import { CustomTrackingTargetScope } from '../enums/custom-tracking-target-scope.enum';
import {
  CustomTrackingDefinitionTreeService,
  CustomTrackingSectionNode,
} from './custom-tracking-definition-tree.service';
import { CustomTrackingDefinitionMapper } from './custom-tracking-definition.mapper';
import { CustomTrackingSectionService } from './custom-tracking-section.service';
import { CustomTrackingSectionsController } from './custom-tracking-sections.controller';

describe('CustomTrackingSectionsController', () => {
  const userId = 'user-1';
  const scope = CustomTrackingTargetScope.ACCOUNT;

  const section = (
    overrides: Partial<CustomTrackingSectionEntity> = {},
  ): CustomTrackingSectionEntity =>
    ({
      id: 'section-1',
      targetScope: scope,
      name: 'Ship collection',
      description: null,
      orderIndex: 1000,
      publiclyVisible: false,
      suppressedAt: null,
      ...overrides,
    }) as CustomTrackingSectionEntity;

  let controller: CustomTrackingSectionsController;
  let sections: {
    list: jest.Mock<() => Promise<CustomTrackingSectionEntity[]>>;
    create: jest.Mock<() => Promise<CustomTrackingSectionEntity>>;
    update: jest.Mock<() => Promise<CustomTrackingSectionEntity>>;
    remove: jest.Mock<() => Promise<void>>;
    describeDeletion: jest.Mock<
      () => Promise<{ tabs: number; fields: number }>
    >;
    reorder: jest.Mock<() => Promise<void>>;
  };
  let load: jest.Mock<() => Promise<CustomTrackingSectionNode[]>>;

  beforeEach(() => {
    sections = {
      list: jest
        .fn<() => Promise<CustomTrackingSectionEntity[]>>()
        .mockResolvedValue([section()]),
      create: jest
        .fn<() => Promise<CustomTrackingSectionEntity>>()
        .mockResolvedValue(section()),
      update: jest
        .fn<() => Promise<CustomTrackingSectionEntity>>()
        .mockResolvedValue(section({ name: 'Renamed' })),
      remove: jest.fn<() => Promise<void>>().mockResolvedValue(),
      describeDeletion: jest
        .fn<() => Promise<{ tabs: number; fields: number }>>()
        .mockResolvedValue({ tabs: 4, fields: 19 }),
      reorder: jest.fn<() => Promise<void>>().mockResolvedValue(),
    };

    load = jest
      .fn<() => Promise<CustomTrackingSectionNode[]>>()
      .mockResolvedValue([
        {
          section: section(),
          tabs: [
            {
              tab: { id: 'tab-1', sectionId: 'section-1', suppressedAt: null },
              fields: [
                {
                  field: { id: 'field-1', tabId: 'tab-1', suppressedAt: null },
                  options: [],
                },
              ],
            },
          ],
        },
      ] as unknown as CustomTrackingSectionNode[]);

    controller = new CustomTrackingSectionsController(
      sections as unknown as CustomTrackingSectionService,
      { load } as unknown as CustomTrackingDefinitionTreeService,
      new CustomTrackingDefinitionMapper(),
    );
  });

  it('lists the caller’s sections for the scope in the path', async () => {
    await expect(controller.list(userId, scope)).resolves.toEqual([
      expect.objectContaining({ id: 'section-1', targetScope: scope }),
    ]);
    expect(sections.list).toHaveBeenCalledWith(userId, scope);
  });

  // The builder searches across the whole hierarchy, so it has to be able to
  // read all of it rather than only the branches somebody has opened.
  it('reads a whole scope in one request, nested', async () => {
    const tree = await controller.tree(userId, scope);

    expect(load).toHaveBeenCalledWith(userId, scope);
    expect(tree).toEqual([
      expect.objectContaining({
        id: 'section-1',
        tabs: [
          expect.objectContaining({
            id: 'tab-1',
            fields: [expect.objectContaining({ id: 'field-1' })],
          }),
        ],
      }),
    ]);
  });

  // The scope comes from the path because it is fixed for the life of a
  // Section; accepting it in the body would suggest it were editable.
  it('creates a section in the scope named by the path', async () => {
    await controller.create(userId, scope, {
      name: 'Ship collection',
      description: null,
      publiclyVisible: false,
    });

    expect(sections.create).toHaveBeenCalledWith(userId, scope, {
      name: 'Ship collection',
      description: null,
      publiclyVisible: false,
    });
  });

  it('returns the mapped section rather than the stored row', async () => {
    const created = await controller.create(userId, scope, {
      name: 'Ship collection',
      description: null,
      publiclyVisible: false,
    });

    expect(created).not.toHaveProperty('suppressedAt');
    expect(created).toHaveProperty('suppressed', false);
  });

  it('passes a change through and maps the result', async () => {
    await expect(
      controller.update(userId, 'section-1', { name: 'Renamed' }),
    ).resolves.toMatchObject({ name: 'Renamed' });
    expect(sections.update).toHaveBeenCalledWith(userId, 'section-1', {
      name: 'Renamed',
    });
  });

  it('reports what a deletion would remove', async () => {
    await expect(
      controller.describeDeletion(userId, 'section-1'),
    ).resolves.toEqual({ tabs: 4, fields: 19 });
  });

  it('deletes a section', async () => {
    await expect(
      controller.remove(userId, 'section-1'),
    ).resolves.toBeUndefined();
    expect(sections.remove).toHaveBeenCalledWith(userId, 'section-1');
  });

  it('hands the whole requested order to the service', async () => {
    await controller.reorder(userId, scope, { orderedIds: ['b', 'a'] });

    expect(sections.reorder).toHaveBeenCalledWith(userId, scope, ['b', 'a']);
  });
});
