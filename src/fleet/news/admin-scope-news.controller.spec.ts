import { jest } from '@jest/globals';

import { ROLES_KEY } from 'src/auth/roles.decorator';
import { UserRole } from 'src/user/enums/user-role.enum';

import { FleetFeatureService } from '../fleet-feature.service';
import { AdminScopeNewsController } from './admin-scope-news.controller';
import { ScopeNewsService } from './services/scope-news.service';

describe('AdminScopeNewsController', () => {
  let feature: { assertEnabled: jest.Mock<() => Promise<void>> };
  let news: {
    unpublishAsSiteAdmin: jest.Mock<(postId: string) => Promise<void>>;
    removeAsSiteAdmin: jest.Mock<(postId: string) => Promise<void>>;
  };
  let controller: AdminScopeNewsController;

  beforeEach(() => {
    feature = { assertEnabled: jest.fn(async () => undefined) };
    news = {
      unpublishAsSiteAdmin: jest.fn(async () => undefined),
      removeAsSiteAdmin: jest.fn(async () => undefined),
    };
    controller = new AdminScopeNewsController(
      feature as unknown as FleetFeatureService,
      news as unknown as ScopeNewsService,
    );
  });

  it('is for site administrators only', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminScopeNewsController)).toEqual([
      UserRole.ADMIN,
    ]);
  });

  it('unpublishes a scoped post', async () => {
    await controller.unpublish('post-1');

    expect(feature.assertEnabled).toHaveBeenCalled();
    expect(news.unpublishAsSiteAdmin).toHaveBeenCalledWith('post-1');
  });

  it('deletes a scoped post', async () => {
    await controller.remove('post-1');

    expect(feature.assertEnabled).toHaveBeenCalled();
    expect(news.removeAsSiteAdmin).toHaveBeenCalledWith('post-1');
  });
});
