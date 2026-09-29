import { BadRequestException, NotFoundException } from '@nestjs/common';

import { GeneralFactionEntity } from 'src/sto/character/entities/general-faction.entity';

import { InMemoryManager, Row } from '../../../../test/in-memory-manager';
import { ActivityEventEntity } from '../../activity/entities/activity-event.entity';
import { ActivityType } from '../../activity/enums/activity.enums';
import { ArmadaFleetMembershipEntity } from '../../entities/armada-fleet-membership.entity';
import { ScopeCapabilityGrantEntity } from '../../entities/scope-capability-grant.entity';
import { ScopeMembershipEntity } from '../../entities/scope-membership.entity';
import { ScopeRoleAssignmentEntity } from '../../entities/scope-role-assignment.entity';
import { StoArmadaEntity } from '../../entities/sto-armada.entity';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { ArmadaPosition } from '../../enums/armada-position.enum';
import { FleetScopeRole } from '../../enums/fleet-scope-role.enum';
import { ScopeMembershipStatus } from '../../enums/scope-membership-status.enum';
import { ScopeGovernanceActionEntity } from '../../governance/entities/scope-governance-action.entity';
import { ScopeGovernanceActionKind } from '../../governance/enums/scope-governance-action-kind.enum';
import { ArmadaActionEntity } from '../entities/armada-action.entity';
import { ArmadaJoinRequestEntity } from '../entities/armada-join-request.entity';
import { ArmadaActionKind } from '../enums/armada-action-kind.enum';
import { ArmadaJoinRequestStatus } from '../enums/armada-join-request-status.enum';
import {
  applyArmadaChange,
  ARMADA_ROLE_ENDED_REASON,
  ArmadaChange,
  armadaMemberIds,
  arrangementOf,
  assertArmadaAllegiance,
  assertArrangement,
  cancelOpenRequests,
  endArmadaForClosure,
  endFleetForClosure,
  endIneligibleArmadaRoles,
  lockArmada,
  openPlacementOf,
  openPlacements,
} from './armada-arrangement.utility';

const COMMUNITY_ID = 'community-1';
const ARMADA_ID = 'armada-1';
const NOW = new Date('2026-09-28T12:00:00.000Z');
const EARLIER = new Date('2026-09-01T12:00:00.000Z');

const { ALPHA, BETA, GAMMA } = ArmadaPosition;

/**
 * Builds the Armada's open placements from a sketch.
 *
 * @param sketch - Each Fleet, its position and the Beta it sits under.
 * @returns The placements.
 */
function placed(
  sketch: [string, ArmadaPosition, string?][],
): ArmadaFleetMembershipEntity[] {
  return sketch.map(([fleetId, position, parent]) => ({
    id: `placement-${fleetId}`,
    communityId: COMMUNITY_ID,
    armadaId: ARMADA_ID,
    fleetId,
    position,
    parentMembershipId: parent === undefined ? null : `placement-${parent}`,
    validFrom: EARLIER,
    validTo: null,
    deletedAt: null,
  })) as unknown as ArmadaFleetMembershipEntity[];
}

/**
 * Names a Fleet as the explanations do.
 *
 * @param fleetId - The Fleet.
 * @returns Its name.
 */
const nameOf = (fleetId: string): string => `Fleet ${fleetId}`;

describe('armada arrangement', () => {
  let db: InMemoryManager;
  const armada = {
    id: ARMADA_ID,
    communityId: COMMUNITY_ID,
  } as StoArmadaEntity;

  /**
   * Seeds the Fleets named, and the Armada's placements.
   *
   * @param sketch - Each Fleet, its position and the Beta it sits under.
   */
  function seed(sketch: [string, ArmadaPosition, string?][]): void {
    db.seed(ArmadaFleetMembershipEntity, placed(sketch) as unknown as Row[]);
  }

  /**
   * Makes one change, as a manager would.
   *
   * @param changes - What happens to each Fleet.
   * @param reason - Why.
   * @returns The placements it started.
   */
  async function change(
    changes: [string, ArmadaChange][],
    reason: string | null = 'Reorganising',
  ) {
    return applyArmadaChange(
      db.asManager(),
      armada,
      await openPlacements(db.asManager(), ARMADA_ID),
      new Map(changes),
      { actorUserId: 'manager-1', reason, requestId: 'request-1', now: NOW },
    );
  }

  /**
   * Where each Fleet sits now.
   *
   * @returns The arrangement.
   */
  async function now() {
    return arrangementOf(await openPlacements(db.asManager(), ARMADA_ID));
  }

  beforeEach(() => {
    db = new InMemoryManager();
    db.seed(
      StoFleetEntity,
      ['a', 'b1', 'b2', 'b3', 'g1', 'g2', 'g3', 'g4'].map(id => ({
        id,
        exactGameName: `Fleet ${id}`,
      })),
    );
  });

  describe('reading', () => {
    it('locks the Armada the Community holds', async () => {
      db.seed(StoArmadaEntity, [
        { id: ARMADA_ID, communityId: COMMUNITY_ID, deletedAt: null },
      ]);

      await expect(
        lockArmada(db.asManager(), COMMUNITY_ID, ARMADA_ID),
      ).resolves.toMatchObject({ id: ARMADA_ID });
      expect(db.locks).toEqual([StoArmadaEntity]);
      await expect(
        lockArmada(db.asManager(), 'another-community', ARMADA_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('reads a Gamma’s Beta by Fleet, and an orphan’s as none', () => {
      const slots = arrangementOf([
        ...placed([
          ['b1', BETA],
          ['g1', GAMMA, 'b1'],
        ]),
        ...placed([['g2', GAMMA, 'gone']]),
      ]);

      expect(slots.get('g1')).toEqual({ position: GAMMA, parentFleetId: 'b1' });
      expect(slots.get('b1')).toEqual({ position: BETA, parentFleetId: null });
      expect(slots.get('g2')?.parentFleetId).toBeNull();
    });

    it('finds a Fleet’s open placement, or none', async () => {
      seed([['b1', BETA]]);

      await expect(
        openPlacementOf(db.asManager(), 'b1'),
      ).resolves.toMatchObject({ fleetId: 'b1' });
      await expect(openPlacementOf(db.asManager(), 'g1')).resolves.toBeNull();
    });
  });

  describe('the structure', () => {
    const slots = (
      sketch: [string, ArmadaPosition, string?][],
    ): Map<
      string,
      { position: ArmadaPosition; parentFleetId: string | null }
    > => arrangementOf(placed(sketch));

    it('accepts one Alpha, three Betas and three Gammas under each', () => {
      expect(() =>
        assertArrangement(
          slots([
            ['a', ALPHA],
            ['b1', BETA],
            ['b2', BETA],
            ['b3', BETA],
            ['g1', GAMMA, 'b1'],
            ['g2', GAMMA, 'b1'],
            ['g3', GAMMA, 'b1'],
          ]),
          new Map(),
          nameOf,
        ),
      ).not.toThrow();
    });

    it.each([
      [
        'a second Alpha',
        [
          ['a', ALPHA],
          ['b1', ALPHA],
        ],
        'An Armada has one Alpha.',
      ],
      [
        'a fourth Beta',
        [
          ['b1', BETA],
          ['b2', BETA],
          ['b3', BETA],
          ['g1', BETA],
        ],
        'An Armada has at most 3 Betas.',
      ],
      [
        'a fourth Gamma',
        [
          ['b1', BETA],
          ['g1', GAMMA, 'b1'],
          ['g2', GAMMA, 'b1'],
          ['g3', GAMMA, 'b1'],
          ['g4', GAMMA, 'b1'],
        ],
        'Fleet b1 can have at most 3 Gammas.',
      ],
      [
        'a Gamma under the Alpha',
        [
          ['a', ALPHA],
          ['g1', GAMMA, 'a'],
        ],
        'A Gamma has to sit under one of this Armada’s Betas.',
      ],
    ] as [string, [string, ArmadaPosition, string?][], string][])(
      'refuses %s',
      (_what, sketch, message) => {
        expect(() =>
          assertArrangement(slots(sketch), new Map(), nameOf),
        ).toThrow(new BadRequestException(message));
      },
    );

    it('names the Beta whose Gammas were left behind', () => {
      const before = slots([
        ['b1', BETA],
        ['g1', GAMMA, 'b1'],
      ]);
      const after = new Map(before);

      after.delete('b1');

      expect(() => assertArrangement(after, before, nameOf)).toThrow(
        new BadRequestException('Say where each of Fleet b1’s Gammas goes.'),
      );
    });

    it('allows the Alpha slot to stand empty', () => {
      expect(() =>
        assertArrangement(slots([['b1', BETA]]), new Map(), nameOf),
      ).not.toThrow();
    });
  });

  describe('a change', () => {
    it('places Fleets, Betas before their Gammas, recording each', async () => {
      const started = await change(
        [
          [
            'g1',
            {
              slot: { position: GAMMA, parentFleetId: 'b1' },
              action: ArmadaActionKind.PLACED,
            },
          ],
          [
            'b1',
            {
              slot: { position: BETA, parentFleetId: null },
              action: ArmadaActionKind.PLACED,
            },
          ],
        ],
        null,
      );

      expect(started.get('g1')).toMatchObject({
        parentMembershipId: started.get('b1')?.id,
        validFrom: NOW,
        recordedByUserId: 'manager-1',
      });
      expect(db.rows(ArmadaActionEntity)).toEqual([
        expect.objectContaining({
          fleetId: 'g1',
          action: ArmadaActionKind.PLACED,
          fromPosition: null,
          toPosition: GAMMA,
          toParentFleetId: 'b1',
          requestId: 'request-1',
        }),
        expect.objectContaining({
          fleetId: 'b1',
          toPosition: BETA,
          toParentFleetId: null,
          requestId: 'request-1',
        }),
      ]);
      expect(db.increments).toEqual([
        { entity: StoArmadaEntity, where: { id: ARMADA_ID } },
      ]);
    });

    it('ends a moved Fleet’s placement and starts another, sharing the change', async () => {
      seed([
        ['b1', BETA],
        ['b2', BETA],
        ['g1', GAMMA, 'b1'],
      ]);

      await change([
        [
          'g1',
          {
            slot: { position: GAMMA, parentFleetId: 'b2' },
            action: ArmadaActionKind.MOVED,
          },
        ],
        ['b1', { slot: null, action: ArmadaActionKind.REMOVED }],
      ]);

      const slots = await now();
      const actions = db.rows<Row>(ArmadaActionEntity);

      expect(slots.get('g1')).toEqual({ position: GAMMA, parentFleetId: 'b2' });
      expect(slots.has('b1')).toBe(false);
      expect(
        db
          .rows<Row>(ArmadaFleetMembershipEntity)
          .find(row => row.id === 'placement-g1')?.validTo,
      ).toEqual(NOW);
      expect(new Set(actions.map(action => action.changeId)).size).toBe(1);
      expect(actions).toEqual([
        expect.objectContaining({
          fleetId: 'g1',
          fromPosition: GAMMA,
          fromParentFleetId: 'b1',
          reason: 'Reorganising',
          requestId: null,
        }),
        expect.objectContaining({
          fleetId: 'b1',
          action: ArmadaActionKind.REMOVED,
          toPosition: null,
        }),
      ]);

      // Each Fleet's change goes on the Armada's feed and on its own.
      const changeId = actions[0].changeId as string;
      const item = (
        type: ActivityType,
        fleetId: string,
        from: ArmadaPosition,
        to: ArmadaPosition | null,
      ) => ({
        communityId: COMMUNITY_ID,
        type,
        actorUserId: 'manager-1',
        sourceId: ARMADA_ID,
        detail: { fleetId, armadaId: ARMADA_ID, from, to },
        occurredAt: NOW,
      });

      expect(db.rows(ActivityEventEntity)).toEqual([
        expect.objectContaining({
          ...item(ActivityType.ARMADA_FLEET_MOVED, 'g1', GAMMA, GAMMA),
          armadaId: ARMADA_ID,
          fleetId: null,
          idempotencyKey: `ARMADA_FLEET_MOVED:${changeId}:g1:ARMADA`,
        }),
        expect.objectContaining({
          ...item(ActivityType.ARMADA_FLEET_MOVED, 'g1', GAMMA, GAMMA),
          armadaId: null,
          fleetId: 'g1',
          idempotencyKey: `ARMADA_FLEET_MOVED:${changeId}:g1:FLEET`,
        }),
        expect.objectContaining({
          ...item(ActivityType.ARMADA_FLEET_LEFT, 'b1', BETA, null),
          armadaId: ARMADA_ID,
        }),
        expect.objectContaining({
          ...item(ActivityType.ARMADA_FLEET_LEFT, 'b1', BETA, null),
          fleetId: 'b1',
        }),
      ]);
    });

    it('cites no request for a placement made without one', async () => {
      await applyArmadaChange(
        db.asManager(),
        armada,
        [],
        new Map([
          [
            'b1',
            {
              slot: { position: BETA, parentFleetId: null },
              action: ArmadaActionKind.PLACED,
            },
          ],
        ]),
        { actorUserId: null, reason: null, now: NOW },
      );

      expect(db.rows<Row>(ArmadaActionEntity)[0].requestId).toBeNull();
    });

    it('reads no names for a change touching nothing', async () => {
      await applyArmadaChange(db.asManager(), armada, [], new Map(), {
        actorUserId: null,
        reason: null,
        now: NOW,
      });

      expect(db.rows(ArmadaActionEntity)).toEqual([]);
    });

    it('writes nothing when the result does not fit', async () => {
      seed([['a', ALPHA]]);

      await expect(
        change([
          [
            'b1',
            {
              slot: { position: ALPHA, parentFleetId: null },
              action: ArmadaActionKind.PLACED,
            },
          ],
        ]),
      ).rejects.toThrow('An Armada has one Alpha.');
      expect(db.rows(ArmadaActionEntity)).toEqual([]);
    });

    it('names a Fleet it cannot find as “That Fleet”', async () => {
      seed([
        ['missing', BETA],
        ['g1', GAMMA, 'missing'],
      ]);

      await expect(
        change([['missing', { slot: null, action: ArmadaActionKind.REMOVED }]]),
      ).rejects.toThrow('Say where each of That Fleet’s Gammas goes.');
    });
  });

  describe('Armada roles', () => {
    /**
     * Seeds a role at the Armada.
     *
     * @param userId - Who holds it.
     */
    function roleFor(userId: string): void {
      db.seed(ScopeRoleAssignmentEntity, [
        {
          id: `role-${userId}`,
          communityId: COMMUNITY_ID,
          armadaId: ARMADA_ID,
          userId,
          role: FleetScopeRole.ADMIN,
          validTo: null,
          deletedAt: null,
        },
      ]);
      db.seed(ScopeCapabilityGrantEntity, [
        {
          id: `grant-${userId}`,
          communityId: COMMUNITY_ID,
          armadaId: ARMADA_ID,
          subjectUserId: userId,
          subjectRole: null,
          capability: 'news.write',
          effect: 'GRANT',
          validTo: null,
          deletedAt: null,
        },
      ]);
    }

    beforeEach(() => {
      seed([['b1', BETA]]);
      db.seed(ScopeMembershipEntity, [
        {
          fleetId: 'b1',
          userId: 'member-1',
          status: ScopeMembershipStatus.APPROVED,
          deletedAt: null,
        },
        {
          fleetId: 'b1',
          userId: 'suspended-1',
          status: ScopeMembershipStatus.SUSPENDED,
          deletedAt: null,
        },
      ]);
      roleFor('member-1');
      roleFor('outsider-1');
    });

    it('counts the approved members of placed Fleets as members', async () => {
      await expect(armadaMemberIds(db.asManager(), ARMADA_ID)).resolves.toEqual(
        ['member-1'],
      );
      await expect(
        armadaMemberIds(db.asManager(), 'empty-armada'),
      ).resolves.toEqual([]);
    });

    it('ends the roles and grants of anybody no longer a member, logging why', async () => {
      await endIneligibleArmadaRoles(db.asManager(), armada, 'manager-1', NOW);

      const roles = db.rows<Row>(ScopeRoleAssignmentEntity);
      const grants = db.rows<Row>(ScopeCapabilityGrantEntity);

      expect(roles.map(role => role.validTo)).toEqual([null, NOW]);
      expect(grants.map(grant => grant.validTo)).toEqual([null, NOW]);
      expect(db.rows(ScopeGovernanceActionEntity)).toEqual([
        expect.objectContaining({
          armadaId: ARMADA_ID,
          action: ScopeGovernanceActionKind.ROLE_WITHDRAWN,
          actorUserId: 'manager-1',
          subjectUserId: 'outsider-1',
          role: FleetScopeRole.ADMIN,
          reason: ARMADA_ROLE_ENDED_REASON,
        }),
        // FC-039: each grant that goes is logged too, by the system.
        expect.objectContaining({
          armadaId: ARMADA_ID,
          action: ScopeGovernanceActionKind.CAPABILITY_CLEARED,
          actorUserId: null,
          subjectUserId: 'outsider-1',
          capability: 'news.write',
          reason: ARMADA_ROLE_ENDED_REASON,
          idempotencyKey: 'ENDED:grant-outsider-1',
        }),
      ]);
    });

    it('ends every role once no Fleet is left', async () => {
      await change([['b1', { slot: null, action: ArmadaActionKind.REMOVED }]]);

      expect(
        db.rows<Row>(ScopeRoleAssignmentEntity).map(role => role.validTo),
      ).toEqual([NOW, NOW]);
      expect(
        db.rows<Row>(ScopeCapabilityGrantEntity).map(grant => grant.validTo),
      ).toEqual([NOW, NOW]);
    });
  });

  describe('allegiance', () => {
    beforeEach(() => {
      db.seed(GeneralFactionEntity, [
        { id: 'federation', name: 'Federation' },
        { id: 'klingon', name: 'Klingon' },
        { id: 'undecided', name: 'Undecided' },
      ]);
    });

    it.each(['federation', 'klingon'])('accepts %s', async factionId => {
      await expect(
        assertArmadaAllegiance(db.asManager(), factionId),
      ).resolves.toBeUndefined();
    });

    it.each(['undecided', 'nothing'])('refuses %s', async factionId => {
      await expect(
        assertArmadaAllegiance(db.asManager(), factionId),
      ).rejects.toThrow(
        new BadRequestException('An Armada is Federation or Klingon.'),
      );
    });
  });

  describe('closures', () => {
    beforeEach(() => {
      db.seed(StoArmadaEntity, [
        { id: ARMADA_ID, communityId: COMMUNITY_ID, deletedAt: null },
      ]);
      db.seed(ArmadaJoinRequestEntity, [
        {
          armadaId: ARMADA_ID,
          fleetId: 'g4',
          status: ArmadaJoinRequestStatus.PENDING,
        },
        {
          armadaId: 'another-armada',
          fleetId: 'b3',
          status: ArmadaJoinRequestStatus.PENDING,
        },
      ]);
    });

    it('cancels open requests to an Armada, or from a Fleet', async () => {
      await cancelOpenRequests(db.asManager(), { armadaId: ARMADA_ID }, NOW);
      await cancelOpenRequests(db.asManager(), { fleetId: 'b3' }, NOW);

      expect(
        db.rows<Row>(ArmadaJoinRequestEntity).map(request => request.status),
      ).toEqual([
        ArmadaJoinRequestStatus.CANCELLED,
        ArmadaJoinRequestStatus.CANCELLED,
      ]);
    });

    it('ends every placement when the Armada closes', async () => {
      seed([
        ['a', ALPHA],
        ['b1', BETA],
        ['g1', GAMMA, 'b1'],
      ]);

      await endArmadaForClosure(db.asManager(), armada, 'owner-1', NOW);

      expect((await now()).size).toBe(0);
      expect(
        db.rows<Row>(ArmadaActionEntity).map(action => action.action),
      ).toEqual([
        ArmadaActionKind.CLOSED,
        ArmadaActionKind.CLOSED,
        ArmadaActionKind.CLOSED,
      ]);
      // The closure is its own item; the Fleets it lets go add none.
      expect(db.rows(ActivityEventEntity)).toEqual([]);
    });

    it('changes nothing but requests when an empty Armada closes', async () => {
      await endArmadaForClosure(db.asManager(), armada, 'owner-1', NOW);

      expect(db.rows(ArmadaActionEntity)).toEqual([]);
      expect(db.rows<Row>(ArmadaJoinRequestEntity)[0].status).toBe(
        ArmadaJoinRequestStatus.CANCELLED,
      );
    });

    it('does nothing more for a closing Fleet in no Armada', async () => {
      await endFleetForClosure(
        db.asManager(),
        { id: 'b3', exactGameName: 'Fleet b3' },
        'owner-1',
        NOW,
      );

      expect(db.rows(ArmadaActionEntity)).toEqual([]);
      expect(db.locks).toEqual([]);
    });

    it('takes a closing Gamma out alone', async () => {
      seed([
        ['b1', BETA],
        ['g1', GAMMA, 'b1'],
        ['g2', GAMMA, 'b1'],
      ]);

      await endFleetForClosure(
        db.asManager(),
        { id: 'g1', exactGameName: 'Fleet g1' },
        'owner-1',
        NOW,
      );

      expect([...(await now()).keys()]).toEqual(['b1', 'g2']);
      expect(db.rows(ArmadaActionEntity)).toEqual([
        expect.objectContaining({
          fleetId: 'g1',
          action: ArmadaActionKind.CLOSED,
          reason: 'Fleet g1 closed.',
        }),
      ]);
    });

    it('makes a closing Beta’s Gammas Betas where there is room, and takes the rest out', async () => {
      seed([
        ['b1', BETA],
        ['b2', BETA],
        ['b3', BETA],
        ['g1', GAMMA, 'b1'],
        ['g2', GAMMA, 'b1'],
        ['g3', GAMMA, 'b2'],
      ]);

      await endFleetForClosure(
        db.asManager(),
        { id: 'b1', exactGameName: 'Fleet b1' },
        'owner-1',
        NOW,
      );

      const slots = await now();

      expect(slots.get('g1')?.position).toBe(BETA);
      expect(slots.has('g2')).toBe(false);
      expect(slots.get('g3')?.parentFleetId).toBe('b2');
      expect(
        db
          .rows<Row>(ArmadaActionEntity)
          .map(action => [action.fleetId, action.action]),
      ).toEqual([
        ['b1', ArmadaActionKind.CLOSED],
        ['g1', ArmadaActionKind.MOVED],
        ['g2', ArmadaActionKind.REMOVED],
      ]);
    });
  });
});
