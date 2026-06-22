import { ensureError, stringifyError } from './error.utility';

describe('Error Utility', () => {
  describe('stringifyError', () => {
    it('returns the message when error is an Error instance', () => {
      const error = new Error('Something went wrong');
      expect(stringifyError(error)).toBe('Something went wrong');
    });

    it('returns the string as-is when error is a string', () => {
      const error = 'Custom error message';
      expect(stringifyError(error)).toBe('Custom error message');
    });

    it('stringifies objects as JSON', () => {
      const error = { code: 'CUSTOM', details: 'Some details' };
      const result = stringifyError(error);
      expect(result).toBe(JSON.stringify(error));
    });

    it('converts arrays to JSON string', () => {
      const error = ['error1', 'error2'];
      const result = stringifyError(error);
      expect(result).toBe(JSON.stringify(error));
    });

    it('converts null to "null" string', () => {
      expect(stringifyError(null)).toBe('null');
    });

    it('converts undefined to "undefined" string', () => {
      expect(stringifyError(undefined)).toBe('undefined');
    });

    it('converts booleans to their string representation', () => {
      expect(stringifyError(true)).toBe('true');
      expect(stringifyError(false)).toBe('false');
    });

    it('converts numbers to their string representation', () => {
      expect(stringifyError(42)).toBe('42');
      expect(stringifyError(3.14)).toBe('3.14');
    });

    it('converts symbols to their string representation', () => {
      const sym = Symbol('test');
      const result = stringifyError(sym);
      expect(result).toContain('Symbol');
    });

    it('handles circular references gracefully', () => {
      const circular: Record<string, unknown> = { a: 1 };
      circular.self = circular;
      // JSON.stringify throws on circular refs, so it falls back to String()
      const result = stringifyError(circular);
      expect(typeof result).toBe('string');
    });

    it('handles objects with toJSON method', () => {
      const obj = {
        data: 'test',
        toJSON: () => ({ data: 'test_json' }),
      };
      const result = stringifyError(obj);
      expect(result).toContain('test_json');
    });

    it('handles Error subclasses correctly', () => {
      class CustomError extends Error {
        constructor(message: string) {
          super(message);
          this.name = 'CustomError';
        }
      }
      const error = new CustomError('Custom error message');
      expect(stringifyError(error)).toBe('Custom error message');
    });
  });

  describe('ensureError', () => {
    it('returns the Error as-is when already an Error instance', () => {
      const error = new Error('Original error');
      const result = ensureError(error);
      expect(result).toBe(error);
      expect(result.message).toBe('Original error');
    });

    it('wraps a string in an Error', () => {
      const result = ensureError('String error');
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe('String error');
    });

    it('wraps an object in an Error with stringified message', () => {
      const obj = { code: 'ERR_001', reason: 'Test error' };
      const result = ensureError(obj);
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe(JSON.stringify(obj));
    });

    it('wraps null in an Error', () => {
      const result = ensureError(null);
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe('null');
    });

    it('wraps undefined in an Error', () => {
      const result = ensureError(undefined);
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe('undefined');
    });

    it('wraps a number in an Error', () => {
      const result = ensureError(404);
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe('404');
    });

    it('wraps Error subclasses correctly', () => {
      class CustomError extends Error {
        constructor(message: string) {
          super(message);
          this.name = 'CustomError';
        }
      }
      const custom = new CustomError('Test');
      const result = ensureError(custom);
      expect(result).toBe(custom);
      expect(result instanceof CustomError).toBe(true);
    });

    it('handles arrays by stringifying them', () => {
      const result = ensureError(['error1', 'error2']);
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe(JSON.stringify(['error1', 'error2']));
    });

    it('creates a new Error instance when not an Error', () => {
      const original = { error: 'test' };
      const result = ensureError(original);
      expect(result).not.toBe(original);
      expect(result).toBeInstanceOf(Error);
    });
  });

  describe('Integration: stringifyError and ensureError', () => {
    it('ensureError wraps the result of stringifyError correctly', () => {
      const obj = { message: 'test', code: 'TEST_ERROR' };
      const stringified = stringifyError(obj);
      const wrapped = ensureError(obj);
      expect(wrapped.message).toBe(stringified);
    });

    it('can roundtrip complex error scenarios', () => {
      const scenarios = [
        new Error('Standard error'),
        'String message',
        { error: 'object', code: 123 },
        null,
        undefined,
        42,
        true,
      ];

      scenarios.forEach(scenario => {
        const stringified = stringifyError(scenario);
        const wrapped = ensureError(scenario);

        expect(typeof stringified).toBe('string');
        expect(wrapped).toBeInstanceOf(Error);
        expect(stringified).toBeTruthy();
      });
    });
  });
});
