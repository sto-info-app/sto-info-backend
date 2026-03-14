import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import * as fc from 'fast-check';
import { CreateCharacterRequestDto } from '../../sto/character/dto/create-character-request.dto';

describe('Character DTO validation fuzz tests', () => {
  const numRuns = Number(process.env['FUZZ_NUM_RUNS']) || 100;

  it('should handle arbitrary CreateCharacterRequestDto inputs without throwing', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          accountId: fc.oneof(fc.uuid(), fc.string()),
          handle: fc.string(),
          profilePictureId: fc.oneof(
            fc.uuid(),
            fc.string(),
            fc.constant(undefined),
          ),
          level: fc.oneof(fc.integer(), fc.double(), fc.constant(undefined)),
          generalFactionId: fc.oneof(fc.uuid(), fc.string()),
          factionId: fc.oneof(fc.uuid(), fc.string()),
          sexId: fc.oneof(fc.uuid(), fc.string()),
          classId: fc.oneof(fc.uuid(), fc.string()),
          recruitTypeId: fc.oneof(
            fc.uuid(),
            fc.string(),
            fc.constant(undefined),
          ),
          speciesId: fc.oneof(fc.uuid(), fc.string()),
          createdDate: fc.oneof(
            fc
              .date({
                min: new Date('2020-01-01'),
                max: new Date('2100-12-31'),
              })
              .filter(d => !isNaN(d.getTime()))
              .map(d => d.toISOString()),
            fc.string(),
            fc.constant(undefined),
          ),
          firstName: fc.oneof(fc.string(), fc.constant(undefined)),
          middleName: fc.oneof(fc.string(), fc.constant(undefined)),
          lastName: fc.oneof(fc.string(), fc.constant(undefined)),
          biography: fc.oneof(fc.string(), fc.constant(undefined)),
          notes: fc.oneof(fc.string(), fc.constant(undefined)),
        }),
        async (input: Record<string, unknown>) => {
          expect(async () => {
            const dto = plainToInstance(CreateCharacterRequestDto, input);
            const errors = await validate(dto);
            expect(Array.isArray(errors)).toBe(true);
          }).not.toThrow();
        },
      ),
      { numRuns },
    );
  });

  it('should handle completely arbitrary object structures for CreateCharacterRequestDto without throwing', async () => {
    await fc.assert(
      fc.asyncProperty(fc.object(), async (input: Record<string, unknown>) => {
        expect(async () => {
          const dto = plainToInstance(CreateCharacterRequestDto, input);
          const errors = await validate(dto);
          expect(Array.isArray(errors)).toBe(true);
        }).not.toThrow();
      }),
      { numRuns },
    );
  });
});
