import { validate } from 'class-validator';

import { CreateAccountRequestDto } from './create-account-request.dto';

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
