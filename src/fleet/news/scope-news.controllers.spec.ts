import { BadRequestException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';

import { jest } from '@jest/globals';

import { NewsStatus } from 'src/news/enums/news-status.enum';

import { FLEET_CAPABILITIES } from '../authorisation/fleet-capability.constants';
import { REQUIRES_SCOPE_CAPABILITY_KEY } from '../authorisation/requires-scope-capability.decorator';
import { FleetAudience } from '../enums/fleet-audience.enum';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetFeatureService } from '../fleet-feature.service';
import {
  armadaScope,
  communityScope,
  fleetScope,
} from '../governance/utilities/governance-scope.utility';
import {
  ArmadaNewsController,
  CommunityNewsController,
  FleetNewsController,
} from './scope-news.controllers';
import { ScopeNewsService } from './services/scope-news.service';

const COMMUNITY_ID = '27000000-0000-4000-8000-000000000001';
const SCOPE_ID = '27000000-0000-4000-8000-000000000002';
const POST_ID = '27000000-0000-4000-8000-000000000003';
const USER_ID = '27000000-0000-4000-8000-000000000004';

/** The routes that change something, each needing news.write. */
const WRITING_ROUTES = [
  'create',
  'update',
  'publish',
  'unpublish',
  'remove',
  'setCover',
  'clearCover',
] as const;

/** Every kind of scope's controller, and what it should say about itself. */
const CASES = [
  {
    name: 'CommunityNewsController',
    type: CommunityNewsController,
    path: 'fleet-communities/:communityId/news',
    source: { kind: FleetScopeKind.COMMUNITY, param: 'communityId' },
    // A Community's routes name it once, and read it twice.
    scope: communityScope(COMMUNITY_ID),
    id: COMMUNITY_ID,
  },
  {
    name: 'FleetNewsController',
    type: FleetNewsController,
    path: 'fleet-communities/:communityId/fleets/:fleetId/news',
    source: {
      kind: FleetScopeKind.FLEET,
      param: 'fleetId',
      communityParam: 'communityId',
    },
    scope: fleetScope(COMMUNITY_ID, SCOPE_ID),
    id: SCOPE_ID,
  },
  {
    name: 'ArmadaNewsController',
    type: ArmadaNewsController,
    path: 'fleet-communities/:communityId/armadas/:armadaId/news',
    source: {
      kind: FleetScopeKind.ARMADA,
      param: 'armadaId',
      communityParam: 'communityId',
    },
    scope: armadaScope(COMMUNITY_ID, SCOPE_ID),
    id: SCOPE_ID,
  },
];

type Controller = InstanceType<typeof FleetNewsController>;

describe.each(CASES)('$name', ({ name, type, path, source, scope, id }) => {
  let feature: { assertEnabled: jest.Mock<() => Promise<void>> };
  let news: Record<
    | 'list'
    | 'read'
    | 'create'
    | 'update'
    | 'publish'
    | 'unpublish'
    | 'remove'
    | 'setCover'
    | 'clearCover',
    jest.Mock<(...args: unknown[]) => Promise<unknown>>
  >;
  let controller: Controller;

  beforeEach(() => {
    feature = { assertEnabled: jest.fn(async () => undefined) };
    news = {
      list: jest.fn(async () => 'page'),
      read: jest.fn(async () => 'view'),
      create: jest.fn(async () => 'created'),
      update: jest.fn(async () => 'updated'),
      publish: jest.fn(async () => 'published'),
      unpublish: jest.fn(async () => 'unpublished'),
      remove: jest.fn(async () => undefined),
      setCover: jest.fn(async () => 'accepted'),
      clearCover: jest.fn(async () => undefined),
    };
    controller = new type(
      feature as unknown as FleetFeatureService,
      news as unknown as ScopeNewsService,
    ) as Controller;
  });

  afterEach(() => {
    // Every route that reached the service asked whether the feature is on.
    if (Object.values(news).some(route => route.mock.calls.length > 0)) {
      expect(feature.assertEnabled).toHaveBeenCalled();
    }
  });

  it('is a controller of its own name, at its own address', () => {
    expect(type.name).toBe(name);
    expect(Reflect.getMetadata(PATH_METADATA, type)).toBe(path);
  });

  it.each(WRITING_ROUTES)(
    'keeps %s to holders of news.write at the scope',
    route => {
      expect(
        Reflect.getMetadata(
          REQUIRES_SCOPE_CAPABILITY_KEY,
          type.prototype[route],
        ),
      ).toEqual({ capability: FLEET_CAPABILITIES.NEWS_WRITE, source });
    },
  );

  it('leaves reading open to whoever may see the post', () => {
    for (const route of ['list', 'read'] as const) {
      expect(
        Reflect.getMetadata(
          REQUIRES_SCOPE_CAPABILITY_KEY,
          type.prototype[route],
        ),
      ).toBeUndefined();
    }
  });

  it('lists the scope’s news for the reader', async () => {
    const query = { q: 'refit', status: NewsStatus.PUBLISHED };

    await expect(controller.list(COMMUNITY_ID, id, null, query)).resolves.toBe(
      'page',
    );
    expect(news.list).toHaveBeenCalledWith(scope, null, query);
  });

  it('reads a post by its slug', async () => {
    await expect(
      controller.read(COMMUNITY_ID, id, 'refit-night', USER_ID),
    ).resolves.toBe('view');
    expect(news.read).toHaveBeenCalledWith(scope, 'refit-night', USER_ID);
  });

  it('writes a post', async () => {
    const dto = { title: 'T', body: 'B', audience: FleetAudience.COMMUNITY };

    await expect(
      controller.create(COMMUNITY_ID, id, dto, USER_ID),
    ).resolves.toBe('created');
    expect(news.create).toHaveBeenCalledWith(scope, dto, USER_ID);
  });

  it('changes a post', async () => {
    const dto = { title: 'New' };

    await expect(
      controller.update(COMMUNITY_ID, id, POST_ID, dto, USER_ID),
    ).resolves.toBe('updated');
    expect(news.update).toHaveBeenCalledWith(scope, POST_ID, dto, USER_ID);
  });

  it('publishes and unpublishes a post', async () => {
    await expect(
      controller.publish(COMMUNITY_ID, id, POST_ID, USER_ID),
    ).resolves.toBe('published');
    await expect(
      controller.unpublish(COMMUNITY_ID, id, POST_ID, USER_ID),
    ).resolves.toBe('unpublished');
    expect(news.publish).toHaveBeenCalledWith(scope, POST_ID, USER_ID);
    expect(news.unpublish).toHaveBeenCalledWith(scope, POST_ID, USER_ID);
  });

  it('deletes a post', async () => {
    await controller.remove(COMMUNITY_ID, id, POST_ID, USER_ID);

    expect(news.remove).toHaveBeenCalledWith(scope, POST_ID, USER_ID);
  });

  it('sends a cover to be scanned', async () => {
    const file = { originalname: 'cover.jpg' } as Express.Multer.File;

    await expect(
      controller.setCover(COMMUNITY_ID, id, POST_ID, USER_ID, file, {
        altText: 'A ship',
      }),
    ).resolves.toBe('accepted');
    expect(news.setCover).toHaveBeenCalledWith(scope, POST_ID, {
      userId: USER_ID,
      altText: 'A ship',
      file,
    });
  });

  it('refuses a cover upload with no file', async () => {
    await expect(
      controller.setCover(COMMUNITY_ID, id, POST_ID, USER_ID, undefined, {
        altText: 'A ship',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(news.setCover).not.toHaveBeenCalled();
  });

  it('takes a cover down', async () => {
    await controller.clearCover(COMMUNITY_ID, id, POST_ID, USER_ID);

    expect(news.clearCover).toHaveBeenCalledWith(scope, POST_ID, USER_ID);
  });
});
