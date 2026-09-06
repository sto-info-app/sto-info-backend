import { ExecutionContext } from '@nestjs/common';

import { jest } from '@jest/globals';

import { CUSTOM_TRACKING_FEATURE_FLAGS } from '../constants/custom-tracking-feature.constants';
import { CustomTrackingFeatureService } from '../custom-tracking-feature.service';
import { CustomTrackingPolicyService } from '../policy/custom-tracking-policy.service';
import { CustomTrackingValueEditingGuard } from './custom-tracking-value-editing.guard';

describe('CustomTrackingValueEditingGuard', () => {
  let guard: CustomTrackingValueEditingGuard;
  let assertFlagEnabled: jest.Mock<() => Promise<void>>;
  let assertAccepted: jest.Mock<(userId: string) => Promise<void>>;

  beforeEach(() => {
    assertFlagEnabled = jest.fn<() => Promise<void>>().mockResolvedValue();
    assertAccepted = jest
      .fn<(userId: string) => Promise<void>>()
      .mockResolvedValue();

    guard = new CustomTrackingValueEditingGuard(
      { assertFlagEnabled } as unknown as CustomTrackingFeatureService,
      { assertAccepted } as unknown as CustomTrackingPolicyService,
    );
  });

  const contextFor = (user: unknown): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  // The two guards exist separately so an environment can freeze the builder
  // while values stay editable, or the reverse during an incident. Naming the
  // right capability is the only thing that distinguishes them.
  it('requires the value-editing capability, not the definition one', async () => {
    await expect(guard.canActivate(contextFor({ id: 'user-1' }))).resolves.toBe(
      true,
    );

    expect(assertFlagEnabled).toHaveBeenCalledWith(
      CUSTOM_TRACKING_FEATURE_FLAGS.VALUE_EDITING_ENABLED,
    );
  });

  it('still requires the agreement to have been accepted', async () => {
    await guard.canActivate(contextFor({ id: 'user-1' }));

    expect(assertAccepted).toHaveBeenCalledWith('user-1');
  });
});
