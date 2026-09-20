import { randomUUID } from 'node:crypto';

import { InjectQueue } from '@nestjs/bullmq';
import { ConflictException, Injectable, Logger } from '@nestjs/common';

import { Queue } from 'bullmq';

import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';
import { FileAssetService } from 'src/file-assets/services/file-asset.service';

import {
  FILE_SCAN_CONTRACT_VERSION,
  FILE_SCAN_REQUEST_JOB,
  FILE_SCAN_REQUEST_QUEUE,
  ScanRequestMessage,
} from '../contract/file-scan-contract';

/** An asset that has been sent to a scanner. */
export interface RequestedScan {
  /** The asset, now in `SCANNING`. */
  readonly asset: FileAssetEntity;
  /** The identifier carried through to the verdict. */
  readonly traceId: string;
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
   * @returns The asset as it now stands, and the identifier to follow it by.
   * @throws ConflictException when the asset is not in a state to be scanned.
   */
  async requestScan(
    asset: FileAssetEntity,
    campaignId: string | null = null,
  ): Promise<RequestedScan> {
    this.assertScannable(asset);

    const request: ScanRequestMessage = {
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

    const scanning = await this._fileAssetService.markScanning(asset.id);

    try {
      await this._queue.add(FILE_SCAN_REQUEST_JOB, request, {
        jobId: `${asset.id}:${asset.policyVersion}`,
        attempts: DELIVERY_ATTEMPTS,
        backoff: { type: 'exponential', delay: 1_000 },
        removeOnComplete: true,
        removeOnFail: false,
      });
    } catch (error) {
      await this._fileAssetService.markRetryPending(asset.id);

      this._logger.error(
        `[requestScan] Could not queue a scan - AssetId: ${asset.id}`,
      );

      throw error;
    }

    this._logger.log(
      `[requestScan] Scan requested - AssetId: ${asset.id}, ` +
        `TraceId: ${request.traceId}`,
    );

    return { asset: scanning, traceId: request.traceId };
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
