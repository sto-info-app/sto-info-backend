import { jest } from '@jest/globals';
import { IsNull, Not, Repository } from 'typeorm';

import { StoArmadaEntity } from '../entities/sto-armada.entity';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { platformSlugRequest } from './platform-slug.utility';

describe('platformSlugRequest', () => {
  const scope = {
    targetType: FleetScopeKind.ARMADA,
    communityId: 'community-1',
    platformId: 'platform-1',
  };

  let count: jest.Mock<(options: unknown) => Promise<number>>;
  let repository: Repository<StoArmadaEntity>;

  beforeEach(() => {
    count = jest.fn<(options: unknown) => Promise<number>>();
    repository = { count } as unknown as Repository<StoArmadaEntity>;
  });

  it('carries the scope and the wish into the request', () => {
    const request = platformSlugRequest(
      scope,
      { desiredSlug: 'sol', name: 'Sol Armada', targetId: 'armada-1' },
      repository,
    );

    expect(request).toEqual({
      ...scope,
      desiredSlug: 'sol',
      name: 'Sol Armada',
      targetId: 'armada-1',
      isTakenByLiveScope: expect.any(Function),
    });
  });

  it('counts live records in the same Community and platform', async () => {
    count.mockResolvedValue(1);

    const request = platformSlugRequest(scope, { name: 'Sol' }, repository);

    await expect(request.isTakenByLiveScope('sol')).resolves.toBe(true);
    expect(count).toHaveBeenCalledWith({
      where: {
        communityId: 'community-1',
        platformId: 'platform-1',
        slug: 'sol',
        deletedAt: IsNull(),
      },
    });
  });

  it('lets the record being renamed keep its own slug', async () => {
    count.mockResolvedValue(0);

    const request = platformSlugRequest(
      scope,
      { name: 'Sol', targetId: 'armada-1' },
      repository,
    );

    await expect(request.isTakenByLiveScope('sol')).resolves.toBe(false);
    expect(count).toHaveBeenCalledWith({
      where: {
        communityId: 'community-1',
        platformId: 'platform-1',
        slug: 'sol',
        deletedAt: IsNull(),
        id: Not('armada-1'),
      },
    });
  });
});
