import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegistrySort } from '../enums/registry-sort.enum';
import { RegistryQueryDto } from './registry-query.dto';

/**
 * Validates a plain query object as a `RegistryQueryDto`.
 *
 * @param plain - The raw query parameters.
 * @returns The instantiated DTO and its validation errors.
 */
async function validateQuery(plain: Record<string, unknown>) {
  const dto = plainToInstance(RegistryQueryDto, plain);
  const errors = await validate(dto);
  return { dto, errors };
}

describe('RegistryQueryDto Validation', () => {
  it('should accept an empty query', async () => {
    const { errors } = await validateQuery({});

    expect(errors.length).toBe(0);
  });

  it('should accept every supported sort value', async () => {
    for (const sort of Object.values(RegistrySort)) {
      const { errors } = await validateQuery({ sort });
      expect(errors.length).toBe(0);
    }
  });

  it('should reject an unknown sort value', async () => {
    const { errors } = await validateQuery({ sort: 'popularity' });

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('isEnum');
  });

  it('should trim the search term', async () => {
    const { dto } = await validateQuery({ search: '  picard  ' });

    expect(dto.search).toBe('picard');
  });

  it('should leave a non-string search term untransformed for validation', async () => {
    const { errors } = await validateQuery({ search: 42 });

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('isString');
  });

  it('should reject a search term longer than 50 characters', async () => {
    const { errors } = await validateQuery({ search: 'a'.repeat(51) });

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('maxLength');
  });

  it('should coerce a numeric string page', async () => {
    const { dto, errors } = await validateQuery({ page: '3' });

    expect(errors.length).toBe(0);
    expect(dto.page).toBe(3);
  });

  it('should reject a page below 1', async () => {
    const { errors } = await validateQuery({ page: 0 });

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('min');
  });

  it('should reject a non-integer page', async () => {
    const { errors } = await validateQuery({ page: 1.5 });

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('isInt');
  });

  it('should reject a page size above 50', async () => {
    const { errors } = await validateQuery({ pageSize: 51 });

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('max');
  });

  it('should reject a page size below 1', async () => {
    const { errors } = await validateQuery({ pageSize: 0 });

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('min');
  });

  it('should accept the maximum page size', async () => {
    const { dto, errors } = await validateQuery({ pageSize: 50 });

    expect(errors.length).toBe(0);
    expect(dto.pageSize).toBe(50);
  });
});
