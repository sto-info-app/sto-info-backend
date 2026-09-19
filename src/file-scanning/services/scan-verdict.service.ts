import { Injectable, Logger } from '@nestjs/common';

import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';
import {
  FileAssetService,
  FileAssetVerdict,
} from 'src/file-assets/services/file-asset.service';

import { ScanVerdictMessage } from '../contract/file-scan-contract';

/** Why a verdict was not acted on. */
export type VerdictRefusal =
  /** No such asset. Nothing to do and nothing to worry about. */
  | 'NO_SUCH_ASSET'
  /** The verdict is about an object the asset no longer holds. */
  | 'NOT_THESE_BYTES'
  /** The asset is not waiting for a verdict. */
  | 'NOT_SCANNING'
  /** A clean verdict that did not say which bytes it cleared. */
  | 'UNMEASURED_CLEAN';

/** What applying a verdict did. */
export interface VerdictOutcome {
  /** Whether the registry moved. */
  readonly applied: boolean;
  /** Why it did not, when it did not. */
  readonly refusal: VerdictRefusal | null;
}

/**
 * Turns a scanner's answer into a registry state.
 *
 * The consuming half of ADR-0006's contract, and the only place in the site
 * that acts on anything the worker says. It is written as a sequence of
 * refusals because every one of them is a case the second acceptance
 * criterion names: a verdict that arrives after the asset has moved on, a
 * verdict about bytes that have since been replaced, a verdict delivered
 * twice.
 *
 * **It never publishes.** The best a clean verdict achieves is `CLEAN`, which
 * is not serveable. Publication needs an allowed type, successful processing
 * and an audience, and a scanner knows none of those — ADR-0015 decision 3.
 * FC-012 is what calls `publish`, against a fresh look at the registry.
 *
 * **It rechecks the hash rather than trusting the message.** ADR-0006
 * required business publication to be performed "against current permissions
 * with a hash recheck", and this is that recheck: the verdict says which
 * bytes it was asked about, and if the registry now records different ones
 * then the asset was replaced while the scanner was working and the answer
 * belongs to a file that no longer exists.
 */
@Injectable()
export class ScanVerdictService {
  private readonly _logger = new Logger(ScanVerdictService.name);

  /**
   * Creates an instance of ScanVerdictService.
   *
   * @param _fileAssetService - The asset registry.
   */
  constructor(private readonly _fileAssetService: FileAssetService) {}

  /**
   * Applies one verdict.
   *
   * @param verdict - What the worker concluded.
   * @returns Whether the registry moved, and why not when it did not.
   */
  async apply(verdict: ScanVerdictMessage): Promise<VerdictOutcome> {
    const asset = await this._fileAssetService.findById(verdict.assetId);

    if (asset === null) {
      return this.refuse(verdict, 'NO_SUCH_ASSET');
    }

    if (!this.isAboutTheseBytes(asset, verdict)) {
      return this.refuse(verdict, 'NOT_THESE_BYTES');
    }

    if (asset.state !== FileAssetState.SCANNING) {
      // A duplicate delivery lands here, and so does a verdict that lost a
      // race with a second one. Both are refused the same way, which is what
      // makes at-least-once delivery safe without a deduplication table.
      return this.refuse(verdict, 'NOT_SCANNING');
    }

    return this.applyOutcome(asset, verdict);
  }

  /**
   * Moves the registry, now that the verdict has been accepted.
   *
   * @param asset - The asset.
   * @param verdict - What the worker concluded.
   * @returns Whether the registry moved, and why not when it did not.
   */
  private async applyOutcome(
    asset: FileAssetEntity,
    verdict: ScanVerdictMessage,
  ): Promise<VerdictOutcome> {
    const recorded: FileAssetVerdict = {
      engine: verdict.engine,
      engineVersion: verdict.engineVersion,
      signatureVersion: verdict.signatureVersion,
      policyVersion: verdict.policyVersion,
    };

    if (verdict.outcome === 'REJECTED') {
      await this._fileAssetService.reject(
        asset.id,
        verdict.rejectionCode as string,
        recorded,
      );

      return { applied: true, refusal: null };
    }

    if (verdict.outcome === 'RETRY') {
      await this._fileAssetService.markRetryPending(asset.id);

      return { applied: true, refusal: null };
    }

    if (verdict.observedSha256 !== asset.sha256) {
      // The contract already refuses a clean verdict with no observed hash,
      // and the worker already refuses one that does not match. This is the
      // third check of the same thing, in the one place where being wrong
      // would mean publishing bytes nobody cleared.
      return this.refuse(verdict, 'UNMEASURED_CLEAN');
    }

    await this._fileAssetService.recordCleanVerdict(asset.id, recorded);

    this._logger.log(
      `[applyOutcome] Clean, and not yet available - AssetId: ${asset.id}`,
    );

    return { applied: true, refusal: null };
  }

  /**
   * Reports whether a verdict is about the object the registry holds now.
   *
   * @param asset - The asset.
   * @param verdict - What the worker concluded.
   * @returns True when the two agree about which bytes these are.
   */
  private isAboutTheseBytes(
    asset: FileAssetEntity,
    verdict: ScanVerdictMessage,
  ): boolean {
    return (
      asset.objectKey === verdict.objectKey &&
      asset.objectVersion === verdict.objectVersion &&
      asset.sha256 === verdict.expectedSha256
    );
  }

  /**
   * Records that a verdict was not acted on.
   *
   * At `log` rather than `warn`. Every refusal here is a normal consequence
   * of a queue that delivers at least once, and an alert that fires on
   * ordinary operation is an alert somebody turns off.
   *
   * @param verdict - What the worker concluded.
   * @param refusal - Why it was not acted on.
   * @returns The outcome.
   */
  private refuse(
    verdict: ScanVerdictMessage,
    refusal: VerdictRefusal,
  ): VerdictOutcome {
    this._logger.log(
      `[apply] Verdict not applied - AssetId: ${verdict.assetId}, ` +
        `Reason: ${refusal}`,
    );

    return { applied: false, refusal };
  }
}
