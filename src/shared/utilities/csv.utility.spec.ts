import { CSV_BOM, csvCell, toCsv } from './csv.utility';

describe('CSV writing', () => {
  describe('csvCell', () => {
    it.each([
      ['plain text as it is', 'Tova Reen', 'Tova Reen'],
      ['nothing as an empty cell', null, ''],
      ['a number as it is', 42, '42'],
      ['a negative number as it is', -3, '-3'],
      ['a boolean as a word', true, 'true'],
      [
        'an instant in ISO 8601 UTC',
        new Date('2024-12-01T12:00:00Z'),
        '2024-12-01T12:00:00.000Z',
      ],
      ['a comma inside quotes', 'Reen, Tova', '"Reen, Tova"'],
      ['a quote doubled, inside quotes', 'The "Admiral"', '"The ""Admiral"""'],
      ['a line break inside quotes', 'one\ntwo', '"one\ntwo"'],
    ])('writes %s', (_, value, cell) => {
      expect(csvCell(value)).toBe(cell);
    });

    // A Character name is somebody else's text: it must never run.
    it.each(['=HYPERLINK("x")', '+1', '-2+3', '@SUM(A1)', '\tx', '\rx'])(
      'neutralises %j as a formula',
      value => {
        expect(csvCell(value).replace(/^"/, '').charAt(0)).toBe("'");
      },
    );

    it('quotes a neutralised formula that needs quoting too', () => {
      expect(csvCell('=A1,B1')).toBe(`"'=A1,B1"`);
    });
  });

  describe('toCsv', () => {
    it('ends every line with CRLF', () => {
      expect(
        toCsv([
          ['Export', 'Members'],
          [new Date('2024-12-01T12:00:00Z'), 6],
        ]),
      ).toBe('Export,Members\r\n2024-12-01T12:00:00.000Z,6\r\n');
    });

    it('writes nothing for no rows', () => {
      expect(toCsv([])).toBe('');
    });
  });

  it('offers the byte order mark a spreadsheet reads UTF-8 by', () => {
    expect(CSV_BOM).toBe('\u{FEFF}');
  });
});
