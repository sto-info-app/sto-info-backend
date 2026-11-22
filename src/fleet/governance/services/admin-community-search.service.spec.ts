import { beforeEach, describe, expect, it } from '@jest/globals';

import { UserProfileEntity } from 'src/user/entities/user-profile.entity';

import { InMemoryManager } from '../../../../test/in-memory-manager';
import { FleetCommunityEntity } from '../../entities/fleet-community.entity';
import { FleetAudience } from '../../enums/fleet-audience.enum';
import { FleetScopeStatus } from '../../enums/fleet-scope-status.enum';
import { AdminCommunitySearchService } from './admin-community-search.service';

/**
 * A live Community.
 *
 * @param id - Its identifier, which also names it.
 * @param overrides - What differs.
 * @returns The row.
 */
const community = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name: `Community ${id}`,
  slug: `community-${id}`,
  visibility: FleetAudience.PUBLIC,
  status: FleetScopeStatus.ACTIVE,
  ownerUserId: 'owner-1',
  deletedAt: null,
  ...overrides,
});

describe('AdminCommunitySearchService', () => {
  let db: InMemoryManager;
  let service: AdminCommunitySearchService;

  beforeEach(() => {
    db = new InMemoryManager()
      .seed(FleetCommunityEntity, [
        community('b', {
          name: 'Hidden Harbour',
          slug: 'hidden-harbour',
          visibility: FleetAudience.PRIVATE,
        }),
        community('a', {
          name: 'Members Moorings',
          slug: 'moorings',
          visibility: FleetAudience.COMMUNITY,
          status: FleetScopeStatus.SUSPENDED,
          ownerUserId: 'owner-2',
        }),
        community('c', {
          name: 'Open Orbit',
          slug: 'open-orbit',
          status: FleetScopeStatus.CLOSED,
          ownerUserId: null,
        }),
        community('d', {
          name: 'Hidden Gone',
          slug: 'hidden-gone',
          deletedAt: new Date('2026-09-01T00:00:00.000Z'),
        }),
        community('e', { name: '100% Fleet', slug: 'hundred-percent' }),
      ])
      .seed(UserProfileEntity, [{ userId: 'owner-1', username: 'Quark' }]);
    service = new AdminCommunitySearchService(db.asDataSource());
  });

  it('lists every live Community by name, whoever may see it and whatever its state', async () => {
    const page = await service.search();

    expect(page).toMatchObject({ total: 4, page: 1, pageSize: 20 });
    expect(page.items.map(each => each.name)).toEqual([
      '100% Fleet',
      'Hidden Harbour',
      'Members Moorings',
      'Open Orbit',
    ]);
    expect(page.items[1]).toEqual({
      id: 'b',
      name: 'Hidden Harbour',
      slug: 'hidden-harbour',
      visibility: FleetAudience.PRIVATE,
      status: FleetScopeStatus.ACTIVE,
      ownerUsername: 'Quark',
    });
  });

  it('names no Owner where there is none, or where they have no username', async () => {
    const { items } = await service.search();

    expect(items[2].ownerUsername).toBeNull();
    expect(items[3].ownerUsername).toBeNull();
  });

  it('finds by name or web address, whatever the case', async () => {
    const byName = await service.search('  HIDDEN ');
    const bySlug = await service.search('moorings');

    expect(byName.items.map(each => each.id)).toEqual(['b']);
    expect(bySlug.items.map(each => each.id)).toEqual(['a']);
  });

  it('takes a wildcard for itself', async () => {
    const { items } = await service.search('%');

    expect(items.map(each => each.id)).toEqual(['e']);
  });

  it('pages, keeping to the largest page allowed', async () => {
    const second = await service.search(undefined, 2, 2);
    const capped = await service.search(undefined, 1, 500);

    expect(second).toMatchObject({ total: 4, page: 2, pageSize: 2 });
    expect(second.items.map(each => each.id)).toEqual(['a', 'c']);
    expect(capped.pageSize).toBe(50);
  });
});
