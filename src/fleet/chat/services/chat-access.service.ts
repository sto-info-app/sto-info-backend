import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, IsNull, Not } from 'typeorm';

import { FleetAuthorisationService } from '../../authorisation/fleet-authorisation.service';
import { FLEET_CAPABILITIES } from '../../authorisation/fleet-capability.constants';
import { ScopeMembershipEntity } from '../../entities/scope-membership.entity';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { FleetScopeRole } from '../../enums/fleet-scope-role.enum';
import { FleetScopeStatus } from '../../enums/fleet-scope-status.enum';
import { ScopeMembershipStatus } from '../../enums/scope-membership-status.enum';
import {
  fleetScope,
  GovernanceScope,
  toScopeRef,
} from '../../governance/utilities/governance-scope.utility';
import { ChatChannelEntity } from '../entities/chat-channel.entity';

/** How senior each role is: a higher number reads and posts more. */
export const CHAT_ROLE_RANK: Readonly<Record<FleetScopeRole, number>> = {
  [FleetScopeRole.MEMBER]: 1,
  [FleetScopeRole.OFFICER]: 2,
  [FleetScopeRole.ADMIN]: 3,
  [FleetScopeRole.OWNER]: 4,
};

/** Who somebody is in one scope's chat. */
export interface ChatStanding {
  readonly userId: string;
  readonly scope: GovernanceScope;
  /** Their most senior standing there: 0 for none, 1 a member, up to 4. */
  readonly rank: number;
  /** Whether they may post at all: `chat.post`, where they hold it. */
  readonly mayPost: boolean;
  /** Whether they run its channels and messages: `chat.moderate`. */
  readonly mayModerate: boolean;
  /** Whether the scope is open, so its chat may change. */
  readonly isOpen: boolean;
  /** Whether they may export a transcript: `chat.transcript.export` (FC-035). */
  readonly mayExport: boolean;
  /** Whether they may report a message: `content.report` (FC-035). */
  readonly mayReport: boolean;
}

/**
 * Says who somebody is in a scope's chat (FC-031).
 *
 * Steve's decisions of 28 September 2026: chat is for members, never for
 * followers. A Fleet's member takes part in its own channels, its Armada's
 * and its Community's. A Community counts the members of every Fleet in it
 * as well as its own, and such a member posts there on the strength of
 * `chat.post` at their Fleet. A role — Officer, Admin, Owner — reaches
 * further, into the channels kept for it. Every answer is asked afresh, so
 * leaving a Fleet, a suspension or a Fleet leaving its Armada closes the
 * door at once.
 */
@Injectable()
export class ChatAccessService {
  /**
   * Creates an instance of ChatAccessService.
   *
   * @param _dataSource - The database.
   * @param _authorisation - Resolves roles and capabilities at a scope.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _authorisation: FleetAuthorisationService,
  ) {}

  /**
   * Who somebody is in a scope's chat.
   *
   * @param scope - The scope.
   * @param userId - The person.
   * @returns Their standing; a rank of 0 when they take no part.
   */
  async standingAt(
    scope: GovernanceScope,
    userId: string,
  ): Promise<ChatStanding> {
    const authorisation = await this._authorisation.authorise(
      userId,
      toScopeRef(scope),
    );
    const isOpen =
      authorisation?.scope.effectiveStatus === FleetScopeStatus.ACTIVE;
    const none: ChatStanding = {
      userId,
      scope,
      rank: 0,
      mayPost: false,
      mayModerate: false,
      isOpen,
      mayExport: false,
      mayReport: false,
    };

    if (authorisation === null || authorisation.isSuspended) {
      return none;
    }

    const rank = Math.max(
      authorisation.isApprovedMember ? 1 : 0,
      ...[...authorisation.roles].map(role => CHAT_ROLE_RANK[role]),
    );

    if (rank > 0) {
      return {
        ...none,
        rank,
        mayPost: authorisation.capabilities.has(FLEET_CAPABILITIES.CHAT_POST),
        mayModerate: authorisation.capabilities.has(
          FLEET_CAPABILITIES.CHAT_MODERATE,
        ),
        mayExport: authorisation.capabilities.has(
          FLEET_CAPABILITIES.CHAT_TRANSCRIPT_EXPORT,
        ),
        mayReport: authorisation.capabilities.has(
          FLEET_CAPABILITIES.CONTENT_REPORT,
        ),
      };
    }

    return scope.kind === FleetScopeKind.COMMUNITY
      ? { ...none, ...(await this.throughFleets(scope, userId)) }
      : none;
  }

  /**
   * The scope a channel belongs to.
   *
   * @param channel - The channel.
   * @returns Its scope.
   */
  scopeOf(
    channel: Pick<ChatChannelEntity, 'communityId' | 'fleetId' | 'armadaId'>,
  ): GovernanceScope {
    return {
      kind:
        channel.fleetId !== null
          ? FleetScopeKind.FLEET
          : channel.armadaId !== null
            ? FleetScopeKind.ARMADA
            : FleetScopeKind.COMMUNITY,
      communityId: channel.communityId,
      fleetId: channel.fleetId,
      armadaId: channel.armadaId,
    };
  }

  /**
   * Whether somebody may read a channel.
   *
   * @param channel - The channel.
   * @param standing - Who they are at its scope.
   * @returns True while it is live and their standing reaches it.
   */
  canRead(channel: ChatChannelEntity, standing: ChatStanding): boolean {
    return (
      channel.archivedAt === null &&
      standing.rank >= CHAT_ROLE_RANK[channel.readRole]
    );
  }

  /**
   * Whether somebody may post in a channel.
   *
   * @param channel - The channel.
   * @param standing - Who they are at its scope.
   * @returns True when they may read it, their standing reaches its posting
   *   role, they hold `chat.post`, and the scope is open.
   */
  canPost(channel: ChatChannelEntity, standing: ChatStanding): boolean {
    return (
      this.canRead(channel, standing) &&
      standing.rank >= CHAT_ROLE_RANK[channel.postRole] &&
      standing.mayPost &&
      standing.isOpen
    );
  }

  /**
   * A Community's member through one of its Fleets.
   *
   * @param scope - The Community.
   * @param userId - The person.
   * @returns A member's standing, posting and reporting where any of their
   *   Fleets lets them; nothing when they belong to none of its Fleets.
   */
  private async throughFleets(
    scope: GovernanceScope,
    userId: string,
  ): Promise<Partial<ChatStanding>> {
    const memberships = await this._dataSource.manager.find(
      ScopeMembershipEntity,
      {
        where: {
          communityId: scope.communityId,
          userId,
          fleetId: Not(IsNull()),
          status: ScopeMembershipStatus.APPROVED,
          deletedAt: IsNull(),
        },
      },
    );

    if (memberships.length === 0) {
      return {};
    }

    let mayPost = false;
    let mayReport = false;

    for (const membership of memberships) {
      const atFleet = await this._authorisation.authorise(
        userId,
        toScopeRef(fleetScope(scope.communityId, membership.fleetId as string)),
      );

      mayPost ||=
        atFleet?.capabilities.has(FLEET_CAPABILITIES.CHAT_POST) ?? false;
      mayReport ||=
        atFleet?.capabilities.has(FLEET_CAPABILITIES.CONTENT_REPORT) ?? false;
    }

    return { rank: 1, mayPost, mayReport };
  }
}
