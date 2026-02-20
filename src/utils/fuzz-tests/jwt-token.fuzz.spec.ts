import * as fc from 'fast-check';

/**
 * Simulates JWT token structure validation
 */
function validateJwtStructure(token: string): {
  valid: boolean;
  parts: number;
} {
  try {
    const parts = token.split('.');
    return {
      valid: parts.length === 3,
      parts: parts.length,
    };
  } catch {
    return { valid: false, parts: 0 };
  }
}

/**
 * Simulates JWT payload decoding (without signature verification)
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    // Decode the payload (second part)
    const payload = parts[1];
    const decoded = Buffer.from(payload, 'base64').toString('utf-8');

    // JWT payloads are expected to be JSON objects. If the decoded JSON is a
    // primitive (e.g. "0") or an array, treat it as invalid.
    const parsed: unknown = JSON.parse(decoded);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }

    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Simulates JWT expiration check
 */
function isTokenExpired(token: string): boolean {
  try {
    const payload = decodeJwtPayload(token);
    const exp = payload?.['exp'];

    if (typeof exp !== 'number') {
      return true;
    }

    const currentTime = Math.floor(Date.now() / 1000);
    return currentTime > exp;
  } catch {
    return true;
  }
}

describe('JWT token parsing fuzz tests', () => {
  const numRuns = Number(process.env['FUZZ_NUM_RUNS']) || 100;

  it('should handle arbitrary strings as JWT tokens without throwing', () => {
    fc.assert(
      fc.property(fc.string(), (token: string) => {
        expect(() => {
          const result = validateJwtStructure(token);
          expect(typeof result.valid).toBe('boolean');
          expect(typeof result.parts).toBe('number');
        }).not.toThrow();
      }),
      { numRuns },
    );
  });

  it('should handle malformed JWT structures without throwing', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(''),
          fc.constant('.'),
          fc.constant('..'),
          fc.constant('...'),
          fc.constant('a.b'),
          fc.constant('a.b.c.d'),
          fc.string(),
        ),
        (malformedToken: string) => {
          expect(() => {
            const result = validateJwtStructure(malformedToken);
            expect(typeof result.valid).toBe('boolean');
          }).not.toThrow();
        },
      ),
      { numRuns },
    );
  });

  it('should handle JWT payload decoding with arbitrary inputs without throwing', () => {
    fc.assert(
      fc.property(fc.string(), (token: string) => {
        expect(() => {
          const payload = decodeJwtPayload(token);
          expect(payload === null || typeof payload === 'object').toBe(true);
        }).not.toThrow();
      }),
      { numRuns },
    );
  });

  it('should handle JWT tokens with invalid base64 encoding without throwing', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.string(),
        fc.string(),
        (header: string, payload: string, signature: string) => {
          expect(() => {
            const token = `${header}.${payload}.${signature}`;
            const result = decodeJwtPayload(token);
            expect(result === null || typeof result === 'object').toBe(true);
          }).not.toThrow();
        },
      ),
      { numRuns },
    );
  });

  it('should handle JWT tokens with valid structure but invalid JSON without throwing', () => {
    fc.assert(
      fc.property(fc.string(), (invalidJson: string) => {
        expect(() => {
          const header = Buffer.from('{"alg":"HS256"}').toString('base64');
          const payload = Buffer.from(invalidJson).toString('base64');
          const signature = 'signature';
          const token = `${header}.${payload}.${signature}`;
          const result = decodeJwtPayload(token);
          expect(result === null || typeof result === 'object').toBe(true);
        }).not.toThrow();
      }),
      { numRuns },
    );
  });

  it('should handle expiration check with arbitrary tokens without throwing', () => {
    fc.assert(
      fc.property(fc.string(), (token: string) => {
        expect(() => {
          const expired = isTokenExpired(token);
          expect(typeof expired).toBe('boolean');
        }).not.toThrow();
      }),
      { numRuns },
    );
  });

  it('should handle JWT tokens with various exp values without throwing', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer(),
          fc.constant(null),
          fc.constant(undefined),
          fc.string(),
          fc.boolean(),
        ),
        (expValue: number | null | undefined | string | boolean) => {
          expect(() => {
            const header = Buffer.from('{"alg":"HS256"}').toString('base64');
            const payload = Buffer.from(
              JSON.stringify({ exp: expValue }),
            ).toString('base64');
            const signature = 'signature';
            const token = `${header}.${payload}.${signature}`;
            const expired = isTokenExpired(token);
            expect(typeof expired).toBe('boolean');
          }).not.toThrow();
        },
      ),
      { numRuns },
    );
  });

  it('should handle very long JWT tokens without throwing', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 5000 }),
        (longString: string) => {
          expect(() => {
            const header = Buffer.from('{"alg":"HS256"}').toString('base64');
            const payload = Buffer.from(longString).toString('base64');
            const signature = 'sig';
            const token = `${header}.${payload}.${signature}`;
            const result = validateJwtStructure(token);
            expect(typeof result.valid).toBe('boolean');
          }).not.toThrow();
        },
      ),
      { numRuns },
    );
  });

  it('should handle JWT tokens with special characters without throwing', () => {
    fc.assert(
      fc.property(
        fc
          .array(fc.constantFrom('.', '=', '+', '/', '-', '_'), {
            minLength: 0,
            maxLength: 512,
          })
          .map(chars => chars.join('')),
        (specialChars: string) => {
          expect(() => {
            const token = `header.${specialChars}.signature`;
            const result = validateJwtStructure(token);
            expect(typeof result.valid).toBe('boolean');
          }).not.toThrow();
        },
      ),
      { numRuns },
    );
  });

  it('should handle JWT payload with nested objects without throwing', () => {
    fc.assert(
      fc.property(
        fc.object({ maxDepth: 3 }),
        (nestedObj: Record<string, unknown>) => {
          expect(() => {
            const header = Buffer.from('{"alg":"HS256"}').toString('base64');
            const payload = Buffer.from(JSON.stringify(nestedObj)).toString(
              'base64',
            );
            const signature = 'signature';
            const token = `${header}.${payload}.${signature}`;
            const result = decodeJwtPayload(token);
            expect(result === null || typeof result === 'object').toBe(true);
          }).not.toThrow();
        },
      ),
      { numRuns },
    );
  });
});
