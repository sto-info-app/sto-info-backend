import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import {
  FindOptionsWhere,
  ILike,
  In,
  IsNull,
  Not,
  QueryFailedError,
  Repository,
} from 'typeorm';

import { FileAssetAudience } from 'src/file-assets/enums/file-asset-audience.enum';
import { FileAssetKind } from 'src/file-assets/enums/file-asset-kind.enum';
import { FileAssetSlot } from 'src/file-assets/enums/file-asset-slot.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import { AcceptedAsset } from 'src/file-assets/services/asset-ingress.service';
import { AssetWithdrawalService } from 'src/file-assets/services/asset-withdrawal.service';
import { ImageIngressService } from 'src/file-assets/services/image-ingress.service';
import { NewsPostEntity } from 'src/news/entities/news-post.entity';
import { NewsStatus } from 'src/news/enums/news-status.enum';
import { RegistryService } from 'src/registry/registry.service';
import { DEFAULT_MULTER_LIMITS } from 'src/shared/constants/file-upload.constants';
import { normaliseToSlug } from 'src/shared/utilities/slug.utility';
import { escapeSqlLikeTerm } from 'src/shared/utilities/sql-like.utility';

import { ActivityType } from '../../activity/enums/activity.enums';
import { recordActivity } from '../../activity/utilities/record-activity.utility';
import { FleetAudienceService } from '../../authorisation/fleet-audience.service';
import { FleetAuthorisationService } from '../../authorisation/fleet-authorisation.service';
import { FLEET_CAPABILITIES } from '../../authorisation/fleet-capability.constants';
import {
  ScopeAuthorisation,
  ScopeRef,
} from '../../authorisation/scope-authorisation.interface';
import { SOFT_DELETE_RETENTION_DAYS } from '../../constants/fleet-policy.constants';
import { FleetAudience } from '../../enums/fleet-audience.enum';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { FleetScopeStatus } from '../../enums/fleet-scope-status.enum';
import {
  GovernanceScope,
  toScopeRef,
} from '../../governance/utilities/governance-scope.utility';
import { usernamesFor } from '../../recruitment/utilities/recruitment-names.utility';
import { purgeInBatches } from '../../retention/purge-in-batches.utility';
import { RetentionOutcome } from '../../retention/retention-run.service';
import {
  DEFAULT_SCOPE_NEWS_AUDIENCE,
  SCOPE_NEWS_AUDIENCES,
  SCOPE_NEWS_COVER_SPEC,
  SCOPE_NEWS_DEFAULT_PAGE_SIZE,
  SCOPE_NEWS_SLUG_MAX_LENGTH,
} from '../constants/scope-news.constants';
import {
  CreateScopeNewsPostDto,
  ScopeNewsAuthorDto,
  ScopeNewsPageDto,
  ScopeNewsPostDto,
  ScopeNewsPostSummaryDto,
  ScopeNewsPostViewDto,
  ScopeNewsQueryDto,
  UpdateScopeNewsPostDto,
} from '../dto/scope-news.dto';

/** One day, in milliseconds. */
const DAY = 86_400_000;

/** How each kind of scope is named in a sentence. */
const SCOPE_NOUNS: Readonly<Record<FleetScopeKind, string>> = {
  [FleetScopeKind.COMMUNITY]: 'Community',
  [FleetScopeKind.FLEET]: 'Fleet',
  [FleetScopeKind.ARMADA]: 'Armada',
};

/** A cover image on its way to be scanned. */
export interface ScopeNewsCoverUpload {
  /** Who is uploading it. */
  readonly userId: string;
  /** What it shows. */
  readonly altText: string;
  /** The cropped image. */
  readonly file: Express.Multer.File;
}

/** What the reader may do with a scope's news. */
interface NewsAccess {
  /** The reference the policy was asked about. */
  readonly ref: ScopeRef;
  /** Whether they hold `news.write` there. */
  readonly mayWrite: boolean;
  /** Whether the scope is active, so its news may change. */
  readonly isOpen: boolean;
}

/**
 * A Community's, a Fleet's or an Armada's news (FC-027).
 *
 * The posts live in the site's own `news_post` table, so there is one news
 * system; the site's queries ask for posts naming no Community and these ask
 * for posts naming this scope exactly. Steve's decisions of 28 September 2026
 * shape the rest:
 *
 * - **Reading.** Nobody reads a post of a scope they may not see, and a
 *   published post is read only by its audience: anyone, the Community, or
 *   the scope's members. The scope's own visibility caps it, asked afresh on
 *   every read, so narrowing a Fleet narrows its news without anything being
 *   rewritten. A draft is read only by `news.write` holders.
 * - **Writing.** Anybody holding `news.write` at the scope — its Owner and
 *   Admins, Officers it is delegated to, and the Community's Owner and Admins
 *   for its Fleets and Armadas — may write, edit, publish, unpublish and
 *   delete any post there, not only their own.
 * - **Closure.** A closed or suspended scope's published posts stay readable
 *   and cannot change. Its drafts may still be deleted.
 * - **Site administrators** may take any scoped post down — unpublish or
 *   delete it — but not write one, unless they hold `news.write` there.
 *
 * Every change is saved through the repository, so the audit subscriber
 * records it with who made it.
 */
@Injectable()
export class ScopeNewsService {
  /**
   * Creates an instance of ScopeNewsService.
   *
   * @param _posts - Repository of news posts.
   * @param _authorisation - Resolves who holds what at a scope.
   * @param _audience - Says who may see a scope and its content.
   * @param _registry - Says whose profiles a reader may open.
   * @param _ingress - Checks a cover over and sends it to be scanned.
   * @param _withdrawal - Takes a published cover down.
   */
  constructor(
    @InjectRepository(NewsPostEntity)
    private readonly _posts: Repository<NewsPostEntity>,
    private readonly _authorisation: FleetAuthorisationService,
    private readonly _audience: FleetAudienceService,
    private readonly _registry: RegistryService,
    private readonly _ingress: ImageIngressService,
    private readonly _withdrawal: AssetWithdrawalService,
  ) {}

  /**
   * Lists a page of a scope's posts that the reader may see, newest first.
   *
   * @param scope - The scope.
   * @param viewerId - The reader, or null when signed out.
   * @param query - Which page, which words, and published or drafts.
   * @returns The page, and what the reader may do.
   * @throws NotFoundException when the reader may not see the scope.
   * @throws ForbiddenException when drafts are asked for without
   *   `news.write`.
   */
  async list(
    scope: GovernanceScope,
    viewerId: string | null,
    query: ScopeNewsQueryDto,
  ): Promise<ScopeNewsPageDto> {
    const access = await this.readAccess(scope, viewerId);
    const status = query.status ?? NewsStatus.PUBLISHED;

    if (status === NewsStatus.DRAFT && !access.mayWrite) {
      throw new ForbiddenException('Only its news writers see its drafts.');
    }

    const base: FindOptionsWhere<NewsPostEntity> = {
      ...this.inScope(scope),
      status,
      ...(access.mayWrite
        ? {}
        : { audience: In(await this.audiencesFor(access.ref, viewerId)) }),
    };
    const term = query.q ?? '';
    const where =
      term === ''
        ? base
        : [
            { ...base, title: ILike(`%${escapeSqlLikeTerm(term)}%`) },
            { ...base, summary: ILike(`%${escapeSqlLikeTerm(term)}%`) },
          ];
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? SCOPE_NEWS_DEFAULT_PAGE_SIZE;

    const [posts, total] = await this._posts.findAndCount({
      where,
      order:
        status === NewsStatus.PUBLISHED
          ? { publishedAt: 'DESC', createdAt: 'DESC' }
          : { updatedAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    const authors = await this.authorsOf(posts, viewerId);

    return {
      items: posts.map(post => this.toSummary(post, authors)),
      total,
      page,
      pageSize,
      mayWrite: access.mayWrite,
      isOpen: access.isOpen,
    };
  }

  /**
   * Reads one post the reader may see.
   *
   * @param scope - The scope.
   * @param slug - The post's slug.
   * @param viewerId - The reader, or null when signed out.
   * @returns The post, and what the reader may do.
   * @throws NotFoundException when there is no such post here, or the reader
   *   may not see it — the same answer either way.
   */
  async read(
    scope: GovernanceScope,
    slug: string,
    viewerId: string | null,
  ): Promise<ScopeNewsPostViewDto> {
    const access = await this.readAccess(scope, viewerId);
    const post = await this._posts.findOne({
      where: { ...this.inScope(scope), slug },
    });

    if (post === null || !(await this.mayRead(post, access, viewerId))) {
      throw new NotFoundException('Not found');
    }

    return {
      post: this.toPost(post, await this.authorsOf([post], viewerId)),
      mayWrite: access.mayWrite,
      isOpen: access.isOpen,
    };
  }

  /**
   * Writes a new post, as a draft.
   *
   * @param scope - The scope, at which the author holds `news.write`.
   * @param dto - The post.
   * @param userId - The author.
   * @returns The draft.
   * @throws ConflictException when the scope is not open.
   */
  async create(
    scope: GovernanceScope,
    dto: CreateScopeNewsPostDto,
    userId: string,
  ): Promise<ScopeNewsPostDto> {
    await this.assertOpen(scope, userId);

    const post = this._posts.create({
      communityId: scope.communityId,
      fleetId: scope.fleetId,
      armadaId: scope.armadaId,
      title: dto.title,
      slug: this.slugFor(dto.title),
      summary: this.summaryOf(dto.summary),
      body: dto.body,
      category: null,
      audience: dto.audience ?? DEFAULT_SCOPE_NEWS_AUDIENCE,
      status: NewsStatus.DRAFT,
      publishedAt: null,
      authorId: userId,
    });

    return this.saveAndShow(post, userId);
  }

  /**
   * Changes a post. Its slug stays as it was, so a link to it keeps working.
   *
   * @param scope - The scope, at which the editor holds `news.write`.
   * @param postId - The post.
   * @param dto - What to change.
   * @param userId - The editor.
   * @returns The post as it now is.
   * @throws NotFoundException when there is no such post here.
   * @throws ConflictException when the scope is not open.
   */
  async update(
    scope: GovernanceScope,
    postId: string,
    dto: UpdateScopeNewsPostDto,
    userId: string,
  ): Promise<ScopeNewsPostDto> {
    const post = await this.findInScope(scope, postId);

    await this.assertOpen(scope, userId);

    if (dto.title !== undefined) post.title = dto.title;
    if (dto.summary !== undefined) post.summary = this.summaryOf(dto.summary);
    if (dto.body !== undefined) post.body = dto.body;
    if (dto.audience !== undefined) post.audience = dto.audience;

    return this.saveAndShow(post, userId);
  }

  /**
   * Publishes a post now. One already published keeps its date.
   *
   * A draft published goes on the scope's activity feed (FC-029), where
   * whoever may read the post sees it. One published again after going back
   * to a draft is dated afresh, and so is a new item.
   *
   * @param scope - The scope, at which the caller holds `news.write`.
   * @param postId - The post.
   * @param userId - The caller.
   * @returns The post as it now is.
   * @throws NotFoundException when there is no such post here.
   * @throws ConflictException when the scope is not open.
   */
  async publish(
    scope: GovernanceScope,
    postId: string,
    userId: string,
  ): Promise<ScopeNewsPostDto> {
    const post = await this.findInScope(scope, postId);

    await this.assertOpen(scope, userId);

    if (post.status === NewsStatus.PUBLISHED) {
      return this.saveAndShow(post, userId);
    }

    const publishedAt = post.publishedAt ?? new Date();

    post.status = NewsStatus.PUBLISHED;
    post.publishedAt = publishedAt;

    return this.saveAndShow(post, userId, manager =>
      recordActivity(manager, [
        {
          communityId: post.communityId as string,
          fleetId: post.fleetId,
          armadaId: post.armadaId,
          type: ActivityType.NEWS_PUBLISHED,
          actorUserId: userId,
          sourceId: post.id,
          idempotencyKey: `${ActivityType.NEWS_PUBLISHED}:${post.id}:${publishedAt.toISOString()}`,
          occurredAt: publishedAt,
        },
      ]),
    );
  }

  /**
   * Takes a post back to a draft, as the site's news does: its date goes
   * with it, and publishing it again dates it afresh.
   *
   * @param scope - The scope, at which the caller holds `news.write`.
   * @param postId - The post.
   * @param userId - The caller.
   * @returns The post as it now is.
   * @throws NotFoundException when there is no such post here.
   * @throws ConflictException when the scope is not open.
   */
  async unpublish(
    scope: GovernanceScope,
    postId: string,
    userId: string,
  ): Promise<ScopeNewsPostDto> {
    const post = await this.findInScope(scope, postId);

    await this.assertOpen(scope, userId);
    this.toDraft(post);

    return this.saveAndShow(post, userId);
  }

  /**
   * Deletes a post, and takes its cover down.
   *
   * A draft may be deleted whatever the scope's state. A published post of a
   * closed scope is part of the record and stays.
   *
   * @param scope - The scope, at which the caller holds `news.write`.
   * @param postId - The post.
   * @param userId - The caller.
   * @throws NotFoundException when there is no such post here.
   * @throws ConflictException when the post is published and the scope is
   *   not open.
   */
  async remove(
    scope: GovernanceScope,
    postId: string,
    userId: string,
  ): Promise<void> {
    const post = await this.findInScope(scope, postId);

    if (post.status === NewsStatus.PUBLISHED) {
      await this.assertOpen(scope, userId);
    }

    await this.delete(post, 'Its post was deleted');
  }

  /**
   * Sends a post's cover to be scanned. The post shows its old cover, if any,
   * until the new one is cleared.
   *
   * @param scope - The scope, at which the caller holds `news.write`.
   * @param postId - The post.
   * @param upload - The uploader, the description and the file.
   * @returns The upload to ask about, and how far along it is.
   * @throws NotFoundException when there is no such post here.
   * @throws ConflictException when the scope is not open.
   * @throws BadRequestException when the file is unacceptable as a cover.
   */
  async setCover(
    scope: GovernanceScope,
    postId: string,
    upload: ScopeNewsCoverUpload,
  ): Promise<AcceptedAsset> {
    const post = await this.findInScope(scope, postId);

    await this.assertOpen(scope, upload.userId);

    return this._ingress.accept({
      spec: SCOPE_NEWS_COVER_SPEC,
      userId: upload.userId,
      kind: FileAssetKind.FLEET_IMAGE,
      audience: FileAssetAudience.SCOPE,
      subject: FileAssetSubject.NEWS_POST,
      subjectId: post.id,
      slot: FileAssetSlot.COVER,
      scope: {
        communityId: scope.communityId,
        fleetId: scope.fleetId,
        armadaId: scope.armadaId,
        audience: post.audience,
      },
      entityTag: SCOPE_NEWS_COVER_SPEC.entityTag,
      entityId: post.id,
      maximumBytes: DEFAULT_MULTER_LIMITS.fileSize,
      sizeLimitLabel: 'News covers',
      file: upload.file,
      feature: { altText: upload.altText },
    });
  }

  /**
   * Takes a post's cover down.
   *
   * @param scope - The scope, at which the caller holds `news.write`.
   * @param postId - The post.
   * @param userId - The caller.
   * @throws NotFoundException when there is no such post here, or it has no
   *   cover.
   * @throws ConflictException when the scope is not open.
   */
  async clearCover(
    scope: GovernanceScope,
    postId: string,
    userId: string,
  ): Promise<void> {
    const post = await this.findInScope(scope, postId);

    await this.assertOpen(scope, userId);

    if (post.coverImageId === null) {
      throw new NotFoundException('There is no cover there to remove.');
    }

    await this.withdrawCover(post, 'Removed from its post');
  }

  /**
   * Takes a scoped post back to a draft, as a site administrator.
   *
   * Moderation, so it works whatever the scope's state.
   *
   * @param postId - The post.
   * @throws NotFoundException when no scoped post has that ID.
   */
  async unpublishAsSiteAdmin(postId: string): Promise<void> {
    const post = await this.findScoped(postId);

    this.toDraft(post);
    await this._posts.save(post);
  }

  /**
   * Deletes a scoped post, as a site administrator.
   *
   * @param postId - The post.
   * @throws NotFoundException when no scoped post has that ID.
   */
  async removeAsSiteAdmin(postId: string): Promise<void> {
    await this.delete(
      await this.findScoped(postId),
      'Its post was deleted by a site administrator',
    );
  }

  /**
   * Works out what a reader may do with a scope's news, refusing a reader
   * who may not see the scope at all.
   *
   * @param scope - The scope.
   * @param viewerId - The reader, or null when signed out.
   * @returns What they may do.
   * @throws NotFoundException when they may not see the scope.
   */
  /**
   * Forgets scoped posts deleted more than 30 days ago, a batch at a time
   * (FC-037). The site's own news is not touched. Daily, by the Fleet's
   * retention schedule.
   *
   * Each cover was withdrawn when its post was deleted, and its registry
   * entry outlives the post as every withdrawn asset's does.
   *
   * @returns How many were forgotten, and whether that was all that is due.
   */
  async purgeDeleted(): Promise<RetentionOutcome> {
    const tally = await purgeInBatches(
      this._posts.manager,
      NewsPostEntity,
      {
        communityId: Not(IsNull()),
        deletedAt: LessThan(
          new Date(Date.now() - SOFT_DELETE_RETENTION_DAYS * DAY),
        ),
      },
      { withDeleted: true },
    );

    return { counts: { posts: tally.deleted }, complete: tally.complete };
  }

  private async readAccess(
    scope: GovernanceScope,
    viewerId: string | null,
  ): Promise<NewsAccess> {
    const ref = toScopeRef(scope);

    if (!(await this._audience.canViewScope(ref, viewerId))) {
      throw new NotFoundException('Not found');
    }

    // Seeing the scope means it resolves, so there is always an answer here.
    const authorisation = (await this._authorisation.authorise(
      viewerId,
      ref,
    )) as ScopeAuthorisation;

    return {
      ref,
      mayWrite: authorisation.capabilities.has(FLEET_CAPABILITIES.NEWS_WRITE),
      isOpen: authorisation.scope.effectiveStatus === FleetScopeStatus.ACTIVE,
    };
  }

  /**
   * Reports whether a reader may see one post.
   *
   * @param post - The post.
   * @param access - What the reader may do at its scope.
   * @param viewerId - The reader, or null when signed out.
   * @returns True when they may.
   */
  private async mayRead(
    post: NewsPostEntity,
    access: NewsAccess,
    viewerId: string | null,
  ): Promise<boolean> {
    if (access.mayWrite) {
      return true;
    }

    if (post.status !== NewsStatus.PUBLISHED) {
      return false;
    }

    return this._audience.canView(
      post.audience as FleetAudience,
      access.ref,
      viewerId,
    );
  }

  /**
   * Lists the audiences whose posts a reader may see at a scope.
   *
   * @param ref - The scope.
   * @param viewerId - The reader, or null when signed out.
   * @returns The audiences.
   */
  private async audiencesFor(
    ref: ScopeRef,
    viewerId: string | null,
  ): Promise<FleetAudience[]> {
    const audiences: FleetAudience[] = [];

    for (const audience of SCOPE_NEWS_AUDIENCES) {
      if (await this._audience.canView(audience, ref, viewerId)) {
        audiences.push(audience);
      }
    }

    return audiences;
  }

  /**
   * Requires that a scope's news may change.
   *
   * @param scope - The scope.
   * @param userId - The caller.
   * @throws NotFoundException when the scope does not resolve.
   * @throws ConflictException when it is closed or suspended.
   */
  private async assertOpen(
    scope: GovernanceScope,
    userId: string,
  ): Promise<void> {
    const authorisation = await this._authorisation.authorise(
      userId,
      toScopeRef(scope),
    );

    if (authorisation === null) {
      throw new NotFoundException('Not found');
    }

    const status = authorisation.scope.effectiveStatus;

    if (status !== FleetScopeStatus.ACTIVE) {
      throw new ConflictException(
        `This ${SCOPE_NOUNS[scope.kind]} is ${status === FleetScopeStatus.SUSPENDED ? 'suspended' : 'closed'}, so its news cannot change.`,
      );
    }
  }

  /**
   * Finds a post of this scope.
   *
   * @param scope - The scope.
   * @param postId - The post.
   * @returns The post.
   * @throws NotFoundException when this scope has no such post.
   */
  private async findInScope(
    scope: GovernanceScope,
    postId: string,
  ): Promise<NewsPostEntity> {
    const post = await this._posts.findOne({
      where: { ...this.inScope(scope), id: postId },
    });

    if (post === null) {
      throw new NotFoundException('Not found');
    }

    return post;
  }

  /**
   * Finds any scoped post, never one of the site's own.
   *
   * @param postId - The post.
   * @returns The post.
   * @throws NotFoundException when no scoped post has that ID.
   */
  private async findScoped(postId: string): Promise<NewsPostEntity> {
    const post = await this._posts.findOne({
      where: { id: postId, communityId: Not(IsNull()) },
    });

    if (post === null) {
      throw new NotFoundException('Not found');
    }

    return post;
  }

  /**
   * The condition matching this scope's posts exactly: a Community's own,
   * not its Fleets' or Armadas'.
   *
   * An empty column is matched with `IsNull()` rather than `null`, which a
   * find would drop, widening a Community's news to every post in it.
   *
   * @param scope - The scope.
   * @returns The condition.
   */
  private inScope(scope: GovernanceScope): FindOptionsWhere<NewsPostEntity> {
    return {
      communityId: scope.communityId,
      fleetId: scope.fleetId ?? IsNull(),
      armadaId: scope.armadaId ?? IsNull(),
    };
  }

  /**
   * Makes a slug from a title, unique within the scope in practice by the
   * same time-based suffix the site's news uses.
   *
   * @param title - The title.
   * @returns The slug.
   */
  private slugFor(title: string): string {
    const base = normaliseToSlug(title, SCOPE_NEWS_SLUG_MAX_LENGTH);
    const suffix = Date.now().toString(36);

    return base ? `${base}-${suffix}` : suffix;
  }

  /**
   * Stores a summary, an empty one as none.
   *
   * @param summary - The summary sent.
   * @returns What to store.
   */
  private summaryOf(summary: string | null | undefined): string | null {
    return summary ? summary : null;
  }

  /**
   * Takes a post back to a draft.
   *
   * @param post - The post.
   */
  private toDraft(post: NewsPostEntity): void {
    post.status = NewsStatus.DRAFT;
    post.publishedAt = null;
  }

  /**
   * Deletes a post, then takes its cover down.
   *
   * The deleted row keeps naming its cover; what stops the bytes being served
   * is the withdrawal, and a deleted post is never shown to anybody.
   *
   * @param post - The post.
   * @param reason - Why the cover goes, for the withdrawal record.
   */
  private async delete(post: NewsPostEntity, reason: string): Promise<void> {
    await this._posts.softRemove(post);

    if (post.coverImageId !== null) {
      await this._withdrawal.withdrawSlot(
        FileAssetSubject.NEWS_POST,
        post.id,
        FileAssetSlot.COVER,
        post.coverImageId,
        reason,
      );
    }
  }

  /**
   * Empties a post's cover and withdraws the picture it showed.
   *
   * The columns are emptied first, so the post never points at bytes that
   * have stopped being served.
   *
   * @param post - The post.
   * @param reason - Why, for the withdrawal record.
   */
  private async withdrawCover(
    post: NewsPostEntity,
    reason: string,
  ): Promise<void> {
    const reference = post.coverImageId;

    post.coverImageId = null;
    post.coverImageAlt = null;
    await this._posts.save(post);

    await this._withdrawal.withdrawSlot(
      FileAssetSubject.NEWS_POST,
      post.id,
      FileAssetSlot.COVER,
      reference,
      reason,
    );
  }

  /**
   * Saves a post and shows it to the person who changed it.
   *
   * @param post - The post.
   * @param userId - Who changed it.
   * @param alongside - Anything written with it, in the same transaction.
   * @returns The post as it now is.
   * @throws ConflictException in the unlikely event its slug is taken.
   */
  private async saveAndShow(
    post: NewsPostEntity,
    userId: string,
    alongside?: (manager: EntityManager) => Promise<void>,
  ): Promise<ScopeNewsPostDto> {
    let saved: NewsPostEntity;

    try {
      saved =
        alongside === undefined
          ? await this._posts.save(post)
          : await this._posts.manager.transaction(async manager => {
              const row = await manager.save(NewsPostEntity, post);

              await alongside(manager);

              return row;
            });
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        error.message.includes('duplicate key value')
      ) {
        throw new ConflictException(
          'A post with that address was written at the same moment. Please try again.',
        );
      }

      throw error;
    }

    return this.toPost(saved, await this.authorsOf([saved], userId));
  }

  /**
   * Names the authors of some posts, and says which the reader may follow to
   * a profile.
   *
   * @param posts - The posts.
   * @param viewerId - The reader, or null when signed out.
   * @returns Each author with a username, by user ID.
   */
  private async authorsOf(
    posts: readonly NewsPostEntity[],
    viewerId: string | null,
  ): Promise<Map<string, ScopeNewsAuthorDto>> {
    const names = await usernamesFor(
      this._posts.manager,
      posts.map(post => post.authorId),
    );
    const linkable = await this._registry.findVisibleProfileUserIds(
      [...names.keys()],
      viewerId,
    );

    return new Map(
      [...names].map(([userId, username]) => [
        userId,
        { username, linksToProfile: linkable.has(userId) },
      ]),
    );
  }

  /**
   * Shows a post as a listing does.
   *
   * @param post - The post.
   * @param authors - Its author, if named.
   * @returns The summary.
   */
  private toSummary(
    post: NewsPostEntity,
    authors: ReadonlyMap<string, ScopeNewsAuthorDto>,
  ): ScopeNewsPostSummaryDto {
    return {
      id: post.id,
      slug: post.slug,
      title: post.title,
      summary: post.summary,
      status: post.status,
      audience: post.audience as FleetAudience,
      publishedAt: post.publishedAt,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      coverImageId: post.coverImageId,
      coverImageAlt: post.coverImageAlt,
      author: authors.get(post.authorId as string) ?? null,
    };
  }

  /**
   * Shows a post in full.
   *
   * @param post - The post.
   * @param authors - Its author, if named.
   * @returns The post.
   */
  private toPost(
    post: NewsPostEntity,
    authors: ReadonlyMap<string, ScopeNewsAuthorDto>,
  ): ScopeNewsPostDto {
    return { ...this.toSummary(post, authors), body: post.body };
  }
}
