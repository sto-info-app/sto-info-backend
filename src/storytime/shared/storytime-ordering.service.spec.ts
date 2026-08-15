import { Test, TestingModule } from '@nestjs/testing';
import {
  ORDER_INDEX_GAP,
  ORDER_INDEX_START,
} from './storytime-ordering.constants';
import { StorytimeOrderingService } from './storytime-ordering.service';

describe('StorytimeOrderingService', () => {
  let service: StorytimeOrderingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StorytimeOrderingService],
    }).compile();

    service = module.get<StorytimeOrderingService>(StorytimeOrderingService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('nextIndex', () => {
    it('starts an empty collection at the first position', () => {
      expect(service.nextIndex(null)).toBe(ORDER_INDEX_START);
    });

    it('appends a gap beyond the last item', () => {
      expect(service.nextIndex(3000)).toBe(3000 + ORDER_INDEX_GAP);
    });

    it('appends after a position that is not on a gap boundary', () => {
      expect(service.nextIndex(1500)).toBe(1500 + ORDER_INDEX_GAP);
    });
  });

  describe('placeBetween', () => {
    it('places the only item at the first position', () => {
      expect(service.placeBetween(null, null)).toEqual({
        orderIndex: ORDER_INDEX_START,
        requiresRenumber: false,
      });
    });

    it('places an item at the midpoint of its neighbours', () => {
      expect(service.placeBetween(1000, 2000)).toEqual({
        orderIndex: 1500,
        requiresRenumber: false,
      });
    });

    it('places an item after the last', () => {
      expect(service.placeBetween(3000, null)).toEqual({
        orderIndex: 4000,
        requiresRenumber: false,
      });
    });

    it('places an item before the first by halving', () => {
      expect(service.placeBetween(null, 1000)).toEqual({
        orderIndex: 500,
        requiresRenumber: false,
      });
    });

    it('handles an odd gap without colliding with either neighbour', () => {
      const placement = service.placeBetween(1000, 1003);

      expect(placement.orderIndex).toBeGreaterThan(1000);
      expect(placement.orderIndex).toBeLessThan(1003);
      expect(placement.requiresRenumber).toBe(false);
    });

    it('uses the smallest usable gap', () => {
      const placement = service.placeBetween(1000, 1002);

      expect(placement.orderIndex).toBe(1001);
      expect(placement.requiresRenumber).toBe(false);
    });

    // Once neighbours are adjacent there is no whole number between them.
    it('asks for a renumber when neighbours are adjacent', () => {
      expect(service.placeBetween(1000, 1001).requiresRenumber).toBe(true);
    });

    it('asks for a renumber when neighbours share an index', () => {
      expect(service.placeBetween(1000, 1000).requiresRenumber).toBe(true);
    });

    it('asks for a renumber when there is no room before the first item', () => {
      expect(service.placeBetween(null, 1)).toEqual({
        orderIndex: 0,
        requiresRenumber: true,
      });
    });

    it('places before a first item that still has room', () => {
      expect(service.placeBetween(null, 2)).toEqual({
        orderIndex: 1,
        requiresRenumber: false,
      });
    });

    it('never produces a negative index', () => {
      expect(service.placeBetween(null, 0).orderIndex).toBeGreaterThanOrEqual(
        0,
      );
    });
  });

  describe('renumber', () => {
    it('spreads a collection back onto even gaps', () => {
      expect(service.renumber(['a', 'b', 'c'])).toEqual([
        { id: 'a', orderIndex: 1000 },
        { id: 'b', orderIndex: 2000 },
        { id: 'c', orderIndex: 3000 },
      ]);
    });

    it('preserves the order it is given', () => {
      const result = service.renumber(['c', 'a', 'b']);

      expect(result.map(entry => entry.id)).toEqual(['c', 'a', 'b']);
    });

    it('handles an empty collection', () => {
      expect(service.renumber([])).toEqual([]);
    });

    it('leaves room to insert between every pair afterwards', () => {
      const result = service.renumber(['a', 'b']);
      const placement = service.placeBetween(
        result[0].orderIndex,
        result[1].orderIndex,
      );

      expect(placement.requiresRenumber).toBe(false);
    });
  });
});
