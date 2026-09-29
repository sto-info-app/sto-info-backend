import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { In, IsNull, LessThan, Not, Repository } from 'typeorm';

import { CLOSED_ACCOUNT_RETENTION_DAYS } from 'src/cron/constants/cron.constants';
import { CustomTrackingPurgeService } from 'src/custom-tracking/retention/custom-tracking-purge.service';
import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { FileAssetKind } from 'src/file-assets/enums/file-asset-kind.enum';
import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';
import { AssetWithdrawalService } from 'src/file-assets/services/asset-withdrawal.service';
import { ModerationHoldEntity } from 'src/fleet/chat/holds/moderation-hold.entity';
import { ModerationHoldKind } from 'src/fleet/chat/holds/moderation-hold.enums';
import { AccountEntity } from 'src/sto/account/entities/account.entity';
import { UserRefreshTokenEntity } from 'src/user-refresh-token/entities/user-refresh-token.entity';
import {
  ACCOUNT_DEPARTURE,
  AccountDeparture,
} from 'src/user/account-departure';
import { UserProfileEntity } from 'src/user/entities/user-profile.entity';
import { UserEntity } from 'src/user/entities/user.entity';

/** The pictures that are a person's own, and go with their account. */
const PERSONAL_IMAGES: readonly FileAssetKind[] = [
  FileAssetKind.PROFILE_IMAGE,
  FileAssetKind.CHARACTER_IMAGE,
  FileAssetKind.STORYTIME_IMAGE,
];

/** The asset states with nothing left to withdraw. */
const GONE: readonly FileAssetState[] = [
  FileAssetState.DELETED,
  FileAssetState.REVOKED,
  FileAssetState.REJECTED,
];

/** Why an erased account's pictures were withdrawn. */
const ERASED_REASON = 'The account was erased';

@Injectable()
export class UserAccountCleanupService {
  private readonly _logger = new Logger(UserAccountCleanupService.name);

  /**
   * Creates an instance of UserAccountCleanupService.
   *
   * @param _userRepository - User repository.
   * @param _userProfileRepository - User profile repository.
   * @param _userRefreshTokenRepository - User refresh token repository.
   * @param _accountRepository - Account repository.
   * @param _customTracking - Removes their Custom Tracking data, including the
   *   pictures a database cascade cannot reach.
   * @param _withdrawal - Takes down their own pictures (FC-038).
   * @param _departure - Hands on or closes any Community they still own
   *   (FC-038), when the Fleet is there to ask.
   */
  constructor(
    @InjectRepository(UserEntity)
    private readonly _userRepository: Repository<UserEntity>,

    @InjectRepository(UserProfileEntity)
    private readonly _userProfileRepository: Repository<UserProfileEntity>,

    @InjectRepository(UserRefreshTokenEntity)
    private readonly _userRefreshTokenRepository: Repository<UserRefreshTokenEntity>,

    @InjectRepository(AccountEntity)
    private readonly _accountRepository: Repository<AccountEntity>,

    private readonly _customTracking: CustomTrackingPurgeService,

    private readonly _withdrawal: AssetWithdrawalService,

    @Optional()
    @Inject(ACCOUNT_DEPARTURE)
    private readonly _departure?: AccountDeparture,
  ) {}

  /**
   * Permanently deletes soft-deleted user records older than the configured
   * retention threshold.
   */
  async cleanup(): Promise<void> {
    const thresholdDate = new Date();
    thresholdDate.setDate(
      thresholdDate.getDate() - CLOSED_ACCOUNT_RETENTION_DAYS,
    );

    const usersToDelete = await this._userRepository.find({
      where: { deletedAt: LessThan(thresholdDate) },
      withDeleted: true,
      select: { id: true },
    });
    const kept = await this.keptBack(usersToDelete.map(user => user.id));
    const userIds: string[] = [];

    for (const { id } of usersToDelete) {
      if (!kept.has(id) && (await this.departed(id))) {
        userIds.push(id);
      }
    }

    if (kept.size > 0) {
      this._logger.warn(
        `Kept ${kept.size} closed account(s) whose chat messages are held, ` +
          'until each hold is released.',
      );
    }

    if (!userIds.length) {
      this._logger.log(
        `No closed accounts eligible for hard deletion (threshold: ${CLOSED_ACCOUNT_RETENTION_DAYS} days).`,
      );
      return;
    }

    await this.withdrawPictures(userIds);

    // Custom Tracking first. Its foreign keys would take the rows with the
    // user, but the pictures those rows point at live in Cloudflare, and a
    // cascade has no way to queue them for deletion. Doing it here, before the
    // references disappear, is what stops a closed account leaving images
    // behind that nothing will ever look for again.
    const purged = await this._customTracking.purgeUsers(userIds);

    this._logger.log(
      `Removed custom tracking data for ${userIds.length} closed account(s): ` +
        `${purged.sections} section(s), ${purged.fields} field(s), ` +
        `${purged.values} value(s), ${purged.images} image(s) queued.`,
    );

    // Purge dependent records with non-cascading FKs first.
    await this._userRefreshTokenRepository
      .createQueryBuilder()
      .delete()
      .where('"userId" IN (:...userIds)', { userIds })
      .execute();

    await this._userProfileRepository
      .createQueryBuilder()
      .delete()
      .where('"userId" IN (:...userIds)', { userIds })
      .execute();

    // Account rows are cascade-linked to user and remove characters/endeavour
    // rows automatically at the DB level on hard delete.
    await this._accountRepository
      .createQueryBuilder()
      .delete()
      .where('"userId" IN (:...userIds)', { userIds })
      .execute();

    await this._userRepository
      .createQueryBuilder()
      .delete()
      .where('id IN (:...userIds)', { userIds })
      .execute();

    this._logger.log(
      `Hard deleted ${userIds.length} closed user account(s) older than ${CLOSED_ACCOUNT_RETENTION_DAYS} days.`,
    );
  }

  /**
   * The closed accounts that cannot go yet (FC-037, FC-038).
   *
   * One whose chat messages a site admin holds would lose them to the next
   * chat purge, which forgets messages with no author, so it waits until the
   * hold is released (Steve's decision of 29 September 2026).
   *
   * @param userIds - The accounts due.
   * @returns Those to keep.
   */
  private async keptBack(userIds: readonly string[]): Promise<Set<string>> {
    if (!userIds.length) {
      return new Set();
    }

    const held = await this._userRepository.manager.find(ModerationHoldEntity, {
      where: {
        kind: ModerationHoldKind.MEMBER_MESSAGES,
        subjectUserId: In([...userIds]),
        releasedAt: IsNull(),
      },
      select: { id: true, subjectUserId: true },
    });

    return new Set(held.map(hold => hold.subjectUserId as string));
  }

  /**
   * Hands on or closes any open Community an account still owns, as closing
   * it would have (FC-038): an account closed before that, or one whose
   * Admins could not take it then. A Community closed stays the account's
   * until the delete, which leaves it with no Owner.
   *
   * @param userId - The account.
   * @returns False, logged, when it could not, so the account waits.
   */
  private async departed(userId: string): Promise<boolean> {
    try {
      await this._departure?.depart(userId);

      return true;
    } catch (error) {
      this._logger.error(
        `Closed account kept: its Communities could not be handed on - ` +
          `UserId: ${userId}`,
        error instanceof Error ? error.stack : String(error),
      );

      return false;
    }
  }

  /**
   * Takes down the pictures that are each account's own: its profile
   * picture, its Characters' portraits and its Storytime artwork (FC-038).
   * The rows that pointed at them go with the account; without this the
   * objects would stay. A picture that cannot be taken down is logged and
   * left for its record, not allowed to stop the erasure.
   *
   * @param userIds - The accounts.
   */
  private async withdrawPictures(userIds: readonly string[]): Promise<void> {
    const pictures = await this._userRepository.manager.find(FileAssetEntity, {
      where: {
        ownerUserId: In([...userIds]),
        kind: In([...PERSONAL_IMAGES]),
        state: Not(In([...GONE])),
        deliveryReference: Not(IsNull()),
      },
      select: { id: true, deliveryReference: true },
    });
    let withdrawn = 0;

    for (const picture of pictures) {
      try {
        await this._withdrawal.withdrawByReference(
          picture.deliveryReference as string,
          ERASED_REASON,
        );
        withdrawn++;
      } catch (error) {
        this._logger.error(
          `Picture not withdrawn - AssetId: ${picture.id}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    this._logger.log(
      `Withdrew ${withdrawn} of ${pictures.length} picture(s) of closed ` +
        'account(s).',
    );
  }
}
