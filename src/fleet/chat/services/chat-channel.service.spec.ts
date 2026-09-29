import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { beforeEach, describe, expect, it } from '@jest/globals';
import { QueryFailedError } from 'typeorm';

import {
  ARMADA_ID,
  CHANNEL_ID,
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
import { Row } from '../../../../test/in-memory-manager';
import { ArmadaFleetMembershipEntity } from '../../entities/armada-fleet-membership.entity';
import { ScopeMembershipEntity } from '../../entities/scope-membership.entity';
import { ScopeRoleAssignmentEntity } from '../../entities/scope-role-assignment.entity';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { FleetScopeRole } from '../../enums/fleet-scope-role.enum';
import { ScopeMembershipStatus } from '../../enums/scope-membership-status.enum';
import { ChatActionEntity } from '../entities/chat-action.entity';
import { ChatChannelEntity } from '../entities/chat-channel.entity';
import { ChatActionKind, ChatChannelKind } from '../enums/chat.enums';
import { STANDARD_CHANNEL_NAME } from './chat-channel.service';

const CUSTOM_ID = '31000000-0000-4000-8000-0000000000c2';

describe('ChatChannelService', () => {
  let world: ChatWorld;

  beforeEach(() => {
    world = chatWorld();
  });

  /**
   * Makes the next channel save fail as the database would.
   *
   * @param driverError - What PostgreSQL said.
   */
  const refuseSave = (driverError: Row): void => {
    const save = world.db.save;

    world.db.save = (entity, row) =>
      entity === ChatChannelEntity
        ? Promise.reject(
            new QueryFailedError('INSERT', [], driverError as unknown as Error),
          )
        : save(entity, row);
  };

  describe('list', () => {
    it('hides a scope from somebody with no part in its chat', async () => {
      await expect(world.channels.list(FLEET, STRANGER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('makes the standard channel once, and lists it first', async () => {
      world.stand(MEMBER_ID, FLEET_ID, MEMBER);
      seedChannel(world.db, {
        id: CUSTOM_ID,
        kind: ChatChannelKind.CUSTOM,
        name: 'Away team',
      });
      seedChannel(world.db, {
        id: 'hidden',
        kind: ChatChannelKind.CUSTOM,
        name: 'Officers',
        readRole: FleetScopeRole.OFFICER,
        postRole: FleetScopeRole.OFFICER,
      });

      await world.channels.list(FLEET, MEMBER_ID);
      const listed = await world.channels.list(FLEET, MEMBER_ID);

      expect(listed.map(channel => channel.name)).toEqual([
        STANDARD_CHANNEL_NAME,
        'Away team',
      ]);
      expect(listed[0]).toMatchObject({
        kind: ChatChannelKind.STANDARD,
        mayPost: true,
        mayManage: false,
        mayReport: false,
      });
      expect(world.db.rows(ChatChannelEntity)).toHaveLength(3);
    });

    it('orders custom channels by name, and lets a moderator manage them', async () => {
      world.stand(MODERATOR_ID, FLEET_ID, MODERATOR);

      for (const name of ['Zulu', 'Alpha']) {
        seedChannel(world.db, {
          id: name,
          kind: ChatChannelKind.CUSTOM,
          name,
        });
      }

      const listed = await world.channels.list(FLEET, MODERATOR_ID);

      expect(listed.map(channel => [channel.name, channel.mayManage])).toEqual([
        [STANDARD_CHANNEL_NAME, false],
        ['Alpha', true],
        ['Zulu', true],
      ]);
    });
  });

  describe('mine', () => {
    const membership = (row: Row): Row => ({
      communityId: COMMUNITY_ID,
      fleetId: null,
      armadaId: null,
      userId: MEMBER_ID,
      status: ScopeMembershipStatus.APPROVED,
      deletedAt: null,
      ...row,
    });

    it('lists nothing for somebody in nothing', async () => {
      await expect(world.channels.mine(STRANGER_ID)).resolves.toEqual([]);
    });

    it('lists the Community, the Armada and the Fleet, in that order', async () => {
      world.db
        .seed(ScopeMembershipEntity, [
          membership({ fleetId: FLEET_ID }),
          // A Fleet that has gone: skipped.
          membership({ fleetId: OTHER_FLEET_ID }),
        ])
        .seed(ArmadaFleetMembershipEntity, [
          {
            communityId: COMMUNITY_ID,
            armadaId: ARMADA_ID,
            fleetId: FLEET_ID,
            validTo: null,
          },
        ]);
      world.stand(MEMBER_ID, FLEET_ID, MEMBER);
      world.stand(MEMBER_ID, OTHER_FLEET_ID, MEMBER);
      world.stand(MEMBER_ID, ARMADA_ID, MEMBER);
      world.stand(MEMBER_ID, COMMUNITY_ID, MODERATOR);

      const listed = await world.channels.mine(MEMBER_ID);

      expect(listed.map(scope => [scope.kind, scope.name])).toEqual([
        [FleetScopeKind.COMMUNITY, 'Fixture Community'],
        [FleetScopeKind.ARMADA, 'Fixture Armada'],
        [FleetScopeKind.FLEET, 'Fixture Fleet'],
      ]);
      expect(listed[0]).toMatchObject({
        path: '/fleets/communities/fixture-community',
        target: { communityId: COMMUNITY_ID, fleetId: null, armadaId: null },
        mayCreate: true,
        mayExport: false,
        channels: [expect.objectContaining({ name: STANDARD_CHANNEL_NAME })],
      });
      expect(listed[2].mayCreate).toBe(false);
    });

    it('lists an Armada where they hold a role, and skips a scope where they have none', async () => {
      world.db.seed(ScopeRoleAssignmentEntity, [
        {
          communityId: COMMUNITY_ID,
          fleetId: null,
          armadaId: ARMADA_ID,
          userId: MEMBER_ID,
          role: FleetScopeRole.OFFICER,
          validTo: null,
          deletedAt: null,
        },
      ]);
      world.stand(MEMBER_ID, ARMADA_ID, OFFICER);

      const listed = await world.channels.mine(MEMBER_ID);

      expect(listed.map(scope => scope.kind)).toEqual([FleetScopeKind.ARMADA]);
    });

    it('asks no placements when they are in no Fleet', async () => {
      world.db.seed(ScopeMembershipEntity, [membership({})]);
      world.stand(MEMBER_ID, COMMUNITY_ID, MEMBER);

      const listed = await world.channels.mine(MEMBER_ID);

      expect(listed.map(scope => scope.kind)).toEqual([
        FleetScopeKind.COMMUNITY,
      ]);
    });
  });

  describe('create', () => {
    const dto = {
      name: '  Away team ',
      readRole: FleetScopeRole.MEMBER,
    };

    it('refuses somebody who does not moderate', async () => {
      world.stand(MEMBER_ID, FLEET_ID, MEMBER);

      await expect(
        world.channels.create(FLEET, dto, MEMBER_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses a closed scope', async () => {
      world.stand(MODERATOR_ID, FLEET_ID, MODERATOR);
      world.closed.add(FLEET_ID);

      await expect(
        world.channels.create(FLEET, dto, MODERATOR_ID),
      ).rejects.toThrow(ConflictException);
    });

    it('adds a custom channel, posting as it reads, and logs it', async () => {
      world.stand(MODERATOR_ID, FLEET_ID, MODERATOR);

      const channel = await world.channels.create(FLEET, dto, MODERATOR_ID);

      expect(channel).toMatchObject({
        kind: ChatChannelKind.CUSTOM,
        name: 'Away team',
        readRole: FleetScopeRole.MEMBER,
        postRole: FleetScopeRole.MEMBER,
        mayPost: true,
        mayManage: true,
      });
      expect(world.db.rows(ChatActionEntity)).toEqual([
        expect.objectContaining({
          channelId: channel.id,
          action: ChatActionKind.CHANNEL_CREATED,
          actorUserId: MODERATOR_ID,
          detail: null,
        }),
      ]);
    });

    it('refuses posting open to more people than reading', async () => {
      world.stand(MODERATOR_ID, FLEET_ID, MODERATOR);

      await expect(
        world.channels.create(
          FLEET,
          {
            ...dto,
            readRole: FleetScopeRole.OFFICER,
            postRole: FleetScopeRole.MEMBER,
          },
          MODERATOR_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('says the scope is full when the ceiling’s trigger refuses it', async () => {
      world.stand(MODERATOR_ID, COMMUNITY_ID, MODERATOR);
      refuseSave({ code: '23514' });

      await expect(
        world.channels.create(COMMUNITY, dto, MODERATOR_ID),
      ).rejects.toThrow('three custom channels already');
    });

    it('passes a CHECK’s refusal on', async () => {
      world.stand(MODERATOR_ID, FLEET_ID, MODERATOR);
      refuseSave({ code: '23514', constraint: 'CHK_chat_channel_name' });

      await expect(
        world.channels.create(FLEET, dto, MODERATOR_ID),
      ).rejects.toThrow(QueryFailedError);
    });

    it('says the name is taken', async () => {
      world.stand(MODERATOR_ID, FLEET_ID, MODERATOR);
      refuseSave({ code: '23505' });

      await expect(
        world.channels.create(FLEET, dto, MODERATOR_ID),
      ).rejects.toThrow('already has that name');
    });

    it('passes any other failure on', async () => {
      world.stand(MODERATOR_ID, FLEET_ID, MODERATOR);
      refuseSave({ code: '40001' });

      await expect(
        world.channels.create(FLEET, dto, MODERATOR_ID),
      ).rejects.toThrow(QueryFailedError);
    });
  });

  describe('update and archive', () => {
    beforeEach(() => {
      world.stand(MODERATOR_ID, FLEET_ID, MODERATOR);
      seedChannel(world.db);
      seedChannel(world.db, {
        id: CUSTOM_ID,
        kind: ChatChannelKind.CUSTOM,
        name: 'Away team',
      });
    });

    it('renames a custom channel and logs what it was', async () => {
      const channel = await world.channels.update(
        FLEET,
        CUSTOM_ID,
        {
          name: 'Officers',
          readRole: FleetScopeRole.OFFICER,
          postRole: FleetScopeRole.ADMIN,
        },
        MODERATOR_ID,
      );

      expect(channel).toMatchObject({
        id: CUSTOM_ID,
        name: 'Officers',
        readRole: FleetScopeRole.OFFICER,
        postRole: FleetScopeRole.ADMIN,
      });
      expect(world.db.rows(ChatActionEntity)[0]).toMatchObject({
        action: ChatActionKind.CHANNEL_CHANGED,
        detail: {
          before: {
            name: 'Away team',
            readRole: FleetScopeRole.MEMBER,
            postRole: FleetScopeRole.MEMBER,
          },
        },
      });
      expect(world.db.locks).toEqual([ChatChannelEntity]);
    });

    it('will not touch the standard channel', async () => {
      await expect(
        world.channels.update(
          FLEET,
          CHANNEL_ID,
          { name: 'Chatter', readRole: FleetScopeRole.MEMBER },
          MODERATOR_ID,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('archives a custom channel, which then is gone', async () => {
      await world.channels.archive(FLEET, CUSTOM_ID, MODERATOR_ID);

      expect(
        world.db.rows<Row>(ChatChannelEntity).find(row => row.id === CUSTOM_ID)
          ?.archivedAt,
      ).toBeInstanceOf(Date);
      expect(world.db.rows(ChatActionEntity)[0]).toMatchObject({
        action: ChatActionKind.CHANNEL_ARCHIVED,
      });
      await expect(
        world.channels.archive(FLEET, CUSTOM_ID, MODERATOR_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('finds no channel of another scope', async () => {
      world.stand(MODERATOR_ID, COMMUNITY_ID, MODERATOR);

      await expect(
        world.channels.archive(COMMUNITY, CUSTOM_ID, MODERATOR_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
