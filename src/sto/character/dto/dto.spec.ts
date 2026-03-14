import { validate } from 'class-validator';
import {
  CreateCharacterRequestDto,
  emptyStringToUndefined,
} from './create-character-request.dto';
import { CreateCharacterDto } from './create-character.dto';

describe('DTO Transformations', () => {
  it('should transform empty strings to undefined', () => {
    expect(emptyStringToUndefined({ value: '' })).toBeUndefined();
    expect(emptyStringToUndefined({ value: 'some' })).toBe('some');
    expect(emptyStringToUndefined({ value: null })).toBeNull();
  });

  it('should be able to instantiate CreateCharacterDto', () => {
    const dto = new CreateCharacterDto();
    expect(dto).toBeDefined();
  });
});

describe('CreateCharacterRequestDto Validation', () => {
  let dto: CreateCharacterRequestDto;

  beforeEach(() => {
    dto = new CreateCharacterRequestDto();
    // Fill required fields with valid data
    Object.assign(dto, {
      accountId: '00000000-0000-0000-0000-000000000000',
      handle: 'Jean-Luc Picard',
      generalFactionId: '00000000-0000-0000-0000-000000000000',
      factionId: '00000000-0000-0000-0000-000000000000',
      sexId: '00000000-0000-0000-0000-000000000000',
      classId: '00000000-0000-0000-0000-000000000000',
      speciesId: '00000000-0000-0000-0000-000000000000',
    });
  });

  it('should validate correctly with valid characters', async () => {
    const validNames = [
      'Picard',
      "T'Pol",
      'J.L. Picard',
      'Multiple Names',
      'Jean-Luc',
    ];
    for (const name of validNames) {
      (dto as any).handle = name;
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    }
  });

  it('should fail with invalid characters', async () => {
    const invalidNames = ['Picard@', 'Worf!', '123'];
    for (const name of invalidNames) {
      (dto as any).handle = name;
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].constraints).toHaveProperty('matches');
    }
  });

  it('should fail with trailing space', async () => {
    (dto as any).handle = 'Picard ';
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('matches');
  });

  it('should fail with only space', async () => {
    (dto as any).handle = ' ';
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  describe('required UUID fields', () => {
    const requiredUuidFields = [
      'accountId',
      'generalFactionId',
      'factionId',
      'sexId',
      'classId',
      'speciesId',
    ] as const;

    it.each(requiredUuidFields)(
      'should fail when %s is missing',
      async field => {
        delete (dto as any)[field];
        const errors = await validate(dto);
        const fieldError = errors.find(e => e.property === field);
        expect(fieldError).toBeDefined();
      },
    );

    it.each(requiredUuidFields)(
      'should fail when %s is not a valid UUID',
      async field => {
        (dto as any)[field] = 'not-a-uuid';
        const errors = await validate(dto);
        const fieldError = errors.find(e => e.property === field);
        expect(fieldError?.constraints).toHaveProperty('isUuid');
      },
    );
  });

  describe('recruitTypeId', () => {
    it('should pass when recruitTypeId is a valid UUID', async () => {
      (dto as any).recruitTypeId = '550e8400-e29b-41d4-a716-446655440000';
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should fail when recruitTypeId is not a valid UUID', async () => {
      (dto as any).recruitTypeId = 'not-a-uuid';
      const errors = await validate(dto);
      const fieldError = errors.find(e => e.property === 'recruitTypeId');
      expect(fieldError?.constraints).toHaveProperty('isUuid');
    });

    it('should pass when recruitTypeId is omitted', async () => {
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });
  });

  describe('createdDate', () => {
    it('should pass when createdDate is a valid ISO date string', async () => {
      (dto as any).createdDate = '2024-01-01T00:00:00.000Z';
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should fail when createdDate is not a valid date string', async () => {
      (dto as any).createdDate = 'not-a-date';
      const errors = await validate(dto);
      const fieldError = errors.find(e => e.property === 'createdDate');
      expect(fieldError?.constraints).toHaveProperty('isDateString');
    });
  });

  describe('level', () => {
    it('should validate correctly with a valid level', async () => {
      (dto as any).level = 65;
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should pass with level of 0 (boundary)', async () => {
      (dto as any).level = 0;
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should fail with negative level', async () => {
      (dto as any).level = -1;
      const errors = await validate(dto);
      const fieldError = errors.find(e => e.property === 'level');
      expect(fieldError?.constraints).toHaveProperty('min');
    });
  });
});
