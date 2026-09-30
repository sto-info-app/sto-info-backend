import { createHash, randomUUID } from 'crypto';

import { InjectQueue } from '@nestjs/bullmq';
import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';

import { Queue } from 'bullmq';
import {
  Brackets,
  DataSource,
  In,
  IsNull,
  LessThan,
  Not,
  QueryFailedError,
} from 'typeorm';

import { SiteAdminActionKind } from 'src/audit/site-admin/site-admin-action.enum';
import { recordSiteAdminAction } from 'src/audit/site-admin/site-admin-action.utility';
import { SHOWABLE_IMAGE_STATES } from 'src/file-assets/delivery/image-url-signing.interceptor';
import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';
import { FileAssetStorage } from 'src/file-assets/enums/file-asset-storage.enum';
import { QuarantineStorageService } from 'src/file-assets/services/quarantine-storage.service';
import { ImageUploadsService } from 'src/shared/utilities/image-uploads.service';

import { ScanDiagnosticsService } from '../services/scan-diagnostics.service';
import { ScanRequestProducerService } from '../services/scan-request-producer.service';
import {
  FileRescanCampaignEntity,
  RescanCampaignCounts,
  RescanSelection,
} from './file-rescan-campaign.entity';
import { FileRescanEntity } from './file-rescan.entity';
import { declaredTypeOf } from './rescan-content-type.utility';
import {
  RESCAN_BACKOFF_MS,
  RESCAN_BATCH_JOB,
  RESCAN_BATCH_SIZE,
  RESCAN_CAMPAIGN_QUEUE,
  RESCAN_PRIORITIES,
  RESCAN_QUEUE_CEILING,
  RESCAN_STALE_HOURS,
} from './rescan.constants';
import {
  RescanCampaignKind,
  RescanCampaignState,
  RescanState,
} from './rescan.enums';

/** A day, in milliseconds. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** The storages a published picture is served from. */
const PUBLIC_STORAGES = [
  FileAssetStorage.PUBLIC_IMAGES,
  FileAssetStorage.LEGACY_PUBLIC_R2,
];

/** The states a campaign is open in. */
const OPEN_STATES = [
  RescanCampaignState.RUNNING,
  RescanCampaignState.PAUSED,
  RescanCampaignState.FAILED,
];

/** A policy refusal or infection, for the page. IDs and codes only. */
export interface RescanFinding {
  /** The rescan, which a site admin decides a policy refusal by (FC-050). */
  readonly id: string;
  readonly assetId: string;
  readonly state: RescanState;
  readonly rejectionCode: string | null;
  readonly verdictAt: Date | null;
}

/** Where the campaigns stand, for Scan Diagnostics. */
export interface RescanOverview {
  readonly campaigns: FileRescanCampaignEntity[];
  /** Rescans waiting for a verdict. */
  readonly waiting: number;
  /** Legacy pictures still never scanned. */
  readonly unverified: number;
  /** The latest infections, and policy refusals not yet decided. */
  readonly findings: RescanFinding[];
}

/**
 * Rescan campaigns (FC-041).
 *
 * Steve's decisions of 29 September 2026. A campaign rescans a selection of
 * published pictures, by kind, upload date and how long since each was last
 * scanned. For each, the API reads the picture from Cloudflare (or a legacy
 * R2 portrait), stages a copy in the quarantine bucket and asks the worker
 * to scan it as it would an upload. The worker keeps its quarantine-only
 * access, and the contract is unchanged.
 *
 * - **Behind new uploads.** Every rescan is queued with a priority, which
 *   an upload never has, and a campaign holds back while the queue is long.
 * - **Once per epoch.** A picture is rescanned once per policy and
 *   signature version, however many campaigns overlap; the worker keeps the
 *   same rule for its attempts.
 * - **Checkpointed.** A campaign's cursor is the last picture it staged. A
 *   pause, a crash or a failure resumes after it, and a rescan with no
 *   verdict after a day counts as failed, to be tried again by another.
 * - **Legacy first.** After release the system starts one campaign over
 *   every legacy picture, once, and then leaves it to site admins.
 */
@Injectable()
export class RescanCampaignService {
  private readonly _logger = new Logger(RescanCampaignService.name);

  /**
   * Creates an instance of RescanCampaignService.
   *
   * @param _dataSource - The database.
   * @param _images - Cloudflare Images and the public R2 bucket.
   * @param _quarantine - Where copies are staged.
   * @param _producer - The scan request queue.
   * @param _diagnostics - The worker's signature version.
   * @param _config - The environment.
   * @param _queue - Where campaign batches run.
   */
  constructor(
    @InjectDataSource() private readonly _dataSource: DataSource,
    private readonly _images: ImageUploadsService,
    private readonly _quarantine: QuarantineStorageService,
    private readonly _producer: ScanRequestProducerService,
    private readonly _diagnostics: ScanDiagnosticsService,
    private readonly _config: ConfigService,
    @InjectQueue(RESCAN_CAMPAIGN_QUEUE) private readonly _queue: Queue,
  ) {}

  /**
   * Where the campaigns stand.
   *
   * @returns The latest campaigns, what is waiting and the latest findings.
   */
  async overview(): Promise<RescanOverview> {
    const manager = this._dataSource.manager;
    const [campaigns, waiting, unverified, findings] = await Promise.all([
      manager.find(FileRescanCampaignEntity, {
        order: { createdAt: 'DESC' },
        take: 20,
      }),
      manager.count(FileRescanEntity, {
        where: { state: RescanState.REQUESTED },
      }),
      manager.count(FileAssetEntity, {
        where: {
          state: FileAssetState.UNVERIFIED,
          storage: In(PUBLIC_STORAGES),
        },
      }),
      // A decided refusal leaves the list (FC-050); an infection was taken
      // down when it was found, and stays as a record of that.
      manager.find(FileRescanEntity, {
        where: [
          { state: RescanState.INFECTED },
          { state: RescanState.REFUSED, decision: IsNull() },
        ],
        order: { verdictAt: 'DESC' },
        take: 50,
        select: {
          id: true,
          assetId: true,
          state: true,
          rejectionCode: true,
          verdictAt: true,
        },
      }),
    ]);

    return { campaigns, waiting, unverified, findings };
  }

  /**
   * Starts a campaign, logged with its reason.
   *
   * @param selection - Which pictures.
   * @param adminUserId - The site admin.
   * @param reason - Why.
   * @returns The campaign.
   */
  async start(
    selection: RescanSelection,
    adminUserId: string,
    reason: string,
  ): Promise<FileRescanCampaignEntity> {
    const campaign = await this._dataSource.transaction(async manager => {
      const created = await manager.save(
        FileRescanCampaignEntity,
        manager.create(FileRescanCampaignEntity, {
          kind: RescanCampaignKind.MANUAL,
          state: RescanCampaignState.RUNNING,
          startedByUserId: adminUserId,
          selection,
          counts: {},
        }),
      );

      await recordSiteAdminAction(manager, {
        action: SiteAdminActionKind.RESCAN_STARTED,
        actorUserId: adminUserId,
        subject: { kind: 'RESCAN_CAMPAIGN', id: created.id },
        reason,
        detail: { selection },
      });

      return created;
    });

    await this.enqueue(campaign.id);

    return campaign;
  }

  /**
   * Starts the legacy campaign, once, when there is a legacy estate to scan.
   *
   * @returns The campaign, or null when there was nothing to start.
   */
  async startLegacyOnce(): Promise<FileRescanCampaignEntity | null> {
    const manager = this._dataSource.manager;

    if (
      await manager.exists(FileRescanCampaignEntity, {
        where: { kind: RescanCampaignKind.LEGACY },
      })
    ) {
      return null;
    }

    const legacy = await manager.count(FileAssetEntity, {
      where: {
        state: FileAssetState.UNVERIFIED,
        storage: In(PUBLIC_STORAGES),
      },
    });

    if (legacy === 0) {
      return null;
    }

    const campaign = await manager.save(
      FileRescanCampaignEntity,
      manager.create(FileRescanCampaignEntity, {
        kind: RescanCampaignKind.LEGACY,
        state: RescanCampaignState.RUNNING,
        startedByUserId: null,
        selection: { unverifiedOnly: true, priority: 'LOW' },
        counts: {},
      }),
    );

    this._logger.log(
      `[startLegacyOnce] Legacy campaign started - CampaignId: ${campaign.id}, Pictures: ${legacy}`,
    );
    await this.enqueue(campaign.id);

    return campaign;
  }

  /**
   * Pauses a running campaign after the batch under way.
   *
   * @param campaignId - The campaign.
   * @param adminUserId - The site admin.
   * @param reason - Why.
   * @returns The campaign.
   */
  pause(
    campaignId: string,
    adminUserId: string,
    reason: string,
  ): Promise<FileRescanCampaignEntity> {
    return this.move(
      campaignId,
      [RescanCampaignState.RUNNING],
      RescanCampaignState.PAUSED,
      SiteAdminActionKind.RESCAN_PAUSED,
      adminUserId,
      reason,
    );
  }

  /**
   * Resumes a paused or failed campaign where it stopped.
   *
   * @param campaignId - The campaign.
   * @param adminUserId - The site admin.
   * @param reason - Why.
   * @returns The campaign.
   */
  async resume(
    campaignId: string,
    adminUserId: string,
    reason: string,
  ): Promise<FileRescanCampaignEntity> {
    const campaign = await this.move(
      campaignId,
      [RescanCampaignState.PAUSED, RescanCampaignState.FAILED],
      RescanCampaignState.RUNNING,
      SiteAdminActionKind.RESCAN_RESUMED,
      adminUserId,
      reason,
    );

    await this.enqueue(campaign.id);

    return campaign;
  }

  /**
   * Ends an open campaign. Rescans already asked for still get their
   * verdicts.
   *
   * @param campaignId - The campaign.
   * @param adminUserId - The site admin.
   * @param reason - Why.
   * @returns The campaign.
   */
  cancel(
    campaignId: string,
    adminUserId: string,
    reason: string,
  ): Promise<FileRescanCampaignEntity> {
    return this.move(
      campaignId,
      OPEN_STATES,
      RescanCampaignState.CANCELLED,
      SiteAdminActionKind.RESCAN_CANCELLED,
      adminUserId,
      reason,
    );
  }

  /**
   * Stages one batch of a campaign, and queues the next.
   *
   * @param campaignId - The campaign.
   */
  async processBatch(campaignId: string): Promise<void> {
    const manager = this._dataSource.manager;
    const campaign = await manager.findOne(FileRescanCampaignEntity, {
      where: { id: campaignId },
    });

    if (campaign === null || campaign.state !== RescanCampaignState.RUNNING) {
      return;
    }

    try {
      if ((await this._producer.waiting()) >= RESCAN_QUEUE_CEILING) {
        await this.enqueue(campaign.id, RESCAN_BACKOFF_MS);

        return;
      }

      const epoch = await this._diagnostics.currentDefinitionEpoch();
      const assets = await this.nextAssets(campaign);

      for (const asset of assets) {
        await this.stageOne(campaign, asset, epoch);
        campaign.cursor = asset.id;
      }

      const done = assets.length < RESCAN_BATCH_SIZE;
      const moved = await manager.update(
        FileRescanCampaignEntity,
        { id: campaign.id, state: RescanCampaignState.RUNNING },
        {
          cursor: campaign.cursor,
          ...(done
            ? { state: RescanCampaignState.DONE, finishedAt: new Date() }
            : {}),
        },
      );

      if (!moved.affected) {
        // Paused or cancelled meanwhile: keep the progress, and stop.
        await manager.update(
          FileRescanCampaignEntity,
          { id: campaign.id },
          { cursor: campaign.cursor },
        );

        return;
      }

      if (!done) {
        await this.enqueue(campaign.id);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this._logger.error(
        `[processBatch] Campaign failed - CampaignId: ${campaign.id}`,
      );
      await manager.update(
        FileRescanCampaignEntity,
        { id: campaign.id, state: RescanCampaignState.RUNNING },
        {
          state: RescanCampaignState.FAILED,
          lastError: message.slice(0, 500),
          cursor: campaign.cursor,
        },
      );
    }
  }

  /**
   * Counts rescans that never got a verdict as failed, and drops their
   * copies, so another campaign may try them again.
   *
   * @param now - When.
   * @returns How many it gave up on.
   */
  async sweepStale(now: Date = new Date()): Promise<number> {
    const manager = this._dataSource.manager;
    const stale = await manager.find(FileRescanEntity, {
      where: {
        state: RescanState.REQUESTED,
        requestedAt: LessThan(
          new Date(now.getTime() - RESCAN_STALE_HOURS * 60 * 60 * 1000),
        ),
      },
      take: 500,
    });

    for (const rescan of stale) {
      const moved = await manager.update(
        FileRescanEntity,
        { id: rescan.id, state: RescanState.REQUESTED },
        { state: RescanState.FAILED, verdictAt: now },
      );

      if (moved.affected) {
        await this.count(rescan.campaignId, 'failed');
        await this.dropCopy(rescan.stagingKey);
      }
    }

    return stale.length;
  }

  /**
   * Adds one to a campaign's count, in the database, so batches and
   * verdicts landing together lose nothing.
   *
   * @param campaignId - The campaign.
   * @param key - What.
   */
  async count(
    campaignId: string,
    key: keyof RescanCampaignCounts,
  ): Promise<void> {
    await this._dataSource.query(
      `UPDATE "sto_info_app"."file_rescan_campaign"
       SET "counts" = jsonb_set("counts", ARRAY[$2::text], to_jsonb(COALESCE(("counts"->>$2)::int, 0) + 1))
       WHERE "id" = $1`,
      [campaignId, key],
    );
  }

  /**
   * Deletes a staged copy, reporting rather than throwing: the quarantine
   * sweep takes anything left.
   *
   * @param stagingKey - Where it is.
   */
  async dropCopy(stagingKey: string): Promise<void> {
    try {
      await this._quarantine.remove(stagingKey);
    } catch {
      this._logger.warn(`[dropCopy] Staged copy left - Key: ${stagingKey}`);
    }
  }

  // ----- Helpers -----

  /**
   * The next pictures a campaign selects, after its cursor.
   *
   * @param campaign - The campaign.
   * @returns Up to a batch of them, in order.
   */
  private nextAssets(
    campaign: FileRescanCampaignEntity,
  ): Promise<FileAssetEntity[]> {
    const selection = campaign.selection;
    const query = this._dataSource.manager
      .createQueryBuilder(FileAssetEntity, 'asset')
      .where('asset.storage IN (:...storages)', { storages: PUBLIC_STORAGES })
      .andWhere('asset.state IN (:...states)', {
        states: selection.unverifiedOnly
          ? [FileAssetState.UNVERIFIED]
          : [...SHOWABLE_IMAGE_STATES],
      })
      .andWhere('asset.deliveryReference IS NOT NULL')
      .orderBy('asset.id', 'ASC')
      .take(RESCAN_BATCH_SIZE);

    if (campaign.cursor !== null) {
      query.andWhere('asset.id > :cursor', { cursor: campaign.cursor });
    }

    if (selection.kinds !== undefined && selection.kinds.length > 0) {
      query.andWhere('asset.kind IN (:...kinds)', { kinds: selection.kinds });
    }

    if (selection.uploadedFrom !== undefined) {
      query.andWhere('asset.createdAt >= :from', {
        from: new Date(selection.uploadedFrom),
      });
    }

    if (selection.uploadedBefore !== undefined) {
      query.andWhere('asset.createdAt < :before', {
        before: new Date(selection.uploadedBefore),
      });
    }

    if (selection.notScannedForDays !== undefined) {
      const since = new Date(Date.now() - selection.notScannedForDays * DAY_MS);

      query.andWhere(
        new Brackets(where =>
          where
            .where('asset.lastVerdictAt IS NULL')
            .orWhere('asset.lastVerdictAt < :since', { since }),
        ),
      );
    }

    return query.getMany();
  }

  /**
   * Stages one picture's copy and asks for its scan, unless it has been
   * rescanned against these definitions already.
   *
   * @param campaign - The campaign.
   * @param asset - The picture.
   * @param epoch - The worker's signature version.
   */
  private async stageOne(
    campaign: FileRescanCampaignEntity,
    asset: FileAssetEntity,
    epoch: string,
  ): Promise<void> {
    const manager = this._dataSource.manager;

    // The epoch read here is what the worker's latest attempt recorded,
    // which lags a signature update until the next scan; a rescan's verdict
    // records the version it was really scanned with. Either counts.
    const same = {
      assetId: asset.id,
      policyVersion: asset.policyVersion,
      state: Not(RescanState.FAILED),
    };

    if (
      await manager.exists(FileRescanEntity, {
        where: [
          { ...same, definitionEpoch: epoch },
          { ...same, signatureVersion: epoch },
        ],
      })
    ) {
      await this.count(campaign.id, 'skipped');

      return;
    }

    const rescanId = randomUUID();
    const stagingKey = `${this._config.get<string>('NODE_ENV')}/rescans/${rescanId}`;
    let staged = false;

    try {
      const bytes =
        asset.storage === FileAssetStorage.LEGACY_PUBLIC_R2
          ? await this._images.readR2Object(asset.deliveryReference as string)
          : await this._images.readImage(asset.deliveryReference as string);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const declaredContentType = declaredTypeOf(bytes);
      const put = await this._quarantine.put(stagingKey, bytes);

      staged = true;
      await manager.insert(FileRescanEntity, {
        id: rescanId,
        campaignId: campaign.id,
        assetId: asset.id,
        state: RescanState.REQUESTED,
        stagingKey,
        sha256,
        declaredContentType,
        policyVersion: asset.policyVersion,
        definitionEpoch: epoch,
      });
      await this._producer.requestRescan({
        rescanId,
        assetId: asset.id,
        objectKey: stagingKey,
        objectVersion: put.objectVersion,
        sha256,
        declaredContentType,
        policyVersion: asset.policyVersion,
        campaignId: campaign.id,
        priority: RESCAN_PRIORITIES[campaign.selection.priority ?? 'LOW'],
      });
      await this.count(campaign.id, 'requested');
    } catch (error: unknown) {
      if (staged) {
        await this.dropCopy(stagingKey);
      }

      // Another campaign got there first, between the check and the insert.
      if (
        error instanceof QueryFailedError &&
        (error as QueryFailedError & { code?: string }).code === '23505'
      ) {
        await this.count(campaign.id, 'skipped');

        return;
      }

      await manager.update(
        FileRescanEntity,
        { id: rescanId, state: RescanState.REQUESTED },
        { state: RescanState.FAILED, verdictAt: new Date() },
      );
      await this.count(campaign.id, 'failed');
      this._logger.warn(
        `[stageOne] Picture not rescanned - AssetId: ${asset.id}, ` +
          `Reason: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  /**
   * Moves a campaign from some states to another, logged.
   *
   * @param campaignId - The campaign.
   * @param from - Where it must be.
   * @param to - Where it goes.
   * @param action - How the site admin log calls it.
   * @param adminUserId - The site admin.
   * @param reason - Why.
   * @returns The campaign.
   * @throws ConflictException when it is not where it must be.
   */
  private move(
    campaignId: string,
    from: readonly RescanCampaignState[],
    to: RescanCampaignState,
    action: SiteAdminActionKind,
    adminUserId: string,
    reason: string,
  ): Promise<FileRescanCampaignEntity> {
    return this._dataSource.transaction(async manager => {
      const campaign = await manager.findOne(FileRescanCampaignEntity, {
        where: { id: campaignId, state: In([...from]) },
      });

      if (campaign === null) {
        throw new ConflictException('That campaign cannot do that now.');
      }

      const finishedAt =
        to === RescanCampaignState.CANCELLED ? new Date() : null;

      await manager.update(
        FileRescanCampaignEntity,
        { id: campaign.id },
        { state: to, lastError: null, finishedAt },
      );
      await recordSiteAdminAction(manager, {
        action,
        actorUserId: adminUserId,
        subject: { kind: 'RESCAN_CAMPAIGN', id: campaign.id },
        reason,
      });

      return { ...campaign, state: to, lastError: null, finishedAt };
    });
  }

  /**
   * Queues a campaign's next batch.
   *
   * @param campaignId - The campaign.
   * @param delay - How long to wait first, in milliseconds.
   */
  private async enqueue(campaignId: string, delay = 0): Promise<void> {
    await this._queue.add(
      RESCAN_BATCH_JOB,
      { campaignId },
      { delay, removeOnComplete: true, removeOnFail: true },
    );
  }
}
