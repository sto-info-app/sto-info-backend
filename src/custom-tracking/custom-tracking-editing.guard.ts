import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';

import {
  CUSTOM_TRACKING_FEATURE_FLAGS,
  CustomTrackingFeatureFlag,
} from './constants/custom-tracking-feature.constants';
import { CustomTrackingFeatureService } from './custom-tracking-feature.service';
import { CustomTrackingPolicyService } from './policy/custom-tracking-policy.service';

/** Minimal shape of the authenticated user attached to the request. */
interface RequestWithUser {
  user?: { id?: string; userId?: string };
}

/**
 * Requires the capability to be available and the agreement to have been
 * accepted, before anything is created or changed.
 *
 * A guard rather than two calls at the top of every handler. There are sixteen
 * of them across the hierarchy and the value editor, and a check repeated
 * sixteen times is a check that will eventually be missing from one — which
 * would be a route letting a user create content under terms they had never
 * agreed to.
 *
 * Reading is deliberately not guarded this way. A user whose acceptance has
 * been superseded keeps full sight of everything they have already recorded.
 *
 * Abstract because definitions and values are separately switchable: an
 * environment may want the builder frozen while values stay editable, or the
 * reverse during an incident. The two subclasses differ only in which flag
 * they name, which is the one thing that actually varies.
 */
@Injectable()
export abstract class CustomTrackingEditingGuardBase implements CanActivate {
  /**
   * Creates an instance of CustomTrackingEditingGuardBase.
   *
   * @param _features - Whether the capability is switched on.
   * @param _policy - Whether the user has accepted the current agreement.
   */
  constructor(
    private readonly _features: CustomTrackingFeatureService,
    private readonly _policy: CustomTrackingPolicyService,
  ) {}

  /**
   * The capability this guard requires.
   */
  protected abstract get flag(): CustomTrackingFeatureFlag;

  /**
   * Decides whether the request may proceed.
   *
   * The capability is checked first. A user who has not accepted the agreement
   * should be told so, but only once they are somewhere the feature exists at
   * all — asking somebody to agree to terms for something that is switched off
   * would be a strange thing to do, and would reveal that it is coming.
   *
   * @param context - The request being handled.
   * @returns True when the request may proceed.
   * @throws NotFoundException when the capability is unavailable.
   * @throws ForbiddenException when the agreement has not been accepted.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this._features.assertFlagEnabled(this.flag);
    await this._policy.assertAccepted(this.userIdOf(context));

    return true;
  }

  /**
   * Reads the authenticated user from the request.
   *
   * @param context - The request being handled.
   * @returns The user's identifier.
   * @throws BadRequestException when the request carries no user.
   */
  private userIdOf(context: ExecutionContext): string {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const userId = request?.user?.id ?? request?.user?.userId;

    if (!userId) {
      throw new BadRequestException('User not found');
    }

    return userId;
  }
}

/**
 * Guards the definition builder.
 */
@Injectable()
export class CustomTrackingEditingGuard extends CustomTrackingEditingGuardBase {
  /**
   * The capability this guard requires.
   *
   * @returns The definition-editing capability.
   */
  protected get flag(): CustomTrackingFeatureFlag {
    return CUSTOM_TRACKING_FEATURE_FLAGS.DEFINITION_EDITING_ENABLED;
  }
}
