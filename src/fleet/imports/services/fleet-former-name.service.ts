import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { In, IsNull, Repository } from 'typeorm';

import { FleetNameAliasEntity } from '../../entities/fleet-name-alias.entity';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import {
  toComparableExactGameName,
  toNormalisedExactGameName,
} from '../../utilities/exact-game-name.utility';
import {
  FleetFormerNameDto,
  FleetFormerNamesDto,
  RecordFleetFormerNameDto,
  RemoveFleetFormerNameDto,
} from '../dto/fleet-former-name.dto';
import { RosterImportSourceEntity } from '../entities/roster-import-source.entity';

/** Who each former name was recorded and removed by, for reading. */
const RELATIONS = {
  recordedBy: { profile: true },
  removedBy: { profile: true },
} as const;

/**
 * A Fleet's former names, recorded by the people who investigate its roster
 * (FC-050).
 *
 * In-game Fleets are renamed, and an export from before a rename carries the
 * old name in its filename. The roster import has always matched a recorded
 * former name, and until FC-050 nothing could record one. Steve's decision
 * of 30 September 2026: the Fleet's Owner and Admins record them, with the
 * dates the name was used and a reason, and can remove one.
 *
 * **Deliberately, never from a file.** A name is accepted only when somebody
 * states it, because an importer that learned names from filenames could be
 * told a Fleet's name by whoever uploaded next, and could file one Fleet's
 * roster under another's.
 *
 * **Removal keeps the record.** An import that matched a name goes on saying
 * which name it matched, so a removed name is soft-deleted with who removed it
 * and why, and from then on matches nothing new.
 */
@Injectable()
export class FleetFormerNameService {
  private readonly _logger = new Logger(FleetFormerNameService.name);

  /**
   * Creates an instance of FleetFormerNameService.
   *
   * @param _aliases - The names Fleets have been known by.
   * @param _fleets - Read for each Fleet's current name.
   * @param _imports - Counted for the imports that matched each name.
   */
  constructor(
    @InjectRepository(FleetNameAliasEntity)
    private readonly _aliases: Repository<FleetNameAliasEntity>,
    @InjectRepository(StoFleetEntity)
    private readonly _fleets: Repository<StoFleetEntity>,
    @InjectRepository(RosterImportSourceEntity)
    private readonly _imports: Repository<RosterImportSourceEntity>,
  ) {}

  /**
   * Lists a Fleet's former names, in use and removed.
   *
   * @param fleetId - The Fleet.
   * @param mayChange - Whether the reader may record and remove them.
   * @returns The names.
   */
  async list(
    fleetId: string,
    mayChange: boolean,
  ): Promise<FleetFormerNamesDto> {
    const names = await this._aliases.find({
      where: { fleetId },
      withDeleted: true,
      relations: RELATIONS,
      order: { validTo: 'DESC', recordedAt: 'DESC' },
    });
    const matched = await this.matchesOf(names.map(name => name.id));

    const described = names.map(name =>
      this.describe(name, matched.get(name.id) ?? 0),
    );

    return {
      items: described.filter(name => name.removedAt === null),
      removed: described
        .filter(name => name.removedAt !== null)
        .sort(
          (a, b) =>
            (b.removedAt as Date).getTime() - (a.removedAt as Date).getTime(),
        ),
      mayChange,
    };
  }

  /**
   * Records a former name.
   *
   * @param fleetId - The Fleet.
   * @param userId - Who is recording it.
   * @param dto - The name, when it was used, and why.
   * @returns The name as recorded.
   * @throws BadRequestException when the interval is backwards or not over.
   * @throws ConflictException when it is the Fleet's name now, or already
   *   recorded for part of that time.
   */
  async record(
    fleetId: string,
    userId: string,
    dto: RecordFleetFormerNameDto,
  ): Promise<FleetFormerNameDto> {
    if (dto.validTo.getTime() <= dto.validFrom.getTime()) {
      throw new BadRequestException(
        'The name has to stop being used after it began.',
      );
    }

    if (dto.validTo.getTime() > Date.now()) {
      throw new BadRequestException(
        'A former name has to have stopped being used by now.',
      );
    }

    const fleet = await this._fleets.findOneOrFail({ where: { id: fleetId } });
    const comparable = toComparableExactGameName(dto.exactName);

    if (toComparableExactGameName(fleet.exactGameName) === comparable) {
      throw new ConflictException('That is the Fleet’s name now.');
    }

    const recorded = await this._aliases.find({ where: { fleetId } });
    const overlapping = recorded.some(
      name =>
        toComparableExactGameName(name.exactName) === comparable &&
        name.validFrom.getTime() < dto.validTo.getTime() &&
        (name.validTo === null ||
          dto.validFrom.getTime() < name.validTo.getTime()),
    );

    if (overlapping) {
      throw new ConflictException(
        'That name is already recorded for part of that time.',
      );
    }

    const saved = await this._aliases.save(
      this._aliases.create({
        fleetId,
        exactName: dto.exactName,
        exactNameNormalized: toNormalisedExactGameName(dto.exactName),
        validFrom: dto.validFrom,
        validTo: dto.validTo,
        reason: dto.reason,
        recordedByUserId: userId,
      }),
    );

    // Identifiers only. The name is somebody's text, and a log line is a
    // sink like any other.
    this._logger.log(
      `[record] Former Fleet name recorded - AliasId: ${saved.id}, ` +
        `FleetId: ${fleetId}, UserId: ${userId}`,
    );

    return this.read(fleetId, saved.id);
  }

  /**
   * Removes a former name, keeping who removed it and why.
   *
   * @param fleetId - The Fleet.
   * @param aliasId - The name.
   * @param userId - Who is removing it.
   * @param dto - Why.
   * @returns The name as it now stands.
   * @throws NotFoundException when the Fleet has no such name in use. One of
   *   another Fleet is reported the same way.
   */
  async remove(
    fleetId: string,
    aliasId: string,
    userId: string,
    dto: RemoveFleetFormerNameDto,
  ): Promise<FleetFormerNameDto> {
    // One statement, so the reason can never be missing from a removal,
    // and only while it is in use, so two removals cannot both succeed.
    const [, affected] = (await this._aliases.query(
      `UPDATE "sto_info_app"."fleet_name_alias"
          SET "deletedAt" = now(), "removedByUserId" = $3, "removalReason" = $4
        WHERE "id" = $1 AND "fleetId" = $2 AND "deletedAt" IS NULL`,
      [aliasId, fleetId, userId, dto.reason],
    )) as [unknown, number];

    if (affected === 0) {
      throw new NotFoundException('Not found');
    }

    this._logger.log(
      `[remove] Former Fleet name removed - AliasId: ${aliasId}, ` +
        `FleetId: ${fleetId}, UserId: ${userId}`,
    );

    return this.read(fleetId, aliasId);
  }

  /**
   * Reads one former name, removed or not.
   *
   * @param fleetId - The Fleet.
   * @param aliasId - The name.
   * @returns It, described.
   */
  private async read(
    fleetId: string,
    aliasId: string,
  ): Promise<FleetFormerNameDto> {
    const name = await this._aliases.findOneOrFail({
      where: { id: aliasId, fleetId },
      withDeleted: true,
      relations: RELATIONS,
    });
    const matched = await this.matchesOf([aliasId]);

    return this.describe(name, matched.get(aliasId) ?? 0);
  }

  /**
   * Counts the imports that matched each of some names.
   *
   * @param aliasIds - The names.
   * @returns The count for each name any import matched.
   */
  private async matchesOf(
    aliasIds: readonly string[],
  ): Promise<Map<string, number>> {
    if (aliasIds.length === 0) {
      return new Map();
    }

    const imports = await this._imports.find({
      select: { id: true, matchedAliasId: true },
      where: { matchedAliasId: In([...aliasIds]), replacedAt: IsNull() },
    });
    const counts = new Map<string, number>();

    for (const found of imports) {
      const aliasId = found.matchedAliasId as string;

      counts.set(aliasId, (counts.get(aliasId) ?? 0) + 1);
    }

    return counts;
  }

  /**
   * Describes a former name for its readers.
   *
   * @param name - The name, with who recorded and removed it.
   * @param matchedImports - How many imports matched it.
   * @returns It, described.
   */
  private describe(
    name: FleetNameAliasEntity,
    matchedImports: number,
  ): FleetFormerNameDto {
    return {
      id: name.id,
      exactName: name.exactName,
      validFrom: name.validFrom,
      validTo: name.validTo,
      reason: name.reason,
      recordedByName: name.recordedBy?.profile?.username ?? null,
      recordedAt: name.recordedAt,
      removedAt: name.deletedAt,
      removedByName: name.removedBy?.profile?.username ?? null,
      removalReason: name.removalReason,
      matchedImports,
    };
  }
}
