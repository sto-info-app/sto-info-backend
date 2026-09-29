import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, IsNull } from 'typeorm';

import { SHOWABLE_IMAGE_STATES } from 'src/file-assets/delivery/image-url-signing.interceptor';
import { AssetWithdrawalService } from 'src/file-assets/services/asset-withdrawal.service';
import {
  FileAssetService,
  FileAssetVerdict,
} from 'src/file-assets/services/file-asset.service';
import { NotificationSeverity } from 'src/notification/enums/notification-severity.enum';
import { NotificationTarget } from 'src/notification/enums/notification-target.enum';
import { NotificationService } from 'src/notification/notification.service';
import { UserEntity } from 'src/user/entities/user.entity';
import { UserRole } from 'src/user/enums/user-role.enum';

import { ScanVerdictMessage } from '../contract/file-scan-contract';
import { FileRescanEntity } from './file-rescan.entity';
import { RescanCampaignService } from './rescan-campaign.service';
import { INFECTION_CODES, NO_VERDICT_CODES } from './rescan.constants';
import { RescanState } from './rescan.enums';

/** Where a site admin reads about it. */
const SCAN_DIAGNOSTICS_LINK = '/admin/scan-diagnostics';

/** What the owner is told, with no detail (Steve's decision). */
const OWNER_NOTICE = {
  title: 'A picture was removed',
  body:
    'One of your pictures was removed because it failed a security check. ' +
    'You can upload another.',
};

/**
 * Applies a rescan's verdict (FC-041).
 *
 * Found by the staged copy's key: a verdict for an upload never matches a
 * rescan, and a verdict for a rescan never reaches the upload's path.
 *
 * - **Clean:** the picture stays; its verdict is brought up to date, and a
 *   legacy picture becomes `AVAILABLE`.
 * - **Infected:** delivery is refused first, since a revoked picture is
 *   never signed again; then the image is deleted, every site admin is
 *   alerted with the asset and the code, and the owner is told, without
 *   detail, that a picture was removed.
 * - **Refused for policy:** the picture stays up, and the code is reported
 *   on Scan Diagnostics for a site admin to decide.
 * - **No verdict:** the rescan fails, and another campaign may try again.
 *
 * The staged copy is deleted whatever the outcome.
 */
@Injectable()
export class RescanVerdictService {
  private readonly _logger = new Logger(RescanVerdictService.name);

  /**
   * Creates an instance of RescanVerdictService.
   *
   * @param _dataSource - The database.
   * @param _fileAssets - The registry.
   * @param _withdrawal - What takes a picture down.
   * @param _modules - Where the notification service is found, at send
   *   time: its module reaches back to this one through the user module, so
   *   importing it would make a loop.
   * @param _campaigns - Campaign counts and staged copies.
   */
  constructor(
    @InjectDataSource() private readonly _dataSource: DataSource,
    private readonly _fileAssets: FileAssetService,
    private readonly _withdrawal: AssetWithdrawalService,
    private readonly _modules: ModuleRef,
    private readonly _campaigns: RescanCampaignService,
  ) {}

  /**
   * Applies a verdict, if it is a rescan's.
   *
   * @param verdict - The verdict.
   * @returns Whether it was a rescan's; false leaves it to the upload path.
   */
  async apply(verdict: ScanVerdictMessage): Promise<boolean> {
    const manager = this._dataSource.manager;
    const rescan = await manager.findOne(FileRescanEntity, {
      where: {
        assetId: verdict.assetId,
        stagingKey: verdict.objectKey,
      },
    });

    if (rescan === null) {
      return false;
    }

    if (rescan.state !== RescanState.REQUESTED) {
      // A repeated delivery: the first one settled it.
      return true;
    }

    const state = this.stateOf(rescan, verdict);
    const settled = await manager.update(
      FileRescanEntity,
      { id: rescan.id, state: RescanState.REQUESTED, verdictAt: IsNull() },
      {
        state,
        rejectionCode:
          state === RescanState.INFECTED || state === RescanState.REFUSED
            ? verdict.rejectionCode
            : null,
        engine: verdict.engine,
        engineVersion: verdict.engineVersion,
        signatureVersion: verdict.signatureVersion,
        verdictAt: new Date(),
      },
    );

    if (!settled.affected) {
      return true;
    }

    const recorded: FileAssetVerdict = {
      engine: verdict.engine,
      engineVersion: verdict.engineVersion,
      signatureVersion: verdict.signatureVersion,
      policyVersion: verdict.policyVersion,
    };

    if (state === RescanState.CLEAN) {
      await this._fileAssets.recordRescanClean(rescan.assetId, recorded, {
        sha256: rescan.sha256,
        detectedContentType: rescan.declaredContentType,
      });
    } else if (state === RescanState.INFECTED) {
      await this.takeDown(rescan, verdict.rejectionCode as string, recorded);
    }

    await this._campaigns.count(rescan.campaignId, this.countOf(state));
    await this._campaigns.dropCopy(rescan.stagingKey);

    return true;
  }

  /**
   * What a verdict means for a rescan.
   *
   * @param rescan - The rescan.
   * @param verdict - The verdict.
   * @returns Its state.
   */
  private stateOf(
    rescan: FileRescanEntity,
    verdict: ScanVerdictMessage,
  ): RescanState {
    if (verdict.outcome === 'CLEAN') {
      return verdict.observedSha256 === rescan.sha256 &&
        verdict.expectedSha256 === rescan.sha256
        ? RescanState.CLEAN
        : RescanState.FAILED;
    }

    if (verdict.outcome === 'RETRY') {
      return RescanState.FAILED;
    }

    const code = verdict.rejectionCode ?? '';

    if (INFECTION_CODES.includes(code)) {
      return RescanState.INFECTED;
    }

    return NO_VERDICT_CODES.includes(code)
      ? RescanState.FAILED
      : RescanState.REFUSED;
  }

  /**
   * The campaign count a state adds to.
   *
   * @param state - The rescan's state.
   * @returns The count's name.
   */
  private countOf(
    state: RescanState,
  ): 'clean' | 'infected' | 'refused' | 'failed' {
    switch (state) {
      case RescanState.CLEAN:
        return 'clean';
      case RescanState.INFECTED:
        return 'infected';
      case RescanState.REFUSED:
        return 'refused';
      default:
        return 'failed';
    }
  }

  /**
   * Takes an infected picture down: refuses delivery, deletes the image,
   * records why, and tells the site admins and the owner.
   *
   * @param rescan - The rescan.
   * @param code - The scanner's code.
   * @param recorded - The verdict.
   */
  private async takeDown(
    rescan: FileRescanEntity,
    code: string,
    recorded: FileAssetVerdict,
  ): Promise<void> {
    const asset = await this._fileAssets.findById(rescan.assetId);

    if (asset === null) {
      return;
    }

    if (
      SHOWABLE_IMAGE_STATES.includes(asset.state) &&
      asset.deliveryReference !== null
    ) {
      await this._withdrawal.withdrawByReference(
        asset.deliveryReference,
        `Infected on rescan: ${code}`,
      );
    }

    await this._fileAssets.recordRescanRejection(asset.id, code, recorded);
    this._logger.warn(
      `[takeDown] Infected picture taken down - AssetId: ${asset.id}, Code: ${code}`,
    );

    const admins = await this._dataSource.manager.find(UserEntity, {
      where: { role: UserRole.ADMIN, disabledAt: IsNull() },
      select: { id: true },
    });

    for (const admin of admins) {
      await this.tell(admin.id, {
        title: 'Infected picture taken down',
        body:
          `A rescan found asset ${asset.id} infected (${code}). It is no ` +
          'longer served, and its image has been deleted.',
        linkUrl: SCAN_DIAGNOSTICS_LINK,
      });
    }

    if (asset.ownerUserId !== null) {
      await this.tell(asset.ownerUserId, { ...OWNER_NOTICE, linkUrl: null });
    }
  }

  /**
   * Sends one in-app notice, reporting rather than throwing: the picture is
   * already down, which is what matters.
   *
   * @param userId - Who.
   * @param notice - What.
   * @param notice.title - Its title.
   * @param notice.body - Its text.
   * @param notice.linkUrl - Where it leads, if anywhere.
   */
  private async tell(
    userId: string,
    notice: { title: string; body: string; linkUrl: string | null },
  ): Promise<void> {
    try {
      await this._modules
        .get(NotificationService, { strict: false })
        .createNotification({
          target: NotificationTarget.USER,
          userId,
          severity: NotificationSeverity.WARNING,
          title: notice.title,
          body: notice.body,
          linkUrl: notice.linkUrl ?? undefined,
        });
    } catch {
      this._logger.warn(`[tell] Notice not sent - UserId: ${userId}`);
    }
  }
}
