import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import {
  FindOptionsWhere,
  IsNull,
  Not,
  QueryFailedError,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';

import { FleetAuthorisationRevisionService } from '../authorisation/fleet-authorisation-revision.service';
import { CreateStoFleetDto } from '../dto/create-sto-fleet.dto';
import { CreateUnregisteredFleetDto } from '../dto/create-unregistered-fleet.dto';
import { StoFleetDirectoryQueryDto } from '../dto/fleet-directory-query.dto';
import { UpdateStoFleetDto } from '../dto/update-sto-fleet.dto';
import { StoFleetEntity } from '../entities/sto-fleet.entity';
import { FleetAudience } from '../enums/fleet-audience.enum';
import { FleetDirectorySort } from '../enums/fleet-directory-sort.enum';
import { FleetDirectoryStatusFilter } from '../enums/fleet-directory-status-filter.enum';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetScopeStatus } from '../enums/fleet-scope-status.enum';
import {
  applyDirectoryStatus,
  applyExactGameNameSearch,
  resolveDirectoryPage,
  resolveDirectoryPageSize,
  toDuplicateKey,
} from '../utilities/directory-query.utility';
import { toNormalisedExactGameName } from '../utilities/exact-game-name.utility';
import {
  DirectoryEntry,
  DirectoryPage,
  DuplicateCountRow,
} from './fleet-directory-page.interface';
import { FleetPlatformService } from './fleet-platform.service';
import { FleetSlugScope, FleetSlugService } from './fleet-slug.service';

/**
 * How many possible duplicates are reported.
 *
 * A warning is read or it is not, and a list long enough to scroll is not
 * read. Ten is more than the directory has ever held for one name, and a
 * registrant who needs the eleventh is better served by the directory search
 * than by a longer warning.
 */
export const MAX_REPORTED_DUPLICATES = 10;

/** One day, for turning the freshness filter's window into an instant. */
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** Everything the caller is told about a registration that succeeded. */
export interface RegisteredFleet {
  /** The Fleet that was registered. */
  readonly fleet: StoFleetEntity;
  /** Records that already answered to the same name on the same platform. */
  readonly duplicates: readonly StoFleetEntity[];
}

/** Which records a duplicate search may report. */
interface DuplicateSearchOptions {
  /** The Community whose own records should be reported whatever they hide. */
  readonly withinCommunityId?: string | null;
  /** A record to leave out, being the one just written or being renamed. */
  readonly excludingId?: string;
}

/**
 * Registering, reading and changing the Fleets a Community records.
 *
 * ## What is not enforced here, deliberately
 *
 * **Two records for the same in-game Fleet are allowed.** There is no unique
 * constraint on name and platform and this service does not invent one. Plan
 * section 4.1 and FC-004's first acceptance criterion both say the same
 * thing: STO Info holds a Community's *record* of a Fleet, not a tenant-wide
 * claim on the Fleet itself, so two Communities may each keep one and neither
 * is authoritative. {@link findDuplicates} exists to inform a registrant, and
 * a warning that could refuse them would be a claim this application has no
 * standing to make.
 *
 * **The name is stored exactly as given.** Including a leading or trailing
 * space, which ADR-0003 requires and which FC-016's filename check depends
 * on. Only the duplicate-detection column is folded, and only for case.
 *
 * ## What the database owns
 *
 * Slug uniqueness, over `(communityId, platformId, slug)` among live rows.
 * The slug service looks for a free candidate first, but two registrations
 * racing for one name can still collide, and a 409 is the honest answer.
 *
 * ## Why the platform is half of everything
 *
 * A Fleet's slug is unique within its Community *and* platform, and its
 * canonical URL carries both — ADR-0022. One Community may hold a Fleet of
 * the same name on PC and on Xbox, and both keep the readable slug rather
 * than the second being suffixed to avoid a collision that never existed
 * outside the index.
 */
@Injectable()
export class StoFleetService {
  private readonly _logger = new Logger(StoFleetService.name);

  /**
   * Creates an instance of StoFleetService.
   *
   * @param _fleetRepository - Repository of Fleets.
   * @param _platformService - Reads the platform catalogue.
   * @param _slugService - Mints scoped slugs and remembers retired ones.
   * @param _revisionService - Advances the authorisation revision.
   */
  constructor(
    @InjectRepository(StoFleetEntity)
    private readonly _fleetRepository: Repository<StoFleetEntity>,
    private readonly _platformService: FleetPlatformService,
    private readonly _slugService: FleetSlugService,
    private readonly _revisionService: FleetAuthorisationRevisionService,
  ) {}

  /**
   * Registers a Fleet under a Community.
   *
   * @param communityId - The Community it belongs to.
   * @param dto - What to register.
   * @param actingUserId - The caller, for the log.
   * @returns The Fleet, and anything that already answered to its name.
   * @throws BadRequestException when the platform is not one this site knows.
   * @throws ConflictException when another registration took the slug first.
   */
  async register(
    communityId: string,
    dto: CreateStoFleetDto,
    actingUserId: string,
  ): Promise<RegisteredFleet> {
    const platform = await this._platformService.findByIdOrFail(dto.platformId);

    const slug = await this.mintSlug(communityId, platform.id, {
      desiredSlug: dto.slug,
      name: dto.exactGameName,
    });

    const fleet = this._fleetRepository.create({
      communityId,
      platformId: platform.id,
      allegianceFactionId: dto.allegianceFactionId ?? null,
      exactGameName: dto.exactGameName,
      exactGameNameNormalized: toNormalisedExactGameName(dto.exactGameName),
      slug,
      ...(dto.recruitmentState === undefined
        ? {}
        : { recruitmentState: dto.recruitmentState }),
      ...(dto.visibility === undefined ? {} : { visibility: dto.visibility }),
    });

    const saved = await this.saveTranslatingConstraints(fleet);

    // The relation is attached rather than re-read. It was loaded a moment
    // ago to check the platform exists, and a second round trip to fetch a
    // row that cannot have changed is a query for nothing.
    saved.platform = platform;

    const duplicates = await this.findDuplicates(
      platform.id,
      dto.exactGameName,
      { withinCommunityId: communityId, excludingId: saved.id },
    );

    this._logger.log(
      `Fleet '${saved.slug}' registered in Community ${communityId} by ${actingUserId}`,
    );

    return { fleet: saved, duplicates };
  }

  /**
   * Confirms an unregistered Fleet: a record of a Fleet nobody here runs.
   *
   * Needs an account and nothing else. There is no scope to hold a
   * capability at, and no owner to hold one either, which is the whole
   * nature of the record: it exists so an imported roster has something to
   * attach to when the Fleet it describes belongs to nobody on this site.
   *
   * **Two confirmations of the same name make two records, and neither can
   * ever be closed.** Every mutating route checks a capability at a scope,
   * and an unregistered Fleet resolves to no scope, so nothing in this
   * feature can withdraw one. That is the accepted cost of keeping one rule
   * for duplicates rather than two: a registration is never refused for
   * looking like something that already exists, here as everywhere else.
   * Merging or adopting such a record is FC-039's.
   *
   * The audience is set to `PUBLIC` explicitly rather than left to the
   * column default. The default is `COMMUNITY`, and a Community audience on
   * a record with no Community resolves to nobody at all — which would make
   * a stub created to be *found* invisible to everybody, including the next
   * person about to create a second one.
   *
   * @param dto - The name, the platform and the caller's confirmation.
   * @param actingUserId - The caller, for the log.
   * @returns The record, and anything that already answered to its name.
   * @throws BadRequestException when the platform is not one this site knows.
   */
  async registerUnregistered(
    dto: CreateUnregisteredFleetDto,
    actingUserId: string,
  ): Promise<RegisteredFleet> {
    const platform = await this._platformService.findByIdOrFail(dto.platformId);

    const fleet = this._fleetRepository.create({
      communityId: null,
      platformId: platform.id,
      exactGameName: dto.exactGameName,
      exactGameNameNormalized: toNormalisedExactGameName(dto.exactGameName),
      slug: await this.mintStandaloneSlug(platform.id, dto.exactGameName),
      visibility: FleetAudience.PUBLIC,
    });

    const saved = await this.saveTranslatingConstraints(fleet);

    saved.platform = platform;

    const duplicates = await this.findDuplicates(
      platform.id,
      dto.exactGameName,
      { excludingId: saved.id },
    );

    this._logger.log(
      `Unregistered Fleet '${saved.exactGameName}' confirmed by ${actingUserId}`,
    );

    return { fleet: saved, duplicates };
  }

  /**
   * Reads a Fleet belonging to a Community.
   *
   * The Community is part of the query rather than checked afterwards, so a
   * Fleet reached through the wrong Community's path is reported as absent
   * rather than as forbidden. A `403` there would confirm that the Fleet
   * exists somewhere else, which is exactly what a probe is looking for.
   *
   * @param communityId - The Community named in the path.
   * @param fleetId - The Fleet.
   * @returns The Fleet, with its platform loaded.
   * @throws NotFoundException when no such Fleet belongs to that Community.
   */
  async findByIdOrFail(
    communityId: string,
    fleetId: string,
  ): Promise<StoFleetEntity> {
    const fleet = await this._fleetRepository.findOne({
      where: { id: fleetId, communityId, deletedAt: IsNull() },
      relations: { platform: true },
    });

    if (!fleet) {
      throw new NotFoundException('Not found');
    }

    return fleet;
  }

  /**
   * Resolves the Fleet a URL segment names, following a rename.
   *
   * A live slug wins over the history, always. A Fleet may reclaim a slug it
   * used to have, and resolving history first would redirect it to itself.
   *
   * @param communityId - The Community named in the path.
   * @param platformId - The platform named in the path.
   * @param slug - The Fleet segment from the URL.
   * @returns The Fleet, and whether the segment used was a retired one.
   * @throws NotFoundException when nothing ever answered to that segment.
   */
  async resolveBySlugOrFail(
    communityId: string,
    platformId: string,
    slug: string,
  ): Promise<{ fleet: StoFleetEntity; redirected: boolean }> {
    const live = await this._fleetRepository.findOne({
      where: { communityId, platformId, slug, deletedAt: IsNull() },
      relations: { platform: true },
    });

    if (live) {
      return { fleet: live, redirected: false };
    }

    const retiredBy = await this._slugService.findByRetiredSlug(
      this.slugScope(communityId, platformId),
      slug,
    );

    if (retiredBy === null) {
      throw new NotFoundException('Not found');
    }

    // The history can outlive the row it points at. A dead pointer is a 404
    // rather than an error: the address genuinely leads nowhere now.
    return {
      fleet: await this.findByIdOrFail(communityId, retiredBy),
      redirected: true,
    };
  }

  /**
   * Reads a Fleet that belongs to no Community, by its address.
   *
   * No slug history to fall back on. Nothing can rename a standalone Fleet —
   * there is no owner and no capability held at one — so a slug that answers
   * to nothing now has never answered to anything, and a `404` is the whole
   * truth rather than a guess.
   *
   * @param platformId - The platform named in the address.
   * @param slug - The Fleet segment.
   * @returns The Fleet, with its platform loaded.
   * @throws NotFoundException when no standalone Fleet answers to that.
   */
  async resolveStandaloneBySlugOrFail(
    platformId: string,
    slug: string,
  ): Promise<StoFleetEntity> {
    const fleet = await this._fleetRepository.findOne({
      where: { communityId: IsNull(), platformId, slug, deletedAt: IsNull() },
      relations: { platform: true },
    });

    if (!fleet) {
      throw new NotFoundException('Not found');
    }

    return fleet;
  }

  /**
   * Finds the records that already answer to a name on a platform.
   *
   * **Who is reported, and why it is not everybody.** A record is included
   * when it is `PUBLIC`, when it has no Community — an unregistered
   * observation target is a directory stub by definition — or when it belongs
   * to the Community the registrant is acting in. Anything else stays out:
   * telling somebody that a private Fleet in a Community they have nothing to
   * do with shares their name would answer, precisely, the question a private
   * Fleet exists in order not to answer.
   *
   * @param platformId - The platform to look on.
   * @param name - The name being registered, exactly as it was typed.
   * @param options - Which records may be reported.
   * @returns The matches, freshest first.
   */
  async findDuplicates(
    platformId: string,
    name: string,
    options: DuplicateSearchOptions = {},
  ): Promise<StoFleetEntity[]> {
    const common: FindOptionsWhere<StoFleetEntity> = {
      platformId,
      exactGameNameNormalized: toNormalisedExactGameName(name),
      deletedAt: IsNull(),
      ...(options.excludingId ? { id: Not(options.excludingId) } : {}),
    };

    const where: FindOptionsWhere<StoFleetEntity>[] = [
      { ...common, visibility: FleetAudience.PUBLIC },
      { ...common, communityId: IsNull() },
    ];

    if (options.withinCommunityId) {
      where.push({ ...common, communityId: options.withinCommunityId });
    }

    return this._fleetRepository.find({
      where,
      relations: { platform: true, community: true },
      order: {
        lastEffectiveImportAt: { direction: 'DESC', nulls: 'LAST' },
        createdAt: 'DESC',
      },
      take: MAX_REPORTED_DUPLICATES,
    });
  }

  /**
   * Lists the Fleets anybody may see, with how many share each name.
   *
   * ## Who is listed
   *
   * `PUBLIC` records, whoever is asking, and nothing else. A signed-in
   * member of a Community does **not** see its private Fleets here, which is
   * deliberate rather than a simplification: the alternative is a visibility
   * check per row, and a page of fifty would be fifty authorisation queries
   * for a list a signed-out visitor can also ask for. A Community's own
   * Fleets are read through the Community's own routes, where the check is
   * made once against a scope named in the path.
   *
   * Unregistered Fleets are listed, because they are `PUBLIC` and because a
   * directory stub exists in order to be found. One shows an empty Community
   * on its card, which is the honest answer: nobody holds it.
   *
   * ## What makes it duplicate-aware
   *
   * Ordering by the folded name puts records answering to one name together,
   * and each card says how many others do. The count runs over the same
   * audience and the same lifecycle filter as the listing itself, so it never
   * promises a record the reader cannot then open — FC-013's third acceptance
   * criterion asks for records to be *distinguishable*, and a count pointing
   * at something invisible would be the opposite.
   *
   * @param query - Search, filters, ordering and paging.
   * @returns The page, each record with its duplicate count.
   * @throws BadRequestException when the roster filters contradict.
   */
  async findDirectoryPage(
    query: StoFleetDirectoryQueryDto,
  ): Promise<DirectoryPage<DirectoryEntry<StoFleetEntity>>> {
    if (query.withRoster === false && query.freshWithinDays !== undefined) {
      throw new BadRequestException(
        'Asking for Fleets with no roster and a recent one at the same ' +
          'time matches nothing. Drop one of the two.',
      );
    }

    const page = resolveDirectoryPage(query.page);
    const pageSize = resolveDirectoryPageSize(query.pageSize);

    const builder = this.listedFleetsQuery()
      .innerJoinAndSelect('fleet.platform', 'platform')
      .leftJoinAndSelect('fleet.community', 'community');

    this.applyDirectoryFilters(builder, query);
    this.applyDirectorySort(builder, query.sort);

    const [fleets, total] = await builder
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return {
      items: await this.withDuplicateCounts(fleets, query.status),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Changes a Fleet's own settings.
   *
   * @param communityId - The Community named in the path.
   * @param fleetId - The Fleet.
   * @param dto - The changes, including the revision last seen.
   * @param actingUserId - The caller, for the log.
   * @returns The updated Fleet.
   * @throws ConflictException when it changed since the caller loaded it, or
   *   when another Fleet took the slug first.
   */
  async update(
    communityId: string,
    fleetId: string,
    dto: UpdateStoFleetDto,
    actingUserId: string,
  ): Promise<StoFleetEntity> {
    const fleet = await this.findByIdOrFail(communityId, fleetId);

    if (dto.revision !== undefined && dto.revision !== fleet.revision) {
      throw new ConflictException(
        'This Fleet has changed since you opened it. Reload and try again.',
      );
    }

    const previousSlug = fleet.slug;
    const previousVisibility = fleet.visibility;

    if (dto.exactGameName !== undefined || dto.slug !== undefined) {
      fleet.slug = await this.mintSlug(communityId, fleet.platformId, {
        desiredSlug: dto.slug,
        name: dto.exactGameName ?? fleet.exactGameName,
        targetId: fleetId,
      });
    }

    if (dto.exactGameName !== undefined) {
      fleet.exactGameNameNormalized = toNormalisedExactGameName(
        dto.exactGameName,
      );
    }

    const { slug, revision, ...changes } = dto;
    void slug;
    void revision;

    Object.assign(fleet, changes);

    const saved = await this.saveTranslatingConstraints(fleet);

    await this._slugService.recordRetiredSlug(
      this.slugScope(communityId, saved.platformId),
      saved.id,
      previousSlug,
      saved.slug,
    );

    // Only a visibility change alters who may see the Fleet. Renaming it
    // changes what its page says, and telling every connected client to throw
    // its view away because a description was reworded is a cost with no
    // matching benefit.
    if (saved.visibility !== previousVisibility) {
      await this._revisionService.bump(FleetScopeKind.FLEET, saved.id);
    }

    this._logger.log(`Fleet '${saved.slug}' updated by ${actingUserId}`);

    return saved;
  }

  /**
   * Closes a Fleet, keeping everything it holds.
   *
   * Idempotent: closing a closed Fleet succeeds and does not move the closure
   * instant, so a retried request cannot rewrite when it happened. The row
   * keeps `deletedAt` null, so its Armada placements, roster history and web
   * address all survive it — plan section 4.1.
   *
   * @param communityId - The Community named in the path.
   * @param fleetId - The Fleet.
   * @param actingUserId - The caller, for the log.
   * @returns The closed Fleet.
   */
  async close(
    communityId: string,
    fleetId: string,
    actingUserId: string,
  ): Promise<StoFleetEntity> {
    const fleet = await this.findByIdOrFail(communityId, fleetId);

    if (fleet.status === FleetScopeStatus.CLOSED) {
      return fleet;
    }

    fleet.status = FleetScopeStatus.CLOSED;
    fleet.closedAt = new Date();

    const saved = await this._fleetRepository.save(fleet);

    // Closure withdraws every mutating capability at the Fleet, so unlike a
    // rename this one is not optional.
    await this._revisionService.bump(FleetScopeKind.FLEET, saved.id);

    this._logger.log(`Fleet '${saved.slug}' closed by ${actingUserId}`);

    return saved;
  }

  /**
   * The Fleets a directory listing may report at all.
   *
   * The audience rule and nothing else, shared by the listing and the count
   * behind it so the two cannot drift: a count taken over a wider set than
   * the list would tell a reader about records the list is hiding from them.
   *
   * @returns A query restricted to live, public Fleets.
   */
  private listedFleetsQuery(): SelectQueryBuilder<StoFleetEntity> {
    return this._fleetRepository
      .createQueryBuilder('fleet')
      .where('fleet.deletedAt IS NULL')
      .andWhere('fleet.visibility = :listedAudience', {
        listedAudience: FleetAudience.PUBLIC,
      });
  }

  /**
   * Narrows a listing to what the caller asked for.
   *
   * An allegiance filter excludes a Fleet whose faction was never given
   * rather than matching it. The column is nullable precisely because an
   * allegiance is never guessed, and a filter that treated "unknown" as
   * "matches" would be guessing on the reader's behalf.
   *
   * @param builder - The query being built.
   * @param query - What the caller asked for.
   */
  private applyDirectoryFilters(
    builder: SelectQueryBuilder<StoFleetEntity>,
    query: StoFleetDirectoryQueryDto,
  ): void {
    applyDirectoryStatus(builder, 'fleet', query.status);
    applyExactGameNameSearch(builder, 'fleet', query.search);

    if (query.platformId) {
      builder.andWhere('fleet.platformId = :platformId', {
        platformId: query.platformId,
      });
    }

    if (query.recruitmentState) {
      builder.andWhere('fleet.recruitmentState = :recruitmentState', {
        recruitmentState: query.recruitmentState,
      });
    }

    if (query.allegianceFactionId) {
      builder.andWhere('fleet.allegianceFactionId = :allegianceFactionId', {
        allegianceFactionId: query.allegianceFactionId,
      });
    }

    if (query.withRoster === true) {
      builder.andWhere('fleet.lastEffectiveImportAt IS NOT NULL');
    }

    if (query.withRoster === false) {
      builder.andWhere('fleet.lastEffectiveImportAt IS NULL');
    }

    if (query.freshWithinDays !== undefined) {
      builder.andWhere('fleet.lastEffectiveImportAt >= :freshSince', {
        freshSince: new Date(
          Date.now() - query.freshWithinDays * MILLISECONDS_PER_DAY,
        ),
      });
    }
  }

  /**
   * Orders a listing.
   *
   * By the folded name rather than the stored one, so `omega command` sorts
   * beside `Omega Command` instead of after every capital letter. The whole
   * point of the default ordering is that two records for one Fleet are read
   * together, and a case-sensitive sort would separate the commonest pair of
   * duplicates there is.
   *
   * @param builder - The query being built.
   * @param sort - The ordering asked for, if any.
   */
  private applyDirectorySort(
    builder: SelectQueryBuilder<StoFleetEntity>,
    sort?: FleetDirectorySort,
  ): void {
    if (sort === FleetDirectorySort.NEWEST) {
      builder.orderBy('fleet.createdAt', 'DESC');
    } else if (sort === FleetDirectorySort.FRESHNESS) {
      builder.orderBy('fleet.lastEffectiveImportAt', 'DESC', 'NULLS LAST');
    } else {
      builder.orderBy('fleet.exactGameNameNormalized', 'ASC');
    }

    // Stable tie-break, so a page boundary cannot repeat or skip a record.
    builder.addOrderBy('fleet.id', 'ASC');
  }

  /**
   * Counts, for each record on a page, how many others answer to its name.
   *
   * One grouped query for the whole page rather than one per card. It is
   * restricted to the platforms and names actually on the page, which reads
   * like a cross join and is not: the group is `(platform, name)` and the
   * lookup asks for that exact pair, so a few extra groups cost a row each
   * and change no answer.
   *
   * A name with no row at all counts as one — itself — which is what happens
   * when a record is listed under a filter the count query does not share.
   *
   * @param fleets - The records on the page.
   * @param status - The lifecycle filter the listing used.
   * @returns Each record, with how many others share its name and platform.
   */
  private async withDuplicateCounts(
    fleets: StoFleetEntity[],
    status?: FleetDirectoryStatusFilter,
  ): Promise<DirectoryEntry<StoFleetEntity>[]> {
    if (fleets.length === 0) {
      return [];
    }

    const builder = this.listedFleetsQuery()
      .select('fleet.platformId', 'platformId')
      .addSelect('fleet.exactGameNameNormalized', 'name')
      .addSelect('COUNT(*)', 'total')
      .andWhere('fleet.platformId IN (:...platformIds)', {
        platformIds: [...new Set(fleets.map(fleet => fleet.platformId))],
      })
      .andWhere('fleet.exactGameNameNormalized IN (:...names)', {
        names: [...new Set(fleets.map(fleet => fleet.exactGameNameNormalized))],
      })
      .groupBy('fleet.platformId')
      .addGroupBy('fleet.exactGameNameNormalized');

    applyDirectoryStatus(builder, 'fleet', status);

    const rows = await builder.getRawMany<DuplicateCountRow>();

    const counts = new Map(
      rows.map(row => [
        toDuplicateKey(row.platformId, row.name),
        Number(row.total),
      ]),
    );

    return fleets.map(fleet => ({
      record: fleet,
      duplicateCount:
        (counts.get(
          toDuplicateKey(fleet.platformId, fleet.exactGameNameNormalized),
        ) ?? 1) - 1,
    }));
  }

  /**
   * Produces a slug free among the standalone Fleets on one platform.
   *
   * A standalone Fleet is addressed under the reserved `standalone` segment
   * where a Community's slug would sit, so this is an address rather than a
   * label and has to be unique in the scope that segment names: every Fleet
   * with no Community, on this platform.
   *
   * No slug history. A standalone Fleet has no owner and no capability held
   * at it, so nothing can rename one — there is never an old address to
   * retire, and a scope with no Community is one the history table's check
   * constraint refuses anyway.
   *
   * @param platformId - The platform the record is on.
   * @param name - The exact game name.
   * @returns A slug nothing else standalone on that platform is using.
   */
  private mintStandaloneSlug(
    platformId: string,
    name: string,
  ): Promise<string> {
    return this._slugService.generateUniqueSlug({
      targetType: FleetScopeKind.FLEET,
      communityId: null,
      platformId,
      name,
      isTakenByLiveScope: candidate =>
        this.isStandaloneSlugTaken(platformId, candidate),
    });
  }

  /**
   * Determines whether a live standalone Fleet already holds a slug.
   *
   * @param platformId - The platform.
   * @param candidate - The slug to test.
   * @returns True when something else holds it.
   */
  private async isStandaloneSlugTaken(
    platformId: string,
    candidate: string,
  ): Promise<boolean> {
    const held = await this._fleetRepository.count({
      where: {
        communityId: IsNull(),
        platformId,
        slug: candidate,
        deletedAt: IsNull(),
      },
    });

    return held > 0;
  }

  /**
   * Produces a slug free within one Community on one platform.
   *
   * @param communityId - The owning Community.
   * @param platformId - The platform.
   * @param request - The desired slug, the name to fall back on, and the
   *   Fleet being renamed when there is one.
   * @returns A slug nothing else in that scope is using.
   */
  private mintSlug(
    communityId: string,
    platformId: string,
    request: { desiredSlug?: string; name: string; targetId?: string },
  ): Promise<string> {
    return this._slugService.generateUniqueSlug({
      ...this.slugScope(communityId, platformId),
      desiredSlug: request.desiredSlug,
      name: request.name,
      targetId: request.targetId,
      isTakenByLiveScope: candidate =>
        this.isSlugTaken(communityId, platformId, candidate, request.targetId),
    });
  }

  /**
   * Describes where a Fleet's slug has to be unique.
   *
   * @param communityId - The owning Community.
   * @param platformId - The platform.
   * @returns The slug scope.
   */
  private slugScope(communityId: string, platformId: string): FleetSlugScope {
    return {
      targetType: FleetScopeKind.FLEET,
      communityId,
      platformId,
    };
  }

  /**
   * Determines whether a live Fleet in the same scope already holds a slug.
   *
   * @param communityId - The owning Community.
   * @param platformId - The platform.
   * @param candidate - The slug to test.
   * @param excludingId - The Fleet being renamed, which may keep its own.
   * @returns True when something else holds it.
   */
  private async isSlugTaken(
    communityId: string,
    platformId: string,
    candidate: string,
    excludingId?: string,
  ): Promise<boolean> {
    const held = await this._fleetRepository.count({
      where: {
        communityId,
        platformId,
        slug: candidate,
        deletedAt: IsNull(),
        ...(excludingId ? { id: Not(excludingId) } : {}),
      },
    });

    return held > 0;
  }

  /**
   * Saves a Fleet, turning the constraint it can break into an answer.
   *
   * The slug service looks for a free candidate first and can be overtaken
   * between the look and the insert. Letting the database decide is what
   * makes the uniqueness true under concurrency; translating what it raises
   * is what makes the refusal readable.
   *
   * @param fleet - The Fleet to save.
   * @returns The saved Fleet.
   * @throws ConflictException when the slug index refused it.
   */
  private async saveTranslatingConstraints(
    fleet: StoFleetEntity,
  ): Promise<StoFleetEntity> {
    try {
      return await this._fleetRepository.save(fleet);
    } catch (error) {
      if (!(error instanceof QueryFailedError)) {
        throw error;
      }

      if (error.message.includes('duplicate key value')) {
        throw new ConflictException(
          'That web address has just been taken. Choose another.',
        );
      }

      throw error;
    }
  }
}
