import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { IsNull, Not, QueryFailedError, Repository } from 'typeorm';

import { escapeSqlLikeTerm } from 'src/shared/utilities/sql-like.utility';

import { FleetAuthorisationRevisionService } from '../authorisation/fleet-authorisation-revision.service';
import { MAX_FLEET_COMMUNITIES_PER_OWNER } from '../constants/fleet-policy.constants';
import { CreateFleetCommunityDto } from '../dto/create-fleet-community.dto';
import { FleetCommunityDirectoryQueryDto } from '../dto/fleet-directory-query.dto';
import { UpdateFleetCommunityDto } from '../dto/update-fleet-community.dto';
import { FleetCommunityEntity } from '../entities/fleet-community.entity';
import { FleetAudience } from '../enums/fleet-audience.enum';
import { FleetDirectorySort } from '../enums/fleet-directory-sort.enum';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetScopeStatus } from '../enums/fleet-scope-status.enum';
import {
  applyDirectoryStatus,
  resolveDirectoryPage,
  resolveDirectoryPageSize,
} from '../utilities/directory-query.utility';
import { DirectoryPage } from './fleet-directory-page.interface';
import { FleetSlugScope, FleetSlugService } from './fleet-slug.service';

/**
 * The part of the owner-limit exception that identifies it.
 *
 * The trigger in `1792800000000-LimitFleetCommunitiesPerOwner` raises SQLSTATE
 * `23514`, which every other check constraint on the table would raise too, so
 * the message is what tells them apart. `fleet-policy.constants.spec` asserts
 * that the migration still contains this wording, which is what stops the two
 * drifting apart silently.
 */
const OWNER_LIMIT_ERROR_FRAGMENT = 'live Fleet Communities';

/** Where a Community's own slug is unique: everywhere, so it has no parent. */
const COMMUNITY_SLUG_SCOPE: FleetSlugScope = {
  targetType: FleetScopeKind.COMMUNITY,
  communityId: null,
  platformId: null,
};

/** A Community reached by slug, and whether the slug used was the current one. */
export interface ResolvedCommunityBySlug {
  /** The Community the slug resolves to. */
  readonly community: FleetCommunityEntity;
  /**
   * The retired slug the caller asked for, when it was not the current one.
   *
   * Non-null means the caller should be redirected rather than served here,
   * so an old link keeps working while only one address is canonical.
   */
  readonly redirectedFrom: string | null;
}

/**
 * Registering, reading and changing a Fleet Community.
 *
 * This service decides nothing about *who* may act: the capability is checked
 * by {@link ScopeCapabilityGuard} before a handler is reached, and the one
 * place that decides is {@link FleetAuthorisationService}. What lives here is
 * the part authorisation cannot answer — how a Community comes into being, and
 * what has to stay true about it afterwards.
 *
 * ## Three rules the database owns, not this class
 *
 * **Ten live Communities per owner.** Counted and refused by a trigger holding
 * an advisory lock on the owner, because two registrations committing at once
 * cannot see each other's uncommitted rows and a count in application code
 * would let an eleventh through. The check below is for the message: it tells
 * somebody who has ten what the limit is, instead of showing them a failed
 * insert. The trigger is what makes the limit true, so the failure it raises is
 * translated rather than assumed away.
 *
 * **Slug uniqueness.** A partial unique index over live rows. The slug service
 * finds a free candidate first, but two registrations racing for the same name
 * can still collide, and a 409 is the honest answer to that.
 *
 * **The registrant is the Owner.** Not by inserting a role assignment, but
 * because {@link FleetAuthorisationService} reads `ownerUserId` directly. R02
 * requires the registrant to be Owner from the moment of creation, and a
 * separate row would mean a Community briefly existing with nobody able to
 * administer it.
 *
 * ## Closing rather than deleting
 *
 * `close` sets the status and leaves everything else standing. Plan section 4.1
 * is explicit that closure is a status change: Armada placements, roster
 * history and the Community's own URL all outlive it, and a delete would take
 * evidence with it. The row keeps `deletedAt` null, so the slug stays claimed
 * and an old link still resolves to a page that says the Community is closed.
 */
@Injectable()
export class FleetCommunityService {
  private readonly _logger = new Logger(FleetCommunityService.name);

  /**
   * Creates an instance of FleetCommunityService.
   *
   * @param _communityRepository - Repository of Fleet Communities.
   * @param _slugService - Mints scoped slugs and remembers retired ones.
   * @param _revisionService - Advances the authorisation revision.
   */
  constructor(
    @InjectRepository(FleetCommunityEntity)
    private readonly _communityRepository: Repository<FleetCommunityEntity>,
    private readonly _slugService: FleetSlugService,
    private readonly _revisionService: FleetAuthorisationRevisionService,
  ) {}

  /**
   * Registers a Community owned by the caller.
   *
   * @param dto - What to register.
   * @param ownerUserId - The registrant, who becomes its Owner.
   * @returns The registered Community.
   * @throws ConflictException when the owner already holds the maximum, or
   *   when another registration took the slug first.
   */
  async register(
    dto: CreateFleetCommunityDto,
    ownerUserId: string,
  ): Promise<FleetCommunityEntity> {
    await this.assertOwnerHasRoom(ownerUserId);

    const slug = await this._slugService.generateUniqueSlug({
      ...COMMUNITY_SLUG_SCOPE,
      desiredSlug: dto.slug,
      name: dto.name,
      isTakenByLiveScope: candidate => this.isSlugTaken(candidate),
    });

    const community = this._communityRepository.create({
      ...dto,
      slug,
      ownerUserId,
    });

    const saved = await this.saveTranslatingConstraints(community);

    this._logger.log(
      `Fleet Community '${saved.slug}' registered by ${ownerUserId}`,
    );

    return saved;
  }

  /**
   * Reads a Community by its identifier.
   *
   * @param id - The Community.
   * @returns The Community.
   * @throws NotFoundException when it does not exist.
   */
  async findByIdOrFail(id: string): Promise<FleetCommunityEntity> {
    const community = await this._communityRepository.findOne({
      where: { id, deletedAt: IsNull() },
    });

    if (!community) {
      throw new NotFoundException('Not found');
    }

    return community;
  }

  /**
   * Resolves the Community a URL segment names, following a rename.
   *
   * A live slug wins over the history, always. A Community may reclaim a slug
   * it used to have, and resolving history first would send it to itself
   * through a redirect that never settles.
   *
   * @param slug - The segment from the URL.
   * @returns The Community, and the retired slug when one was used.
   * @throws NotFoundException when no Community ever answered to the slug.
   */
  async resolveBySlugOrFail(slug: string): Promise<ResolvedCommunityBySlug> {
    const live = await this._communityRepository.findOne({
      where: { slug, deletedAt: IsNull() },
    });

    if (live) {
      return { community: live, redirectedFrom: null };
    }

    const retiredBy = await this._slugService.findByRetiredSlug(
      COMMUNITY_SLUG_SCOPE,
      slug,
    );

    if (retiredBy === null) {
      throw new NotFoundException('Not found');
    }

    // The history can outlive the row it points at, because a Community that
    // is hard-deleted for erasure takes its redirects' target with it. A dead
    // pointer is a 404 rather than an error: the address genuinely leads
    // nowhere now.
    const community = await this._communityRepository.findOne({
      where: { id: retiredBy, deletedAt: IsNull() },
    });

    if (!community) {
      throw new NotFoundException('Not found');
    }

    return { community, redirectedFrom: slug };
  }

  /**
   * Lists the Communities anybody may see.
   *
   * ## Who is listed
   *
   * `PUBLIC` Communities, whoever is asking. A Community is the outermost
   * scope and its card carries nothing private — a name, what it says about
   * itself, and whether it is taking subscribers — so the audience column is
   * the whole of the rule.
   *
   * ## No duplicate count
   *
   * Unlike a Fleet or an Armada, a Community does not claim to describe
   * something the game holds exactly once: it names a group of people, and
   * two groups may reasonably pick one name. There is no folded name column
   * to group by and nothing would be served by adding one — the site-unique
   * slug already stops two Communities sharing an address.
   *
   * @param query - Search, filters, ordering and paging.
   * @returns The page of Communities.
   */
  async findDirectoryPage(
    query: FleetCommunityDirectoryQueryDto,
  ): Promise<DirectoryPage<FleetCommunityEntity>> {
    const page = resolveDirectoryPage(query.page);
    const pageSize = resolveDirectoryPageSize(query.pageSize);

    const builder = this._communityRepository
      .createQueryBuilder('community')
      .where('community.deletedAt IS NULL')
      .andWhere('community.visibility = :listedAudience', {
        listedAudience: FleetAudience.PUBLIC,
      });

    applyDirectoryStatus(builder, 'community', query.status);

    if (query.search) {
      builder.andWhere('LOWER(community.name) LIKE :nameSearch', {
        nameSearch: `%${escapeSqlLikeTerm(query.search)}%`,
      });
    }

    if (query.recruitmentState) {
      builder.andWhere('community.recruitmentState = :recruitmentState', {
        recruitmentState: query.recruitmentState,
      });
    }

    if (query.sort === FleetDirectorySort.NEWEST) {
      builder.orderBy('community.createdAt', 'DESC');
    } else {
      builder.orderBy('LOWER(community.name)', 'ASC');
    }

    // Stable tie-break, so a page boundary cannot repeat or skip a record.
    builder.addOrderBy('community.id', 'ASC');

    const [communities, total] = await builder
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return { items: communities, total, page, pageSize };
  }

  /**
   * Changes a Community's own settings.
   *
   * @param id - The Community.
   * @param dto - The changes, including the revision last seen.
   * @param actingUserId - The caller, for the log.
   * @returns The updated Community.
   * @throws ConflictException when it changed since the caller loaded it, or
   *   when another Community took the slug first.
   */
  async update(
    id: string,
    dto: UpdateFleetCommunityDto,
    actingUserId: string,
  ): Promise<FleetCommunityEntity> {
    const community = await this.findByIdOrFail(id);

    if (dto.revision !== undefined && dto.revision !== community.revision) {
      throw new ConflictException(
        'This Community has changed since you opened it. Reload and try again.',
      );
    }

    const previousSlug = community.slug;
    const previousVisibility = community.visibility;

    if (dto.name !== undefined || dto.slug !== undefined) {
      community.slug = await this._slugService.generateUniqueSlug({
        ...COMMUNITY_SLUG_SCOPE,
        desiredSlug: dto.slug,
        name: dto.name ?? community.name,
        targetId: id,
        isTakenByLiveScope: candidate => this.isSlugTaken(candidate, id),
      });
    }

    const { slug, revision, ...changes } = dto;
    void slug;
    void revision;

    Object.assign(community, changes);

    const saved = await this.saveTranslatingConstraints(community);

    await this._slugService.recordRetiredSlug(
      COMMUNITY_SLUG_SCOPE,
      saved.id,
      previousSlug,
      saved.slug,
    );

    // Only a visibility change alters what somebody is allowed to see, so only
    // that bumps the revision. Renaming and rewording change what a page says,
    // not who may read it, and bumping on every description edit would tell
    // every connected client to throw its view away for nothing.
    if (saved.visibility !== previousVisibility) {
      await this._revisionService.bump(FleetScopeKind.COMMUNITY, saved.id);
    }

    this._logger.log(
      `Fleet Community '${saved.slug}' updated by ${actingUserId}`,
    );

    return saved;
  }

  /**
   * Closes a Community, keeping everything it holds.
   *
   * Idempotent: closing a closed Community succeeds and does not move the
   * closure instant, so a retried request cannot rewrite when it happened.
   *
   * @param id - The Community.
   * @param actingUserId - The caller, for the log.
   * @returns The closed Community.
   */
  async close(id: string, actingUserId: string): Promise<FleetCommunityEntity> {
    const community = await this.findByIdOrFail(id);

    if (community.status === FleetScopeStatus.CLOSED) {
      return community;
    }

    community.status = FleetScopeStatus.CLOSED;
    community.closedAt = new Date();

    const saved = await this._communityRepository.save(community);

    // Closure withdraws every mutating capability at the Community and at each
    // Fleet and Armada inside it, so this one is not optional.
    await this._revisionService.bump(FleetScopeKind.COMMUNITY, saved.id);

    this._logger.log(
      `Fleet Community '${saved.slug}' closed by ${actingUserId}`,
    );

    return saved;
  }

  /**
   * Refuses a registration that would take an owner past the limit.
   *
   * Advisory only. The trigger is what enforces it, and this exists so that
   * somebody who already has ten is told the number rather than shown a
   * failed insert.
   *
   * @param ownerUserId - The registrant.
   * @throws ConflictException when they already hold the maximum.
   */
  private async assertOwnerHasRoom(ownerUserId: string): Promise<void> {
    const held = await this._communityRepository.count({
      where: { ownerUserId, deletedAt: IsNull() },
    });

    if (held >= MAX_FLEET_COMMUNITIES_PER_OWNER) {
      throw new ConflictException(
        `You may own at most ${MAX_FLEET_COMMUNITIES_PER_OWNER} Fleet Communities. Close one you no longer run before registering another.`,
      );
    }
  }

  /**
   * Determines whether a live Community already holds a slug.
   *
   * @param candidate - The slug to test.
   * @param excludingId - The Community being renamed, which may keep its own.
   * @returns True when something else holds it.
   */
  private async isSlugTaken(
    candidate: string,
    excludingId?: string,
  ): Promise<boolean> {
    const held = await this._communityRepository.count({
      where: {
        slug: candidate,
        deletedAt: IsNull(),
        ...(excludingId ? { id: Not(excludingId) } : {}),
      },
    });

    return held > 0;
  }

  /**
   * Saves a Community, turning the two constraints it can break into answers.
   *
   * Both are races rather than programming errors: the slug service and the
   * owner count each check first, and each can be overtaken between the check
   * and the insert. Letting the database be the one that decides is what makes
   * the limits true under concurrency; translating what it raises is what makes
   * the refusal readable.
   *
   * @param community - The Community to save.
   * @returns The saved Community.
   * @throws ConflictException when the owner limit or the slug index refused it.
   */
  private async saveTranslatingConstraints(
    community: FleetCommunityEntity,
  ): Promise<FleetCommunityEntity> {
    try {
      return await this._communityRepository.save(community);
    } catch (error) {
      if (!(error instanceof QueryFailedError)) {
        throw error;
      }

      if (error.message.includes(OWNER_LIMIT_ERROR_FRAGMENT)) {
        throw new ConflictException(
          `You may own at most ${MAX_FLEET_COMMUNITIES_PER_OWNER} Fleet Communities. Close one you no longer run before registering another.`,
        );
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
