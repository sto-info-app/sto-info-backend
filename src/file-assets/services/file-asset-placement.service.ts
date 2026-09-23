import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { In, LessThan, Repository } from 'typeorm';

import { FileAssetPlacementEntity } from '../entities/file-asset-placement.entity';
import { FileAssetPlacementState } from '../enums/file-asset-placement-state.enum';
import { FileAssetSlot } from '../enums/file-asset-slot.enum';
import { FileAssetSubject } from '../enums/file-asset-subject.enum';

/** Which slot a picture is going into, and what the publisher will need. */
export interface PlaceAssetInput {
  /** The asset being placed. */
  readonly assetId: string;
  /** The kind of record it belongs to. */
  readonly subject: FileAssetSubject;
  /** Which record of that kind. */
  readonly subjectId: string;
  /** Which picture of that record. */
  readonly slot: FileAssetSlot;
  /** What the publisher will need and cannot work out for itself. */
  readonly detail?: Record<string, unknown> | null;
}

/** What placing an asset did. */
export interface PlacementOutcome {
  /** The new placement, pending a verdict. */
  readonly placement: FileAssetPlacementEntity;
  /**
   * The upload this one overtook, when there was one.
   *
   * Its bytes are still in quarantine and its asset is still on its way
   * through a scanner. The caller drops both, because the last thing
   * somebody sent is the thing they get.
   */
  readonly superseded: FileAssetPlacementEntity | null;
}

/**
 * Which picture is in which slot, and what is on its way to one.
 *
 * Thin by design: every method here is one question about one row, and the
 * decisions about what to do with the answers live in
 * {@link AssetIngressService} and {@link AssetPublicationService}. The
 * awkward part of an asynchronous upload is not the bookkeeping, it is the
 * ordering, and the ordering is easier to read in one place than spread
 * across a service that also writes rows.
 *
 * The two uniqueness rules — one pending and one active placement per slot —
 * are enforced by partial indexes rather than by the reads here. A check
 * performed before an insert is a check two requests can pass at once.
 */
@Injectable()
export class FileAssetPlacementService {
  private readonly _logger = new Logger(FileAssetPlacementService.name);

  /**
   * Creates an instance of FileAssetPlacementService.
   *
   * @param _repository - Repository of placements.
   */
  constructor(
    @InjectRepository(FileAssetPlacementEntity)
    private readonly _repository: Repository<FileAssetPlacementEntity>,
  ) {}

  /**
   * Claims a slot for an asset that is about to be scanned.
   *
   * Any upload already on its way to the same slot is superseded first, which
   * is both what a person expects and what the pending index requires.
   *
   * @param input - The asset, the slot and anything the publisher will need.
   * @returns The new placement, and the one it overtook.
   */
  async placePending(input: PlaceAssetInput): Promise<PlacementOutcome> {
    const existing = await this.findInState(
      input.subject,
      input.subjectId,
      input.slot,
      FileAssetPlacementState.PENDING,
    );

    const superseded =
      existing === null
        ? null
        : await this.settle(existing, FileAssetPlacementState.SUPERSEDED);

    const placement = await this._repository.save(
      this._repository.create({
        assetId: input.assetId,
        state: FileAssetPlacementState.PENDING,
        subject: input.subject,
        subjectId: input.subjectId,
        slot: input.slot,
        detail: input.detail ?? null,
        settledAt: null,
      }),
    );

    this._logger.log(
      `[placePending] Slot claimed - AssetId: ${input.assetId}, ` +
        `Subject: ${input.subject}, Slot: ${input.slot}, ` +
        `Superseded: ${superseded?.assetId ?? 'none'}`,
    );

    return { placement, superseded };
  }

  /**
   * Makes a placement the one its slot shows.
   *
   * Whatever the slot showed before is superseded in the same breath, since
   * only one placement may be active. That row is how the previous picture's
   * asset is found afterwards, which is what lets a replacement withdraw the
   * bytes it replaced rather than leaving them published for ever.
   *
   * @param placement - The pending placement.
   * @returns The now-active placement, and the one it replaced.
   */
  async activate(placement: FileAssetPlacementEntity): Promise<{
    active: FileAssetPlacementEntity;
    replaced: FileAssetPlacementEntity | null;
  }> {
    const existing = await this.findInState(
      placement.subject,
      placement.subjectId,
      placement.slot,
      FileAssetPlacementState.ACTIVE,
    );

    const replaced =
      existing === null
        ? null
        : await this.settle(existing, FileAssetPlacementState.SUPERSEDED);

    placement.state = FileAssetPlacementState.ACTIVE;
    placement.settledAt = new Date();

    const active = await this._repository.save(placement);

    return { active, replaced };
  }

  /**
   * Settles a placement that will never become active.
   *
   * @param placement - The placement.
   * @param state - What became of it.
   * @returns The settled placement.
   */
  async settle(
    placement: FileAssetPlacementEntity,
    state: FileAssetPlacementState,
  ): Promise<FileAssetPlacementEntity> {
    placement.state = state;
    placement.settledAt = new Date();

    return this._repository.save(placement);
  }

  /**
   * Holds a pending placement until somebody decides about it.
   *
   * Not {@link settle}: a held placement may yet go into force. It carries
   * `settledAt` all the same, because the scanner has answered and the sweep
   * must not mistake it for an upload nothing came back for.
   *
   * @param placement - The pending placement.
   * @returns The held placement.
   */
  async hold(
    placement: FileAssetPlacementEntity,
  ): Promise<FileAssetPlacementEntity> {
    placement.state = FileAssetPlacementState.HELD;
    placement.settledAt = new Date();

    return this._repository.save(placement);
  }

  /**
   * Finds the placement a verdict is about.
   *
   * An asset is placed at most once, so this is a single row or none. None
   * means the upload was interrupted before it claimed a slot, which leaves
   * nothing for a verdict to publish into.
   *
   * @param assetId - The asset.
   * @returns The placement, or null.
   */
  async findByAssetId(
    assetId: string,
  ): Promise<FileAssetPlacementEntity | null> {
    return this._repository.findOne({ where: { assetId } });
  }

  /**
   * Finds the placements of several assets at once.
   *
   * For a listing, which would otherwise ask once per row. An asset is placed
   * at most once, so there is at most one row per asset; one never placed is
   * simply absent.
   *
   * @param assetIds - The assets.
   * @returns Their placements, in no particular order.
   */
  async findByAssetIds(
    assetIds: readonly string[],
  ): Promise<FileAssetPlacementEntity[]> {
    if (assetIds.length === 0) {
      return [];
    }

    return this._repository.find({ where: { assetId: In([...assetIds]) } });
  }

  /**
   * Reports what a slot has to say for itself.
   *
   * The most recent placement that is either live or worth telling somebody
   * about: an upload in flight, a refusal they have not replaced yet, or the
   * picture the slot shows. Ordered rather than filtered by state, because
   * which of the three matters is decided by which happened last.
   *
   * @param subject - The kind of record.
   * @param subjectId - Which record.
   * @param slot - Which picture of it.
   * @returns The placement, or null when the slot has no history.
   */
  async findCurrentForSlot(
    subject: FileAssetSubject,
    subjectId: string,
    slot: FileAssetSlot,
  ): Promise<FileAssetPlacementEntity | null> {
    const placements = await this._repository.find({
      where: [
        {
          subject,
          subjectId,
          slot,
          state: FileAssetPlacementState.PENDING,
        },
        {
          subject,
          subjectId,
          slot,
          state: FileAssetPlacementState.ACTIVE,
        },
        {
          subject,
          subjectId,
          slot,
          state: FileAssetPlacementState.REJECTED,
        },
      ],
      order: { createdAt: 'DESC' },
      take: 1,
    });

    return placements[0] ?? null;
  }

  /**
   * Finds the picture a slot is showing.
   *
   * @param subject - The kind of record.
   * @param subjectId - Which record.
   * @param slot - Which picture of it.
   * @returns The active placement, or null.
   */
  async findActiveForSlot(
    subject: FileAssetSubject,
    subjectId: string,
    slot: FileAssetSlot,
  ): Promise<FileAssetPlacementEntity | null> {
    return this.findInState(
      subject,
      subjectId,
      slot,
      FileAssetPlacementState.ACTIVE,
    );
  }

  /**
   * Finds uploads that have been pending too long to still be arriving.
   *
   * @param before - The moment a placement had to have been created before.
   * @param limit - The most to return in one sweep.
   * @returns The stale placements, oldest first.
   */
  async findStalePending(
    before: Date,
    limit: number,
  ): Promise<FileAssetPlacementEntity[]> {
    return this._repository.find({
      where: {
        state: FileAssetPlacementState.PENDING,
        createdAt: LessThan(before),
      },
      order: { createdAt: 'ASC' },
      take: limit,
    });
  }

  /**
   * Finds one placement in one state.
   *
   * @param subject - The kind of record.
   * @param subjectId - Which record.
   * @param slot - Which picture of it.
   * @param state - The state to look for.
   * @returns The placement, or null.
   */
  private async findInState(
    subject: FileAssetSubject,
    subjectId: string,
    slot: FileAssetSlot,
    state: FileAssetPlacementState,
  ): Promise<FileAssetPlacementEntity | null> {
    return this._repository.findOne({
      where: { subject, subjectId, slot, state },
    });
  }
}
