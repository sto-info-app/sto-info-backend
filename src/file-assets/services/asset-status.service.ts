import { Injectable, NotFoundException } from '@nestjs/common';

import {
  AssetScanStatus,
  assetScanStatusOf,
} from '../constants/asset-scan-status.constants';
import { FileAssetService } from './file-asset.service';

/** How far along an upload is, as the person who sent it is told. */
export interface AssetStatusReport {
  /** The asset asked about. */
  readonly assetId: string;
  /** How far along it is. */
  readonly status: AssetScanStatus;
}

/**
 * Answers "what happened to the file I just sent".
 *
 * Deliberately the smallest thing that can answer it. An upload is now
 * asynchronous, so the page that started one has to ask again, and what it
 * asks has to be cheap enough to poll and empty enough to be safe: an asset
 * identifier and one of five words.
 *
 * **Only the uploader may ask, and only about their own upload.** Anything
 * else is the same `NotFoundException` as an asset that does not exist —
 * ADR-0016 decision 5. A distinguishable refusal would let somebody walk
 * identifiers to learn what the site holds, and, for a refused file, confirm
 * a scanner verdict to the person best placed to make use of it.
 *
 * **There is nothing here to leak.** No rejection code, no signature, no
 * engine, no key, no filename. The fourth acceptance criterion is met by the
 * shape of the answer rather than by remembering to strip fields from it.
 */
@Injectable()
export class AssetStatusService {
  /**
   * Creates an instance of AssetStatusService.
   *
   * @param _fileAssets - The asset registry.
   */
  constructor(private readonly _fileAssets: FileAssetService) {}

  /**
   * Reports how far along one upload is.
   *
   * @param assetId - The asset asked about.
   * @param viewerId - The authenticated caller.
   * @returns The asset and one of the five words.
   * @throws NotFoundException when there is no such asset or it is not the
   *   caller's.
   */
  async report(assetId: string, viewerId: string): Promise<AssetStatusReport> {
    const asset = await this._fileAssets.findById(assetId);

    if (asset === null || asset.ownerUserId !== viewerId) {
      throw new NotFoundException('No such upload');
    }

    return { assetId: asset.id, status: assetScanStatusOf(asset.state) };
  }
}
