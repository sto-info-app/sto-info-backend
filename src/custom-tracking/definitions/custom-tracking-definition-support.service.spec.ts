import { BadRequestException, ConflictException } from '@nestjs/common';

import { IsNull } from 'typeorm';

import { StorytimeOrderingService } from '../../storytime/shared/storytime-ordering.service';
import { CustomTrackingObservabilityService } from '../observability/custom-tracking-observability.service';
import {
  createEntityManagerDouble,
  createRepositoryDouble,
} from '../testing/custom-tracking-test.doubles';
import { CustomTrackingDefinitionSupportService } from './custom-tracking-definition-support.service';

/**
 * A stand-in row carrying the columns the four real levels between them use,
 * so one set of tests covers the rules all of them share.
 */
interface Row {
  id: string;
  orderIndex: number;
  sectionId?: string;
  tabId?: string;
  nameNormalized?: string;
  deletedAt?: Date | null;
}

describe('CustomTrackingDefinitionSupportService', () => {
  let service: CustomTrackingDefinitionSupportService;
  let repositoryDouble: ReturnType<typeof createRepositoryDouble<Row>>;
  let limitReached: jest.Mock;

  const roomFor = (used: number) => ({
    userId: 'user-1',
    used,
    limit: 'MAX_TABS_PER_SECTION' as const,
    message: 'full',
  });

  beforeEach(() => {
    limitReached = jest.fn();
    service = new CustomTrackingDefinitionSupportService(
      new StorytimeOrderingService(),
      { limitReached } as unknown as CustomTrackingObservabilityService,
    );
    repositoryDouble = createRepositoryDouble<Row>();
  });

  describe('countActive', () => {
    it('counts only rows that are not deleted', async () => {
      repositoryDouble.double.count.mockResolvedValue(4);

      await expect(
        service.countActive(repositoryDouble.repository, { sectionId: 's' }),
      ).resolves.toBe(4);

      expect(repositoryDouble.double.count).toHaveBeenCalledWith({
        where: { sectionId: 's', deletedAt: IsNull() },
      });
    });
  });

  describe('assertRoomFor', () => {
    it('allows a collection with room left', () => {
      expect(() => service.assertRoomFor(roomFor(9))).not.toThrow();
      expect(limitReached).not.toHaveBeenCalled();
    });

    it('refuses a collection that is exactly full', () => {
      expect(() => service.assertRoomFor(roomFor(10))).toThrow(
        ConflictException,
      );
    });

    it('refuses a collection somehow beyond its limit', () => {
      expect(() => service.assertRoomFor(roomFor(11))).toThrow('full');
    });

    // A hundred refusals a minute is only legible as abuse if the record says
    // they were all the same ceiling.
    it('records which ceiling was reached', () => {
      expect(() => service.assertRoomFor(roomFor(10))).toThrow();

      expect(limitReached).toHaveBeenCalledWith(
        'user-1',
        'MAX_TABS_PER_SECTION',
        10,
      );
    });
  });

  describe('assertNameAvailable', () => {
    it('allows a name nothing live is using', async () => {
      repositoryDouble.double.findOne.mockResolvedValue(null);

      await expect(
        service.assertNameAvailable(
          repositoryDouble.repository,
          { nameNormalized: 'ships' },
          'taken',
        ),
      ).resolves.toBeUndefined();
    });

    it('refuses a name a live sibling already has', async () => {
      repositoryDouble.double.findOne.mockResolvedValue({
        id: 'a',
        orderIndex: 1000,
      });

      await expect(
        service.assertNameAvailable(
          repositoryDouble.repository,
          { nameNormalized: 'ships' },
          'taken',
        ),
      ).rejects.toThrow(ConflictException);
    });

    // A deleted definition does not reserve its name; the partial unique index
    // is written the same way.
    it('looks only at rows that are not deleted', async () => {
      await service.assertNameAvailable(
        repositoryDouble.repository,
        { nameNormalized: 'ships' },
        'taken',
      );

      expect(repositoryDouble.double.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { nameNormalized: 'ships', deletedAt: IsNull() },
        }),
      );
    });
  });

  describe('nextOrderIndex', () => {
    it('starts an empty collection at the first position', async () => {
      repositoryDouble.double.findOne.mockResolvedValue(null);

      await expect(
        service.nextOrderIndex(repositoryDouble.repository, { tabId: 't' }),
      ).resolves.toBe(1000);
    });

    it('places a new row after the last one', async () => {
      repositoryDouble.double.findOne.mockResolvedValue({
        id: 'a',
        orderIndex: 3000,
      });

      await expect(
        service.nextOrderIndex(repositoryDouble.repository, { tabId: 't' }),
      ).resolves.toBe(4000);
    });
  });

  describe('reorder', () => {
    const siblings = (...ids: string[]): Row[] =>
      ids.map((id, index) => ({ id, orderIndex: (index + 1) * 1000 }));

    it('renumbers the collection into the order asked for', async () => {
      const { double: manager, manager: entityManager } =
        createEntityManagerDouble();

      manager.find.mockResolvedValue(siblings('a', 'b', 'c'));

      await service.reorder(
        entityManager,
        repositoryDouble.repository,
        { tabId: 't' },
        ['c', 'a', 'b'],
      );

      expect(manager.update).toHaveBeenNthCalledWith(
        1,
        expect.anything(),
        'c',
        {
          orderIndex: 1000,
        },
      );
      expect(manager.update).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        'a',
        {
          orderIndex: 2000,
        },
      );
      expect(manager.update).toHaveBeenNthCalledWith(
        3,
        expect.anything(),
        'b',
        {
          orderIndex: 3000,
        },
      );
    });

    it('refuses an order that names the same item twice', async () => {
      const { double: manager, manager: entityManager } =
        createEntityManagerDouble();

      manager.find.mockResolvedValue(siblings('a', 'b'));

      await expect(
        service.reorder(
          entityManager,
          repositoryDouble.repository,
          { tabId: 't' },
          ['a', 'a'],
        ),
      ).rejects.toThrow('The new order lists the same item more than once.');
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('refuses an order that leaves an item out', async () => {
      const { double: manager, manager: entityManager } =
        createEntityManagerDouble();

      manager.find.mockResolvedValue(siblings('a', 'b', 'c'));

      await expect(
        service.reorder(
          entityManager,
          repositoryDouble.repository,
          { tabId: 't' },
          ['a', 'b'],
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses an order with an item too many', async () => {
      const { double: manager, manager: entityManager } =
        createEntityManagerDouble();

      manager.find.mockResolvedValue(siblings('a', 'b'));

      await expect(
        service.reorder(
          entityManager,
          repositoryDouble.repository,
          { tabId: 't' },
          ['a', 'b', 'c'],
        ),
      ).rejects.toThrow(BadRequestException);
    });

    // An identifier from somebody else's collection is not among the siblings
    // loaded here, so it reads as an unknown row rather than as a move. This
    // is what stops a row being dragged out of another user's hierarchy.
    it('refuses an order naming a row from another collection', async () => {
      const { double: manager, manager: entityManager } =
        createEntityManagerDouble();

      manager.find.mockResolvedValue(siblings('a', 'b'));

      await expect(
        service.reorder(
          entityManager,
          repositoryDouble.repository,
          { tabId: 't' },
          ['a', 'somebody-elses-row'],
        ),
      ).rejects.toThrow(
        'The new order has to list every item in this group exactly once.',
      );
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('reads only rows that are not deleted', async () => {
      const { double: manager, manager: entityManager } =
        createEntityManagerDouble();

      manager.find.mockResolvedValue([]);

      await service.reorder(
        entityManager,
        repositoryDouble.repository,
        { tabId: 't' },
        [],
      );

      expect(manager.find).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          where: { tabId: 't', deletedAt: IsNull() },
        }),
      );
    });
  });
});
