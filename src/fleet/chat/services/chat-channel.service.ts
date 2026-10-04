import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import {
  DataSource,
  EntityManager,
  In,
  IsNull,
  QueryDeepPartialEntity,
  QueryFailedError,
} from 'typeorm';

import { ArmadaFleetMembershipEntity } from '../../entities/armada-fleet-membership.entity';
import { FleetCommunityEntity } from '../../entities/fleet-community.entity';
import { ScopeMembershipEntity } from '../../entities/scope-membership.entity';
import { ScopeRoleAssignmentEntity } from '../../entities/scope-role-assignment.entity';
import { StoArmadaEntity } from '../../entities/sto-armada.entity';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { FleetScopeRole } from '../../enums/fleet-scope-role.enum';
import { ScopeMembershipStatus } from '../../enums/scope-membership-status.enum';
import {
  armadaScope,
  communityScope,
  fleetScope,
  GovernanceScope,
} from '../../governance/utilities/governance-scope.utility';
import { scopePlaceOf } from '../../utilities/scope-place.utility';
import {
  ChatChannelDto,
  ChatChannelInputDto,
  ChatScopeChannelsDto,
} from '../dto/chat.dto';
import { ChatActionEntity } from '../entities/chat-action.entity';
import { ChatChannelEntity } from '../entities/chat-channel.entity';
import { ChatActionKind, ChatChannelKind } from '../enums/chat.enums';
import {
  CHAT_ROLE_RANK,
  ChatAccessService,
  ChatStanding,
} from './chat-access.service';

/** The standard channel's name. */
export const STANDARD_CHANNEL_NAME = 'General';

/** What a refused creation says, however many were already there. */
const LIMIT_REACHED =
  'This has three custom channels already. Archive one to make another.';

/** The order scopes are listed in. */
const SCOPE_ORDER: Readonly<Record<FleetScopeKind, number>> = {
  [FleetScopeKind.COMMUNITY]: 0,
  [FleetScopeKind.ARMADA]: 1,
  [FleetScopeKind.FLEET]: 2,
};

/** What a clashing name says. */
const NAME_TAKEN = 'Another channel here already has that name.';

/**
 * A Community's, a Fleet's and an Armada's channels (FC-031).
 *
 * Steve's decisions of 28 September 2026: every scope has one standard
 * channel for all its members, made the first time anybody asks for it, and
 * its `chat.moderate` holders may add up to three custom ones, each with the
 * least role that may read it and the least that may post. The ceiling is
 * the database's to keep, under the scope's lock, so two creations at once
 * cannot make a fourth. Nothing is deleted: a custom channel is archived.
 */
@Injectable()
export class ChatChannelService {
  /**
   * Creates an instance of ChatChannelService.
   *
   * @param _dataSource - The database.
   * @param _access - Says who somebody is in a scope's chat.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _access: ChatAccessService,
  ) {}

  /**
   * Lists a scope's channels the reader may read.
   *
   * @param scope - The scope.
   * @param userId - The reader.
   * @returns Its channels, standard first, then by name.
   * @throws NotFoundException when they take no part in its chat, the same
   *   answer as for a scope that does not exist.
   */
  async list(
    scope: GovernanceScope,
    userId: string,
  ): Promise<ChatChannelDto[]> {
    const standing = await this._access.standingAt(scope, userId);

    if (standing.rank === 0) {
      throw new NotFoundException('Not found');
    }

    await this.ensureStandard(scope);

    return this.channelsFor(standing);
  }

  /**
   * Lists every channel somebody may read, scope by scope: each Community
   * they belong to, each Armada their Fleets are placed in, and each Fleet,
   * as well as anywhere they hold a role.
   *
   * A role held across a whole Community, and the Owner's standing, which
   * lives on the Community rather than in a role row, reach every Fleet and
   * Armada in it, so each of those is listed too (FC-044).
   *
   * @param userId - The person.
   * @returns Each scope's channels, Communities first, then Armadas, then
   *   Fleets.
   */
  async mine(userId: string): Promise<ChatScopeChannelsDto[]> {
    const manager = this._dataSource.manager;
    const [memberships, roles, owned] = await Promise.all([
      manager.find(ScopeMembershipEntity, {
        where: {
          userId,
          status: ScopeMembershipStatus.APPROVED,
          deletedAt: IsNull(),
        },
      }),
      manager.find(ScopeRoleAssignmentEntity, {
        where: { userId, validTo: IsNull(), deletedAt: IsNull() },
      }),
      manager.find(FleetCommunityEntity, {
        where: { ownerUserId: userId },
        select: { id: true },
      }),
    ]);
    const wholeCommunities = [
      ...new Set([
        ...owned.map(community => community.id),
        ...roles
          .filter(role => role.fleetId === null && role.armadaId === null)
          .map(role => role.communityId),
      ]),
    ];
    const [wholeFleets, wholeArmadas] =
      wholeCommunities.length === 0
        ? [[], []]
        : await Promise.all([
            manager.find(StoFleetEntity, {
              where: { communityId: In(wholeCommunities) },
              select: { id: true, communityId: true },
            }),
            manager.find(StoArmadaEntity, {
              where: { communityId: In(wholeCommunities) },
              select: { id: true, communityId: true },
            }),
          ]);
    const fleetIds = memberships
      .map(membership => membership.fleetId)
      .filter((fleetId): fleetId is string => fleetId !== null);
    const placements =
      fleetIds.length === 0
        ? []
        : await manager.find(ArmadaFleetMembershipEntity, {
            where: { fleetId: In(fleetIds), validTo: IsNull() },
          });
    const scopes = new Map<string, GovernanceScope>();
    const add = (scope: GovernanceScope): void => {
      scopes.set(
        `${scope.communityId}:${scope.fleetId}:${scope.armadaId}`,
        scope,
      );
    };

    for (const row of [...memberships, ...roles]) {
      add(communityScope(row.communityId));

      if (row.fleetId !== null) {
        add(fleetScope(row.communityId, row.fleetId));
      } else if (row.armadaId !== null) {
        add(armadaScope(row.communityId, row.armadaId));
      }
    }

    for (const placement of placements) {
      add(armadaScope(placement.communityId, placement.armadaId));
    }

    for (const communityId of wholeCommunities) {
      add(communityScope(communityId));
    }

    for (const fleet of wholeFleets) {
      // Found by Community, so never a standalone Fleet.
      add(fleetScope(fleet.communityId as string, fleet.id));
    }

    for (const armada of wholeArmadas) {
      add(armadaScope(armada.communityId, armada.id));
    }

    const listed: ChatScopeChannelsDto[] = [];

    for (const scope of [...scopes.values()].sort(
      (a, b) => SCOPE_ORDER[a.kind] - SCOPE_ORDER[b.kind],
    )) {
      const standing = await this._access.standingAt(scope, userId);
      const place =
        standing.rank === 0 ? null : await scopePlaceOf(manager, scope);

      if (place === null) {
        continue;
      }

      await this.ensureStandard(scope);
      listed.push({
        kind: place.kind,
        name: place.name,
        path: place.path,
        target: {
          communityId: scope.communityId,
          fleetId: scope.fleetId,
          armadaId: scope.armadaId,
        },
        mayCreate: standing.mayModerate && standing.isOpen,
        mayExport: standing.mayExport,
        channels: await this.channelsFor(standing),
      });
    }

    return listed;
  }

  /**
   * The channels a standing reads, standard first, then by name.
   *
   * @param standing - Who somebody is at the scope.
   * @returns Each channel, with what they may do there.
   */
  async channelsFor(standing: ChatStanding): Promise<ChatChannelDto[]> {
    const { scope } = standing;
    const channels = await this._dataSource.manager.find(ChatChannelEntity, {
      where: {
        communityId: scope.communityId,
        fleetId: scope.fleetId ?? IsNull(),
        armadaId: scope.armadaId ?? IsNull(),
        archivedAt: IsNull(),
      },
    });

    return channels
      .filter(channel => this._access.canRead(channel, standing))
      .sort(
        (a, b) =>
          Number(a.kind === ChatChannelKind.CUSTOM) -
            Number(b.kind === ChatChannelKind.CUSTOM) ||
          a.name.localeCompare(b.name, 'en'),
      )
      .map(channel => this.toDto(channel, standing));
  }

  /**
   * Makes a scope's standard channel, if nobody has yet.
   *
   * @param scope - The scope.
   */
  async ensureStandard(scope: GovernanceScope): Promise<void> {
    await this._dataSource.manager
      .createQueryBuilder()
      .insert()
      .into(ChatChannelEntity)
      .values({
        communityId: scope.communityId,
        fleetId: scope.fleetId,
        armadaId: scope.armadaId,
        kind: ChatChannelKind.STANDARD,
        name: STANDARD_CHANNEL_NAME,
      } as QueryDeepPartialEntity<ChatChannelEntity>)
      .orIgnore()
      .execute();
  }

  /**
   * Adds a custom channel.
   *
   * @param scope - The scope.
   * @param dto - Its name, and who may read and post.
   * @param userId - The moderator.
   * @returns The channel.
   * @throws ForbiddenException when they do not run the scope's chat.
   * @throws ConflictException when the scope is closed, has three already,
   *   or another channel there has the name.
   */
  async create(
    scope: GovernanceScope,
    dto: ChatChannelInputDto,
    userId: string,
  ): Promise<ChatChannelDto> {
    const standing = await this.moderatorAt(scope, userId);

    return this.writing(async manager => {
      const channel = await manager.save(ChatChannelEntity, {
        communityId: scope.communityId,
        fleetId: scope.fleetId,
        armadaId: scope.armadaId,
        kind: ChatChannelKind.CUSTOM,
        name: dto.name.trim(),
        readRole: dto.readRole,
        postRole: postRoleOf(dto),
        createdByUserId: userId,
        archivedAt: null,
      });

      await this.log(
        manager,
        channel.id,
        ChatActionKind.CHANNEL_CREATED,
        userId,
      );

      return this.toDto(channel, standing);
    });
  }

  /**
   * Renames a custom channel, or changes who may read and post.
   *
   * @param scope - The scope.
   * @param channelId - The channel.
   * @param dto - Its name, and who may read and post.
   * @param userId - The moderator.
   * @returns The channel.
   * @throws NotFoundException when there is no such custom channel here.
   * @throws ForbiddenException when they do not run the scope's chat.
   * @throws ConflictException when the scope is closed or the name is taken.
   */
  async update(
    scope: GovernanceScope,
    channelId: string,
    dto: ChatChannelInputDto,
    userId: string,
  ): Promise<ChatChannelDto> {
    const standing = await this.moderatorAt(scope, userId);

    return this.writing(async manager => {
      const channel = await this.customIn(manager, scope, channelId);
      const before = {
        name: channel.name,
        readRole: channel.readRole,
        postRole: channel.postRole,
      };

      channel.name = dto.name.trim();
      channel.readRole = dto.readRole;
      channel.postRole = postRoleOf(dto);

      const saved = await manager.save(ChatChannelEntity, channel);

      await this.log(
        manager,
        channelId,
        ChatActionKind.CHANNEL_CHANGED,
        userId,
        {
          before,
        },
      );

      return this.toDto(saved, standing);
    });
  }

  /**
   * Archives a custom channel: nobody reads or posts in it again, and a new
   * one may take its place.
   *
   * @param scope - The scope.
   * @param channelId - The channel.
   * @param userId - The moderator.
   * @throws NotFoundException when there is no such live custom channel here.
   * @throws ForbiddenException when they do not run the scope's chat.
   * @throws ConflictException when the scope is closed.
   */
  async archive(
    scope: GovernanceScope,
    channelId: string,
    userId: string,
  ): Promise<void> {
    await this.moderatorAt(scope, userId);

    await this.writing(async manager => {
      const channel = await this.customIn(manager, scope, channelId);

      channel.archivedAt = new Date();
      await manager.save(ChatChannelEntity, channel);
      await this.log(
        manager,
        channelId,
        ChatActionKind.CHANNEL_ARCHIVED,
        userId,
      );
    });
  }

  /**
   * Shows a channel to somebody.
   *
   * @param channel - The channel.
   * @param standing - Who they are at its scope.
   * @returns The channel, with what they may do there.
   */
  toDto(channel: ChatChannelEntity, standing: ChatStanding): ChatChannelDto {
    return {
      id: channel.id,
      kind: channel.kind,
      name: channel.name,
      readRole: channel.readRole,
      postRole: channel.postRole,
      mayPost: this._access.canPost(channel, standing),
      mayManage:
        channel.kind === ChatChannelKind.CUSTOM &&
        standing.mayModerate &&
        standing.isOpen,
      mayReport: standing.mayReport,
    };
  }

  /**
   * Requires that somebody runs an open scope's chat.
   *
   * @param scope - The scope.
   * @param userId - The person.
   * @returns Their standing.
   * @throws ForbiddenException when they do not.
   * @throws ConflictException when the scope is closed.
   */
  private async moderatorAt(
    scope: GovernanceScope,
    userId: string,
  ): Promise<ChatStanding> {
    const standing = await this._access.standingAt(scope, userId);

    if (!standing.mayModerate) {
      throw new ForbiddenException('Only its chat moderators may do that.');
    }

    if (!standing.isOpen) {
      throw new ConflictException('This is closed, so its chat cannot change.');
    }

    return standing;
  }

  /**
   * Finds a live custom channel of the scope, holding it.
   *
   * @param manager - The transaction.
   * @param scope - The scope.
   * @param channelId - The channel.
   * @returns The channel.
   * @throws NotFoundException when there is none.
   */
  private async customIn(
    manager: EntityManager,
    scope: GovernanceScope,
    channelId: string,
  ): Promise<ChatChannelEntity> {
    const channel = await manager.findOne(ChatChannelEntity, {
      where: {
        id: channelId,
        communityId: scope.communityId,
        fleetId: scope.fleetId ?? IsNull(),
        armadaId: scope.armadaId ?? IsNull(),
        kind: ChatChannelKind.CUSTOM,
        archivedAt: IsNull(),
      },
      lock: { mode: 'pessimistic_write' },
    });

    if (channel === null) {
      throw new NotFoundException('There is no such channel here.');
    }

    return channel;
  }

  /**
   * Makes a change, telling a full scope and a clashing name apart.
   *
   * @param work - The change.
   * @returns What it returned.
   * @throws ConflictException when the database refuses it for either.
   */
  private async writing<T>(
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    try {
      return await this._dataSource.transaction(work);
    } catch (error) {
      const driverError = (
        error as { driverError?: { code?: string; constraint?: string } }
      ).driverError;
      const code = driverError?.code;

      // The ceiling's trigger names no constraint; a CHECK would.
      if (
        error instanceof QueryFailedError &&
        code === '23514' &&
        driverError?.constraint === undefined
      ) {
        throw new ConflictException(LIMIT_REACHED);
      }

      if (error instanceof QueryFailedError && code === '23505') {
        throw new ConflictException(NAME_TAKEN);
      }

      throw error;
    }
  }

  /**
   * Adds a line to the chat log.
   *
   * @param manager - The transaction.
   * @param channelId - The channel.
   * @param action - What was done.
   * @param actorUserId - Who did it.
   * @param detail - Anything worth keeping.
   */
  private async log(
    manager: EntityManager,
    channelId: string,
    action: ChatActionKind,
    actorUserId: string,
    detail: Record<string, unknown> | null = null,
  ): Promise<void> {
    await manager.save(ChatActionEntity, {
      channelId,
      messageId: null,
      action,
      actorUserId,
      reason: null,
      detail,
    });
  }
}

/**
 * The posting role, the reading role when none is given.
 *
 * @param dto - What was asked for.
 * @returns The posting role.
 * @throws BadRequestException when it would let more people post than read.
 */
function postRoleOf(dto: ChatChannelInputDto): FleetScopeRole {
  const asked = dto.postRole ?? dto.readRole;

  if (CHAT_ROLE_RANK[asked] < CHAT_ROLE_RANK[dto.readRole]) {
    throw new BadRequestException(
      'Posting cannot be open to more people than reading.',
    );
  }

  return asked;
}
