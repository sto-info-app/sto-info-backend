import { validate, ValidationError } from 'class-validator';

import { AccountSortBy, AccountSortOrder } from '../account-sort.utility';
import { CreateAccountRequestDto } from './create-account-request.dto';
import { FindAccountsQueryDto } from './find-accounts-query.dto';
import { UpdateAccountPinDto } from './update-account-pin.dto';

describe('CreateAccountRequestDto Validation', () => {
  let dto: CreateAccountRequestDto;

  beforeEach(() => {
    dto = new CreateAccountRequestDto();
    Object.assign(dto, {
      handle: 'Steve',
    });
  });

  it('should validate correctly with valid handles', async () => {
    const validHandles = [
      'Steve',
      'St.eve',
      'St_eve',
      'St-eve',
      'Steve#1234',
      'A123',
      'Abcdefghijklmnop',
      'Abcdefghijklmnop#12345',
    ];
    for (const handle of validHandles) {
      (dto as any).handle = handle;
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    }
  });

  it('should fail if it does not start with a letter', async () => {
    (dto as any).handle = '1steve';
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('matches');
  });

  it('should fail if too short', async () => {
    (dto as any).handle = 'St';
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should fail if too long (without hash)', async () => {
    (dto as any).handle = 'Abcdefghijklmnopq'; // 17 chars
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should fail if hashtag has too few numbers', async () => {
    (dto as any).handle = 'Steve#123';
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should fail with invalid characters', async () => {
    (dto as any).handle = 'Steve@';
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('FindAccountsQueryDto Validation', () => {
  const validateQuery = (
    values: Record<string, unknown>,
  ): Promise<ValidationError[]> => {
    const dto = new FindAccountsQueryDto();
    Object.assign(dto, values);

    return validate(dto);
  };

  // The list endpoint is reachable without any ordering, in which case the
  // service applies its own defaults.
  it('should accept an empty query', async () => {
    const errors = await validateQuery({});

    expect(errors.length).toBe(0);
  });

  it('should accept every supported sort field', async () => {
    for (const sortBy of Object.values(AccountSortBy)) {
      const errors = await validateQuery({ sortBy });

      expect(errors.length).toBe(0);
    }
  });

  it('should accept both sort directions', async () => {
    for (const sortOrder of Object.values(AccountSortOrder)) {
      const errors = await validateQuery({ sortOrder });

      expect(errors.length).toBe(0);
    }
  });

  it('should reject an unknown sort field', async () => {
    const errors = await validateQuery({ sortBy: 'email' });

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('isEnum');
  });

  it('should reject an unknown sort direction', async () => {
    const errors = await validateQuery({ sortOrder: 'sideways' });

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('isEnum');
  });

  // Ordering is case-sensitive on the wire, so a lower-case direction is a
  // client bug worth reporting rather than quietly coercing.
  it('should reject a lower-case sort direction', async () => {
    const errors = await validateQuery({ sortOrder: 'asc' });

    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('UpdateAccountPinDto Validation', () => {
  const validatePin = (
    values: Record<string, unknown>,
  ): Promise<ValidationError[]> => {
    const dto = new UpdateAccountPinDto();
    Object.assign(dto, values);

    return validate(dto);
  };

  it('should accept pinning and unpinning', async () => {
    for (const pinned of [true, false]) {
      const errors = await validatePin({ pinned });

      expect(errors.length).toBe(0);
    }
  });

  it('should reject a missing pinned flag', async () => {
    const errors = await validatePin({});

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('isBoolean');
  });

  // A string would otherwise make "false" pin the account.
  it('should reject a stringified boolean', async () => {
    const errors = await validatePin({ pinned: 'false' });

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('isBoolean');
  });
});
