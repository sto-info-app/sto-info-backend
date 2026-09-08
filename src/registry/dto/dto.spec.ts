import { validateDto } from '../../utils/testing/dto-validation.util';
import { RegistrySort } from '../enums/registry-sort.enum';
import { RegistryQueryDto } from './registry-query.dto';

describe('RegistryQueryDto Validation', () => {
  it('should accept an empty query', async () => {
    const { errors } = await validateDto(RegistryQueryDto, {});

    expect(errors).toHaveLength(0);
  });

  it('should accept every supported sort value', async () => {
    for (const sort of Object.values(RegistrySort)) {
      const { errors } = await validateDto(RegistryQueryDto, { sort });
      expect(errors).toHaveLength(0);
    }
  });

  it('should reject an unknown sort value', async () => {
    const { errors } = await validateDto(RegistryQueryDto, {
      sort: 'popularity',
    });

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('isEnum');
  });

  it('should trim the search term', async () => {
    const { dto } = await validateDto(RegistryQueryDto, {
      search: '  picard  ',
    });

    expect(dto.search).toBe('picard');
  });

  it('should leave a non-string search term untransformed for validation', async () => {
    const { errors } = await validateDto(RegistryQueryDto, { search: 42 });

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('isString');
  });

  it('should reject a search term longer than 50 characters', async () => {
    const { errors } = await validateDto(RegistryQueryDto, {
      search: 'a'.repeat(51),
    });

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('maxLength');
  });

  it('should coerce a numeric string page', async () => {
    const { dto, errors } = await validateDto(RegistryQueryDto, { page: '3' });

    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(3);
  });

  it('should reject a page below 1', async () => {
    const { errors } = await validateDto(RegistryQueryDto, { page: 0 });

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('min');
  });

  it('should reject a non-integer page', async () => {
    const { errors } = await validateDto(RegistryQueryDto, { page: 1.5 });

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('isInt');
  });

  it('should reject a page size above 50', async () => {
    const { errors } = await validateDto(RegistryQueryDto, { pageSize: 51 });

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('max');
  });

  it('should reject a page size below 1', async () => {
    const { errors } = await validateDto(RegistryQueryDto, { pageSize: 0 });

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('min');
  });

  it('should accept the maximum page size', async () => {
    const { dto, errors } = await validateDto(RegistryQueryDto, {
      pageSize: 50,
    });

    expect(errors).toHaveLength(0);
    expect(dto.pageSize).toBe(50);
  });
});
