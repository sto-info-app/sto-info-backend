import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { FleetAuthorisationService } from './fleet-authorisation.service';
import {
  REQUIRES_SCOPE_CAPABILITY_KEY,
  ScopeCapabilityRequirement,
} from './requires-scope-capability.decorator';
import { ScopeRef } from './scope-authorisation.interface';

/** Minimal shape of the request the guard reads. */
interface ScopedRequest {
  user?: { id?: string; userId?: string };
  params?: Record<string, string | undefined>;
}

/**
 * Enforces the scoped capability declared by {@link RequiresScopeCapability}.
 *
 * The guard is deliberately thin. It finds the scope in the route, finds the
 * caller on the request, and asks {@link FleetAuthorisationService}; it decides
 * nothing itself. Chat and presence sockets will call the same method with the
 * scope they have, so REST and socket checks cannot drift apart — FC-005's
 * fourth acceptance criterion is met by there being one decision, not two that
 * are reviewed together.
 *
 * When no requirement is declared the guard is a no-op, matching
 * {@link PermissionsGuard} and the roles guard.
 */
@Injectable()
export class ScopeCapabilityGuard implements CanActivate {
  private readonly _logger = new Logger(ScopeCapabilityGuard.name);

  /**
   * Creates an instance of ScopeCapabilityGuard.
   *
   * @param _reflector - Used to read the requirement from handlers/controllers.
   * @param _authorisationService - Decides whether the caller holds it.
   */
  constructor(
    private readonly _reflector: Reflector,
    private readonly _authorisationService: FleetAuthorisationService,
  ) {}

  /**
   * Determines whether the current request satisfies the declared capability.
   *
   * @param context - The execution context.
   * @returns True when access is permitted.
   * @throws NotFoundException when the scope does not resolve, which includes a
   *   scope that belongs to a different Community than the route claimed.
   * @throws ForbiddenException when the route is misconfigured, or the caller
   *   does not hold the capability.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement =
      this._reflector.getAllAndOverride<ScopeCapabilityRequirement>(
        REQUIRES_SCOPE_CAPABILITY_KEY,
        [context.getHandler(), context.getClass()],
      );

    if (!requirement) {
      return true;
    }

    const request = context.switchToHttp().getRequest<ScopedRequest>();
    const scopeRef = this.readScopeRef(requirement, request);

    if (scopeRef === null) {
      // A route that declares a scope parameter it does not have is a
      // programming error, and the only safe way to fail is closed and loudly.
      // Letting the request through because the guard could not work out what
      // to check would turn a typo into an unprotected endpoint.
      this._logger.error(
        `Route declares '${String(requirement.capability)}' on parameter '${requirement.source.param}', which the request does not carry`,
      );
      throw new ForbiddenException('Insufficient permissions');
    }

    // Same precedence as the UserId decorator and PermissionsGuard, so the
    // guard and the handler can never disagree about who is acting.
    const userId = request.user?.id ?? request.user?.userId ?? null;

    await this._authorisationService.assertCapability(
      userId,
      scopeRef,
      requirement.capability,
    );

    return true;
  }

  /**
   * Builds the scope reference from the route parameters.
   *
   * @param requirement - The declared requirement.
   * @param request - The incoming request.
   * @returns The scope reference, or null when the route does not carry it.
   */
  private readScopeRef(
    requirement: ScopeCapabilityRequirement,
    request: ScopedRequest,
  ): ScopeRef | null {
    const id = request.params?.[requirement.source.param];

    if (id === undefined || id === '') {
      return null;
    }

    const { communityParam } = requirement.source;

    if (communityParam === undefined) {
      return { kind: requirement.source.kind, id };
    }

    const withinCommunityId = request.params?.[communityParam];

    if (withinCommunityId === undefined || withinCommunityId === '') {
      return null;
    }

    return { kind: requirement.source.kind, id, withinCommunityId };
  }
}
