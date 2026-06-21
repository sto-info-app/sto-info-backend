import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';

describe('OptionalJwtAuthGuard', () => {
  const guard = new OptionalJwtAuthGuard();

  it('returns the authenticated user when present', () => {
    const user = { id: 'user-1' };
    expect(guard.handleRequest(null, user)).toBe(user);
  });

  it('returns null for an anonymous request even when an error occurred', () => {
    expect(guard.handleRequest(new Error('no token'), undefined)).toBeNull();
  });

  it('returns null when there is no user and no error', () => {
    expect(guard.handleRequest(null, undefined)).toBeNull();
  });
});
