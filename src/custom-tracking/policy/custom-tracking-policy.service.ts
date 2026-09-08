import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import {
  CUSTOM_TRACKING_AGREEMENT,
  CustomTrackingAgreement,
} from '../constants/custom-tracking-agreement.constants';
import {
  CUSTOM_TRACKING_POLICY_EFFECTIVE_DATE,
  CUSTOM_TRACKING_POLICY_UPDATED_DATE,
  CUSTOM_TRACKING_POLICY_VERSION,
} from '../constants/custom-tracking-policy.constants';
import { CustomTrackingPolicyAcceptanceEntity } from '../entities/custom-tracking-policy-acceptance.entity';

/**
 * Where a user stands with the content agreement.
 */
export interface CustomTrackingPolicyStatus {
  /** The version currently published. */
  currentVersion: string;
  /** When the current wording took effect. */
  effectiveDate: string;
  /** When the current wording was last changed. */
  updatedDate: string;
  /** The version the user last accepted, or null if they never have. */
  acceptedVersion: string | null;
  /** When they accepted it, or null. */
  acceptedAt: Date | null;
  /**
   * Whether they must accept before they may create or edit anything.
   *
   * True both for a user who has never accepted and for one whose acceptance
   * is against superseded wording. The interface needs to tell those apart to
   * word the prompt, which it does from `acceptedVersion`; what it needs from
   * this is the single answer to whether editing is locked.
   */
  acceptanceRequired: boolean;
}

/**
 * The content agreement, and who has accepted which version of it.
 *
 * Acceptance gates creation and editing, not reading. A user whose acceptance
 * has been superseded keeps full sight of everything they have already
 * recorded — locking them out of their own data to make a point about terms
 * would be a punishment rather than a safeguard — but may not add to it or
 * change it until they have read what changed and agreed again.
 */
@Injectable()
export class CustomTrackingPolicyService {
  /**
   * Creates an instance of CustomTrackingPolicyService.
   *
   * @param _acceptanceRepository - Repository of acceptance records.
   */
  constructor(
    @InjectRepository(CustomTrackingPolicyAcceptanceEntity)
    private readonly _acceptanceRepository: Repository<CustomTrackingPolicyAcceptanceEntity>,
  ) {}

  /**
   * Returns the agreement as a user should read it before accepting.
   *
   * @returns The current agreement wording, version and dates.
   */
  getAgreement(): CustomTrackingAgreement {
    return CUSTOM_TRACKING_AGREEMENT;
  }

  /**
   * Reports where a user stands with the agreement.
   *
   * @param userId - The user asking.
   * @returns Their acceptance status.
   */
  async getStatus(userId: string): Promise<CustomTrackingPolicyStatus> {
    const acceptance = await this._acceptanceRepository.findOne({
      where: { userId },
    });

    return {
      currentVersion: CUSTOM_TRACKING_POLICY_VERSION,
      effectiveDate: CUSTOM_TRACKING_POLICY_EFFECTIVE_DATE,
      updatedDate: CUSTOM_TRACKING_POLICY_UPDATED_DATE,
      acceptedVersion: acceptance?.policyVersion ?? null,
      acceptedAt: acceptance?.acceptedAt ?? null,
      acceptanceRequired:
        acceptance?.policyVersion !== CUSTOM_TRACKING_POLICY_VERSION,
    };
  }

  /**
   * Records a user's acceptance of the current agreement.
   *
   * The version the user was shown is required and must match the one
   * published. A page left open across a wording change would otherwise
   * record agreement to terms the user never saw, which is the one thing an
   * acceptance record exists to rule out.
   *
   * One row per user, updated in place. The audit trail already records every
   * change to it with its actor and timestamp, so the history is kept without
   * a second table that would grow for anybody who reads each new version.
   *
   * @param userId - The user accepting.
   * @param acceptedVersion - The version the interface displayed to them.
   * @returns Their acceptance status afterwards.
   * @throws ConflictException when the version shown is not the current one.
   */
  async accept(
    userId: string,
    acceptedVersion: string,
  ): Promise<CustomTrackingPolicyStatus> {
    if (acceptedVersion !== CUSTOM_TRACKING_POLICY_VERSION) {
      throw new ConflictException(
        'The agreement has changed since this page was opened. Please read it again before accepting.',
      );
    }

    const existing = await this._acceptanceRepository.findOne({
      where: { userId },
    });

    const acceptance =
      existing ??
      this._acceptanceRepository.create({
        userId,
      });

    acceptance.policyVersion = CUSTOM_TRACKING_POLICY_VERSION;
    acceptance.acceptedAt = new Date();
    acceptance.policyEffectiveDate = CUSTOM_TRACKING_POLICY_EFFECTIVE_DATE;
    acceptance.policyUpdatedDate = CUSTOM_TRACKING_POLICY_UPDATED_DATE;

    await this._acceptanceRepository.save(acceptance);

    return this.getStatus(userId);
  }

  /**
   * Requires that a user has accepted the current agreement.
   *
   * Called before anything is created or changed. Reading is deliberately not
   * gated.
   *
   * @param userId - The user attempting the change.
   * @throws ForbiddenException when they have not accepted the current
   *   version.
   */
  async assertAccepted(userId: string): Promise<void> {
    const status = await this.getStatus(userId);

    if (!status.acceptanceRequired) {
      return;
    }

    throw new ForbiddenException(
      status.acceptedVersion === null
        ? 'Accept the Custom Tracking content agreement before setting anything up.'
        : 'The Custom Tracking content agreement has changed. Read and accept it again before making changes. Everything you have already recorded is still here.',
    );
  }
}
