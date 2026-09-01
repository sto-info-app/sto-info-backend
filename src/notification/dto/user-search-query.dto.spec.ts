import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UserSearchQueryDto } from './user-search-query.dto';
import {
  UserSearchPageDto,
  UserSearchResultDto,
} from './user-search-result.dto';

describe('UserSearchQueryDto', () => {
  it('validates a valid search query with trimmed term', async () => {
    const dto = plainToInstance(UserSearchQueryDto, {
      q: '  kirk  ',
      page: '2',
      pageSize: '10',
    });
    expect(dto.q).toBe('kirk');
    expect(dto.page).toBe(2);
    expect(dto.pageSize).toBe(10);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('keeps non-string q as-is', async () => {
    const dto = plainToInstance(UserSearchQueryDto, {
      q: 123,
    });
    expect(dto.q).toBe(123 as any);
  });

  it('validates with optional page and pageSize omitted', async () => {
    const dto = plainToInstance(UserSearchQueryDto, {
      q: 'spock',
    });
    expect(dto.page).toBeUndefined();
    expect(dto.pageSize).toBeUndefined();
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects short q', async () => {
    const dto = plainToInstance(UserSearchQueryDto, {
      q: 'a',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects pageSize greater than 20', async () => {
    const dto = plainToInstance(UserSearchQueryDto, {
      q: 'scotty',
      pageSize: 25,
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects page less than 1', async () => {
    const dto = plainToInstance(UserSearchQueryDto, {
      q: 'uhura',
      page: 0,
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('UserSearchResultDto and UserSearchPageDto', () => {
  it('instantiates UserSearchResultDto and UserSearchPageDto', () => {
    const item = new UserSearchResultDto();
    item.id = 'u1';
    item.username = 'kirk';
    item.email = 'kirk@ufp.org';

    const page = new UserSearchPageDto();
    page.items = [item];
    page.total = 1;
    page.page = 1;
    page.pageSize = 5;

    expect(page.items[0].username).toBe('kirk');
    expect(page.total).toBe(1);
  });
});
