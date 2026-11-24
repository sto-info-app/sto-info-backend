import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { IsNull, Repository } from 'typeorm';

import { SiteAdminActionKind } from 'src/audit/site-admin/site-admin-action.enum';
import { recordSiteAdminAction } from 'src/audit/site-admin/site-admin-action.utility';
import { FileAssetAudience } from 'src/file-assets/enums/file-asset-audience.enum';
import { FileAssetKind } from 'src/file-assets/enums/file-asset-kind.enum';
import { FileAssetSlot } from 'src/file-assets/enums/file-asset-slot.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import { AcceptedAsset } from 'src/file-assets/services/asset-ingress.service';
import { AssetWithdrawalService } from 'src/file-assets/services/asset-withdrawal.service';
import { ImageIngressService } from 'src/file-assets/services/image-ingress.service';
import { NotificationSeverity } from 'src/notification/enums/notification-severity.enum';
import { NotificationTarget } from 'src/notification/enums/notification-target.enum';
import { NotificationService } from 'src/notification/notification.service';
import { RegistryService } from 'src/registry/registry.service';
import { DEFAULT_MULTER_LIMITS } from 'src/shared/constants/file-upload.constants';
import { dateToStoStardate } from 'src/shared/utilities/stardate.utility';

import {
  LOG_DEFAULT_PAGE_SIZE,
  LOG_LINK,
  LOG_PICTURE_SIZE_LABEL,
  LOG_PICTURE_SPEC,
  LogEntryType,
} from './captains-log.constants';
import {
  CreateLogEntryDto,
  LogEntryQueryDto,
  UpdateLogEntryDto,
} from './dto/log-entry-input.dto';
import { LogEntryEntity } from './entities/log-entry.entity';
import {
  AdminLogEntryView,
  adminLogEntryView,
  LogEntryPage,
  LogEntryView,
  logEntryView,
  PublicLogEntryView,
  publicLogEntryView,
} from './log-entry.view';

/** A picture on its way to be scanned. */
export interface LogPictureUpload {
  /** What it shows. */
  readonly altText: string;
  /** The cropped image. */
  readonly file: Express.Multer.File;
}

/** Who may see an entry's picture, by the entry's type. */
const PICTURE_AUDIENCES: Readonly<Record<LogEntryType, FileAssetAudience>> = {
  [LogEntryType.CAPTAIN]: FileAssetAudience.PUBLIC,
  [LogEntryType.PERSONAL]: FileAssetAudience.OWNER,
};

/** Why an entry that was removed cannot be changed. */
const REMOVED_MESSAGE =
  'This entry was removed by moderators and can no longer be changed.';

/**
 * The Captain's Log (sc-1450): a member's own journal of Captain's entries,
 * shown on their profile while it is public, and Personal entries only they
 * ever see.
 */
@Injectable()
export class CaptainsLogService {
  private readonly _logger = new Logger(CaptainsLogService.name);

  /**
   * Creates an instance of CaptainsLogService.
   *
   * @param _entries - The Log's entries.
   * @param _ingress - Checks a picture over and sends it to be scanned.
   * @param _withdrawal - Takes a published picture down.
   * @param _registry - Says whose profile may be seen.
   * @param _notifications - Tells an author an entry was removed.
   */
  constructor(
    @InjectRepository(LogEntryEntity)
    private readonly _entries: Repository<LogEntryEntity>,
    private readonly _ingress: ImageIngressService,
    private readonly _withdrawal: AssetWithdrawalService,
    private readonly _registry: RegistryService,
    private readonly _notifications: NotificationService,
  ) {}

  // ----- The author -----

  /**
   * Lists a member's own entries, newest first.
   *
   * @param userId - The member.
   * @param query - The type, if only one, and the page.
   * @returns A page of entries.
   */
  async list(
    userId: string,
    query: LogEntryQueryDto,
  ): Promise<LogEntryPage<LogEntryView>> {
    return this.page(
      { userId, ...(query.type ? { type: query.type } : {}) },
      query,
      logEntryView,
    );
  }

  /**
   * Reads one of a member's own entries.
   *
   * @param userId - The member.
   * @param id - The entry.
   * @returns The entry.
   * @throws NotFoundException when it is not theirs, or does not exist.
   */
  async get(userId: string, id: string): Promise<LogEntryView> {
    return logEntryView(await this.requireOwn(userId, id));
  }

  /**
   * Writes a new entry, stamped with the stardate it was written on.
   *
   * @param userId - The author.
   * @param dto - The type, headline and body.
   * @returns The entry.
   */
  async create(userId: string, dto: CreateLogEntryDto): Promise<LogEntryView> {
    const now = new Date();
    const entry = await this._entries.save(
      this._entries.create({
        userId,
        type: dto.type,
        headline: dto.headline || null,
        body: dto.body,
        stardate: dateToStoStardate(now),
        createdAt: now,
      }),
    );

    return logEntryView(entry);
  }

  /**
   * Changes an entry. Its stardate never changes; a type change carries its
   * picture with it, so a Personal entry's picture is never public.
   *
   * @param userId - The author.
   * @param id - The entry.
   * @param dto - What to change.
   * @returns The entry.
   * @throws NotFoundException when it is not theirs.
   * @throws ConflictException when a site admin removed it.
   */
  async update(
    userId: string,
    id: string,
    dto: UpdateLogEntryDto,
  ): Promise<LogEntryView> {
    const entry = this.requireChangeable(await this.requireOwn(userId, id));
    const retyped = dto.type !== undefined && dto.type !== entry.type;

    if (dto.type !== undefined) {
      entry.type = dto.type;
    }

    if (dto.headline !== undefined) {
      entry.headline = dto.headline || null;
    }

    if (dto.body !== undefined) {
      entry.body = dto.body;
    }

    entry.editedAt = new Date();

    const saved = await this._entries.save(entry);

    if (retyped) {
      await this.setPictureAudience(saved.id, PICTURE_AUDIENCES[saved.type]);
    }

    return logEntryView(saved);
  }

  /**
   * Deletes an entry for good, and takes its picture down.
   *
   * @param userId - The author.
   * @param id - The entry.
   * @throws NotFoundException when it is not theirs.
   */
  async remove(userId: string, id: string): Promise<void> {
    const entry = await this.requireOwn(userId, id);

    await this._entries.delete({ id: entry.id });

    if (entry.pictureId) {
      await this.withdrawPicture(
        entry.id,
        entry.pictureId,
        'Its Log entry was deleted',
      );
    }
  }

  /**
   * Sends an entry's picture to be scanned. The entry keeps its old picture,
   * or none, until the scanner clears the new one.
   *
   * @param userId - The author.
   * @param id - The entry.
   * @param upload - The description and the file.
   * @returns The upload to ask about, and how far along it is.
   * @throws NotFoundException when it is not theirs.
   * @throws ConflictException when a site admin removed it.
   * @throws BadRequestException when the file is unacceptable.
   */
  async setPicture(
    userId: string,
    id: string,
    upload: LogPictureUpload,
  ): Promise<AcceptedAsset> {
    const entry = this.requireChangeable(await this.requireOwn(userId, id));

    return this._ingress.accept({
      spec: LOG_PICTURE_SPEC,
      userId,
      kind: FileAssetKind.LOG_IMAGE,
      audience: PICTURE_AUDIENCES[entry.type],
      subject: FileAssetSubject.LOG_ENTRY,
      subjectId: entry.id,
      slot: FileAssetSlot.PICTURE,
      entityTag: LOG_PICTURE_SPEC.entityTag,
      entityId: entry.id,
      maximumBytes: DEFAULT_MULTER_LIMITS.fileSize,
      sizeLimitLabel: LOG_PICTURE_SIZE_LABEL,
      file: upload.file,
      feature: { altText: upload.altText },
    });
  }

  /**
   * Takes an entry's picture down. The columns are emptied first, so the
   * entry never points at bytes that have stopped being served.
   *
   * @param userId - The author.
   * @param id - The entry.
   * @throws NotFoundException when it is not theirs, or has no picture.
   */
  async clearPicture(userId: string, id: string): Promise<void> {
    const entry = await this.requireOwn(userId, id);
    const reference = entry.pictureId;

    if (!reference) {
      throw new NotFoundException('This entry has no picture to remove.');
    }

    entry.pictureId = null;
    entry.pictureAlt = null;
    await this._entries.save(entry);

    await this.withdrawPicture(entry.id, reference, 'Removed from its entry');
  }

  // ----- Readers -----

  /**
   * Lists the Captain's entries on a public profile, newest first. A
   * profile that is not public, or a member blocked either way, is not
   * found, exactly as the profile itself is not.
   *
   * @param username - The profile's username.
   * @param viewerId - The reader, or null when signed out.
   * @param query - The page.
   * @returns A page of entries.
   * @throws NotFoundException when the profile may not be seen.
   */
  async listPublic(
    username: string,
    viewerId: string | null,
    query: LogEntryQueryDto,
  ): Promise<LogEntryPage<PublicLogEntryView>> {
    const userId = await this._registry.findVisibleMemberId(username, viewerId);

    return this.page(
      { userId, type: LogEntryType.CAPTAIN, removedAt: IsNull() },
      query,
      publicLogEntryView,
    );
  }

  /**
   * Finds a member's Captain's entry that may be reported: shown on their
   * profile, so neither Personal nor removed.
   *
   * @param userId - Its author.
   * @param id - The entry.
   * @returns Whether there is one.
   */
  async isReportable(userId: string, id: string): Promise<boolean> {
    return this._entries.exists({
      where: {
        id,
        userId,
        type: LogEntryType.CAPTAIN,
        removedAt: IsNull(),
      },
    });
  }

  // ----- Site admins -----

  /**
   * Reads any entry, for a site admin working a report.
   *
   * @param id - The entry.
   * @returns The entry and its author.
   * @throws NotFoundException when there is none.
   */
  async getForAdmin(id: string): Promise<AdminLogEntryView> {
    return adminLogEntryView(await this.requireEntry(id));
  }

  /**
   * Removes a reported entry from its author's profile. It stays with its
   * author, marked as removed; the removal goes in the Security Log and the
   * author is told why.
   *
   * @param adminUserId - The site admin.
   * @param id - The entry.
   * @param reason - Why.
   * @returns The entry as it now is.
   * @throws NotFoundException when there is none.
   * @throws ConflictException when it was removed already.
   */
  async removeForAdmin(
    adminUserId: string,
    id: string,
    reason: string,
  ): Promise<AdminLogEntryView> {
    const entry = this.requireChangeable(await this.requireEntry(id));

    entry.removedAt = new Date();
    entry.removedByUserId = adminUserId;
    entry.removedReason = reason;

    const saved = await this._entries.manager.transaction(async manager => {
      const removed = await manager.save(LogEntryEntity, entry);

      await recordSiteAdminAction(manager, {
        action: SiteAdminActionKind.LOG_ENTRY_REMOVED,
        actorUserId: adminUserId,
        targetUserId: removed.userId,
        subject: { kind: 'LOG_ENTRY', id: removed.id },
        reason,
        detail: { type: removed.type },
      });

      return removed;
    });

    await this.setPictureAudience(saved.id, FileAssetAudience.OWNER);
    await this.notifyRemoved(saved, reason);

    return adminLogEntryView(saved);
  }

  // ----- Helpers -----

  /**
   * Reads one page of entries, newest first.
   *
   * @param where - Which entries.
   * @param query - The page.
   * @param view - How each is shaped.
   * @returns The page.
   */
  private async page<T>(
    where: Record<string, unknown>,
    query: LogEntryQueryDto,
    view: (entry: LogEntryEntity) => T,
  ): Promise<LogEntryPage<T>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? LOG_DEFAULT_PAGE_SIZE;
    const [entries, total] = await this._entries.findAndCount({
      where,
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return { items: entries.map(view), total, page, pageSize };
  }

  /**
   * Loads an entry.
   *
   * @param id - The entry.
   * @returns It.
   * @throws NotFoundException when there is none.
   */
  private async requireEntry(id: string): Promise<LogEntryEntity> {
    const entry = await this._entries.findOneBy({ id });

    if (!entry) {
      throw new NotFoundException('Log entry not found');
    }

    return entry;
  }

  /**
   * Loads one of a member's own entries. Somebody else's is not found, so
   * nobody learns that an entry exists.
   *
   * @param userId - The member.
   * @param id - The entry.
   * @returns It.
   * @throws NotFoundException when it is not theirs.
   */
  private async requireOwn(
    userId: string,
    id: string,
  ): Promise<LogEntryEntity> {
    const entry = await this.requireEntry(id);

    if (entry.userId !== userId) {
      throw new NotFoundException('Log entry not found');
    }

    return entry;
  }

  /**
   * Refuses an entry a site admin has removed.
   *
   * @param entry - The entry.
   * @returns It, when it may be changed.
   * @throws ConflictException when it was removed.
   */
  private requireChangeable(entry: LogEntryEntity): LogEntryEntity {
    if (entry.removedAt) {
      throw new ConflictException(REMOVED_MESSAGE);
    }

    return entry;
  }

  /**
   * Gives every picture ever placed on an entry, published or still being
   * scanned, the audience its type allows.
   *
   * @param entryId - The entry.
   * @param audience - Who may see them now.
   */
  private async setPictureAudience(
    entryId: string,
    audience: FileAssetAudience,
  ): Promise<void> {
    await this._entries.manager.query(
      `UPDATE "sto_info_app"."file_asset" SET "audience" = $1
        WHERE "id" IN (SELECT "assetId" FROM "sto_info_app"."file_asset_placement"
          WHERE "subject" = $2 AND "subjectId" = $3)`,
      [audience, FileAssetSubject.LOG_ENTRY, entryId],
    );
  }

  /**
   * Withdraws the picture an entry showed.
   *
   * @param entryId - The entry.
   * @param reference - The picture's delivery reference.
   * @param reason - Why, for the withdrawal record.
   */
  private async withdrawPicture(
    entryId: string,
    reference: string,
    reason: string,
  ): Promise<void> {
    await this._withdrawal.withdrawSlot(
      FileAssetSubject.LOG_ENTRY,
      entryId,
      FileAssetSlot.PICTURE,
      reference,
      reason,
    );
  }

  /**
   * Tells an author a site admin removed their entry. Best effort: the
   * removal and its audit entry are saved already, and losing them because
   * the notice failed would be far worse than the author finding out when
   * they next look.
   *
   * @param entry - The entry.
   * @param reason - The site admin's reason.
   */
  private async notifyRemoved(
    entry: LogEntryEntity,
    reason: string,
  ): Promise<void> {
    const headline = logEntryView(entry).headline;

    try {
      await this._notifications.createNotification({
        target: NotificationTarget.USER,
        userId: entry.userId,
        severity: NotificationSeverity.WARNING,
        title: "A Captain's Log entry was removed",
        body: `Moderators removed "${headline}" from your profile: ${reason}`,
        linkUrl: LOG_LINK,
      });
    } catch (error) {
      this._logger.error(
        `Failed to notify ${entry.userId} of a Log entry removal`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
