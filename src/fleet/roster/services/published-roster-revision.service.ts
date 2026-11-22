import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { RosterProjectionInputEntity } from '../../projection/entities/roster-projection-input.entity';
import { RosterProjectionEntity } from '../../projection/entities/roster-projection.entity';
import { RosterProjectionInputOutcome } from '../../projection/enums/roster-projection-input-outcome.enum';

/** The revision of a Fleet's roster history a reader has pinned itself to. */
export interface PublishedRosterRevision {
  /** The revision, or 0 before the first is published. */
  readonly revision: number;
  /** When it was published, or null before the first. */
  readonly publishedAt: Date | null;
  /** Whether a change is waiting for a newer one. */
  readonly stale: boolean;
}

/** One export a revision read. */
export interface EffectiveRosterExport {
  /** The import it arrived as. */
  readonly importId: string;
  /** The instant it was taken. */
  readonly exportedAt: Date;
  /** Whether it was marked partial. */
  readonly partial: boolean;
}

/**
 * Pins a reader of a Fleet's roster history to one revision (FC-020).
 *
 * Every page of the roster, the history and the reports reads the published
 * revision number first and then only that revision's rows, as FC-019's
 * status route does. A replay can publish the next revision between two of
 * a reader's queries; the one before stays until the publish after, so a
 * reader pinned to it never mixes two.
 */
@Injectable()
export class PublishedRosterRevisionService {
  /**
   * Creates an instance of PublishedRosterRevisionService.
   *
   * @param _projections - Which revision each Fleet has published.
   * @param _inputs - What each revision made of each import.
   */
  constructor(
    @InjectRepository(RosterProjectionEntity)
    private readonly _projections: Repository<RosterProjectionEntity>,
    @InjectRepository(RosterProjectionInputEntity)
    private readonly _inputs: Repository<RosterProjectionInputEntity>,
  ) {}

  /**
   * Reads which revision a Fleet has published.
   *
   * @param fleetId - The Fleet.
   * @returns The revision, when, and whether it is stale. A Fleet never
   *   replayed is revision 0 and not stale.
   */
  async pin(fleetId: string): Promise<PublishedRosterRevision> {
    const projection = await this._projections.findOne({
      where: { fleetId },
      select: {
        fleetId: true,
        revision: true,
        publishedAt: true,
        requested: true,
        built: true,
      },
    });

    if (projection === null) {
      return { revision: 0, publishedAt: null, stale: false };
    }

    return {
      revision: projection.revision,
      publishedAt: projection.publishedAt,
      stale: projection.requested > projection.built,
    };
  }

  /**
   * Lists the exports one revision read, oldest first.
   *
   * @param fleetId - The Fleet.
   * @param revision - The revision pinned.
   * @returns Its effective exports. None for revision 0.
   */
  async effectiveExports(
    fleetId: string,
    revision: number,
  ): Promise<EffectiveRosterExport[]> {
    if (revision === 0) {
      return [];
    }

    const inputs = await this._inputs.find({
      where: {
        fleetId,
        revision,
        outcome: RosterProjectionInputOutcome.EFFECTIVE,
      },
      select: { importSourceId: true, exportedAt: true, partial: true },
      order: { exportedAt: 'ASC' },
    });

    return inputs.map(input => ({
      importId: input.importSourceId,
      exportedAt: input.exportedAt,
      partial: input.partial,
    }));
  }
}
