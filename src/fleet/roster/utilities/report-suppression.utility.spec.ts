import {
  REPORT_MINIMUM_COHORT,
  suppressCount,
  suppressGroup,
} from './report-suppression.utility';

describe('report suppression', () => {
  it('holds aggregate audiences to a cohort of five', () => {
    expect(REPORT_MINIMUM_COHORT).toBe(5);
  });

  describe('suppressGroup', () => {
    it('shows a group with no small count as it is, zeros included', () => {
      expect(suppressGroup([12, 0, 5, 30])).toEqual([12, 0, 5, 30]);
    });

    it('hides every count from 1 to 4', () => {
      expect(suppressGroup([1, 4, 9, 2])).toEqual([null, null, 9, null]);
    });

    // With a total shown elsewhere, one hidden cell could be subtracted back.
    it('hides the smallest shown count too when only one is hidden', () => {
      expect(suppressGroup([20, 3, 11, 40])).toEqual([20, null, null, 40]);
    });

    it('takes a zero as the smallest shown count', () => {
      expect(suppressGroup([20, 3, 0, 40])).toEqual([20, null, null, 40]);
    });

    it('takes the first of two equal smallest counts', () => {
      expect(suppressGroup([7, 2, 7])).toEqual([null, null, 7]);
    });

    it('hides a lone small count with nothing to pair it with', () => {
      expect(suppressGroup([3])).toEqual([null]);
    });

    it('shows an empty group as empty', () => {
      expect(suppressGroup([])).toEqual([]);
    });

    it('can be held to another minimum', () => {
      expect(suppressGroup([9, 12, 20], 10)).toEqual([null, null, 20]);
    });
  });

  describe('suppressCount', () => {
    it.each([
      [0, 0],
      [1, null],
      [4, null],
      [5, 5],
      [120, 120],
    ])('shows %i as %p', (count, shown) => {
      expect(suppressCount(count)).toBe(shown);
    });

    it('can be held to another minimum', () => {
      expect(suppressCount(8, 10)).toBeNull();
    });
  });
});
