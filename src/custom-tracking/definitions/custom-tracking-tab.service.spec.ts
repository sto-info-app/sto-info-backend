import { ConflictException, NotFoundException } from '@nestjs/common';

import { jest } from '@jest/globals';
import { DataSource } from 'typeorm';

import { CUSTOM_TRACKING_LIMITS } from '../constants/custom-tracking-limits.constants';
import { CustomTrackingSectionEntity } from '../entities/custom-tracking-section.entity';
import { CustomTrackingTabEntity } from '../entities/custom-tracking-tab.entity';
import { CustomTrackingTargetScope } from '../enums/custom-tracking-target-scope.enum';
import {
  createDataSourceDouble,
  createEntityManagerDouble,
  createRepositoryDouble,
  createSupportService,
} from '../testing/custom-tracking-test.doubles';
import { CustomTrackingCascadeService } from './custom-tracking-cascade.service';
import { CustomTrackingSectionService } from './custom-tracking-section.service';
import { CustomTrackingTabService } from './custom-tracking-tab.service';

describe('CustomTrackingTabService', () => {
  const userId = 'user-1';

  let service: CustomTrackingTabService;
  let tabs: ReturnType<typeof createRepositoryDouble<CustomTrackingTabEntity>>;
  let findOwnedSection: jest.Mock<
    (userId: string, sectionId: string) => Promise<CustomTrackingSectionEntity>
  >;
  let deleteTabs: jest.Mock<() => Promise<void>>;
  let describeTabDeletion: jest.Mock<
    () => Promise<{ tabs: number; fields: number }>
  >;
  let managerDouble: ReturnType<typeof createEntityManagerDouble>;

  const section = (): CustomTrackingSectionEntity =>
    ({
      id: 'section-1',
      userId,
      targetScope: CustomTrackingTargetScope.CHARACTER,
    }) as CustomTrackingSectionEntity;

  beforeEach(() => {
    tabs = createRepositoryDouble<CustomTrackingTabEntity>();
    findOwnedSection = jest
      .fn<
        (
          userId: string,
          sectionId: string,
        ) => Promise<CustomTrackingSectionEntity>
      >()
      .mockResolvedValue(section());
    deleteTabs = jest.fn<() => Promise<void>>().mockResolvedValue();
    describeTabDeletion = jest
      .fn<() => Promise<{ tabs: number; fields: number }>>()
      .mockResolvedValue({ tabs: 0, fields: 0 });
    managerDouble = createEntityManagerDouble();

    service = new CustomTrackingTabService(
      tabs.repository,
      {
        findOwned: findOwnedSection,
      } as unknown as CustomTrackingSectionService,
      createSupportService().support,
      {
        deleteTabs,
        describeTabDeletion,
      } as unknown as CustomTrackingCascadeService,
      createDataSourceDouble(managerDouble.manager) as unknown as DataSource,
    );
  });

  const existing = (
    overrides: Partial<CustomTrackingTabEntity> = {},
  ): CustomTrackingTabEntity =>
    ({
      id: 'tab-1',
      sectionId: 'section-1',
      name: 'Escorts',
      nameNormalized: 'escorts',
      description: null,
      orderIndex: 1000,
      publiclyVisible: false,
      deletedAt: null,
      ...overrides,
    }) as CustomTrackingTabEntity;

  describe('findOwned', () => {
    // A Tab carries no owner of its own, so a Tab found by identifier alone
    // says nothing about who may see it.
    it('establishes ownership through the owning Section', async () => {
      tabs.double.findOne.mockResolvedValue(existing());

      await service.findOwned(userId, 'tab-1');

      expect(findOwnedSection).toHaveBeenCalledWith(userId, 'section-1');
    });

    it('refuses a Tab whose Section is not the caller’s', async () => {
      tabs.double.findOne.mockResolvedValue(existing());
      findOwnedSection.mockRejectedValue(new NotFoundException());

      await expect(service.findOwned(userId, 'tab-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuses a Tab that does not exist', async () => {
      tabs.double.findOne.mockResolvedValue(null);

      await expect(service.findOwned(userId, 'tab-1')).rejects.toThrow(
        'That tab could not be found.',
      );
      expect(findOwnedSection).not.toHaveBeenCalled();
    });
  });

  describe('sectionOf', () => {
    it('returns the owning Section, checked as the caller', async () => {
      await expect(
        service.sectionOf(userId, existing()),
      ).resolves.toMatchObject({ id: 'section-1' });
      expect(findOwnedSection).toHaveBeenCalledWith(userId, 'section-1');
    });
  });

  describe('list', () => {
    it('lists a Section’s Tabs in order', async () => {
      await service.list(userId, 'section-1');

      expect(findOwnedSection).toHaveBeenCalledWith(userId, 'section-1');
      expect(tabs.double.find).toHaveBeenCalledWith(
        expect.objectContaining({ order: { orderIndex: 'ASC', id: 'ASC' } }),
      );
    });
  });

  describe('create', () => {
    it('creates a Tab at the end of the Section', async () => {
      tabs.double.findOne.mockResolvedValue(null);

      await service.create(userId, 'section-1', {
        name: 'Escorts',
        description: null,
        publiclyVisible: false,
      });

      expect(tabs.double.create).toHaveBeenCalledWith(
        expect.objectContaining({
          sectionId: 'section-1',
          name: 'Escorts',
          nameNormalized: 'escorts',
          orderIndex: 1000,
        }),
      );
    });

    it('refuses a name a live sibling already has', async () => {
      tabs.double.findOne.mockResolvedValue(existing());

      await expect(
        service.create(userId, 'section-1', {
          name: 'escorts',
          description: null,
          publiclyVisible: false,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('refuses a Tab once the Section is full', async () => {
      tabs.double.count.mockResolvedValue(
        CUSTOM_TRACKING_LIMITS.MAX_TABS_PER_SECTION,
      );

      await expect(
        service.create(userId, 'section-1', {
          name: 'One too many',
          description: null,
          publiclyVisible: false,
        }),
      ).rejects.toThrow(/most allowed/);
    });
  });

  describe('update', () => {
    it('changes only what it was given', async () => {
      const tab = existing({ description: 'Unchanged' });

      tabs.double.findOne.mockResolvedValue(tab);

      await service.update(userId, 'tab-1', { publiclyVisible: true });

      expect(tab.publiclyVisible).toBe(true);
      expect(tab.name).toBe('Escorts');
      expect(tab.description).toBe('Unchanged');
    });

    it('clears a description when asked to', async () => {
      const tab = existing({ description: 'Something' });

      tabs.double.findOne.mockResolvedValue(tab);

      await service.update(userId, 'tab-1', { description: null });

      expect(tab.description).toBeNull();
    });

    it('allows a rename that only changes capitalisation', async () => {
      const tab = existing();

      tabs.double.findOne.mockResolvedValue(tab);

      await service.update(userId, 'tab-1', { name: 'ESCORTS' });

      expect(tab.name).toBe('ESCORTS');
      expect(tab.nameNormalized).toBe('escorts');
    });

    it('refuses a rename onto a name a sibling has', async () => {
      tabs.double.findOne
        .mockResolvedValueOnce(existing())
        .mockResolvedValueOnce(existing({ id: 'tab-2' }));

      await expect(
        service.update(userId, 'tab-1', { name: 'Cruisers' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('remove', () => {
    it('cascades the deletion inside a transaction', async () => {
      tabs.double.findOne.mockResolvedValue(existing());

      await service.remove(userId, 'tab-1');

      expect(deleteTabs).toHaveBeenCalledWith(
        expect.anything(),
        ['tab-1'],
        expect.any(Date),
      );
    });
  });

  describe('describeDeletion', () => {
    it('reports what would go with it', async () => {
      tabs.double.findOne.mockResolvedValue(existing());
      describeTabDeletion.mockResolvedValue({ tabs: 0, fields: 7 });

      await expect(service.describeDeletion(userId, 'tab-1')).resolves.toEqual({
        tabs: 0,
        fields: 7,
      });
    });
  });

  describe('reorder', () => {
    it('renumbers the Section’s Tabs', async () => {
      managerDouble.double.find.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);

      await service.reorder(userId, 'section-1', ['b', 'a']);

      expect(findOwnedSection).toHaveBeenCalledWith(userId, 'section-1');
      expect(managerDouble.double.update).toHaveBeenCalledTimes(2);
    });
  });
});
