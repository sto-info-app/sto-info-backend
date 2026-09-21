import {
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
import { CreateStoArmadaDto } from '../dto/create-sto-armada.dto';
import { StoArmadaDirectoryQueryDto } from '../dto/fleet-directory-query.dto';
import { UpdateStoArmadaDto } from '../dto/update-sto-armada.dto';
import { StoArmadaEntity } from '../entities/sto-armada.entity';
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
import { MAX_REPORTED_DUPLICATES } from './sto-fleet.service';

/** Everything the caller is told about a registration that succeeded. */
export interface RegisteredArmada {
  /** The Armada that was registered. */
  readonly armada: StoArmadaEntity;
  /** Records that already answered to the same name on the same platform. */
  readonly duplicates: readonly StoArmadaEntity[];
}

/** Which records a duplicate search may report. */
interface DuplicateSearchOptions {
  /** The Community whose own records should be reported whatever they hide. */
  readonly withinCommunityId?: string | null;
  /** A record to leave out, being the one just written or being renamed. */
  readonly excludingId?: string;
}

/**
 * Registering, reading and changing the Armadas a Community records.
 *
 * ## An Armada is only ever entered by a person
 *
 * Nothing observes one. STO roster exports carry no Armada information
 * whatsoever — plan section 3.2 — which is why ADR-0004 rules out any derived
 * topology in v1 and why there is no `lastEffectiveImportAt` here to say how
 * fresh a record is. Everything an Armada knows, somebody typed.
 *
 * ## What it deliberately does not hold
 *
 * **An audience.** `sto_armada` has no visibility column, and this service
 * does not invent one: an Armada is seen exactly as far as the Community
 * holding it is. The read routes apply the Community's audience, so a private
 * Community's Armada is as private as the Community.
 *
 * **Its Fleets.** Which Fleets are in it, in what position and over what
 * interval, is `armada_fleet_membership`. Keeping the placement out of the
 * Armada is what lets a Fleet leave without either record being rewritten,
 * which FC-004's third acceptance criterion requires.
 *
 * ## What the database owns
 *
 * Slug uniqueness over `(communityId, platformId, slug)` among live rows, as
 * for a Fleet. The slug service looks for a free candidate first and can be
 * overtaken between the look and the insert, and a 409 is the honest answer.
 */
@Injectable()
export class StoArmadaService {
  private readonly _logger = new Logger(StoArmadaService.name);

  /**
   * Creates an instance of StoArmadaService.
   *
   * @param _armadaRepository - Repository of Armadas.
   * @param _platformService - Reads the platform catalogue.
   * @param _slugService - Mints scoped slugs and remembers retired ones.
   * @param _revisionService - Advances the authorisation revision.
   */
  constructor(
    @InjectRepository(StoArmadaEntity)
    private readonly _armadaRepository: Repository<StoArmadaEntity>,
    private readonly _platformService: FleetPlatformService,
    private readonly _slugService: FleetSlugService,
    private readonly _revisionService: FleetAuthorisationRevisionService,
  ) {}

  /**
   * Registers an Armada under a Community.
   *
   * @param communityId - The Community it belongs to.
   * @param dto - What to register.
   * @param actingUserId - The caller, for the log.
   * @returns The Armada, and anything that already answered to its name.
   * @throws BadRequestException when the platform is not one this site knows.
   * @throws ConflictException when another registration took the slug first.
   */
  async register(
    communityId: string,
    dto: CreateStoArmadaDto,
    actingUserId: string,
  ): Promise<RegisteredArmada> {
    const platform = await this._platformService.findByIdOrFail(dto.platformId);

    const slug = await this.mintSlug(communityId, platform.id, {
      desiredSlug: dto.slug,
      name: dto.exactGameName,
    });

    const armada = this._armadaRepository.create({
      communityId,
      platformId: platform.id,
      exactGameName: dto.exactGameName,
      exactGameNameNormalized: toNormalisedExactGameName(dto.exactGameName),
      displayName: dto.displayName ?? null,
      slug,
    });

    const saved = await this.saveTranslatingConstraints(armada);

    // Attached rather than re-read: it was loaded a moment ago to check the
    // platform exists, and it cannot have changed since.
    saved.platform = platform;

    const duplicates = await this.findDuplicates(
      platform.id,
      dto.exactGameName,
      { withinCommunityId: communityId, excludingId: saved.id },
    );

    this._logger.log(
      `Armada '${saved.slug}' registered in Community ${communityId} by ${actingUserId}`,
    );

    return { armada: saved, duplicates };
  }

  /**
   * Reads an Armada belonging to a Community.
   *
   * The Community is part of the query rather than checked afterwards, so an
   * Armada reached through the wrong Community's path is reported as absent
   * rather than as forbidden.
   *
   * @param communityId - The Community named in the path.
   * @param armadaId - The Armada.
   * @returns The Armada, with its platform and Community loaded.
   * @throws NotFoundException when no such Armada belongs to that Community.
   */
  async findByIdOrFail(
    communityId: string,
    armadaId: string,
  ): Promise<StoArmadaEntity> {
    const armada = await this._armadaRepository.findOne({
      where: { id: armadaId, communityId, deletedAt: IsNull() },
      relations: { platform: true, community: true },
    });

    if (!armada) {
      throw new NotFoundException('Not found');
    }

    return armada;
  }

  /**
   * Resolves the Armada a URL segment names, following a rename.
   *
   * @param communityId - The Community named in the path.
   * @param platformId - The platform named in the path.
   * @param slug - The Armada segment from the URL.
   * @returns The Armada, and whether the segment used was a retired one.
   * @throws NotFoundException when nothing ever answered to that segment.
   */
  async resolveBySlugOrFail(
    communityId: string,
    platformId: string,
    slug: string,
  ): Promise<{ armada: StoArmadaEntity; redirected: boolean }> {
    const live = await this._armadaRepository.findOne({
      where: { communityId, platformId, slug, deletedAt: IsNull() },
      relations: { platform: true, community: true },
    });

    if (live) {
      return { armada: live, redirected: false };
    }

    const retiredBy = await this._slugService.findByRetiredSlug(
      this.slugScope(communityId, platformId),
      slug,
    );

    if (retiredBy === null) {
      throw new NotFoundException('Not found');
    }

    return {
      armada: await this.findByIdOrFail(communityId, retiredBy),
      redirected: true,
    };
  }

  /**
   * Finds the records that already answer to a name on a platform.
   *
   * An Armada has no audience of its own, so what may be reported follows
   * the Community holding it: a record in a `PUBLIC` Community, or one in the
   * Community the registrant is acting in. This matters more for Armadas than
   * for Fleets, because every member Fleet's Community has a reason to record
   * the same Armada and duplicates are the normal case rather than the
   * exception.
   *
   * @param platformId - The platform to look on.
   * @param name - The name being registered, exactly as it was typed.
   * @param options - Which records may be reported.
   * @returns The matches, newest first.
   */
  async findDuplicates(
    platformId: string,
    name: string,
    options: DuplicateSearchOptions = {},
  ): Promise<StoArmadaEntity[]> {
    const common: FindOptionsWhere<StoArmadaEntity> = {
      platformId,
      exactGameNameNormalized: toNormalisedExactGameName(name),
      deletedAt: IsNull(),
      ...(options.excludingId ? { id: Not(options.excludingId) } : {}),
    };

    const where: FindOptionsWhere<StoArmadaEntity>[] = [
      { ...common, community: { visibility: FleetAudience.PUBLIC } },
    ];

    if (options.withinCommunityId) {
      where.push({ ...common, communityId: options.withinCommunityId });
    }

    return this._armadaRepository.find({
      where,
      relations: { platform: true, community: true },
      order: { createdAt: 'DESC' },
      take: MAX_REPORTED_DUPLICATES,
    });
  }

  /**
   * Lists the Armadas anybody may see, with how many share each name.
   *
   * ## Who is listed
   *
   * Armadas whose **Community** is public. `sto_armada` has no audience
   * column of its own and none was added: an Armada is seen exactly as far as
   * the Community holding it is, and the audience is checked where it was
   * declared. The join is an inner one for the same reason the schema makes
   * `communityId` `NOT NULL` — an Armada with nobody holding it is not a
   * record this application knows how to show.
   *
   * ## What makes it duplicate-aware
   *
   * The same folded-name ordering and the same per-page count as the Fleet
   * directory. What differs is what the card can say: nothing observes an
   * Armada, so there is no roster import to be fresh and no freshness sort.
   * Which Community holds it is the whole of what tells two records apart.
   *
   * @param query - Search, filters, ordering and paging.
   * @returns The page, each record with its duplicate count.
   */
  async findDirectoryPage(
    query: StoArmadaDirectoryQueryDto,
  ): Promise<DirectoryPage<DirectoryEntry<StoArmadaEntity>>> {
    const page = resolveDirectoryPage(query.page);
    const pageSize = resolveDirectoryPageSize(query.pageSize);

    const builder = this.listedArmadasQuery(true);

    this.applyDirectoryFilters(builder, query);
    this.applyDirectorySort(builder, query.sort);

    const [armadas, total] = await builder
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return {
      items: await this.withDuplicateCounts(armadas, query.status),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Changes an Armada's own settings.
   *
   * @param communityId - The Community named in the path.
   * @param armadaId - The Armada.
   * @param dto - The changes, including the revision last seen.
   * @param actingUserId - The caller, for the log.
   * @returns The updated Armada.
   * @throws ConflictException when it changed since the caller loaded it, or
   *   when another Armada took the slug first.
   */
  async update(
    communityId: string,
    armadaId: string,
    dto: UpdateStoArmadaDto,
    actingUserId: string,
  ): Promise<StoArmadaEntity> {
    const armada = await this.findByIdOrFail(communityId, armadaId);

    if (dto.revision !== undefined && dto.revision !== armada.revision) {
      throw new ConflictException(
        'This Armada has changed since you opened it. Reload and try again.',
      );
    }

    const previousSlug = armada.slug;

    if (dto.exactGameName !== undefined || dto.slug !== undefined) {
      armada.slug = await this.mintSlug(communityId, armada.platformId, {
        desiredSlug: dto.slug,
        name: dto.exactGameName ?? armada.exactGameName,
        targetId: armadaId,
      });
    }

    if (dto.exactGameName !== undefined) {
      armada.exactGameNameNormalized = toNormalisedExactGameName(
        dto.exactGameName,
      );
    }

    const { slug, revision, ...changes } = dto;
    void slug;
    void revision;

    Object.assign(armada, changes);

    const saved = await this.saveTranslatingConstraints(armada);

    await this._slugService.recordRetiredSlug(
      this.slugScope(communityId, saved.platformId),
      saved.id,
      previousSlug,
      saved.slug,
    );

    // No revision bump. An Armada carries no audience of its own, so nothing
    // this route can change alters who may see it — only the Community's own
    // visibility does, and that is the Community's route to bump.
    this._logger.log(`Armada '${saved.slug}' updated by ${actingUserId}`);

    return saved;
  }

  /**
   * Closes an Armada, keeping everything it holds.
   *
   * Idempotent: closing a closed Armada succeeds and does not move the
   * closure instant. The placements stay readable, so which Fleets were in
   * it and when survives the Armada being wound up — FC-004's third
   * acceptance criterion.
   *
   * @param communityId - The Community named in the path.
   * @param armadaId - The Armada.
   * @param actingUserId - The caller, for the log.
   * @returns The closed Armada.
   */
  async close(
    communityId: string,
    armadaId: string,
    actingUserId: string,
  ): Promise<StoArmadaEntity> {
    const armada = await this.findByIdOrFail(communityId, armadaId);

    if (armada.status === FleetScopeStatus.CLOSED) {
      return armada;
    }

    armada.status = FleetScopeStatus.CLOSED;
    armada.closedAt = new Date();

    const saved = await this._armadaRepository.save(armada);

    // Closure withdraws every mutating capability at the Armada, so unlike a
    // rename this one is not optional.
    await this._revisionService.bump(FleetScopeKind.ARMADA, saved.id);

    this._logger.log(`Armada '${saved.slug}' closed by ${actingUserId}`);

    return saved;
  }

  /**
   * The Armadas a directory listing may report at all.
   *
   * The Community join carries the audience rule rather than merely loading
   * a name, which is why it is here and not at the call site: a listing that
   * forgot it would publish every private Community's Armadas.
   *
   * @param selecting - True to load the joined rows for mapping, false when
   *   only the condition is wanted, as the count query needs.
   * @returns A query restricted to live Armadas in public Communities.
   */
  private listedArmadasQuery(
    selecting: boolean,
  ): SelectQueryBuilder<StoArmadaEntity> {
    const builder = this._armadaRepository
      .createQueryBuilder('armada')
      .where('armada.deletedAt IS NULL');

    if (selecting) {
      builder
        .innerJoinAndSelect('armada.platform', 'platform')
        .innerJoinAndSelect('armada.community', 'community');
    } else {
      builder.innerJoin('armada.community', 'community');
    }

    return builder
      .andWhere('community.deletedAt IS NULL')
      .andWhere('community.visibility = :listedAudience', {
        listedAudience: FleetAudience.PUBLIC,
      });
  }

  /**
   * Narrows a listing to what the caller asked for.
   *
   * @param builder - The query being built.
   * @param query - What the caller asked for.
   */
  private applyDirectoryFilters(
    builder: SelectQueryBuilder<StoArmadaEntity>,
    query: StoArmadaDirectoryQueryDto,
  ): void {
    applyDirectoryStatus(builder, 'armada', query.status);
    applyExactGameNameSearch(builder, 'armada', query.search);

    if (query.platformId) {
      builder.andWhere('armada.platformId = :platformId', {
        platformId: query.platformId,
      });
    }
  }

  /**
   * Orders a listing.
   *
   * By the folded name rather than the stored one, so two spellings of one
   * Armada are read together instead of being separated by every capital
   * letter between them.
   *
   * @param builder - The query being built.
   * @param sort - The ordering asked for, if any.
   */
  private applyDirectorySort(
    builder: SelectQueryBuilder<StoArmadaEntity>,
    sort?: FleetDirectorySort,
  ): void {
    if (sort === FleetDirectorySort.NEWEST) {
      builder.orderBy('armada.createdAt', 'DESC');
    } else {
      builder.orderBy('armada.exactGameNameNormalized', 'ASC');
    }

    // Stable tie-break, so a page boundary cannot repeat or skip a record.
    builder.addOrderBy('armada.id', 'ASC');
  }

  /**
   * Counts, for each record on a page, how many others answer to its name.
   *
   * One grouped query for the whole page, over the same audience and the
   * same lifecycle filter as the listing, so the number never points at a
   * record the reader cannot open.
   *
   * @param armadas - The records on the page.
   * @param status - The lifecycle filter the listing used.
   * @returns Each record, with how many others share its name and platform.
   */
  private async withDuplicateCounts(
    armadas: StoArmadaEntity[],
    status?: FleetDirectoryStatusFilter,
  ): Promise<DirectoryEntry<StoArmadaEntity>[]> {
    if (armadas.length === 0) {
      return [];
    }

    const builder = this.listedArmadasQuery(false)
      .select('armada.platformId', 'platformId')
      .addSelect('armada.exactGameNameNormalized', 'name')
      .addSelect('COUNT(*)', 'total')
      .andWhere('armada.platformId IN (:...platformIds)', {
        platformIds: [...new Set(armadas.map(armada => armada.platformId))],
      })
      .andWhere('armada.exactGameNameNormalized IN (:...names)', {
        names: [
          ...new Set(armadas.map(armada => armada.exactGameNameNormalized)),
        ],
      })
      .groupBy('armada.platformId')
      .addGroupBy('armada.exactGameNameNormalized');

    applyDirectoryStatus(builder, 'armada', status);

    const rows = await builder.getRawMany<DuplicateCountRow>();

    const counts = new Map(
      rows.map(row => [
        toDuplicateKey(row.platformId, row.name),
        Number(row.total),
      ]),
    );

    return armadas.map(armada => ({
      record: armada,
      duplicateCount:
        (counts.get(
          toDuplicateKey(armada.platformId, armada.exactGameNameNormalized),
        ) ?? 1) - 1,
    }));
  }

  /**
   * Produces a slug free within one Community on one platform.
   *
   * @param communityId - The owning Community.
   * @param platformId - The platform.
   * @param request - The desired slug, the name to fall back on, and the
   *   Armada being renamed when there is one.
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
   * Describes where an Armada's slug has to be unique.
   *
   * @param communityId - The owning Community.
   * @param platformId - The platform.
   * @returns The slug scope.
   */
  private slugScope(communityId: string, platformId: string): FleetSlugScope {
    return {
      targetType: FleetScopeKind.ARMADA,
      communityId,
      platformId,
    };
  }

  /**
   * Determines whether a live Armada in the same scope already holds a slug.
   *
   * @param communityId - The owning Community.
   * @param platformId - The platform.
   * @param candidate - The slug to test.
   * @param excludingId - The Armada being renamed, which may keep its own.
   * @returns True when something else holds it.
   */
  private async isSlugTaken(
    communityId: string,
    platformId: string,
    candidate: string,
    excludingId?: string,
  ): Promise<boolean> {
    const held = await this._armadaRepository.count({
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
   * Saves an Armada, turning the constraint it can break into an answer.
   *
   * @param armada - The Armada to save.
   * @returns The saved Armada.
   * @throws ConflictException when the slug index refused it.
   */
  private async saveTranslatingConstraints(
    armada: StoArmadaEntity,
  ): Promise<StoArmadaEntity> {
    try {
      return await this._armadaRepository.save(armada);
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
