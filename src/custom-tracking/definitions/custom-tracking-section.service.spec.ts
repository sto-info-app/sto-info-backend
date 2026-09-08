import { ConflictException, NotFoundException } from '@nestjs/common';

import { jest } from '@jest/globals';
import { DataSource } from 'typeorm';

import { CUSTOM_TRACKING_LIMITS } from '../constants/custom-tracking-limits.constants';
import { CustomTrackingSectionEntity } from '../entities/custom-tracking-section.entity';
import { CustomTrackingTargetScope } from '../enums/custom-tracking-target-scope.enum';
import {
  createDataSourceDouble,
  createEntityManagerDouble,
  createRepositoryDouble,
  createSupportService,
} from '../testing/custom-tracking-test.doubles';
import { CustomTrackingCascadeService } from './custom-tracking-cascade.service';
import { CustomTrackingSectionService } from './custom-tracking-section.service';

describe('CustomTrackingSectionService', () => {
  const userId = 'user-1';
  const scope = CustomTrackingTargetScope.ACCOUNT;

  let service: CustomTrackingSectionService;
  let sections: ReturnType<
    typeof createRepositoryDouble<CustomTrackingSectionEntity>
  >;
  let cascade: CustomTrackingCascadeService;
  let deleteSection: jest.Mock<() => Promise<void>>;
  let describeSectionDeletion: jest.Mock<
    () => Promise<{ tabs: number; fields: number }>
  >;

  beforeEach(() => {
    sections = createRepositoryDouble<CustomTrackingSectionEntity>();
    deleteSection = jest.fn<() => Promise<void>>().mockResolvedValue();
    describeSectionDeletion = jest
      .fn<() => Promise<{ tabs: number; fields: number }>>()
      .mockResolvedValue({ tabs: 0, fields: 0 });

    cascade = {
      deleteSection,
      describeSectionDeletion,
    } as unknown as CustomTrackingCascadeService;

    const { manager } = createEntityManagerDouble();

    service = new CustomTrackingSectionService(
      sections.repository,
      createSupportService().support,
      cascade,
      createDataSourceDouble(manager) as unknown as DataSource,
    );
  });

  const existing = (
    overrides: Partial<CustomTrackingSectionEntity> = {},
  ): CustomTrackingSectionEntity =>
    ({
      id: 'section-1',
      userId,
      targetScope: scope,
      name: 'Ship collection',
      nameNormalized: 'ship collection',
      description: null,
      orderIndex: 1000,
      publiclyVisible: false,
      deletedAt: null,
      ...overrides,
    }) as CustomTrackingSectionEntity;

  describe('findOwned', () => {
    it('returns a Section belonging to the caller', async () => {
      sections.double.findOne.mockResolvedValue(existing());

      await expect(
        service.findOwned(userId, 'section-1'),
      ).resolves.toMatchObject({ id: 'section-1' });
    });

    // Absent and belonging to somebody else are the same answer, so nobody can
    // discover which identifiers exist by watching which are refused
    // differently.
    it('reports another user’s Section as simply not found', async () => {
      sections.double.findOne.mockResolvedValue(null);

      await expect(service.findOwned(userId, 'section-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(sections.double.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'section-1', userId }),
        }),
      );
    });
  });

  describe('list', () => {
    it('orders by position, then by identifier', async () => {
      await service.list(userId, scope);

      expect(sections.double.find).toHaveBeenCalledWith(
        expect.objectContaining({
          order: { orderIndex: 'ASC', id: 'ASC' },
        }),
      );
    });
  });

  describe('create', () => {
    it('creates a Section at the end of the collection', async () => {
      sections.double.findOne.mockResolvedValue(null);

      await service.create(userId, scope, {
        name: 'Ship collection',
        description: null,
        publiclyVisible: false,
      });

      expect(sections.double.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          targetScope: scope,
          name: 'Ship collection',
          nameNormalized: 'ship collection',
          orderIndex: 1000,
        }),
      );
    });

    it('keeps the capitalisation the user chose while comparing without it', async () => {
      sections.double.findOne.mockResolvedValue(null);

      await service.create(userId, scope, {
        name: '  Ship   Collection  ',
        description: null,
        publiclyVisible: false,
      });

      expect(sections.double.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Ship Collection',
          nameNormalized: 'ship collection',
        }),
      );
    });

    it('refuses a name a live sibling already has', async () => {
      sections.double.findOne.mockResolvedValue(existing());

      await expect(
        service.create(userId, scope, {
          name: 'Ship collection',
          description: null,
          publiclyVisible: false,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('refuses a Section once the scope is full', async () => {
      sections.double.count.mockResolvedValue(
        CUSTOM_TRACKING_LIMITS.MAX_SECTIONS_PER_SCOPE,
      );

      await expect(
        service.create(userId, scope, {
          name: 'One too many',
          description: null,
          publiclyVisible: false,
        }),
      ).rejects.toThrow(/most allowed/);
    });

    // Every custom flag starts private; public sharing is opt-in at each level.
    it('creates a Section private unless asked otherwise', async () => {
      sections.double.findOne.mockResolvedValue(null);

      await service.create(userId, scope, {
        name: 'Ships',
        description: null,
        publiclyVisible: false,
      });

      expect(sections.double.create).toHaveBeenCalledWith(
        expect.objectContaining({ publiclyVisible: false }),
      );
    });
  });

  describe('update', () => {
    it('changes only what it was given', async () => {
      const section = existing({ description: 'Unchanged' });

      sections.double.findOne.mockResolvedValue(section);

      await service.update(userId, 'section-1', { publiclyVisible: true });

      expect(section.publiclyVisible).toBe(true);
      expect(section.name).toBe('Ship collection');
      expect(section.description).toBe('Unchanged');
    });

    it('clears a description when asked to', async () => {
      const section = existing({ description: 'Something' });

      sections.double.findOne.mockResolvedValue(section);

      await service.update(userId, 'section-1', { description: null });

      expect(section.description).toBeNull();
    });

    // A Section keeping the name it already has is not a clash with itself.
    it('allows a rename that only changes capitalisation', async () => {
      const section = existing();

      sections.double.findOne.mockResolvedValue(section);

      await service.update(userId, 'section-1', { name: 'SHIP COLLECTION' });

      expect(section.name).toBe('SHIP COLLECTION');
      expect(section.nameNormalized).toBe('ship collection');
    });

    it('refuses a rename onto a name a sibling has', async () => {
      sections.double.findOne
        .mockResolvedValueOnce(existing())
        .mockResolvedValueOnce(existing({ id: 'section-2' }));

      await expect(
        service.update(userId, 'section-1', { name: 'Something else' }),
      ).rejects.toThrow(ConflictException);
    });

    it('refuses to change a Section that is not the caller’s', async () => {
      sections.double.findOne.mockResolvedValue(null);

      await expect(
        service.update(userId, 'section-1', { name: 'Anything' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('cascades the deletion inside a transaction', async () => {
      sections.double.findOne.mockResolvedValue(existing());

      await service.remove(userId, 'section-1');

      expect(deleteSection).toHaveBeenCalledWith(
        expect.anything(),
        'section-1',
        expect.any(Date),
      );
    });

    it('refuses to delete a Section that is not the caller’s', async () => {
      sections.double.findOne.mockResolvedValue(null);

      await expect(service.remove(userId, 'section-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(deleteSection).not.toHaveBeenCalled();
    });
  });

  describe('describeDeletion', () => {
    it('reports what would go with it', async () => {
      sections.double.findOne.mockResolvedValue(existing());
      describeSectionDeletion.mockResolvedValue({ tabs: 4, fields: 19 });

      await expect(
        service.describeDeletion(userId, 'section-1'),
      ).resolves.toEqual({ tabs: 4, fields: 19 });
    });

    it('refuses to describe a Section that is not the caller’s', async () => {
      sections.double.findOne.mockResolvedValue(null);

      await expect(
        service.describeDeletion(userId, 'section-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('reorder', () => {
    it('renumbers the caller’s Sections in that scope', async () => {
      const { double: manager, manager: entityManager } =
        createEntityManagerDouble();

      manager.find.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);

      service = new CustomTrackingSectionService(
        sections.repository,
        createSupportService().support,
        cascade,
        createDataSourceDouble(entityManager) as unknown as DataSource,
      );

      await service.reorder(userId, scope, ['b', 'a']);

      expect(manager.update).toHaveBeenCalledTimes(2);
    });
  });
});
