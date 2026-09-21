import { ExecutionContext } from '@nestjs/common';

import { UserRole } from 'src/user/enums/user-role.enum';

import { getCallerRoleFromContext } from './user-role.decorator';

/**
 * Builds an execution context carrying whatever request is given.
 *
 * @param request - The request the context should hand back.
 * @returns The context.
 */
function contextFor(request: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('CallerRole decorator', () => {
  it('reads the role off an authenticated request', () => {
    const context = contextFor({ user: { id: 'u1', role: UserRole.ADMIN } });

    expect(getCallerRoleFromContext(undefined, context)).toBe(UserRole.ADMIN);
  });

  /**
   * Null rather than a throw, because this widens what a caller may do
   * rather than deciding whether they may be here at all. A route using it
   * has already been guarded, or is deliberately open.
   */
  it.each([
    ['an anonymous request', {}],
    ['a user with no role', { user: {} }],
    ['no request at all', undefined],
  ])('reports no role for %s', (_name, request) => {
    expect(getCallerRoleFromContext(undefined, contextFor(request))).toBeNull();
  });
});
