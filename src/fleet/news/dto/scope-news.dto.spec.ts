import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { NewsStatus } from 'src/news/enums/news-status.enum';

import { FleetAudience } from '../../enums/fleet-audience.enum';
import {
  CreateScopeNewsPostDto,
  ScopeNewsQueryDto,
  UpdateScopeNewsPostDto,
} from './scope-news.dto';

/**
 * Lists the properties a payload fails on.
 *
 * @param type - The DTO.
 * @param payload - What was sent.
 * @returns The failing properties.
 */
async function failures<T extends object>(
  type: new () => T,
  payload: object,
): Promise<string[]> {
  const errors = await validate(plainToInstance(type, payload));

  return errors.map(error => error.property);
}

describe('Scope news DTOs', () => {
  it('trims a new post’s title and summary', () => {
    const dto = plainToInstance(CreateScopeNewsPostDto, {
      title: '  Refit night  ',
      summary: '  Bring ships  ',
      body: 'Friday.',
    });

    expect(dto.title).toBe('Refit night');
    expect(dto.summary).toBe('Bring ships');
  });

  it('accepts a post with no summary or audience', async () => {
    await expect(
      failures(CreateScopeNewsPostDto, { title: 'T', body: 'B' }),
    ).resolves.toEqual([]);
  });

  it('refuses a blank title or body, and a private audience', async () => {
    await expect(
      failures(CreateScopeNewsPostDto, {
        title: '   ',
        body: '',
        audience: FleetAudience.PRIVATE,
      }),
    ).resolves.toEqual(['title', 'body', 'audience']);
  });

  it('accepts each audience news may be published to', async () => {
    for (const audience of [
      FleetAudience.PUBLIC,
      FleetAudience.COMMUNITY,
      FleetAudience.FLEET_MEMBERS,
    ]) {
      await expect(
        failures(CreateScopeNewsPostDto, { title: 'T', body: 'B', audience }),
      ).resolves.toEqual([]);
    }
  });

  it('lets a change clear the summary, and refuses a blank title', async () => {
    await expect(
      failures(UpdateScopeNewsPostDto, { summary: null }),
    ).resolves.toEqual([]);
    await expect(
      failures(UpdateScopeNewsPostDto, { title: ' ' }),
    ).resolves.toEqual(['title']);
  });

  it('reads a page, a search and a status from the query string', async () => {
    const dto = plainToInstance(ScopeNewsQueryDto, {
      page: '2',
      pageSize: '20',
      q: '  refit ',
      status: NewsStatus.DRAFT,
    });

    expect(dto).toEqual({
      page: 2,
      pageSize: 20,
      q: 'refit',
      status: NewsStatus.DRAFT,
    });
    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('refuses an oversized page and an unknown status', async () => {
    await expect(
      failures(ScopeNewsQueryDto, { pageSize: '51', status: 'ARCHIVED' }),
    ).resolves.toEqual(['pageSize', 'status']);
  });
});
