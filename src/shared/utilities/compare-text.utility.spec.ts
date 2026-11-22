import { compareText } from './compare-text.utility';

describe('compareText', () => {
  it.each([
    ['a', 'b', -1],
    ['b', 'a', 1],
    ['a', 'a', 0],
    // By code unit: every capital sorts before every small letter.
    ['Z', 'a', -1],
  ])('orders %s against %s as %i', (a, b, expected) => {
    expect(compareText(a, b)).toBe(expected);
  });
});
