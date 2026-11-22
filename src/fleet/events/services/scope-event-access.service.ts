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
  /** Whether it is suspended rather than closed, when it is not open. */
  readonly isSuspended: boolean;
  /**
   * Whether they see who answered, not only how many: the scope's members
   * and its managers.
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
      isSuspended:
        authorisation.scope.effectiveStatus === FleetScopeStatus.SUSPENDED,
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
    let kind: FleetScopeKind;

    if (event.fleetId !== null) {
      kind = FleetScopeKind.FLEET;
    } else if (event.armadaId !== null) {
      kind = FleetScopeKind.ARMADA;
    } else {
      kind = FleetScopeKind.COMMUNITY;
    }

    const scope: GovernanceScope = {
      kind,
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
    return (await this.visibleAmong([event], viewer)).has(event.id);
  }

  /**
   * Picks out the events somebody may see from a scope's.
   *
   * Every event of one audience gets the same answer at one scope, so each
   * audience is asked about once, and the chosen Fleets and roles of all the
   * scope's chosen-audience events are read together. However many events
   * there are, that is at most two audience checks and two reads.
   *
   * @param events - Events of the viewer's scope.
   * @param viewer - Who is looking.
   * @returns The IDs of those they may see.
   */
  async visibleAmong(
    events: readonly ScopeEventEntity[],
    viewer: EventViewer,
  ): Promise<Set<string>> {
    if (viewer.mayManage) {
      return new Set(events.map(event => event.id));
    }

    const audiences = new Set(events.map(event => event.audience));
    const [community, members, selected] = await Promise.all([
      audiences.has(ScopeEventAudience.COMMUNITY) &&
        this._audience.canView(
          FleetAudience.COMMUNITY,
          viewer.ref,
          viewer.userId,
        ),
      audiences.has(ScopeEventAudience.MEMBERS) &&
        this._audience.canView(
          FleetAudience.FLEET_MEMBERS,
          viewer.ref,
          viewer.userId,
        ),
      this.selectedAmong(
        events.filter(event => event.audience === ScopeEventAudience.SELECTED),
        viewer,
      ),
    ]);
    const officer = OFFICER_ROLES.some(role =>
      viewer.authorisation.roles.has(role),
    );
    const sees = (event: ScopeEventEntity): boolean => {
      switch (event.audience) {
        case ScopeEventAudience.PUBLIC:
          return true;
        case ScopeEventAudience.COMMUNITY:
          return community;
        case ScopeEventAudience.MEMBERS:
          return members;
        case ScopeEventAudience.OFFICERS:
          return officer;
        case ScopeEventAudience.SELECTED:
          return selected.has(event.id);
      }
    };

    return new Set(events.filter(sees).map(event => event.id));
  }

  /**
   * Reports whether somebody may answer an event.
   *
   * Anybody it is shown to who holds `events.rsvp` at the scope — its members,
   * by default — and, for a public event, anybody signed in.
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
   * Picks out the chosen-audience events somebody is among.
   *
   * Reads every event's chosen Fleets and roles at once. Then, only for the
   * events no role of theirs already opens, which of the chosen Fleets they
   * are an approved member of, also at once.
   *
   * @param events - Events with a chosen audience.
   * @param viewer - Who is looking.
   * @returns The IDs of those where they hold a chosen role at the scope, or
   *   are an approved member of a chosen Fleet.
   */
  private async selectedAmong(
    events: readonly ScopeEventEntity[],
    viewer: EventViewer,
  ): Promise<Set<string>> {
    const selected = new Set<string>();

    if (viewer.userId === null || events.length === 0) {
      return selected;
    }

    const chosen = await this._dataSource.manager.find(
      ScopeEventAudienceMemberEntity,
      { where: { eventId: In(events.map(event => event.id)) } },
    );

    for (const member of chosen) {
      if (member.role !== null && viewer.authorisation.roles.has(member.role)) {
        selected.add(member.eventId);
      }
    }

    const fleetIds = [
      ...new Set(
        chosen
          .filter(member => !selected.has(member.eventId))
          .map(member => member.fleetId)
          .filter((fleetId): fleetId is string => fleetId !== null),
      ),
    ];

    if (fleetIds.length === 0) {
      return selected;
    }

    const memberOf = new Set(
      (
        await this._dataSource.manager.find(ScopeMembershipEntity, {
          where: {
            userId: viewer.userId,
            fleetId: In(fleetIds),
            status: ScopeMembershipStatus.APPROVED,
            deletedAt: IsNull(),
          },
          select: { fleetId: true },
        })
      ).map(membership => membership.fleetId),
    );

    for (const member of chosen) {
      if (member.fleetId !== null && memberOf.has(member.fleetId)) {
        selected.add(member.eventId);
      }
    }

    return selected;
  }
}
