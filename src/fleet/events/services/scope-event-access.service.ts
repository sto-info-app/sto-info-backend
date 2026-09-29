import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, In, IsNull } from 'typeorm';

import { FleetAudienceService } from '../../authorisation/fleet-audience.service';
import { FleetAuthorisationService } from '../../authorisation/fleet-authorisation.service';
import { FLEET_CAPABILITIES } from '../../authorisation/fleet-capability.constants';
import {
  ScopeAuthorisation,
  ScopeRef,
} from '../../authorisation/scope-authorisation.interface';
import { ScopeMembershipEntity } from '../../entities/scope-membership.entity';
import { FleetAudience } from '../../enums/fleet-audience.enum';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { FleetScopeRole } from '../../enums/fleet-scope-role.enum';
import { FleetScopeStatus } from '../../enums/fleet-scope-status.enum';
import { ScopeMembershipStatus } from '../../enums/scope-membership-status.enum';
import {
  GovernanceScope,
  toScopeRef,
} from '../../governance/utilities/governance-scope.utility';
import { ScopeEventAudienceMemberEntity } from '../entities/scope-event-audience-member.entity';
import { ScopeEventEntity } from '../entities/scope-event.entity';
import { ScopeEventAudience } from '../enums/scope-event.enums';

/** The roles an Officers-only event is shown to. */
const OFFICER_ROLES: readonly FleetScopeRole[] = [
  FleetScopeRole.OWNER,
  FleetScopeRole.ADMIN,
  FleetScopeRole.OFFICER,
];

/** Who is looking at a scope's events, and what they may do there. */
export interface EventViewer {
  /** The reader, or null when signed out. */
  readonly userId: string | null;
  /** The scope, as the policy is asked about it. */
  readonly ref: ScopeRef;
  /** What the policy concluded about them there. */
  readonly authorisation: ScopeAuthorisation;
  /** Whether they hold `events.manage` there. */
  readonly mayManage: boolean;
  /** Whether they hold `events.rsvp` there. */
  readonly mayRsvp: boolean;
  /** Whether the scope is open, so its events may change. */
  readonly isOpen: boolean;
  /**
   * Whether they see who answered, not only how many: the scope's members
   * and its managers, by Steve's decision of 28 September 2026.
   */
  readonly seesNames: boolean;
}

/**
 * Says who may see a scope's events, answer them and run them (FC-028).
 *
 * Seeing the scope comes first, asked of the same policy every Fleet page
 * asks, so an event is never shown to somebody who could not open the page
 * it belongs to. Then the event's own audience: anyone, the Community, the
 * scope's members, its Owner, Admins and Officers, or chosen Fleets and
 * roles. Its managers see every event of the scope, whatever its audience.
 * Every answer is asked afresh, so somebody who leaves a Fleet stops seeing
 * its members' events at once.
 */
@Injectable()
export class ScopeEventAccessService {
  /**
   * Creates an instance of ScopeEventAccessService.
   *
   * @param _dataSource - The database.
   * @param _authorisation - Resolves roles, capabilities and membership.
   * @param _audience - Says who may see a scope and its content.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _authorisation: FleetAuthorisationService,
    private readonly _audience: FleetAudienceService,
  ) {}

  /**
   * Works out who is looking at a scope's events, refusing somebody who may
   * not see the scope at all.
   *
   * @param scope - The scope.
   * @param userId - The reader, or null when signed out.
   * @returns Who they are there.
   * @throws NotFoundException when they may not see the scope.
   */
  async viewerAt(
    scope: GovernanceScope,
    userId: string | null,
  ): Promise<EventViewer> {
    const ref = toScopeRef(scope);

    if (!(await this._audience.canViewScope(ref, userId))) {
      throw new NotFoundException('Not found');
    }

    // Seeing the scope means it resolves, so there is always an answer.
    const authorisation = (await this._authorisation.authorise(
      userId,
      ref,
    )) as ScopeAuthorisation;
    const mayManage = authorisation.capabilities.has(
      FLEET_CAPABILITIES.EVENTS_MANAGE,
    );

    return {
      userId,
      ref,
      authorisation,
      mayManage,
      mayRsvp: authorisation.capabilities.has(FLEET_CAPABILITIES.EVENTS_RSVP),
      isOpen: authorisation.scope.effectiveStatus === FleetScopeStatus.ACTIVE,
      seesNames:
        mayManage ||
        (await this._audience.canView(
          FleetAudience.FLEET_MEMBERS,
          ref,
          userId,
        )),
    };
  }

  /**
   * Works out who somebody is at an event's own scope, without refusing.
   *
   * For the delivery job, which asks about a person rather than on their
   * behalf.
   *
   * @param event - The event.
   * @param userId - The person.
   * @returns Who they are there, or null when they may not see the scope.
   */
  async viewerOf(
    event: Pick<ScopeEventEntity, 'communityId' | 'fleetId' | 'armadaId'>,
    userId: string,
  ): Promise<EventViewer | null> {
    const scope: GovernanceScope = {
      kind:
        event.fleetId !== null
          ? FleetScopeKind.FLEET
          : event.armadaId !== null
            ? FleetScopeKind.ARMADA
            : FleetScopeKind.COMMUNITY,
      communityId: event.communityId,
      fleetId: event.fleetId,
      armadaId: event.armadaId,
    };

    try {
      return await this.viewerAt(scope, userId);
    } catch {
      return null;
    }
  }

  /**
   * Reports whether somebody may see an event.
   *
   * @param event - The event.
   * @param viewer - Who is looking.
   * @returns True when they may.
   */
  async canSee(event: ScopeEventEntity, viewer: EventViewer): Promise<boolean> {
    if (viewer.mayManage) {
      return true;
    }

    switch (event.audience) {
      case ScopeEventAudience.PUBLIC:
        return true;
      case ScopeEventAudience.COMMUNITY:
        return this._audience.canView(
          FleetAudience.COMMUNITY,
          viewer.ref,
          viewer.userId,
        );
      case ScopeEventAudience.MEMBERS:
        return this._audience.canView(
          FleetAudience.FLEET_MEMBERS,
          viewer.ref,
          viewer.userId,
        );
      case ScopeEventAudience.OFFICERS:
        return OFFICER_ROLES.some(role => viewer.authorisation.roles.has(role));
      case ScopeEventAudience.SELECTED:
        return this.isSelected(event, viewer);
    }
  }

  /**
   * Reports whether somebody may answer an event.
   *
   * Steve's decision: anybody it is shown to who holds `events.rsvp` at the
   * scope — its members, by default — and, for a public event, anybody
   * signed in.
   *
   * @param event - The event.
   * @param viewer - Who is looking.
   * @returns True when they may.
   */
  async mayAnswer(
    event: ScopeEventEntity,
    viewer: EventViewer,
  ): Promise<boolean> {
    if (viewer.userId === null || !(await this.canSee(event, viewer))) {
      return false;
    }

    return viewer.mayRsvp || event.audience === ScopeEventAudience.PUBLIC;
  }

  /**
   * Reports whether somebody is among an event's chosen Fleets and roles.
   *
   * @param event - The event.
   * @param viewer - Who is looking.
   * @returns True when they hold a chosen role at the scope, or are an
   *   approved member of a chosen Fleet.
   */
  private async isSelected(
    event: ScopeEventEntity,
    viewer: EventViewer,
  ): Promise<boolean> {
    if (viewer.userId === null) {
      return false;
    }

    const chosen = await this._dataSource.manager.find(
      ScopeEventAudienceMemberEntity,
      { where: { eventId: event.id } },
    );

    if (
      chosen.some(
        member =>
          member.role !== null && viewer.authorisation.roles.has(member.role),
      )
    ) {
      return true;
    }

    const fleetIds = chosen
      .map(member => member.fleetId)
      .filter((fleetId): fleetId is string => fleetId !== null);

    if (fleetIds.length === 0) {
      return false;
    }

    const memberships = await this._dataSource.manager.count(
      ScopeMembershipEntity,
      {
        where: {
          userId: viewer.userId,
          fleetId: In(fleetIds),
          status: ScopeMembershipStatus.APPROVED,
          deletedAt: IsNull(),
        },
      },
    );

    return memberships > 0;
  }
}
