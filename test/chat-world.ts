import { jest } from '@jest/globals';

import { BlockService } from 'src/community/block.service';
import { FriendshipEntity } from 'src/community/entities/friendship.entity';
import { FriendshipStatus } from 'src/community/enums/friendship-status.enum';
import { FriendshipService } from 'src/community/friendship.service';
import { FleetAuthorisationService } from 'src/fleet/authorisation/fleet-authorisation.service';
import { FLEET_CAPABILITIES } from 'src/fleet/authorisation/fleet-capability.constants';
import { ScopeRef } from 'src/fleet/authorisation/scope-authorisation.interface';
import { ChatChannelEntity } from 'src/fleet/chat/entities/chat-channel.entity';
import { ChatDirectConversationEntity } from 'src/fleet/chat/entities/chat-direct-conversation.entity';
import { ChatMessageEntity } from 'src/fleet/chat/entities/chat-message.entity';
import { ChatChannelKind } from 'src/fleet/chat/enums/chat.enums';
import { ChatAccessService } from 'src/fleet/chat/services/chat-access.service';
import { ChatChannelService } from 'src/fleet/chat/services/chat-channel.service';
import { ChatDirectService } from 'src/fleet/chat/services/chat-direct.service';
import { ChatMessageService } from 'src/fleet/chat/services/chat-message.service';
import { FleetCommunityEntity } from 'src/fleet/entities/fleet-community.entity';
import { StoArmadaEntity } from 'src/fleet/entities/sto-armada.entity';
import { StoFleetEntity } from 'src/fleet/entities/sto-fleet.entity';
import { FleetScopeRole } from 'src/fleet/enums/fleet-scope-role.enum';
import { FleetScopeStatus } from 'src/fleet/enums/fleet-scope-status.enum';
import { FleetPolicyService } from 'src/fleet/fleet-policy.service';
import {
  armadaScope,
  communityScope,
  fleetScope,
} from 'src/fleet/governance/utilities/governance-scope.utility';
import { UserProfileEntity } from 'src/user/entities/user-profile.entity';

import { InMemoryManager, Row } from './in-memory-manager';

/**
 * A world for the chat services (FC-031): the real services over rows in an
 * {@link InMemoryManager}, with authorisation answered per person and scope,
 * and friendships and blocks kept here. It lives under `test/` so it is not
 * measured for coverage.
 */

export const COMMUNITY_ID = '31000000-0000-4000-8000-000000000001';
export const FLEET_ID = '31000000-0000-4000-8000-000000000002';
export const OTHER_FLEET_ID = '31000000-0000-4000-8000-000000000003';
export const ARMADA_ID = '31000000-0000-4000-8000-000000000004';
export const MEMBER_ID = '31000000-0000-4000-8000-000000000010';
export const OFFICER_ID = '31000000-0000-4000-8000-000000000011';
export const MODERATOR_ID = '31000000-0000-4000-8000-000000000012';
export const FRIEND_ID = '31000000-0000-4000-8000-000000000013';
export const STRANGER_ID = '31000000-0000-4000-8000-000000000014';
export const CHANNEL_ID = '31000000-0000-4000-8000-0000000000c1';

export const COMMUNITY = communityScope(COMMUNITY_ID);
export const FLEET = fleetScope(COMMUNITY_ID, FLEET_ID);
export const ARMADA = armadaScope(COMMUNITY_ID, ARMADA_ID);

/** How somebody stands at one scope. */
export interface ChatStandingSeed {
  readonly roles?: FleetScopeRole[];
  readonly member?: boolean;
  readonly capabilities?: string[];
  readonly suspended?: boolean;
}

/** A mocked asynchronous call a spec may answer. */
type AsyncMock = jest.Mock<(...args: any[]) => Promise<any>>;

/** A Fleet member, who posts. */
export const MEMBER: ChatStandingSeed = {
  member: true,
  capabilities: [FLEET_CAPABILITIES.CHAT_POST],
};

/** An Officer, who posts. */
export const OFFICER: ChatStandingSeed = {
  roles: [FleetScopeRole.OFFICER],
  member: true,
  capabilities: [FLEET_CAPABILITIES.CHAT_POST],
};

/** An Admin, who moderates. */
export const MODERATOR: ChatStandingSeed = {
  roles: [FleetScopeRole.ADMIN],
  member: true,
  capabilities: [
    FLEET_CAPABILITIES.CHAT_POST,
    FLEET_CAPABILITIES.CHAT_MODERATE,
  ],
};

/** The chat services over one in-memory database. */
export interface ChatWorld {
  readonly db: InMemoryManager;
  readonly access: ChatAccessService;
  readonly channels: ChatChannelService;
  readonly direct: ChatDirectService;
  readonly messages: ChatMessageService;
  readonly authorisation: { authorise: AsyncMock };
  /** Scopes that are closed, by their own ID. */
  readonly closed: Set<string>;
  /** Scopes that do not exist, by their own ID. */
  readonly missing: Set<string>;
  /**
   * Sets how somebody stands at a scope.
   *
   * @param userId - Who.
   * @param scopeId - The scope's own ID.
   * @param seed - Their standing.
   */
  stand(userId: string, scopeId: string, seed: ChatStandingSeed): void;
  /**
   * Makes two people friends.
   *
   * @param a - Who asked.
   * @param b - Who accepted.
   */
  befriend(a: string, b: string): void;
  /**
   * Ends two people's friendship.
   *
   * @param a - One.
   * @param b - The other.
   */
  unfriend(a: string, b: string): void;
  /**
   * Has one person block another.
   *
   * @param blocker - Who blocks.
   * @param blocked - Who is blocked.
   */
  block(blocker: string, blocked: string): void;
}

/**
 * Builds the chat services over an in-memory database.
 *
 * @returns The world.
 */
export function chatWorld(): ChatWorld {
  const db = new InMemoryManager()
    .unique(ChatChannelEntity, row =>
      row.kind === ChatChannelKind.STANDARD
        ? [row.communityId, row.fleetId, row.armadaId].map(String).join(':')
        : null,
    )
    .defaults(ChatChannelEntity, {
      readRole: FleetScopeRole.MEMBER,
      postRole: FleetScopeRole.MEMBER,
      createdByUserId: null,
      archivedAt: null,
    })
    .unique(ChatDirectConversationEntity, row =>
      [row.userLowId, row.userHighId].map(String).join(':'),
    )
    .seed(FleetCommunityEntity, [
      {
        id: COMMUNITY_ID,
        name: 'Fixture Community',
        slug: 'fixture-community',
      },
    ])
    .seed(StoFleetEntity, [
      {
        id: FLEET_ID,
        exactGameName: 'Fixture Fleet',
        slug: 'fixture-fleet',
        platform: { name: 'Windows' },
      },
    ])
    .seed(StoArmadaEntity, [
      {
        id: ARMADA_ID,
        exactGameName: 'Fixture Armada',
        slug: 'fixture-armada',
        platform: { name: 'Windows' },
      },
    ])
    .seed(UserProfileEntity, [
      { userId: MEMBER_ID, username: 'Member' },
      { userId: MODERATOR_ID, username: 'Moderator' },
      { userId: FRIEND_ID, username: 'Friend' },
      { userId: STRANGER_ID, username: 'Stranger' },
    ]);
  const save = db.save;

  // The database stamps a message's time; so does this.
  db.save = (entity, row) => {
    if (entity === ChatMessageEntity && row !== undefined) {
      (row as Row).createdAt ??= new Date();
    }

    return save(entity, row);
  };

  const standings = new Map<string, ChatStandingSeed>();
  const blocked: [string, string][] = [];
  const closed = new Set<string>();
  const missing = new Set<string>();
  const between = (a: string, b: string) => (row: Row) =>
    (row.requesterId === a && row.addresseeId === b) ||
    (row.requesterId === b && row.addresseeId === a);
  const authorisation = {
    authorise: jest.fn((userId: string, ref: ScopeRef) => {
      if (missing.has(ref.id)) {
        return Promise.resolve(null);
      }

      const seed = standings.get(`${userId}:${ref.id}`) ?? {};

      return Promise.resolve({
        scope: {
          effectiveStatus: closed.has(ref.id)
            ? FleetScopeStatus.CLOSED
            : FleetScopeStatus.ACTIVE,
        },
        roles: new Set(seed.roles ?? []),
        capabilities: new Set(seed.capabilities ?? []),
        isApprovedMember: seed.member ?? false,
        isSuspended: seed.suspended ?? false,
      });
    }) as AsyncMock,
  };
  const friendships = {
    findFriendshipBetween: (a: string, b: string) =>
      Promise.resolve(db.rows(FriendshipEntity).find(between(a, b)) ?? null),
  };
  const blocks = {
    isBlockedBetween: (a: string, b: string) =>
      Promise.resolve(
        blocked.some(([x, y]) => (x === a && y === b) || (x === b && y === a)),
      ),
    getBlockedUserIds: (userId: string) =>
      Promise.resolve(
        blocked
          .filter(pair => pair.includes(userId))
          .map(([x, y]) => (x === userId ? y : x)),
      ),
  };
  const policy = {
    chatMemberHistoryHours: 4,
    chatRetentionDays: 45,
  } as FleetPolicyService;
  const dataSource = db.asDataSource();
  const access = new ChatAccessService(
    dataSource,
    authorisation as unknown as FleetAuthorisationService,
  );
  const direct = new ChatDirectService(
    dataSource,
    friendships as unknown as FriendshipService,
    blocks as unknown as BlockService,
  );

  return {
    db,
    access,
    channels: new ChatChannelService(dataSource, access),
    direct,
    messages: new ChatMessageService(dataSource, access, direct, policy),
    authorisation,
    closed,
    missing,
    stand: (userId, scopeId, seed) => {
      standings.set(`${userId}:${scopeId}`, seed);
    },
    befriend: (a, b) => {
      db.seed(FriendshipEntity, [
        { requesterId: a, addresseeId: b, status: FriendshipStatus.ACCEPTED },
      ]);
    },
    unfriend: (a, b) => {
      const rows = db.rows(FriendshipEntity);

      rows.splice(rows.findIndex(between(a, b)), 1);
    },
    block: (blocker, blockedId) => {
      blocked.push([blocker, blockedId]);
    },
  };
}

/**
 * Seeds a channel: the Fleet's standard one, unless told otherwise.
 *
 * @param db - The manager.
 * @param overrides - What differs.
 * @returns The row.
 */
export function seedChannel(
  db: InMemoryManager,
  overrides: Partial<ChatChannelEntity> = {},
): ChatChannelEntity {
  const row = {
    id: CHANNEL_ID,
    communityId: COMMUNITY_ID,
    fleetId: FLEET_ID,
    armadaId: null,
    kind: ChatChannelKind.STANDARD,
    name: 'General',
    readRole: FleetScopeRole.MEMBER,
    postRole: FleetScopeRole.MEMBER,
    createdByUserId: null,
    archivedAt: null,
    ...overrides,
  } as ChatChannelEntity;

  db.seed(ChatChannelEntity, [row as unknown as Row]);

  return row;
}

/**
 * Seeds a message.
 *
 * @param db - The manager.
 * @param overrides - Its place, author, text and time.
 * @returns The row.
 */
export function seedMessage(
  db: InMemoryManager,
  overrides: Partial<ChatMessageEntity> & { id: string },
): ChatMessageEntity {
  const row = {
    channelId: CHANNEL_ID,
    conversationId: null,
    authorUserId: MEMBER_ID,
    clientMessageId: overrides.id,
    body: 'Hello',
    mentions: [],
    replyToMessageId: null,
    createdAt: new Date(),
    deletedAt: null,
    deletedByUserId: null,
    ...overrides,
  } as ChatMessageEntity;

  db.seed(ChatMessageEntity, [row as unknown as Row]);

  return row;
}
