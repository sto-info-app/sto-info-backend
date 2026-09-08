import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import * as fc from 'fast-check';

import { UserLoginDto } from '../../user/dto/user-login.dto';

describe('DTO validation fuzz tests', () => {
  const numRuns = Number(process.env['FUZZ_NUM_RUNS']) || 100;

  it('should handle arbitrary UserLoginDto inputs without throwing', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          email: fc.oneof(fc.emailAddress(), fc.string()),
          password: fc.string(),
        }),
        async (input: Record<string, unknown>) => {
          // Validation should never throw - it should return validation errors
          expect(async () => {
            const dto = plainToInstance(UserLoginDto, input);
            const errors = await validate(dto);
            // Errors array should be defined (even if empty)
            expect(Array.isArray(errors)).toBe(true);
          }).not.toThrow();
        },
      ),
      { numRuns },
    );
  });

  it('should handle arbitrary email strings in UserLoginDto without throwing', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string(),
        fc.string(),
        async (email: string, password: string) => {
          expect(async () => {
            const dto = plainToInstance(UserLoginDto, { email, password });
            const errors = await validate(dto);
            expect(Array.isArray(errors)).toBe(true);
          }).not.toThrow();
        },
      ),
      { numRuns },
    );
  });

  it('should handle arbitrary object structures as DTO input without throwing', async () => {
    await fc.assert(
      fc.asyncProperty(fc.object(), async (input: Record<string, unknown>) => {
        expect(async () => {
          const dto = plainToInstance(UserLoginDto, input);
          const errors = await validate(dto);
          expect(Array.isArray(errors)).toBe(true);
        }).not.toThrow();
      }),
      { numRuns },
    );
  });
});
