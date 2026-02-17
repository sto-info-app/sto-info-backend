import * as fc from 'fast-check';

describe('String utility fuzz tests', () => {
  const numRuns = Number(process.env['FUZZ_NUM_RUNS']) || 100;

  it('should handle arbitrary string trimming without throwing', () => {
    fc.assert(
      fc.property(fc.string(), (input: string) => {
        expect(() => {
          const trimmed = input.trim();
          expect(typeof trimmed).toBe('string');
        }).not.toThrow();
      }),
      { numRuns },
    );
  });

  it('should handle arbitrary string lowercasing without throwing', () => {
    fc.assert(
      fc.property(fc.string(), (input: string) => {
        expect(() => {
          const lowered = input.toLowerCase();
          expect(typeof lowered).toBe('string');
        }).not.toThrow();
      }),
      { numRuns },
    );
  });

  it('should handle arbitrary string splitting without throwing', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.string({ maxLength: 10 }),
        (input: string, delimiter: string) => {
          expect(() => {
            const parts = input.split(delimiter);
            expect(Array.isArray(parts)).toBe(true);

            // `split('')` on an empty string returns an empty array, so length can be 0.
            // For all other cases, split returns at least one element.
            if (delimiter !== '' || input !== '') {
              expect(parts.length).toBeGreaterThan(0);
            } else {
              expect(parts.length).toBe(0);
            }
          }).not.toThrow();
        },
      ),
      { numRuns },
    );
  });

  it('should handle arbitrary JSON parsing attempts safely', () => {
    fc.assert(
      fc.property(fc.string(), (input: string) => {
        expect(() => {
          try {
            const parsed = JSON.parse(input);
            // If parsing succeeds, result should be defined
            expect(parsed).toBeDefined();
          } catch (err) {
            // JSON.parse can throw SyntaxError for invalid JSON
            expect(err).toBeInstanceOf(SyntaxError);
          }
        }).not.toThrow();
      }),
      { numRuns },
    );
  });

  it('should handle arbitrary string-to-number conversions without throwing', () => {
    fc.assert(
      fc.property(fc.string(), (input: string) => {
        expect(() => {
          const num = Number(input);
          // Number() never throws, but may return NaN
          expect(typeof num).toBe('number');
        }).not.toThrow();
      }),
      { numRuns },
    );
  });
});
