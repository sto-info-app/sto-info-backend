import { NotFoundException } from '@nestjs/common';

import { beforeEach, describe, expect, it } from '@jest/globals';

import {
  ARMADA_ID,
  COMMUNITY_ID,
  eventsWorld,
  EventsWorld,
  FLEET,
  FLEET_ID,
  MANAGER_ID,
  MEMBER_ID,
  OTHER_FLEET_ID,
  seedEvent,
  STRANGER_ID,
} from '../../../../test/scope-events-world';
import { FLEET_CAPABILITIES } from '../../authorisation/fleet-capability.constants';
import { ScopeMembershipEntity } from '../../entities/scope-membership.entity';
import { FleetAudience } from '../../enums/fleet-audience.enum';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { FleetScopeRole } from '../../enums/fleet-scope-role.enum';
import { FleetScopeStatus } from '../../enums/fleet-scope-status.enum';
import { ScopeMembershipStatus } from '../../enums/scope-membership-status.enum';
import { ScopeEventAudienceMemberEntity } from '../entities/scope-event-audience-member.entity';
import { ScopeEventEntity } from '../entities/scope-event.entity';
import { ScopeEventAudience } from '../enums/scope-event.enums';

describe('ScopeEventAccessService', () => {
  let world: EventsWorld;
  let event: ScopeEventEntity;

  const sees = async (userId: string | null) =>
    world.access.canSee(event, await world.access.viewerAt(FLEET, userId));

  beforeEach(() => {
    world = eventsWorld();
    event = seedEvent(world.db);
  });

  describe('viewerAt', () => {
    it('says what a manager may do', async () => {
      await expect(world.access.viewerAt(FLEET, MANAGER_ID)).resolves.toEqual(
        expect.objectContaining({
          userId: MANAGER_ID,
          mayManage: true,
          mayRsvp: true,
          isOpen: true,
          seesNames: true,
          ref: {
            kind: FleetScopeKind.FLEET,
            id: FLEET_ID,
            withinCommunityId: COMMUNITY_ID,
          },
        }),
      );
    });

    it('shows a member names, and a stranger none', async () => {
      await expect(world.access.viewerAt(FLEET, MEMBER_ID)).resolves.toEqual(
        expect.objectContaining({ mayManage: false, seesNames: true }),
      );
      await expect(world.access.viewerAt(FLEET, STRANGER_ID)).resolves.toEqual(
        expect.objectContaining({ mayRsvp: false, seesNames: false }),
      );
    });

    it('says when the scope is not open', async () => {
      world.status = FleetScopeStatus.SUSPENDED;

      await expect(world.access.viewerAt(FLEET, MEMBER_ID)).resolves.toEqual(
        expect.objectContaining({ isOpen: false }),
      );
    });

    it('refuses somebody who may not see the scope, as absent', async () => {
      world.standings.set(STRANGER_ID, { seesScope: false });

      await expect(world.access.viewerAt(FLEET, STRANGER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('viewerOf', () => {
    it.each([
      [
        'a Fleet’s',
        { fleetId: FLEET_ID, armadaId: null },
        FleetScopeKind.FLEET,
        FLEET_ID,
      ],
      [
        'an Armada’s',
        { fleetId: null, armadaId: ARMADA_ID },
        FleetScopeKind.ARMADA,
        ARMADA_ID,
      ],
      [
        'a Community’s',
        { fleetId: null, armadaId: null },
        FleetScopeKind.COMMUNITY,
        COMMUNITY_ID,
      ],
    ])('finds somebody at %s event', async (_kind, where, kind, id) => {
      const viewer = await world.access.viewerOf(
        { communityId: COMMUNITY_ID, ...where },
        MEMBER_ID,
      );

      expect(viewer?.ref).toEqual(expect.objectContaining({ kind, id }));
    });

    it('answers null for somebody who may not see the scope', async () => {
      world.standings.set(STRANGER_ID, { seesScope: false });

      await expect(
        world.access.viewerOf(event, STRANGER_ID),
      ).resolves.toBeNull();
    });
  });

  describe('canSee', () => {
    it('shows a public event to anyone, signed out too', async () => {
      await expect(sees(null)).resolves.toBe(true);
    });

    it('shows a Community event to the Community', async () => {
      event.audience = ScopeEventAudience.COMMUNITY;
      world.standings.set(STRANGER_ID, {
        audiences: [FleetAudience.COMMUNITY],
      });

      await expect(sees(STRANGER_ID)).resolves.toBe(true);
      await expect(sees(null)).resolves.toBe(false);
    });

    it('shows a members’ event to members', async () => {
      event.audience = ScopeEventAudience.MEMBERS;

      await expect(sees(MEMBER_ID)).resolves.toBe(true);
      await expect(sees(STRANGER_ID)).resolves.toBe(false);
    });

    it('shows an Officers’ event to its Owner, Admins and Officers', async () => {
      event.audience = ScopeEventAudience.OFFICERS;
      world.standings.set(STRANGER_ID, { roles: [FleetScopeRole.OFFICER] });

      await expect(sees(STRANGER_ID)).resolves.toBe(true);
      await expect(sees(MEMBER_ID)).resolves.toBe(false);
    });

    it('shows every event to its managers', async () => {
      event.audience = ScopeEventAudience.OFFICERS;
      world.standings.set(STRANGER_ID, {
        capabilities: [FLEET_CAPABILITIES.EVENTS_MANAGE],
      });

      await expect(sees(STRANGER_ID)).resolves.toBe(true);
    });

    describe('for chosen Fleets and roles', () => {
      beforeEach(() => {
        event.audience = ScopeEventAudience.SELECTED;
        world.db.seed(ScopeEventAudienceMemberEntity, [
          { eventId: event.id, fleetId: OTHER_FLEET_ID, role: null },
          { eventId: event.id, fleetId: null, role: FleetScopeRole.OFFICER },
        ]);
      });

      it('shows it to holders of a chosen role', async () => {
        world.standings.set(STRANGER_ID, { roles: [FleetScopeRole.OFFICER] });

        await expect(sees(STRANGER_ID)).resolves.toBe(true);
      });

      it('shows it to approved members of a chosen Fleet', async () => {
        world.db.seed(ScopeMembershipEntity, [
          {
            userId: STRANGER_ID,
            fleetId: OTHER_FLEET_ID,
            status: ScopeMembershipStatus.APPROVED,
            deletedAt: null,
          },
          {
            userId: MEMBER_ID,
            fleetId: OTHER_FLEET_ID,
            status: ScopeMembershipStatus.PENDING,
            deletedAt: null,
          },
        ]);

        await expect(sees(STRANGER_ID)).resolves.toBe(true);
        await expect(sees(MEMBER_ID)).resolves.toBe(false);
      });

      it('shows it to nobody signed out', async () => {
        await expect(sees(null)).resolves.toBe(false);
      });

      it('shows it to nobody else when only roles are chosen', async () => {
        world.db
          .rows<Record<string, unknown>>(ScopeEventAudienceMemberEntity)
          .splice(0, 1);

        await expect(sees(MEMBER_ID)).resolves.toBe(false);
      });
    });
  });

  describe('mayAnswer', () => {
    const mayAnswer = async (userId: string | null) =>
      world.access.mayAnswer(event, await world.access.viewerAt(FLEET, userId));

    it('lets a member answer, and anybody signed in on a public event', async () => {
      await expect(mayAnswer(MEMBER_ID)).resolves.toBe(true);
      await expect(mayAnswer(STRANGER_ID)).resolves.toBe(true);
      await expect(mayAnswer(null)).resolves.toBe(false);
    });

    it('lets only events.rsvp holders answer any other event', async () => {
      event.audience = ScopeEventAudience.COMMUNITY;
      world.standings.set(STRANGER_ID, {
        audiences: [FleetAudience.COMMUNITY],
      });

      await expect(mayAnswer(STRANGER_ID)).resolves.toBe(false);
      await expect(mayAnswer(MEMBER_ID)).resolves.toBe(true);
    });

    it('lets nobody answer what they may not see', async () => {
      event.audience = ScopeEventAudience.MEMBERS;

      await expect(mayAnswer(STRANGER_ID)).resolves.toBe(false);
    });
  });
});
