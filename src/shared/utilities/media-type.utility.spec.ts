import { describe, expect, it } from '@jest/globals';

import { normaliseMediaType } from './media-type.utility';

describe('normaliseMediaType', () => {
  it.each([
    ['a type that is already canonical', 'text/csv', 'text/csv'],
    ['capitals', 'TEXT/CSV', 'text/csv'],
    ['surrounding whitespace', '  image/png  ', 'image/png'],
    ['a charset parameter', 'text/csv; charset=utf-8', 'text/csv'],
    ['a parameter in capitals', 'TEXT/CSV; CHARSET=UTF-8', 'text/csv'],
    ['a parameter with no space', 'text/csv;charset=utf-8', 'text/csv'],
  ])('reduces %s', (_description, declared, expected) => {
    expect(normaliseMediaType(declared)).toBe(expected);
  });

  it.each([
    ['image/jpg', 'image/jpeg'],
    ['image/pjpeg', 'image/jpeg'],
    ['image/x-citrix-jpeg', 'image/jpeg'],
    ['image/x-png', 'image/png'],
    ['image/x-citrix-png', 'image/png'],
    ['application/csv', 'text/csv'],
    ['application/x-csv', 'text/csv'],
    ['text/comma-separated-values', 'text/csv'],
    ['text/x-comma-separated-values', 'text/csv'],
    ['application/vnd.ms-excel', 'text/csv'],
    ['application/excel', 'text/csv'],
    ['application/x-excel', 'text/csv'],
  ])('maps %s to %s', (declared, expected) => {
    expect(normaliseMediaType(declared)).toBe(expected);
  });

  it('maps an alias written in capitals and with a parameter', () => {
    // The three reductions in one value, in the order they have to happen:
    // a parameter left on would stop the alias matching at all.
    expect(normaliseMediaType('Image/JPG; charset=binary')).toBe('image/jpeg');
  });

  it.each([
    ['nothing at all', null],
    ['an empty string', ''],
    ['only whitespace', '   '],
    ['only a parameter', '; charset=utf-8'],
    ['a type with no subtype', 'text'],
    ['a wildcard', 'image/*'],
    ['a subtype that is only a wildcard', '*/*'],
    ['a type with a space in it', 'text/c sv'],
    ['a type longer than the column allows', `text/${'c'.repeat(200)}`],
  ])('reads %s as nothing declared', (_description, declared) => {
    expect(normaliseMediaType(declared)).toBeNull();
  });

  it('leaves a type it has never heard of alone', () => {
    // The table maps aliases, not everything. An unknown type is passed
    // through in its canonical spelling and left for the worker to refuse
    // if the bytes do not bear it out.
    expect(normaliseMediaType('Application/Vnd.Made-Up')).toBe(
      'application/vnd.made-up',
    );
  });
});
