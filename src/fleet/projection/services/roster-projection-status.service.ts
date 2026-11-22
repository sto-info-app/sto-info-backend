import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { RosterProjectionStatusDto } from '../dto/roster-projection-status.dto';
import { RosterProjectionInputEntity } from '../entities/roster-projection-input.entity';
import { RosterProjectionEntity } from '../entities/roster-projection.entity';

/**
 * Reports where a Fleet's roster history stands (FC-019).
 *
 * Reads the projection row first and then only its published revision's
 * inputs, the way every reader of the projection pins itself to one
 * revision, so what it reports is one revision even if a replay publishes
 * the next between the two reads.
 */
@Injectable()
export class RosterProjectionStatusService {
  /**
   * Creates an instance of RosterProjectionStatusService.
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
   * Reports one Fleet.
   *
   * @param fleetId - The Fleet.
   * @returns Its published revision, whether it is stale, and its inputs.
   */
  async status(fleetId: string): Promise<RosterProjectionStatusDto> {
    const projection = await this._projections.findOne({
      where: { fleetId },
    });

    if (projection === null || projection.revision === 0) {
      return {
        revision: 0,
        publishedAt: null,
        stale: projection !== null && projection.requested > projection.built,
        latestImportId: null,
        inputs: [],
      };
    }

    const inputs = await this._inputs.find({
      where: { fleetId, revision: projection.revision },
      relations: { importSource: true },
      order: { exportedAt: 'ASC', importSource: { uploadedAt: 'ASC' } },
    });

    return {
      revision: projection.revision,
      publishedAt: projection.publishedAt,
      stale: projection.requested > projection.built,
      latestImportId: projection.latestImportId,
      inputs: inputs.map(input => ({
        importId: input.importSourceId,
        originalFilename: input.importSource.originalFilename,
        exportedAt: input.exportedAt,
        outcome: input.outcome,
        partial: input.partial,
        excludedRows: input.excludedRows,
      })),
    };
  }
}
