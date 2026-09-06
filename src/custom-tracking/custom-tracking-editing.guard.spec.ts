import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { jest } from '@jest/globals';

import { CUSTOM_TRACKING_FEATURE_FLAGS } from './constants/custom-tracking-feature.constants';
import { CustomTrackingEditingGuard } from './custom-tracking-editing.guard';
import { CustomTrackingFeatureService } from './custom-tracking-feature.service';
import { CustomTrackingPolicyService } from './policy/custom-tracking-policy.service';

describe('CustomTrackingEditingGuard', () => {
  let guard: CustomTrackingEditingGuard;
  let assertFlagEnabled: jest.Mock<() => Promise<void>>;
  let assertAccepted: jest.Mock<(userId: string) => Promise<void>>;

  beforeEach(() => {
    assertFlagEnabled = jest.fn<() => Promise<void>>().mockResolvedValue();
    assertAccepted = jest
      .fn<(userId: string) => Promise<void>>()
      .mockResolvedValue();

    guard = new CustomTrackingEditingGuard(
      { assertFlagEnabled } as unknown as CustomTrackingFeatureService,
      { assertAccepted } as unknown as CustomTrackingPolicyService,
    );
  });

  const contextFor = (user: unknown): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  it('lets a request through when the feature is on and the terms accepted', async () => {
    await expect(guard.canActivate(contextFor({ id: 'user-1' }))).resolves.toBe(
      true,
    );

    expect(assertFlagEnabled).toHaveBeenCalledWith(
      CUSTOM_TRACKING_FEATURE_FLAGS.DEFINITION_EDITING_ENABLED,
    );
    expect(assertAccepted).toHaveBeenCalledWith('user-1');
  });

  it('reads the user from either shape the token produces', async () => {
    await guard.canActivate(contextFor({ userId: 'user-2' }));

    expect(assertAccepted).toHaveBeenCalledWith('user-2');
  });

  // Asking somebody to agree to terms for a feature that is switched off would
  // be strange, and would reveal that it is coming.
  it('checks the capability before the agreement', async () => {
    assertFlagEnabled.mockRejectedValue(new NotFoundException());

    await expect(
      guard.canActivate(contextFor({ id: 'user-1' })),
    ).rejects.toThrow(NotFoundException);
    expect(assertAccepted).not.toHaveBeenCalled();
  });

  it('stops a request whose user has not accepted the agreement', async () => {
    assertAccepted.mockRejectedValue(new ForbiddenException('agree first'));

    await expect(
      guard.canActivate(contextFor({ id: 'user-1' })),
    ).rejects.toThrow('agree first');
  });

  it.each([
    ['no user at all', undefined],
    ['a user with no identifier', {}],
  ])('refuses a request with %s', async (_description, user) => {
    await expect(guard.canActivate(contextFor(user))).rejects.toThrow(
      BadRequestException,
    );
  });
});
