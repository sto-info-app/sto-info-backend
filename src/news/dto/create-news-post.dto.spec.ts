import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { NewsStatus } from '../enums/news-status.enum';
import { CreateNewsPostDto } from './create-news-post.dto';

describe('CreateNewsPostDto', () => {
  it('accepts a minimal valid payload', async () => {
    const dto = plainToInstance(CreateNewsPostDto, {
      title: 'Release 1.0',
      body: 'Notes here',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts an explicit valid slug and status', async () => {
    const dto = plainToInstance(CreateNewsPostDto, {
      title: 'T',
      body: 'b',
      slug: 'release-1-0',
      status: NewsStatus.PUBLISHED,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects an invalid slug', async () => {
    const dto = plainToInstance(CreateNewsPostDto, {
      title: 'T',
      body: 'b',
      slug: 'Not a Slug',
    });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('rejects missing required fields', async () => {
    const dto = plainToInstance(CreateNewsPostDto, {});
    expect(await validate(dto)).not.toHaveLength(0);
  });
});
