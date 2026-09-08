import { In, IsNull } from 'typeorm';

import { CustomTrackingFieldEntity } from '../entities/custom-tracking-field.entity';
import { CustomTrackingOptionEntity } from '../entities/custom-tracking-option.entity';
import { CustomTrackingSectionEntity } from '../entities/custom-tracking-section.entity';
import { CustomTrackingTabEntity } from '../entities/custom-tracking-tab.entity';
import { CustomTrackingTargetScope } from '../enums/custom-tracking-target-scope.enum';
import { createRepositoryDouble } from '../testing/custom-tracking-test.doubles';
import { CustomTrackingDefinitionTreeService } from './custom-tracking-definition-tree.service';

describe('CustomTrackingDefinitionTreeService', () => {
  const userId = 'user-1';
  const scope = CustomTrackingTargetScope.ACCOUNT;

  let service: CustomTrackingDefinitionTreeService;
  let sections: ReturnType<
    typeof createRepositoryDouble<CustomTrackingSectionEntity>
  >;
  let tabs: ReturnType<typeof createRepositoryDouble<CustomTrackingTabEntity>>;
  let fields: ReturnType<
    typeof createRepositoryDouble<CustomTrackingFieldEntity>
  >;
  let options: ReturnType<
    typeof createRepositoryDouble<CustomTrackingOptionEntity>
  >;

  beforeEach(() => {
    sections = createRepositoryDouble<CustomTrackingSectionEntity>();
    tabs = createRepositoryDouble<CustomTrackingTabEntity>();
    fields = createRepositoryDouble<CustomTrackingFieldEntity>();
    options = createRepositoryDouble<CustomTrackingOptionEntity>();

    service = new CustomTrackingDefinitionTreeService(
      sections.repository,
      tabs.repository,
      fields.repository,
      options.repository,
    );
  });

  const section = (id: string): CustomTrackingSectionEntity =>
    ({ id }) as CustomTrackingSectionEntity;
  const tab = (id: string, sectionId: string): CustomTrackingTabEntity =>
    ({ id, sectionId }) as CustomTrackingTabEntity;
  const field = (id: string, tabId: string): CustomTrackingFieldEntity =>
    ({ id, tabId }) as unknown as CustomTrackingFieldEntity;
  const option = (id: string, fieldId: string): CustomTrackingOptionEntity =>
    ({ id, fieldId }) as CustomTrackingOptionEntity;

  it('returns nothing for a scope with no sections', async () => {
    await expect(service.load(userId, scope)).resolves.toEqual([]);

    expect(tabs.double.find).not.toHaveBeenCalled();
  });

  it('assembles the four levels into one tree', async () => {
    sections.double.find.mockResolvedValue([section('s1'), section('s2')]);
    tabs.double.find.mockResolvedValue([
      tab('t1', 's1'),
      tab('t2', 's1'),
      tab('t3', 's2'),
    ]);
    fields.double.find.mockResolvedValue([
      field('f1', 't1'),
      field('f2', 't1'),
      field('f3', 't3'),
    ]);
    options.double.find.mockResolvedValue([
      option('o1', 'f1'),
      option('o2', 'f1'),
    ]);

    const tree = await service.load(userId, scope);

    expect(tree).toHaveLength(2);
    expect(tree[0].tabs.map(node => node.tab.id)).toEqual(['t1', 't2']);
    expect(tree[0].tabs[0].fields.map(node => node.field.id)).toEqual([
      'f1',
      'f2',
    ]);
    expect(tree[0].tabs[0].fields[0].options.map(o => o.id)).toEqual([
      'o1',
      'o2',
    ]);
    expect(tree[0].tabs[1].fields).toEqual([]);
    expect(tree[1].tabs[0].fields.map(node => node.field.id)).toEqual(['f3']);
  });

  it('gives a field with no options an empty list', async () => {
    sections.double.find.mockResolvedValue([section('s1')]);
    tabs.double.find.mockResolvedValue([tab('t1', 's1')]);
    fields.double.find.mockResolvedValue([field('f1', 't1')]);
    options.double.find.mockResolvedValue([]);

    const tree = await service.load(userId, scope);

    expect(tree[0].tabs[0].fields[0].options).toEqual([]);
  });

  // Four queries, not four hundred. At the permitted ceilings that is a
  // trivial amount of data and an intolerable number of round trips.
  it('reads each level once', async () => {
    sections.double.find.mockResolvedValue([section('s1')]);
    tabs.double.find.mockResolvedValue([tab('t1', 's1')]);
    fields.double.find.mockResolvedValue([field('f1', 't1')]);

    await service.load(userId, scope);

    expect(sections.double.find).toHaveBeenCalledTimes(1);
    expect(tabs.double.find).toHaveBeenCalledTimes(1);
    expect(fields.double.find).toHaveBeenCalledTimes(1);
    expect(options.double.find).toHaveBeenCalledTimes(1);
  });

  it('skips the levels below an empty one', async () => {
    sections.double.find.mockResolvedValue([section('s1')]);
    tabs.double.find.mockResolvedValue([]);

    await service.load(userId, scope);

    expect(fields.double.find).not.toHaveBeenCalled();
    expect(options.double.find).not.toHaveBeenCalled();
  });

  it('skips options when there are no fields', async () => {
    sections.double.find.mockResolvedValue([section('s1')]);
    tabs.double.find.mockResolvedValue([tab('t1', 's1')]);
    fields.double.find.mockResolvedValue([]);

    await service.load(userId, scope);

    expect(options.double.find).not.toHaveBeenCalled();
  });

  it('reads only the caller’s definitions for the scope asked for', async () => {
    await service.load(userId, scope);

    expect(sections.double.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId, targetScope: scope, deletedAt: IsNull() },
      }),
    );
  });

  it('leaves deleted definitions out of every level', async () => {
    sections.double.find.mockResolvedValue([section('s1')]);
    tabs.double.find.mockResolvedValue([tab('t1', 's1')]);
    fields.double.find.mockResolvedValue([field('f1', 't1')]);

    await service.load(userId, scope);

    expect(tabs.double.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sectionId: In(['s1']), deletedAt: IsNull() },
      }),
    );
    expect(fields.double.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tabId: In(['t1']), deletedAt: IsNull() },
      }),
    );
  });

  // A value that already chose a withdrawn option has to go on reading
  // correctly, and the editor offering to replace it has to name what it was.
  it('loads withdrawn options alongside live ones', async () => {
    sections.double.find.mockResolvedValue([section('s1')]);
    tabs.double.find.mockResolvedValue([tab('t1', 's1')]);
    fields.double.find.mockResolvedValue([field('f1', 't1')]);

    await service.load(userId, scope);

    expect(options.double.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { fieldId: In(['f1']) },
        withDeleted: true,
      }),
    );
  });

  // Without the secondary sort, two rows sharing a position could swap places
  // between requests, which reads as a page reordering itself.
  it.each([
    ['sections', () => sections.double.find],
    ['tabs', () => tabs.double.find],
    ['fields', () => fields.double.find],
    ['options', () => options.double.find],
  ])('orders %s by position and then identifier', async (_name, finder) => {
    sections.double.find.mockResolvedValue([section('s1')]);
    tabs.double.find.mockResolvedValue([tab('t1', 's1')]);
    fields.double.find.mockResolvedValue([field('f1', 't1')]);

    await service.load(userId, scope);

    expect(finder()).toHaveBeenCalledWith(
      expect.objectContaining({ order: { orderIndex: 'ASC', id: 'ASC' } }),
    );
  });
});
