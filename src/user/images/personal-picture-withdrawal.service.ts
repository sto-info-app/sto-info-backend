import { Injectable, Logger } from '@nestjs/common';

import { FileAssetSlot } from 'src/file-assets/enums/file-asset-slot.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import { AssetWithdrawalService } from 'src/file-assets/services/asset-withdrawal.service';

/**
 * Why a profile picture or a Character's portrait was withdrawn, as the file
 * registry records it.
 */
export const PERSONAL_PICTURE_REASONS = {
  /** The member took it off themselves. */
  REMOVED: 'Removed by the owner',
  /** Its Character was deleted. */
  CHARACTER_DELETED: 'Its Character was deleted',
  /** The STO account its Character belonged to was deleted. */
  STO_ACCOUNT_DELETED: 'Its STO account was deleted',
  /** The member closed their account. */
  ACCOUNT_CLOSED: 'The account was closed',
} as const;

/** A profile picture or a Character's portrait, and where it sits. */
export interface PersonalPicture {
  /** The kind of record holding it. */
  readonly subject:
    FileAssetSubject.USER_PROFILE | FileAssetSubject.STO_CHARACTER;
  /** The user, for a profile picture, or the Character. */
  readonly subjectId: string;
  /** Its delivery reference. */
  readonly imageId: string;
}

/** Which slot each kind of record keeps its picture in. */
const SLOTS = {
  [FileAssetSubject.USER_PROFILE]: FileAssetSlot.PICTURE,
  [FileAssetSubject.STO_CHARACTER]: FileAssetSlot.PORTRAIT,
} as const;

/**
 * Withdraws a member's own pictures: their profile picture and their
 * Characters' portraits.
 *
 * Shared by the member removing one, deleting a Character, deleting an STO
 * account and closing their account, so each records its reason the same way
 * and a picture is always revoked in the registry and deleted from
 * Cloudflare rather than left to be served from its old address.
 */
@Injectable()
export class PersonalPictureWithdrawalService {
  private readonly _logger = new Logger(PersonalPictureWithdrawalService.name);

  /**
   * Creates an instance of PersonalPictureWithdrawalService.
   *
   * @param _withdrawal - Revokes, deletes and records the purge.
   */
  constructor(private readonly _withdrawal: AssetWithdrawalService) {}

  /**
   * A profile picture, when the profile holds one.
   *
   * @param userId - Whose profile.
   * @param imageId - What the profile held.
   * @returns The picture, or null when there was none.
   */
  static profilePicture(
    userId: string,
    imageId: string | null | undefined,
  ): PersonalPicture | null {
    return imageId
      ? { subject: FileAssetSubject.USER_PROFILE, subjectId: userId, imageId }
      : null;
  }

  /**
   * A Character's portrait, when it holds one.
   *
   * @param characterId - The Character.
   * @param imageId - What the Character held.
   * @returns The picture, or null when there was none.
   */
  static portrait(
    characterId: string,
    imageId: string | null | undefined,
  ): PersonalPicture | null {
    return imageId
      ? {
          subject: FileAssetSubject.STO_CHARACTER,
          subjectId: characterId,
          imageId,
        }
      : null;
  }

  /**
   * Withdraws one picture, throwing when it could not.
   *
   * @param picture - The picture.
   * @param reason - Why, as the registry records it.
   */
  async withdraw(picture: PersonalPicture, reason: string): Promise<void> {
    await this._withdrawal.withdrawSlot(
      picture.subject,
      picture.subjectId,
      SLOTS[picture.subject],
      picture.imageId,
      reason,
    );
  }

  /**
   * Withdraws each picture, carrying on past one that fails.
   *
   * For a deletion that has already happened: a picture that cannot be
   * withdrawn is logged rather than failing it, and the sweep at the next
   * start finds it again.
   *
   * @param pictures - The pictures; an empty slot is passed as null.
   * @param reason - Why, as the registry records it.
   * @returns How many were withdrawn.
   */
  async withdrawEach(
    pictures: ReadonlyArray<PersonalPicture | null>,
    reason: string,
  ): Promise<number> {
    let withdrawn = 0;

    for (const picture of pictures) {
      if (picture === null) {
        continue;
      }

      try {
        await this.withdraw(picture, reason);
        withdrawn += 1;
      } catch (error: unknown) {
        this._logger.error(
          `[withdrawEach] Not withdrawn - Subject: ${picture.subject}, SubjectId: ${picture.subjectId}, ImageId: ${picture.imageId}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    return withdrawn;
  }
}
