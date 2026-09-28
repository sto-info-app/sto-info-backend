import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { InMemoryManager, Row } from '../../../../test/in-memory-manager';
import { ArmadaFleetMembershipEntity } from '../../entities/armada-fleet-membership.entity';
import { StoArmadaEntity } from '../../entities/sto-armada.entity';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { ArmadaPosition } from '../../enums/armada-position.enum';
import { ArmadaActionEntity } from '../entities/armada-action.entity';
import { ArmadaActionKind } from '../enums/armada-action-kind.enum';
import {
  arrangementOf,
  openPlacements,
} from '../utilities/armada-arrangement.utility';
import { ArmadaArrangeService } from './armada-arrange.service';
import { ArmadaNotifierService } from './armada-notifier.service';

const COMMUNITY_ID = 'community-1';
const ARMADA_ID = 'armada-1';
const MANAGER_ID = 'manager-1';
const { ALPHA, BETA, GAMMA } = ArmadaPosition;

describe('ArmadaArrangeService', () => {
  let db: InMemoryManager;
  let notifier: { removed: jest.Mock };
  let service: ArmadaArrangeService;

  /**
   * Seeds the Armada's placements from a sketch.
   *
   * @param sketch - Each Fleet, its position and the Beta it sits under.
   */
  function seed(sketch: [string, ArmadaPosition, string?][]): void {
    db.seed(
      ArmadaFleetMembershipEntity,
      sketch.map(([fleetId, position, parent]) => ({
        id: `placement-${fleetId}`,
        communityId: COMMUNITY_ID,
        armadaId: ARMADA_ID,
        fleetId,
        position,
        parentMembershipId: parent === undefined ? null : `placement-${parent}`,
        validFrom: new Date('2026-09-01T00:00:00.000Z'),
        validTo: null,
        deletedAt: null,
      })),
    );
  }

  /**
   * Where each Fleet sits now.
   *
   * @returns The arrangement.
   */
  async function slots() {
    return arrangementOf(await openPlacements(db.asManager(), ARMADA_ID));
  }

  beforeEach(() => {
    db = new InMemoryManager();
    db.seed(StoArmadaEntity, [
      { id: ARMADA_ID, communityId: COMMUNITY_ID, deletedAt: null },
    ]);
    db.seed(
      StoFleetEntity,
      ['a', 'b1', 'b2', 'g1', 'g2'].map(id => ({
        id,
        communityId: COMMUNITY_ID,
        exactGameName: `Fleet ${id}`,
        deletedAt: null,
      })),
    );
    notifier = { removed: jest.fn(() => Promise.resolve()) };
    service = new ArmadaArrangeService(
      db.asDataSource(),
      notifier as unknown as ArmadaNotifierService,
    );
  });

  describe('moving', () => {
    it('moves a Fleet, with the reason', async () => {
      seed([['b1', BETA]]);

      await service.move(
        COMMUNITY_ID,
        ARMADA_ID,
        'b1',
        { position: ALPHA, reason: '  Our lead  ' },
        MANAGER_ID,
      );

      expect((await slots()).get('b1')?.position).toBe(ALPHA);
      expect(db.rows(ArmadaActionEntity)).toEqual([
        expect.objectContaining({
          action: ArmadaActionKind.MOVED,
          reason: 'Our lead',
          actorUserId: MANAGER_ID,
        }),
      ]);
      expect(db.locks).toEqual([StoArmadaEntity]);
    });

    it('decides a Beta’s Gammas as it stops being one', async () => {
      seed([
        ['b1', BETA],
        ['b2', BETA],
        ['g1', GAMMA, 'b1'],
        ['g2', GAMMA, 'b1'],
      ]);

      await service.move(
        COMMUNITY_ID,
        ARMADA_ID,
        'b1',
        {
          position: ALPHA,
          reason: 'Promoted',
          gammas: [
            { fleetId: 'g1', outcome: 'GAMMA', parentFleetId: 'b2' },
            { fleetId: 'g2', outcome: 'BETA' },
          ],
        },
        MANAGER_ID,
      );

      const now = await slots();

      expect(now.get('g1')).toEqual({ position: GAMMA, parentFleetId: 'b2' });
      expect(now.get('g2')?.position).toBe(BETA);
    });

    it('leaves the Gammas of a Fleet that stays a Beta where they are', async () => {
      seed([
        ['g1', GAMMA, 'b1'],
        ['b1', BETA],
        ['a', ALPHA],
      ]);

      await service.move(
        COMMUNITY_ID,
        ARMADA_ID,
        'a',
        {
          position: BETA,
          reason: 'Stepping back',
          gammas: [{ fleetId: 'g1', outcome: 'LEAVE' }],
        },
        MANAGER_ID,
      );

      expect((await slots()).get('g1')?.parentFleetId).toBe('b1');
    });

    it.each([
      [
        'no reason',
        'b1',
        { position: ALPHA, reason: ' ' },
        new BadRequestException('Say why it is being moved.'),
      ],
      [
        'a Fleet not in the Armada',
        'g2',
        { position: ALPHA, reason: 'Up' },
        new NotFoundException('That Fleet is not in this Armada.'),
      ],
      [
        'a move to where it is',
        'b1',
        { position: BETA, reason: 'Stay' },
        new BadRequestException('It is there already.'),
      ],
      [
        'a Beta’s Gammas left behind',
        'b1',
        { position: ALPHA, reason: 'Up' },
        new BadRequestException('Say where each of Fleet b1’s Gammas goes.'),
      ],
      [
        'another Fleet’s Gamma',
        'b1',
        {
          position: ALPHA,
          reason: 'Up',
          gammas: [{ fleetId: 'b1', outcome: 'LEAVE' }],
        },
        new BadRequestException(
          'Only the Gammas under the Fleet being moved can go with it.',
        ),
      ],
      [
        'a Gamma decided twice',
        'b1',
        {
          position: ALPHA,
          reason: 'Up',
          gammas: [
            { fleetId: 'g1', outcome: 'LEAVE' },
            { fleetId: 'g1', outcome: 'BETA' },
          ],
        },
        new BadRequestException('Each Gamma is decided once.'),
      ],
      [
        'a Gamma moved under no Beta',
        'b1',
        {
          position: ALPHA,
          reason: 'Up',
          gammas: [{ fleetId: 'g1', outcome: 'GAMMA' }],
        },
        new BadRequestException('Say which Beta the Gamma sits under.'),
      ],
    ])('refuses %s', async (_what, fleetId, dto, error) => {
      seed([
        ['b1', BETA],
        ['g1', GAMMA, 'b1'],
      ]);

      await expect(
        service.move(
          COMMUNITY_ID,
          ARMADA_ID,
          fleetId,
          dto as never,
          MANAGER_ID,
        ),
      ).rejects.toThrow(error);
    });
  });

  describe('removing', () => {
    it('removes a Fleet and its Gammas as chosen, telling each removed Fleet', async () => {
      seed([
        ['b1', BETA],
        ['g1', GAMMA, 'b1'],
        ['g2', GAMMA, 'b1'],
      ]);

      await service.remove(
        COMMUNITY_ID,
        ARMADA_ID,
        'b1',
        {
          reason: 'Inactive',
          gammas: [
            { fleetId: 'g1', outcome: 'LEAVE' },
            { fleetId: 'g2', outcome: 'BETA' },
          ],
        },
        MANAGER_ID,
      );

      expect([...(await slots()).keys()]).toEqual(['g2']);
      expect(notifier.removed).toHaveBeenCalledWith(
        ARMADA_ID,
        ['b1', 'g1'],
        'Inactive',
        MANAGER_ID,
      );
    });

    it('removes a Fleet with no Gammas', async () => {
      seed([['b1', BETA]]);

      await service.remove(
        COMMUNITY_ID,
        ARMADA_ID,
        'b1',
        { reason: 'Inactive' },
        MANAGER_ID,
      );

      expect((await slots()).size).toBe(0);
    });

    it('requires a reason', async () => {
      await expect(
        service.remove(
          COMMUNITY_ID,
          ARMADA_ID,
          'b1',
          { reason: '' },
          MANAGER_ID,
        ),
      ).rejects.toThrow(
        new BadRequestException('Say why it is being removed.'),
      );
    });
  });

  describe('leaving', () => {
    it('takes the Fleet out, with the reason', async () => {
      seed([
        ['g1', GAMMA, 'b1'],
        ['b1', BETA],
      ]);

      await service.leave(
        COMMUNITY_ID,
        'g1',
        { reason: 'Moving on' },
        'fleet-admin',
      );

      expect([...(await slots()).keys()]).toEqual(['b1']);
      expect(db.rows<Row>(ArmadaActionEntity)[0]).toMatchObject({
        action: ArmadaActionKind.LEFT,
        reason: 'Moving on',
        actorUserId: 'fleet-admin',
      });
    });

    it('refuses a Beta with Gammas under it', async () => {
      seed([
        ['b1', BETA],
        ['g1', GAMMA, 'b1'],
      ]);

      await expect(
        service.leave(
          COMMUNITY_ID,
          'b1',
          { reason: 'Moving on' },
          'fleet-admin',
        ),
      ).rejects.toThrow(
        new ConflictException(
          'Fleet b1 has Gammas under it. An Armada manager has to move or remove them before it can leave.',
        ),
      );
    });

    it.each([
      ['in no Armada', 'b2'],
      ['that the Community does not hold', 'missing'],
    ])('refuses a Fleet %s', async (_what, fleetId) => {
      await expect(
        service.leave(
          COMMUNITY_ID,
          fleetId,
          { reason: 'Moving on' },
          'fleet-admin',
        ),
      ).rejects.toThrow(new NotFoundException('This Fleet is in no Armada.'));
    });

    it('requires a reason', async () => {
      await expect(
        service.leave(COMMUNITY_ID, 'b1', { reason: '' }, 'fleet-admin'),
      ).rejects.toThrow(new BadRequestException('Say why it is leaving.'));
    });
  });
});
