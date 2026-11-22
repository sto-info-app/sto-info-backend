import * as fc from 'fast-check';

import { ValidatorsService } from '../../shared/utilities/validators.service';

describe('ValidatorsService Regex Fuzz Tests', () => {
  const service = new ValidatorsService();
  const numRuns = Number(process.env['FUZZ_NUM_RUNS']) || 100;

  // Timeout for each run to detect ReDoS (catastrophic backtracking)
  const timeoutMs = 200;

  const testWithTimeout = async (fn: () => void) => {
    const start = Date.now();
    fn();
    const duration = Date.now() - start;
    if (duration > timeoutMs) {
      throw new Error(`Regex execution took too long: ${duration}ms`);
    }
  };

  it('should validate emails without catastrophic backtracking', async () => {
    await expect(
      fc.assert(
        fc.asyncProperty(fc.string(), async input => {
          await testWithTimeout(() => {
            service.validateEmail(input);
          });
        }),
        { numRuns },
      ),
    ).resolves.toBeUndefined();
  });

  it('should validate usernames without catastrophic backtracking', async () => {
    await expect(
      fc.assert(
        fc.asyncProperty(fc.string(), async input => {
          await testWithTimeout(() => {
            service.validateUsername(input);
          });
        }),
        { numRuns },
      ),
    ).resolves.toBeUndefined();
  });

  it('should validate passwords without catastrophic backtracking', async () => {
    await expect(
      fc.assert(
        fc.asyncProperty(fc.string(), async input => {
          await testWithTimeout(() => {
            service.validatePassword(input);
          });
        }),
        { numRuns },
      ),
    ).resolves.toBeUndefined();
  });

  it('should validate UUIDs without catastrophic backtracking', async () => {
    await expect(
      fc.assert(
        fc.asyncProperty(fc.string(), async input => {
          await testWithTimeout(() => {
            service.validateUuid(input);
          });
        }),
        { numRuns },
      ),
    ).resolves.toBeUndefined();
  });
});
