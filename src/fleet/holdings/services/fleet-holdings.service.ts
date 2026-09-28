import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, EntityManager, In, IsNull } from 'typeorm';

import { FleetAuthorisationService } from '../../authorisation/fleet-authorisation.service';
import { FLEET_CAPABILITIES } from '../../authorisation/fleet-capability.constants';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { FleetScopeStatus } from '../../enums/fleet-scope-status.enum';
import { optionalReason } from '../../governance/utilities/governance-scope.utility';
import { usernamesFor } from '../../recruitment/utilities/recruitment-names.utility';
import {
  FleetHoldingChangeDto,
  FleetHoldingHistoryPageDto,
  FleetHoldingHistoryQueryDto,
  FleetHoldingsDto,
  RecordFleetHoldingDto,
} from '../dto/fleet-holdings.dto';
import { FleetHoldingChangeEntity } from '../entities/fleet-holding-change.entity';
import { FleetHoldingHistoryEntity } from '../entities/fleet-holding-history.entity';
import { FleetHoldingStatusEntity } from '../entities/fleet-holding-status.entity';
import { FleetHoldingTierEntity } from '../entities/fleet-holding-tier.entity';
import { FleetHoldingTrackEntity } from '../entities/fleet-holding-track.entity';
import { FleetHoldingTypeEntity } from '../entities/fleet-holding-type.entity';

/** Changes shown per page when the caller does not say. */
const DEFAULT_HISTORY_PAGE_SIZE = 25;

/** A track, with the tiers it may be at. */
interface CatalogueTrack {
  readonly track: FleetHoldingTrackEntity;
  readonly tiers: ReadonlySet<number>;
  readonly maxTier: number;
}

/** A holding, with its tracks in order. */
interface CatalogueHolding {
  readonly holding: FleetHoldingTypeEntity;
  readonly tracks: readonly CatalogueTrack[];
}

/** What a viewer may do with a Fleet's holdings. */
interface HoldingsViewer {
  /** Whether they hold `holdings.write` there. */
  readonly mayWrite: boolean;
  /** Whether they are shown who recorded each change. */
  readonly seesRecorders: boolean;
}

/**
 * The tiers of a Fleet's holdings, recorded by hand, and their history
 * (FC-023).
 *
 * Steve's decisions of 28 September 2026:
 *
 * - The catalogue is seven holdings from the STO Wiki, each with a track of
 *   its own and its departments. Each track is recorded on its own, within
 *   its own bounds; tracks are not checked against each other.
 * - A track never recorded is at tier 0. Any valid tier may be recorded,
 *   lower as well as higher, with an optional reason.
 * - Holdings are public: anybody who may see the Fleet sees its tiers and
 *   their history. Who recorded a change is shown to the Fleet's members
 *   alone.
 * - One save records one holding, and writes one history row for each track
 *   it moved.
 *
 * There is no XP, and nothing is worked out from contributions.
 */
@Injectable()
export class FleetHoldingsService {
  /**
   * Creates an instance of FleetHoldingsService.
   *
   * @param _dataSource - The database.
   * @param _authorisation - Which capabilities a viewer holds.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _authorisation: FleetAuthorisationService,
  ) {}

  /**
   * Describes a Fleet's holdings for one viewer, who may see the Fleet.
   *
   * @param fleet - The Fleet.
   * @param userId - The viewer, or null when signed out.
   * @returns Every holding in the catalogue, with where the Fleet stands.
   */
  async view(
    fleet: StoFleetEntity,
    userId: string | null,
  ): Promise<FleetHoldingsDto> {
    const manager = this._dataSource.manager;
    const [catalogue, statuses, viewer] = await Promise.all([
      this.catalogue(manager),
      manager.find(FleetHoldingStatusEntity, { where: { fleetId: fleet.id } }),
      this.viewer(fleet, userId),
    ]);
    const current = new Map(statuses.map(status => [status.trackCode, status]));

    return {
      catalogueVersion: Math.max(
        ...catalogue.map(entry => entry.holding.catalogueVersion),
      ),
      mayRecord: viewer.mayWrite && fleet.status === FleetScopeStatus.ACTIVE,
      holdings: catalogue.map(({ holding, tracks }) => ({
        code: holding.code,
        name: holding.name,
        sourceUrl: holding.sourceUrl,
        sourceEditedOn: holding.sourceEditedOn,
        tracks: tracks.map(({ track, maxTier }) => {
          const status = current.get(track.code);

          return {
            code: track.code,
            name: track.name,
            isDepartment: track.isDepartment,
            maxTier,
            tier: status?.tier ?? 0,
            updatedAt: status?.updatedAt ?? null,
          };
        }),
      })),
    };
  }

  /**
   * Reads a page of a Fleet's holdings history, newest first.
   *
   * @param fleet - The Fleet, which the viewer may see.
   * @param userId - The viewer, or null when signed out.
   * @param query - Which page.
   * @returns The changes, with who made them for a member.
   */
  async history(
    fleet: StoFleetEntity,
    userId: string | null,
    query: FleetHoldingHistoryQueryDto,
  ): Promise<FleetHoldingHistoryPageDto> {
    const manager = this._dataSource.manager;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_HISTORY_PAGE_SIZE;
    const [[changes, total], catalogue, viewer] = await Promise.all([
      manager.findAndCount(FleetHoldingChangeEntity, {
        where: { fleetId: fleet.id },
        order: { createdAt: 'DESC', id: 'DESC' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.catalogue(manager),
      this.viewer(fleet, userId),
    ]);
    const moves =
      changes.length === 0
        ? []
        : await manager.find(FleetHoldingHistoryEntity, {
            where: { changeId: In(changes.map(change => change.id)) },
          });
    const names = viewer.seesRecorders
      ? await usernamesFor(
          manager,
          changes.map(change => change.actorUserId),
        )
      : new Map<string, string>();

    return {
      items: changes.map(change =>
        this.describeChange(
          change,
          moves.filter(move => move.changeId === change.id),
          catalogue,
          viewer.seesRecorders && change.actorUserId !== null
            ? (names.get(change.actorUserId) ?? null)
            : null,
        ),
      ),
      recordersShown: viewer.seesRecorders,
      page,
      pageSize,
      total,
    };
  }

  /**
   * Records the tiers of one of a Fleet's holdings.
   *
   * The Fleet's row is locked first, so two recorders are taken one at a
   * time, and each history row says truly what the track moved from.
   *
   * @param communityId - The Community named in the route.
   * @param fleetId - The Fleet.
   * @param holdingCode - The holding.
   * @param dto - The tracks to set, and why.
   * @param userId - The recorder, who holds `holdings.write` there.
   * @throws NotFoundException for an unknown Fleet or holding.
   * @throws ConflictException when the Fleet is closed.
   * @throws BadRequestException for a track of another holding, a track
   *   named twice, a tier out of bounds, or nothing to change.
   */
  async record(
    communityId: string,
    fleetId: string,
    holdingCode: string,
    dto: RecordFleetHoldingDto,
    userId: string,
  ): Promise<void> {
    await this._dataSource.transaction(async manager => {
      const fleet = await manager.findOne(StoFleetEntity, {
        where: { id: fleetId, communityId, deletedAt: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });

      if (!fleet) {
        throw new NotFoundException('Not found');
      }

      if (fleet.status !== FleetScopeStatus.ACTIVE) {
        throw new ConflictException(
          'This Fleet is closed, so its holdings cannot change.',
        );
      }

      const entry = (await this.catalogue(manager)).find(
        ({ holding }) => holding.code === holdingCode,
      );

      if (entry === undefined) {
        throw new NotFoundException('No such holding.');
      }

      const wanted = this.validate(entry, dto);
      const statuses = await manager.find(FleetHoldingStatusEntity, {
        where: { fleetId, holdingTypeCode: holdingCode },
      });
      const current = new Map(
        statuses.map(status => [status.trackCode, status.tier]),
      );
      const moves = [...wanted].filter(
        ([track, tier]) => (current.get(track) ?? 0) !== tier,
      );

      if (moves.length === 0) {
        throw new BadRequestException('Nothing has changed.');
      }

      const now = new Date();
      const change = await manager.save(
        manager.create(FleetHoldingChangeEntity, {
          fleetId,
          communityId,
          holdingTypeCode: holdingCode,
          actorUserId: userId,
          reason: optionalReason(dto.reason),
          createdAt: now,
        }),
      );

      await manager.insert(
        FleetHoldingHistoryEntity,
        moves.map(([track, tier]) => ({
          changeId: change.id,
          fleetId,
          holdingTypeCode: holdingCode,
          trackCode: track,
          tierBefore: current.get(track) ?? 0,
          tier,
        })),
      );
      await manager.upsert(
        FleetHoldingStatusEntity,
        moves.map(([track, tier]) => ({
          fleetId,
          communityId,
          holdingTypeCode: holdingCode,
          trackCode: track,
          tier,
          updatedAt: now,
        })),
        ['fleetId', 'trackCode'],
      );
    });
  }

  /**
   * Checks what a recorder sent against the holding's catalogue entry.
   *
   * @param entry - The holding.
   * @param dto - What was sent.
   * @returns The tier wanted for each track named, in the holding's order.
   * @throws BadRequestException for a track of another holding, a track
   *   named twice, or a tier the track does not have.
   */
  private validate(
    entry: CatalogueHolding,
    dto: RecordFleetHoldingDto,
  ): Map<string, number> {
    const byCode = new Map(
      entry.tracks.map(track => [track.track.code, track]),
    );
    const wanted = new Map<string, number>();

    for (const { track: code, tier } of dto.tiers) {
      const track = byCode.get(code);

      if (track === undefined) {
        throw new BadRequestException(
          `${entry.holding.name} has no track ${code}.`,
        );
      }

      if (wanted.has(code)) {
        throw new BadRequestException(
          `${track.track.name} is given more than once.`,
        );
      }

      if (!track.tiers.has(tier)) {
        throw new BadRequestException(
          `${track.track.name} goes from tier 0 to ${track.maxTier}.`,
        );
      }

      wanted.set(code, tier);
    }

    return new Map(
      entry.tracks
        .filter(({ track }) => wanted.has(track.code))
        .map(({ track }) => [track.code, wanted.get(track.code) as number]),
    );
  }

  /**
   * Puts one change as the history shows it.
   *
   * @param change - The change.
   * @param moves - The tracks it moved.
   * @param catalogue - The catalogue, for names and order.
   * @param recordedBy - Who recorded it, where the viewer is shown.
   * @returns The change.
   */
  private describeChange(
    change: FleetHoldingChangeEntity,
    moves: readonly FleetHoldingHistoryEntity[],
    catalogue: readonly CatalogueHolding[],
    recordedBy: string | null,
  ): FleetHoldingChangeDto {
    const entry = catalogue.find(
      ({ holding }) => holding.code === change.holdingTypeCode,
    ) as CatalogueHolding;
    const byTrack = new Map(moves.map(move => [move.trackCode, move]));

    return {
      id: change.id,
      holdingCode: entry.holding.code,
      holdingName: entry.holding.name,
      recordedAt: change.createdAt,
      recordedBy,
      reason: change.reason,
      moves: entry.tracks
        .filter(({ track }) => byTrack.has(track.code))
        .map(({ track }) => {
          const move = byTrack.get(track.code) as FleetHoldingHistoryEntity;

          return {
            track: track.code,
            trackName: track.name,
            isDepartment: track.isDepartment,
            from: move.tierBefore,
            to: move.tier,
          };
        }),
    };
  }

  /**
   * Works out what a viewer may do with a Fleet's holdings.
   *
   * @param fleet - The Fleet.
   * @param userId - The viewer, or null when signed out.
   * @returns Whether they may record, and whether they see recorders.
   */
  private async viewer(
    fleet: StoFleetEntity,
    userId: string | null,
  ): Promise<HoldingsViewer> {
    const capabilities =
      userId === null
        ? new Set<string>()
        : ((
            await this._authorisation.authorise(userId, {
              kind: FleetScopeKind.FLEET,
              id: fleet.id,
            })
          )?.capabilities ?? new Set<string>());
    const mayWrite = capabilities.has(FLEET_CAPABILITIES.HOLDINGS_WRITE);

    return {
      mayWrite,
      seesRecorders:
        mayWrite || capabilities.has(FLEET_CAPABILITIES.ROSTER_VIEW),
    };
  }

  /**
   * Reads the catalogue: each holding, its tracks and their tiers, in order.
   *
   * One query at a time, since a transaction's manager has one connection.
   *
   * @param manager - The manager to read through.
   * @returns The holdings.
   */
  private async catalogue(manager: EntityManager): Promise<CatalogueHolding[]> {
    const holdings = await manager.find(FleetHoldingTypeEntity, {
      order: { position: 'ASC' },
    });
    const tracks = await manager.find(FleetHoldingTrackEntity, {
      order: { position: 'ASC' },
    });
    const tiers = await manager.find(FleetHoldingTierEntity);
    const tiersOf = new Map<string, Set<number>>();

    for (const { trackCode, tier } of tiers) {
      const set = tiersOf.get(trackCode) ?? new Set<number>();

      set.add(tier);
      tiersOf.set(trackCode, set);
    }

    return holdings.map(holding => ({
      holding,
      tracks: tracks
        .filter(track => track.holdingTypeCode === holding.code)
        .map(track => {
          const valid = tiersOf.get(track.code) ?? new Set<number>([0]);

          return { track, tiers: valid, maxTier: Math.max(...valid) };
        }),
    }));
  }
}
