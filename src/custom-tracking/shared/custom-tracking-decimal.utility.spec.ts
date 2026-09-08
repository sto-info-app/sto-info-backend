import {
  canonicaliseDecimal,
  compareDecimals,
  decimalPlaces,
  isExactDecimal,
} from './custom-tracking-decimal.utility';

describe('isExactDecimal', () => {
  it.each([
    ['a whole number', '42'],
    ['zero', '0'],
    ['a negative', '-17'],
    ['a fraction', '3.14'],
    ['a negative fraction', '-0.5'],
    ['a leading zero', '007'],
    ['ten decimal places', '0.0123456789'],
    ['the largest magnitude', '1000000000'],
  ])('accepts %s', (_description, value) => {
    expect(isExactDecimal(value)).toBe(true);
  });

  // Every one of these is something `Number` would happily parse, which is
  // exactly why the check is a pattern rather than a conversion.
  it.each([
    ['exponent notation', '1e3'],
    ['a huge exponent', '1e400'],
    ['hexadecimal', '0x1f'],
    ['infinity', 'Infinity'],
    ['not a number', 'NaN'],
    ['whitespace', ' 1 '],
    ['an empty string', ''],
    ['a lone sign', '-'],
    ['a trailing point', '1.'],
    ['a leading point', '.5'],
    ['a thousands separator', '1,000'],
    ['two points', '1.2.3'],
    ['a plus sign', '+1'],
    ['eleven decimal places', '0.01234567891'],
    ['a magnitude beyond the ceiling', '1000000001'],
    ['a magnitude far beyond the ceiling', '99999999999'],
    ['a number rather than a string', 1.5],
    ['null', null],
    ['undefined', undefined],
  ])('refuses %s', (_description, value) => {
    expect(isExactDecimal(value)).toBe(false);
  });
});

describe('decimalPlaces', () => {
  it('counts the places a value uses', () => {
    expect(decimalPlaces('3.142')).toBe(3);
  });

  it('counts none for a whole number', () => {
    expect(decimalPlaces('42')).toBe(0);
  });

  // A user who types 1.50 into a field keeping one place has given a figure
  // that fits. Refusing it would be pedantry about how they wrote it.
  it('ignores trailing zeroes', () => {
    expect(decimalPlaces('1.50')).toBe(1);
    expect(decimalPlaces('1.000')).toBe(0);
  });

  it('counts none for something that is not a decimal', () => {
    expect(decimalPlaces('nonsense')).toBe(0);
  });
});

describe('compareDecimals', () => {
  it('orders two whole numbers', () => {
    expect(compareDecimals('2', '10')).toBeLessThan(0);
    expect(compareDecimals('10', '2')).toBeGreaterThan(0);
  });

  it('reports equal values as equal', () => {
    expect(compareDecimals('1.5', '1.50')).toBe(0);
    expect(compareDecimals('007', '7')).toBe(0);
  });

  // Text comparison stops at the first differing character, so without
  // aligning the decimal places `.9` would sort below `.11`.
  it('aligns decimal places before comparing fractions', () => {
    expect(compareDecimals('0.9', '0.11')).toBeGreaterThan(0);
    expect(compareDecimals('0.11', '0.9')).toBeLessThan(0);
  });

  it('orders across the sign', () => {
    expect(compareDecimals('-1', '1')).toBeLessThan(0);
    expect(compareDecimals('1', '-1')).toBeGreaterThan(0);
  });

  // The larger magnitude is the smaller number once it is negative.
  it('reverses the order of two negatives', () => {
    expect(compareDecimals('-10', '-2')).toBeLessThan(0);
    expect(compareDecimals('-2', '-10')).toBeGreaterThan(0);
  });

  it('treats negative zero as zero', () => {
    expect(compareDecimals('-0', '0')).toBe(0);
    expect(compareDecimals('-0.00', '0')).toBe(0);
  });

  it('orders two values of the same width', () => {
    expect(compareDecimals('2', '3')).toBeLessThan(0);
    expect(compareDecimals('3', '2')).toBeGreaterThan(0);
  });

  // A difference smaller than a double can represent is exactly the case the
  // digit-by-digit comparison exists for.
  it('separates values a double would round together', () => {
    expect(compareDecimals('1000000000', '1000000000.0000000001')).toBeLessThan(
      0,
    );
  });

  it('reports values it cannot read as equal', () => {
    expect(compareDecimals('nonsense', '1')).toBe(0);
    expect(compareDecimals('1', 'nonsense')).toBe(0);
  });
});

describe('canonicaliseDecimal', () => {
  it.each([
    ['007', '7'],
    ['1.50', '1.5'],
    ['1.000', '1'],
    ['-0', '0'],
    ['-0.0', '0'],
    ['-1.20', '-1.2'],
    ['0', '0'],
  ])('writes %s as %s', (value, expected) => {
    expect(canonicaliseDecimal(value)).toBe(expected);
  });

  it('returns null for something that is not a decimal', () => {
    expect(canonicaliseDecimal('1e3')).toBeNull();
  });
});
