import {
  ExecutionContext,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetAudienceService } from './fleet-audience.service';
import { FleetAuthorisationService } from './fleet-authorisation.service';
import { FLEET_CAPABILITIES } from './fleet-capability.constants';
import { ScopeCapabilityRequirement } from './requires-scope-capability.decorator';
import { ScopeCapabilityGuard } from './scope-capability.guard';

describe('ScopeCapabilityGuard', () => {
  let guard: ScopeCapabilityGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let authorisation: { assertCapability: jest.Mock };
  let audience: { canViewScope: jest.Mock };

  /**
   * Builds an execution context around a request.
   *
   * @param request - The request the guard will read.
   * @returns The context.
   */
  const contextFor = (request: unknown): ExecutionContext =>
    ({
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;

  const requirement: ScopeCapabilityRequirement = {
    capability: FLEET_CAPABILITIES.ROSTER_IMPORT,
    source: { kind: FleetScopeKind.FLEET, param: 'fleetId' },
  };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    authorisation = { assertCapability: jest.fn().mockResolvedValue({}) };
    audience = { canViewScope: jest.fn().mockResolvedValue(true) };
    guard = new ScopeCapabilityGuard(
      reflector as unknown as Reflector,
      authorisation as unknown as FleetAuthorisationService,
      audience as unknown as FleetAudienceService,
    );
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('lets a request through when no capability is declared', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    await expect(guard.canActivate(contextFor({}))).resolves.toBe(true);
    expect(authorisation.assertCapability).not.toHaveBeenCalled();
  });

  it('asks the policy about the scope the route names', async () => {
    reflector.getAllAndOverride.mockReturnValue(requirement);

    await expect(
      guard.canActivate(
        contextFor({ user: { id: 'user-1' }, params: { fleetId: 'fleet-1' } }),
      ),
    ).resolves.toBe(true);

    expect(authorisation.assertCapability).toHaveBeenCalledWith(
      'user-1',
      { kind: FleetScopeKind.FLEET, id: 'fleet-1' },
      FLEET_CAPABILITIES.ROSTER_IMPORT,
    );
  });

  it('falls back to the userId the JWT strategy attaches', async () => {
    reflector.getAllAndOverride.mockReturnValue(requirement);

    await guard.canActivate(
      contextFor({
        user: { userId: 'user-2' },
        params: { fleetId: 'fleet-1' },
      }),
    );

    expect(authorisation.assertCapability).toHaveBeenCalledWith(
      'user-2',
      expect.anything(),
      expect.anything(),
    );
  });

  it('asks about an anonymous caller rather than refusing outright', async () => {
    reflector.getAllAndOverride.mockReturnValue(requirement);

    await guard.canActivate(contextFor({ params: { fleetId: 'fleet-1' } }));

    expect(authorisation.assertCapability).toHaveBeenCalledWith(
      null,
      expect.anything(),
      expect.anything(),
    );
  });

  it('passes alternatives on for the policy to weigh', async () => {
    reflector.getAllAndOverride.mockReturnValue({
      ...requirement,
      capability: [
        FLEET_CAPABILITIES.ROSTER_IMPORT,
        FLEET_CAPABILITIES.ROSTER_INVESTIGATE,
      ],
    });

    await guard.canActivate(
      contextFor({ user: { id: 'user-1' }, params: { fleetId: 'fleet-1' } }),
    );

    expect(authorisation.assertCapability).toHaveBeenCalledWith(
      'user-1',
      expect.anything(),
      [FLEET_CAPABILITIES.ROSTER_IMPORT, FLEET_CAPABILITIES.ROSTER_INVESTIGATE],
    );
  });

  it('passes the claimed Community on a nested route', async () => {
    reflector.getAllAndOverride.mockReturnValue({
      capability: FLEET_CAPABILITIES.ROSTER_IMPORT,
      source: {
        kind: FleetScopeKind.FLEET,
        param: 'fleetId',
        communityParam: 'communityId',
      },
    });

    await guard.canActivate(
      contextFor({
        user: { id: 'user-1' },
        params: { fleetId: 'fleet-1', communityId: 'community-1' },
      }),
    );

    expect(authorisation.assertCapability).toHaveBeenCalledWith(
      'user-1',
      {
        kind: FleetScopeKind.FLEET,
        id: 'fleet-1',
        withinCommunityId: 'community-1',
      },
      FLEET_CAPABILITIES.ROSTER_IMPORT,
    );
  });

  /**
   * A route that declares a parameter it does not carry is a typo, and the only
   * safe reading of a typo in an authorisation declaration is that nobody gets
   * through. Letting the request past because the guard could not tell what to
   * check is how a misconfigured endpoint ends up unprotected.
   */
  it.each([
    ['a missing scope parameter', { params: {} }],
    ['an empty scope parameter', { params: { fleetId: '' } }],
    ['no parameters at all', {}],
  ])('refuses the request on %s', async (_name, request) => {
    reflector.getAllAndOverride.mockReturnValue(requirement);

    await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(authorisation.assertCapability).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing Community parameter', { fleetId: 'fleet-1' }],
    ['an empty Community parameter', { fleetId: 'fleet-1', communityId: '' }],
  ])('refuses a nested route with %s', async (_name, params) => {
    reflector.getAllAndOverride.mockReturnValue({
      capability: FLEET_CAPABILITIES.ROSTER_IMPORT,
      source: {
        kind: FleetScopeKind.FLEET,
        param: 'fleetId',
        communityParam: 'communityId',
      },
    });

    await expect(
      guard.canActivate(contextFor({ params })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('says which declaration was wrong when it refuses', async () => {
    reflector.getAllAndOverride.mockReturnValue(requirement);

    await expect(
      guard.canActivate(contextFor({ params: {} })),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining('fleetId'),
    );
  });

  it('lets the policy decide, rather than deciding itself', async () => {
    reflector.getAllAndOverride.mockReturnValue(requirement);
    authorisation.assertCapability.mockRejectedValue(
      new ForbiddenException('Insufficient permissions'),
    );

    await expect(
      guard.canActivate(contextFor({ params: { fleetId: 'fleet-1' } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  describe('wording a refusal', () => {
    const request = {
      user: { id: 'user-1' },
      params: { fleetId: 'fleet-1', communityId: 'community-1' },
    };

    beforeEach(() => {
      reflector.getAllAndOverride.mockReturnValue({
        capability: FLEET_CAPABILITIES.ROSTER_IMPORT,
        source: {
          kind: FleetScopeKind.FLEET,
          param: 'fleetId',
          communityParam: 'communityId',
        },
      });
      authorisation.assertCapability.mockRejectedValue(
        new ForbiddenException('Insufficient permissions'),
      );
    });

    // A 403 would confirm, to anybody holding the identifier, a Fleet that
    // the page tells the same person does not exist.
    it('tells somebody who may not see the scope that it does not exist', async () => {
      audience.canViewScope.mockResolvedValue(false);

      await expect(
        guard.canActivate(contextFor(request)),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(audience.canViewScope).toHaveBeenCalledWith(
        {
          kind: FleetScopeKind.FLEET,
          id: 'fleet-1',
          withinCommunityId: 'community-1',
        },
        'user-1',
      );
    });

    it('tells somebody who can see the scope that they may not do this', async () => {
      await expect(
        guard.canActivate(contextFor(request)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('passes on a scope that does not exist without asking again', async () => {
      authorisation.assertCapability.mockRejectedValue(
        new NotFoundException('Not found'),
      );

      await expect(
        guard.canActivate(contextFor(request)),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(audience.canViewScope).not.toHaveBeenCalled();
    });

    it('asks nothing about visibility when the capability is held', async () => {
      authorisation.assertCapability.mockResolvedValue({});

      await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
      expect(audience.canViewScope).not.toHaveBeenCalled();
    });
  });
});
