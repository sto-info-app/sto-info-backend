import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * JWT guard that authenticates the user when a valid token is present but lets
 * anonymous requests through instead of rejecting them.
 *
 * Use on endpoints that serve public data but enrich the response when the
 * caller is logged in (e.g. the polled app-state endpoint). When no/invalid
 * token is supplied, `req.user` is left undefined and the request proceeds.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  /**
   * Returns the authenticated user when one is resolved, otherwise `null`.
   *
   * Unlike the default implementation, a missing or invalid token never throws
   * — the request continues as an anonymous caller.
   *
   * @param _err - Any error raised by the strategy (ignored).
   * @param user - The resolved user, if authentication succeeded.
   * @returns The user, or `null` for anonymous requests.
   */
  handleRequest<TUser = unknown>(_err: unknown, user: TUser): TUser | null {
    return user ?? null;
  }
}
