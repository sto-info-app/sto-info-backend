import { randomUUID } from 'node:crypto';

import { InjectQueue } from '@nestjs/bullmq';
import { ConflictException, Injectable, Logger } from '@nestjs/common';

import { Queue } from 'bullmq';

import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';
import { FileAssetService } from 'src/file-assets/services/file-asset.service';
import { redisWithin } from 'src/shared/queue/redis-within.utility';

import {
  FILE_SCAN_CONTRACT_VERSION,
  FILE_SCAN_REQUEST_JOB,
  FILE_SCAN_REQUEST_QUEUE,
  ScanRequestMessage,
} from '../contract/file-scan-contract';

/** An asset that has been sent to a scanner, or is waiting to be. */
export interface RequestedScan {
  /**
   * The asset: in `SCANNING`, or in `RETRY_PENDING` when the queue could
   * not take the request and the re-queue sweep will send it (FC-042).
   */
  readonly asset: FileAssetEntity;
  /** The identifier carried through to the verdict. */
  readonly traceId: string;
  /** Whether the queue took the request. */
  readonly queued: boolean;
}

/**
 * The scan request job an upload is queued under: the asset and the policy
 * that applies to it.
 *
 * An underscore, not a colon. BullMQ refuses a custom identifier with a
 * colon in it, and a UUID never holds an underscore, so the two parts still
 * split one way only.
 *
 * @param asset - The asset.
 * @param asset.id - Its identifier.
 * @param asset.policyVersion - The policy it is scanned under.
 * @returns The job's identifier.
 */
export function scanJobIdOf(asset: {
  readonly id: string;
  readonly policyVersion: number;
}): string {
  return `${asset.id}_${asset.policyVersion}`;
}

/** The states an asset may be sent to a scanner from. */
const SCANNABLE_STATES: ReadonlySet<FileAssetState> = new Set([
  FileAssetState.QUARANTINED,
  FileAssetState.RETRY_PENDING,
]);

/** How many times BullMQ will redeliver before giving up on a job. */
const DELIVERY_ATTEMPTS = 5;

/**
 * Asks the worker to scan an asset.
 *
 * The producing half of ADR-0006's contract, and the first thing in this
 * codebase that puts anything on a queue. What it sends is fixed by that
 * record and is worth reading as a list of absences: an asset identifier, an
 * object key the registry built, an object version, a hash, a declared type,
 * a policy version and two identifiers. **No URL, no bucket, no endpoint, no
 * credentials, no filename and no row of anybody's data.** The worker
 * resolves where to read from out of its own configuration, which is why
 * there is no SSRF surface to argue about rather than a defence against one.
 *
 * The declared type is new in contract version 2 and is the registry's
 * normalised copy, never a header read at the moment of sending. It is a
 * claim to be checked and not an instruction: the worker compares it with
 * what the bytes look like and refuses the asset when they disagree —
 * ADR-0020.
 *
 * The asset is moved to `SCANNING` before the message is sent, and that
 * order is deliberate. It makes a second request for the same asset fail the
 * state check instead of queueing a duplicate, and it means an asset stuck in
 * `SCANNING` is a visible symptom of a queue that is not moving. If the send
 * then fails, the asset is put back to `RETRY_PENDING`, because an asset left
 * in `SCANNING` with nothing scanning it is the one outcome nobody would
 * notice.
 *
 * **An upload is never refused because Redis is down** (FC-042, Steve's
 * decision of 1 October 2026: accept, queue later). The send waits at most
 * {@link REDIS_TIMEOUT_MS}, because BullMQ holds a command while Redis is
 * away rather than failing it; if it fails or times out, the asset is put
 * back to `RETRY_PENDING` — "waiting to be scanned" to its uploader — the
 * failure is logged, and the upload is answered as usual. The re-queue
 * sweep sends it once Redis answers. Nothing about the asset or its
 * placement depends on the job having been added.
 */
@Injectable()
export class ScanRequestProducerService {
  private readonly _logger = new Logger(ScanRequestProducerService.name);

  /**
   * Creates an instance of ScanRequestProducerService.
   *
   * @param _queue - The scan request queue.
   * @param _fileAssetService - The asset registry.
   */
  constructor(
    @InjectQueue(FILE_SCAN_REQUEST_QUEUE) private readonly _queue: Queue,
    private readonly _fileAssetService: FileAssetService,
  ) {}

  /**
   * Sends one asset to be scanned.
   *
   * @param asset - The asset, already stored in quarantine.
   * @param campaignId - The rescan campaign, when this is part of one.
   * @returns The asset as it now stands, the identifier to follow it by, and
   *   whether the queue took the request.
   * @throws ConflictException when the asset is not in a state to be scanned.
   */
  async requestScan(
    asset: FileAssetEntity,
    campaignId: string | null = null,
  ): Promise<RequestedScan> {
    this.assertScannable(asset);

    const request = this.messageFor(asset, campaignId);
    const scanning = await this._fileAssetService.markScanning(asset.id);

    try {
      await this.send(asset, request);
    } catch (error) {
      const waiting = await this._fileAssetService.markRetryPending(asset.id);

      this._logger.error(
        `[requestScan] Could not queue a scan; it will be queued when the ` +
          `queue answers - AssetId: ${asset.id}, Error: ` +
          (error instanceof Error ? error.name : typeof error),
      );

      return { asset: waiting, traceId: request.traceId, queued: false };
    }

    this._logger.log(
      `[requestScan] Scan requested - AssetId: ${asset.id}, ` +
        `TraceId: ${request.traceId}`,
    );

    return { asset: scanning, traceId: request.traceId, queued: true };
  }

  /**
   * Sends the scan request of an asset already in `SCANNING` again, when its
   * job has gone — Redis lost its data, or the process stopped between
   * marking the asset and sending — leaving the asset as it is (FC-042).
   *
   * @param asset - The asset, in `SCANNING`.
   * @throws ConflictException when it is not scanning or has no identity.
   * @throws Error when the queue does not take it in time.
   */
  async resend(asset: FileAssetEntity): Promise<void> {
    if (asset.state !== FileAssetState.SCANNING) {
      throw new ConflictException(
        `An asset in ${asset.state} has no scan request to send again`,
      );
    }

    this.assertIdentity(asset);

    const request = this.messageFor(asset, null);

    await this.send(asset, request);

    this._logger.log(
      `[resend] Scan requested again - AssetId: ${asset.id}, ` +
        `TraceId: ${request.traceId}`,
    );
  }

  /**
   * The message asking for an asset to be scanned.
   *
   * @param asset - The asset.
   * @param campaignId - The rescan campaign, when this is part of one.
   * @returns The message, with a fresh trace.
   */
  private messageFor(
    asset: FileAssetEntity,
    campaignId: string | null,
  ): ScanRequestMessage {
    return {
      schemaVersion: FILE_SCAN_CONTRACT_VERSION,
      assetId: asset.id,
      objectKey: asset.objectKey as string,
      objectVersion: asset.objectVersion,
      expectedSha256: asset.sha256 as string,
      declaredContentType: asset.declaredContentType as string,
      policyVersion: asset.policyVersion,
      campaignId,
      traceId: randomUUID(),
    };
  }

  /**
   * Puts an upload's scan request on the queue, waiting at most
   * {@link REDIS_TIMEOUT_MS}.
   *
   * @param asset - The asset.
   * @param request - The message.
   * @throws Error when the queue does not take it in time.
   */
  private async send(
    asset: FileAssetEntity,
    request: ScanRequestMessage,
  ): Promise<void> {
    await redisWithin(() =>
      this._queue.add(FILE_SCAN_REQUEST_JOB, request, {
        jobId: scanJobIdOf(asset),
        attempts: DELIVERY_ATTEMPTS,
        backoff: { type: 'exponential', delay: 1_000 },
        removeOnComplete: true,
        removeOnFail: false,
      }),
    );
  }

  /**
   * Asks the worker to scan a copy of a published picture (FC-041).
   *
   * The asset's state is left alone: a picture on the site stays on the
   * site while it is rescanned. The copy is staged in quarantine under its
   * own key, which is how the verdict finds its way back to the rescan
   * rather than to the upload. Queued with a priority, so every new upload,
   * which has none, is taken first.
   *
   * @param rescan - The copy, and what it is asked against.
   * @param rescan.rescanId - The rescan, which names the job.
   * @param rescan.assetId - The picture.
   * @param rescan.objectKey - Where the copy is staged.
   * @param rescan.objectVersion - The copy's version, when the store gave one.
   * @param rescan.sha256 - The copy's hash.
   * @param rescan.declaredContentType - What its bytes read as.
   * @param rescan.policyVersion - The policy it is scanned under.
   * @param rescan.campaignId - The campaign.
   * @param rescan.priority - Its BullMQ priority.
   */
  async requestRescan(rescan: {
    readonly rescanId: string;
    readonly assetId: string;
    readonly objectKey: string;
    readonly objectVersion: string | null;
    readonly sha256: string;
    readonly declaredContentType: string;
    readonly policyVersion: number;
    readonly campaignId: string;
    readonly priority: number;
  }): Promise<void> {
    const request: ScanRequestMessage = {
      schemaVersion: FILE_SCAN_CONTRACT_VERSION,
      assetId: rescan.assetId,
      objectKey: rescan.objectKey,
      objectVersion: rescan.objectVersion,
      expectedSha256: rescan.sha256,
      declaredContentType: rescan.declaredContentType,
      policyVersion: rescan.policyVersion,
      campaignId: rescan.campaignId,
      traceId: randomUUID(),
    };

    await this._queue.add(FILE_SCAN_REQUEST_JOB, request, {
      jobId: `rescan_${rescan.rescanId}`,
      priority: rescan.priority,
      attempts: DELIVERY_ATTEMPTS,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: true,
      removeOnFail: false,
    });
  }

  /**
   * How many scan requests are waiting for the worker.
   *
   * @returns Waiting and prioritised jobs together.
   */
  async waiting(): Promise<number> {
    const counts = await this._queue.getJobCounts('waiting', 'prioritized');

    return (counts.waiting ?? 0) + (counts.prioritized ?? 0);
  }

  /**
   * Refuses to queue an asset that is not ready to be scanned.
   *
   * @param asset - The asset.
   * @throws ConflictException when it is the wrong state or has no identity.
   */
  private assertScannable(asset: FileAssetEntity): void {
    if (!SCANNABLE_STATES.has(asset.state)) {
      throw new ConflictException(
        `An asset in ${asset.state} cannot be sent to a scanner`,
      );
    }

    this.assertIdentity(asset);
  }

  /**
   * Refuses an asset whose request would carry a null the worker cannot act
   * on.
   *
   * @param asset - The asset.
   * @throws ConflictException when it has no stored object or no declared
   *   type.
   */
  private assertIdentity(asset: FileAssetEntity): void {
    if (asset.objectKey === null || asset.sha256 === null) {
      // Both are written by the same call, so this is only reachable through
      // a row assembled by something other than the registry. Refusing is
      // cheap and the alternative is a message the worker cannot act on.
      throw new ConflictException(
        `Asset ${asset.id} has no stored object to scan`,
      );
    }

    if (asset.declaredContentType === null) {
      // The worker checks the claim against the bytes, and an asset that
      // claims nothing cannot have that done for it. Refusing here rather
      // than sending a message with a null in it keeps the check from
      // quietly not applying to whichever assets happen to lack one —
      // ADR-0020.
      //
      // The legacy estate FC-008 counted has no declared type, and also no
      // hash, so it is already refused a line above. Whatever gives those
      // rows a hash for R26's re-scans has to give them a type as well.
      throw new ConflictException(
        `Asset ${asset.id} has no declared content type to check against`,
      );
    }
  }
}
