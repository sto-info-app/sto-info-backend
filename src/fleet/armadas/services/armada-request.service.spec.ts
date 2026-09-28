import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { QueryFailedError } from 'typeorm';

import { InMemoryManager, Row } from '../../../../test/in-memory-manager';
import { ArmadaFleetMembershipEntity } from '../../entities/armada-fleet-membership.entity';
import { StoArmadaEntity } from '../../entities/sto-armada.entity';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { ArmadaPosition } from '../../enums/armada-position.enum';
import { FleetScopeStatus } from '../../enums/fleet-scope-status.enum';
import { ArmadaJoinRequestEntity } from '../entities/armada-join-request.entity';
import { ArmadaJoinRequestStatus } from '../enums/armada-join-request-status.enum';
import { ArmadaNotifierService } from './armada-notifier.service';
import {
  ArmadaRequestService,
  REQUEST_NOT_OPEN,
  slotOf,
} from './armada-request.service';

const COMMUNITY_ID = 'community-1';
const ARMADA_ID = 'armada-1';
const FLEET_ID = 'fleet-1';
const USER_ID = 'user-1';
const DAY = 24 * 60 * 60 * 1000;

describe('ArmadaRequestService', () => {
  let db: InMemoryManager;
  let notifier: { approved: jest.Mock; rejected: jest.Mock; lapsed: jest.Mock };
  let service: ArmadaRequestService;
  let fleet: Row;
  let armada: Row;

  /**
   * Seeds a request.
   *
   * @param overrides - Fields to override.
   * @returns The request.
   */
  function requestRow(overrides: Row = {}): Row {
    const row = {
      id: 'request-1',
      communityId: COMMUNITY_ID,
      armadaId: ARMADA_ID,
      fleetId: FLEET_ID,
      requestedByUserId: USER_ID,
      status: ArmadaJoinRequestStatus.PENDING,
      createdAt: new Date(Date.now() - DAY),
      expiresAt: new Date(Date.now() + DAY),
      answeredAt: null,
      answeredByUserId: null,
      reason: null,
      membershipId: null,
      ...overrides,
    };

    db.seed(ArmadaJoinRequestEntity, [row]);

    return row;
  }

  beforeEach(() => {
    db = new InMemoryManager();
    fleet = {
      id: FLEET_ID,
      communityId: COMMUNITY_ID,
      exactGameName: 'Ninth Fleet',
      platformId: 'pc',
      allegianceFactionId: 'federation',
      status: FleetScopeStatus.ACTIVE,
      deletedAt: null,
    };
    armada = {
      id: ARMADA_ID,
      communityId: COMMUNITY_ID,
      platformId: 'pc',
      allegianceFactionId: 'federation',
      status: FleetScopeStatus.ACTIVE,
      deletedAt: null,
    };
    db.seed(StoFleetEntity, [fleet]).seed(StoArmadaEntity, [armada]);
    notifier = {
      approved: jest.fn(() => Promise.resolve()),
      rejected: jest.fn(() => Promise.resolve()),
      lapsed: jest.fn(() => Promise.resolve()),
    };
    service = new ArmadaRequestService(
      db.asDataSource(),
      notifier as unknown as ArmadaNotifierService,
    );
  });

  describe('the place chosen', () => {
    it('keeps a Gamma’s Beta, and nobody else’s', () => {
      expect(
        slotOf({ position: ArmadaPosition.GAMMA, parentFleetId: 'beta-1' }),
      ).toEqual({ position: ArmadaPosition.GAMMA, parentFleetId: 'beta-1' });
      expect(slotOf({ position: ArmadaPosition.BETA })).toEqual({
        position: ArmadaPosition.BETA,
        parentFleetId: null,
      });
    });

    it.each([
      [
        'a Gamma with no Beta',
        { position: ArmadaPosition.GAMMA },
        'Say which Beta the Gamma sits under.',
      ],
      [
        'a Beta under something',
        { position: ArmadaPosition.BETA, parentFleetId: 'beta-1' },
        'Only a Gamma sits under a Beta.',
      ],
    ])('refuses %s', (_what, dto, message) => {
      expect(() => slotOf(dto)).toThrow(new BadRequestException(message));
    });
  });

  describe('asking to join', () => {
    const ask = (message?: string) =>
      service.request(
        COMMUNITY_ID,
        FLEET_ID,
        { armadaId: ARMADA_ID, message },
        USER_ID,
      );

    it('records the request for fourteen days, with its message trimmed', async () => {
      await ask('  Room for us?  ');

      const [request] = db.rows<Row>(ArmadaJoinRequestEntity);

      expect(request).toMatchObject({
        communityId: COMMUNITY_ID,
        armadaId: ARMADA_ID,
        fleetId: FLEET_ID,
        requestedByUserId: USER_ID,
        message: 'Room for us?',
      });
      expect(
        (request.expiresAt as Date).getTime() -
          (request.createdAt as Date).getTime(),
      ).toBe(14 * DAY);
      expect(db.locks).toContain(StoFleetEntity);
    });

    it('lapses an expired open request first, so a new one can be made', async () => {
      requestRow({ expiresAt: new Date(Date.now() - 1000) });

      await ask();

      expect(
        db.rows<Row>(ArmadaJoinRequestEntity).map(request => request.status),
      ).toEqual([ArmadaJoinRequestStatus.LAPSED, undefined]);
    });

    it.each([
      [
        'a Fleet the Community does not hold',
        () => {
          fleet.communityId = 'another';
        },
        new NotFoundException('Not found'),
      ],
      [
        'an Armada the Community does not hold',
        () => {
          armada.communityId = 'another';
        },
        new NotFoundException('No such Armada in this Community.'),
      ],
      [
        'a closed Fleet',
        () => {
          fleet.status = FleetScopeStatus.CLOSED;
        },
        new ConflictException('That Fleet is closed.'),
      ],
      [
        'a closed Armada',
        () => {
          armada.status = FleetScopeStatus.CLOSED;
        },
        new ConflictException('That Armada is closed.'),
      ],
      [
        'another platform',
        () => {
          armada.platformId = 'xbox';
        },
        new BadRequestException(
          'An Armada takes Fleets on its own platform only.',
        ),
      ],
      [
        'an Armada with no allegiance',
        () => {
          armada.allegianceFactionId = null;
        },
        new ConflictException(
          'That Armada has no allegiance set yet, so it takes no Fleets.',
        ),
      ],
      [
        'another allegiance',
        () => {
          fleet.allegianceFactionId = 'klingon';
        },
        new BadRequestException(
          'An Armada takes Fleets of its own allegiance only.',
        ),
      ],
      [
        'a Fleet placed already',
        () => {
          db.seed(ArmadaFleetMembershipEntity, [
            { fleetId: FLEET_ID, validTo: null, deletedAt: null },
          ]);
        },
        new ConflictException(
          'This Fleet is in an Armada already. It has to leave that one first.',
        ),
      ],
      [
        'a Fleet with a request open',
        () => {
          requestRow();
        },
        new ConflictException('This Fleet already has an open request.'),
      ],
    ])('refuses %s', async (_what, arrange, error) => {
      arrange();

      await expect(ask()).rejects.toThrow(error);
    });

    it('turns a lost race for the open slot into a conflict', async () => {
      db.insert = jest.fn(() =>
        Promise.reject(
          new QueryFailedError(
            'insert',
            [],
            new Error(
              'duplicate key value violates unique constraint "UX_armada_join_request_open"',
            ),
          ),
        ),
      );

      await expect(ask()).rejects.toThrow(
        new ConflictException('This Fleet already has an open request.'),
      );
    });

    it('lets any other failure through', async () => {
      const failure = new Error('connection lost');

      db.insert = jest.fn(() => Promise.reject(failure));

      await expect(ask()).rejects.toBe(failure);
    });
  });

  describe('withdrawing', () => {
    it('withdraws an open request, saying who', async () => {
      const request = requestRow();

      await service.withdraw(COMMUNITY_ID, FLEET_ID, 'request-1', USER_ID);

      expect(request).toMatchObject({
        status: ArmadaJoinRequestStatus.WITHDRAWN,
        answeredByUserId: USER_ID,
      });
    });

    it.each([
      ['answered', { status: ArmadaJoinRequestStatus.REJECTED }],
      ['lapsed', { expiresAt: new Date(Date.now() - 1000) }],
      ['another Fleet’s', { fleetId: 'fleet-2' }],
    ])('refuses one that is %s', async (_what, overrides) => {
      requestRow(overrides);

      await expect(
        service.withdraw(COMMUNITY_ID, FLEET_ID, 'request-1', USER_ID),
      ).rejects.toThrow(new ConflictException(REQUEST_NOT_OPEN));
    });
  });

  describe('approving', () => {
    const approve = (position = ArmadaPosition.BETA) =>
      service.approve(
        COMMUNITY_ID,
        ARMADA_ID,
        'request-1',
        { position },
        'manager-1',
      );

    it('places the Fleet where the approver chose, and tells the requester', async () => {
      const request = requestRow();

      await approve();

      const [placement] = db.rows<Row>(ArmadaFleetMembershipEntity);

      expect(placement).toMatchObject({
        fleetId: FLEET_ID,
        position: ArmadaPosition.BETA,
      });
      expect(request).toMatchObject({
        status: ArmadaJoinRequestStatus.APPROVED,
        answeredByUserId: 'manager-1',
        membershipId: placement.id,
      });
      expect(db.locks).toEqual([StoArmadaEntity]);
      expect(notifier.approved).toHaveBeenCalledWith(
        request,
        ArmadaPosition.BETA,
      );
    });

    it('refuses a request that is not open', async () => {
      requestRow({ status: ArmadaJoinRequestStatus.WITHDRAWN });

      await expect(approve()).rejects.toThrow(
        new ConflictException(REQUEST_NOT_OPEN),
      );
      expect(notifier.approved).not.toHaveBeenCalled();
    });

    it('refuses a Fleet no longer registered', async () => {
      requestRow();
      fleet.deletedAt = new Date();

      await expect(approve()).rejects.toThrow(
        new ConflictException('That Fleet is no longer registered.'),
      );
    });

    it('refuses a Fleet that can no longer join', async () => {
      requestRow();
      fleet.allegianceFactionId = 'klingon';

      await expect(approve()).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a Fleet placed meanwhile', async () => {
      requestRow();
      db.seed(ArmadaFleetMembershipEntity, [
        {
          armadaId: 'another',
          fleetId: FLEET_ID,
          validTo: null,
          deletedAt: null,
        },
      ]);

      await expect(approve()).rejects.toThrow(
        new ConflictException('That Fleet is in an Armada already.'),
      );
    });

    it('refuses a place that does not fit', async () => {
      requestRow();

      await expect(approve(ArmadaPosition.GAMMA)).rejects.toThrow(
        'Say which Beta the Gamma sits under.',
      );
    });
  });

  describe('rejecting', () => {
    it('rejects with the reason, and tells the requester', async () => {
      const request = requestRow();

      await service.reject(
        COMMUNITY_ID,
        ARMADA_ID,
        'request-1',
        '  Full for now  ',
        'manager-1',
      );

      expect(request).toMatchObject({
        status: ArmadaJoinRequestStatus.REJECTED,
        reason: 'Full for now',
        answeredByUserId: 'manager-1',
      });
      expect(notifier.rejected).toHaveBeenCalledWith(request);
    });

    it('requires a reason', async () => {
      requestRow();

      await expect(
        service.reject(COMMUNITY_ID, ARMADA_ID, 'request-1', ' ', 'manager-1'),
      ).rejects.toThrow(
        new BadRequestException('Say why, for the requesting Fleet.'),
      );
    });
  });

  describe('lapsing', () => {
    it('lapses what has run out, telling each requester, and leaves the rest', async () => {
      const expired = requestRow({ expiresAt: new Date(Date.now() - 1000) });
      const open = requestRow({ id: 'request-2', fleetId: 'fleet-2' });

      await expect(service.lapseExpired()).resolves.toBe(1);

      expect(expired.status).toBe(ArmadaJoinRequestStatus.LAPSED);
      expect(open.status).toBe(ArmadaJoinRequestStatus.PENDING);
      expect(notifier.lapsed).toHaveBeenCalledWith(expired);
    });

    it('leaves alone a request answered meanwhile', async () => {
      requestRow({ expiresAt: new Date(Date.now() - 1000) });
      db.update = jest.fn(() => Promise.resolve({ affected: 0 }));

      await expect(service.lapseExpired()).resolves.toBe(0);
      expect(notifier.lapsed).not.toHaveBeenCalled();
    });
  });
});
