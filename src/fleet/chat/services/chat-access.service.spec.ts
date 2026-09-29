import { beforeEach, describe, expect, it } from '@jest/globals';

import {
  ARMADA,
  ARMADA_ID,
  chatWorld,
  ChatWorld,
  COMMUNITY,
  COMMUNITY_ID,
  FLEET,
  FLEET_ID,
  MEMBER,
  MEMBER_ID,
  MODERATOR,
  MODERATOR_ID,
  OFFICER,
  OTHER_FLEET_ID,
  seedChannel,
  STRANGER_ID,
} from '../../../../test/chat-world';
import { FLEET_CAPABILITIES } from '../../authorisation/fleet-capability.constants';
import { ScopeMembershipEntity } from '../../entities/scope-membership.entity';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { FleetScopeRole } from '../../enums/fleet-scope-role.enum';
import { ScopeMembershipStatus } from '../../enums/scope-membership-status.enum';
import { ChatStanding } from './chat-access.service';

describe('ChatAccessService', () => {
  let world: ChatWorld;

  beforeEach(() => {
    world = chatWorld();
  });

  describe('standingAt', () => {
    it('ranks a member who posts', async () => {
      world.stand(MEMBER_ID, FLEET_ID, MEMBER);

      await expect(world.access.standingAt(FLEET, MEMBER_ID)).resolves.toEqual({
        userId: MEMBER_ID,
        scope: FLEET,
        rank: 1,
        mayPost: true,
        mayModerate: false,
        isOpen: true,
        mayExport: false,
        mayReport: false,
      });
    });

    it('exports and reports with chat.transcript.export and content.report (FC-035)', async () => {
      world.stand(MODERATOR_ID, FLEET_ID, {
        ...MODERATOR,
        capabilities: [
          FLEET_CAPABILITIES.CHAT_TRANSCRIPT_EXPORT,
          FLEET_CAPABILITIES.CONTENT_REPORT,
        ],
      });

      await expect(
        world.access.standingAt(FLEET, MODERATOR_ID),
      ).resolves.toMatchObject({ mayExport: true, mayReport: true });
    });

    it('ranks by the most senior role, and moderates with chat.moderate', async () => {
      world.stand(MODERATOR_ID, FLEET_ID, MODERATOR);

      await expect(
        world.access.standingAt(FLEET, MODERATOR_ID),
      ).resolves.toMatchObject({ rank: 3, mayPost: true, mayModerate: true });
    });

    it('ranks a role holder who is not a member', async () => {
      world.stand(MODERATOR_ID, FLEET_ID, {
        roles: [FleetScopeRole.OWNER],
      });

      await expect(
        world.access.standingAt(FLEET, MODERATOR_ID),
      ).resolves.toMatchObject({ rank: 4, mayPost: false });
    });

    it('gives nothing to a suspended member, and says a closed scope is closed', async () => {
      world.stand(MEMBER_ID, FLEET_ID, { ...MEMBER, suspended: true });
      world.closed.add(FLEET_ID);

      await expect(world.access.standingAt(FLEET, MEMBER_ID)).resolves.toEqual(
        expect.objectContaining({ rank: 0, mayPost: false, isOpen: false }),
      );
    });

    it('gives nothing where the scope does not exist', async () => {
      world.missing.add(FLEET_ID);

      await expect(
        world.access.standingAt(FLEET, MEMBER_ID),
      ).resolves.toMatchObject({ rank: 0, isOpen: false });
    });

    it('gives nothing to a stranger at a Fleet or an Armada', async () => {
      await expect(
        world.access.standingAt(FLEET, STRANGER_ID),
      ).resolves.toMatchObject({ rank: 0 });
      await expect(
        world.access.standingAt(ARMADA, STRANGER_ID),
      ).resolves.toMatchObject({ rank: 0 });
    });

    it('counts a Community member directly', async () => {
      world.stand(MEMBER_ID, COMMUNITY_ID, MEMBER);

      await expect(
        world.access.standingAt(COMMUNITY, MEMBER_ID),
      ).resolves.toMatchObject({ rank: 1, mayPost: true });
    });

    it('gives nothing at a Community to somebody in none of its Fleets', async () => {
      await expect(
        world.access.standingAt(COMMUNITY, STRANGER_ID),
      ).resolves.toMatchObject({ rank: 0, mayPost: false });
    });

    describe('through a Fleet', () => {
      beforeEach(() => {
        world.db.seed(
          ScopeMembershipEntity,
          [OTHER_FLEET_ID, FLEET_ID].map(fleetId => ({
            communityId: COMMUNITY_ID,
            fleetId,
            armadaId: null,
            userId: MEMBER_ID,
            status: ScopeMembershipStatus.APPROVED,
            deletedAt: null,
          })),
        );
      });

      it('counts a Fleet member at its Community, posting where any Fleet lets them', async () => {
        world.stand(MEMBER_ID, FLEET_ID, MEMBER);

        await expect(
          world.access.standingAt(COMMUNITY, MEMBER_ID),
        ).resolves.toMatchObject({
          rank: 1,
          mayPost: true,
          mayModerate: false,
        });
      });

      it('lets them read but not post when no Fleet lets them post', async () => {
        world.missing.add(OTHER_FLEET_ID);
        world.stand(MEMBER_ID, FLEET_ID, { member: true });

        await expect(
          world.access.standingAt(COMMUNITY, MEMBER_ID),
        ).resolves.toMatchObject({
          rank: 1,
          mayPost: false,
          mayReport: false,
        });
      });

      it('reports where any Fleet lets them, and never exports there (FC-035)', async () => {
        world.stand(MEMBER_ID, OTHER_FLEET_ID, {
          member: true,
          capabilities: [
            FLEET_CAPABILITIES.CONTENT_REPORT,
            FLEET_CAPABILITIES.CHAT_TRANSCRIPT_EXPORT,
          ],
        });

        await expect(
          world.access.standingAt(COMMUNITY, MEMBER_ID),
        ).resolves.toMatchObject({
          rank: 1,
          mayPost: false,
          mayReport: true,
          mayExport: false,
        });
      });
    });
  });

  describe('scopeOf', () => {
    it('names a channel’s scope', () => {
      expect(world.access.scopeOf(seedChannel(world.db))).toEqual(FLEET);
      expect(
        world.access.scopeOf({
          communityId: COMMUNITY_ID,
          fleetId: null,
          armadaId: ARMADA_ID,
        }),
      ).toEqual(ARMADA);
      expect(
        world.access.scopeOf({
          communityId: COMMUNITY_ID,
          fleetId: null,
          armadaId: null,
        }),
      ).toEqual({ ...COMMUNITY, kind: FleetScopeKind.COMMUNITY });
    });
  });

  describe('canRead and canPost', () => {
    const standing = (overrides: Partial<ChatStanding>): ChatStanding => ({
      userId: MEMBER_ID,
      scope: FLEET,
      rank: 1,
      mayPost: true,
      mayModerate: false,
      isOpen: true,
      mayExport: false,
      mayReport: false,
      ...overrides,
    });

    it('lets a member read and post in the standard channel', () => {
      const channel = seedChannel(world.db);

      expect(world.access.canRead(channel, standing({}))).toBe(true);
      expect(world.access.canPost(channel, standing({}))).toBe(true);
    });

    it('keeps an archived channel from everybody', () => {
      const channel = seedChannel(world.db, { archivedAt: new Date() });

      expect(world.access.canRead(channel, standing({ rank: 4 }))).toBe(false);
    });

    it('keeps an Officers’ channel from a member', () => {
      const channel = seedChannel(world.db, {
        readRole: FleetScopeRole.OFFICER,
        postRole: FleetScopeRole.OFFICER,
      });

      expect(world.access.canRead(channel, standing({}))).toBe(false);
      expect(world.access.canRead(channel, standing({ rank: 2 }))).toBe(true);
    });

    it('refuses a post below the posting role, without chat.post, or when closed', () => {
      const channel = seedChannel(world.db, {
        postRole: FleetScopeRole.OFFICER,
      });

      expect(world.access.canPost(channel, standing({}))).toBe(false);
      expect(world.access.canPost(channel, standing({ rank: 2 }))).toBe(true);
      expect(
        world.access.canPost(channel, standing({ rank: 2, mayPost: false })),
      ).toBe(false);
      expect(
        world.access.canPost(channel, standing({ rank: 2, isOpen: false })),
      ).toBe(false);
    });

    it('ranks an Officer above a member', async () => {
      world.stand(MEMBER_ID, FLEET_ID, OFFICER);

      await expect(
        world.access.standingAt(FLEET, MEMBER_ID),
      ).resolves.toMatchObject({ rank: 2 });
    });
  });
});
