import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { DataSource, EntityManager, IsNull, QueryFailedError } from 'typeorm';

import { NotificationSeverity } from 'src/notification/enums/notification-severity.enum';
import { NotificationTarget } from 'src/notification/enums/notification-target.enum';
import { NotificationService } from 'src/notification/notification.service';
import { UserProfileEntity } from 'src/user/entities/user-profile.entity';

import { FleetAuthorisationRevisionService } from '../../authorisation/fleet-authorisation-revision.service';
import { FleetCommunityEntity } from '../../entities/fleet-community.entity';
import { ScopeCapabilityGrantEntity } from '../../entities/scope-capability-grant.entity';
import { ScopeRoleAssignmentEntity } from '../../entities/scope-role-assignment.entity';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { FleetScopeRole } from '../../enums/fleet-scope-role.enum';
import { FleetScopeStatus } from '../../enums/fleet-scope-status.enum';
import { OwnershipTransferEntity } from '../entities/ownership-transfer.entity';
import { ScopeGovernanceActionEntity } from '../entities/scope-governance-action.entity';
import {
  OwnershipTransferState,
  OwnershipTransferStatus,
} from '../enums/ownership-transfer-status.enum';
import { ScopeGovernanceActionKind } from '../enums/scope-governance-action-kind.enum';
import { communityScope } from '../utilities/governance-scope.utility';
import {
  ENDED_BY_OWNERSHIP,
  FORMER_OWNER_REASON,
  OWNERSHIP_OFFER_DAYS,
  OwnershipTransferService,
  stateOf,
} from './ownership-transfer.service';
import { ScopeGovernanceLogService } from './scope-governance-log.service';

const COMMUNITY_ID = '23000000-0000-4000-8000-000000000001';
const OWNER_ID = '23000000-0000-4000-8000-000000000002';
const ADMIN_ID = '23000000-0000-4000-8000-000000000003';
const OTHER_ID = '23000000-0000-4000-8000-000000000004';
const SITE_ADMIN_ID = '23000000-0000-4000-8000-000000000005';
const TRANSFER_ID = '23000000-0000-4000-8000-000000000006';

const DAY = 24 * 60 * 60 * 1000;

describe('OwnershipTransferService', () => {
  let community: Partial<FleetCommunityEntity> | null;
  let open: OwnershipTransferEntity | null;
  let isAdmin: boolean;
  let admins: Partial<ScopeRoleAssignmentEntity>[];
  let manager: {
    findOne: jest.Mock;
    find: jest.Mock;
    exists: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    count: jest.Mock;
    insert: jest.Mock;
  };
  let bump: jest.Mock;
  let record: jest.Mock;
  let createNotification: jest.Mock;
  let service: OwnershipTransferService;
  let savedFrontendUrl: string | undefined;

  /**
   * Builds an offer.
   *
   * @param overrides - Fields to change.
   * @returns The offer.
   */
  const offer = (
    overrides: Partial<OwnershipTransferEntity> = {},
  ): OwnershipTransferEntity =>
    Object.assign(new OwnershipTransferEntity(), {
      id: TRANSFER_ID,
      communityId: COMMUNITY_ID,
      fromUserId: OWNER_ID,
      toUserId: ADMIN_ID,
      status: OwnershipTransferStatus.PENDING,
      offeredAt: new Date(Date.now() - DAY),
      expiresAt: new Date(Date.now() + 6 * DAY),
      answeredAt: null,
      ...overrides,
    });

  beforeEach(() => {
    savedFrontendUrl = process.env.APP_FRONTEND_URL;
    process.env.APP_FRONTEND_URL = 'https://sto.example';
    community = {
      id: COMMUNITY_ID,
      name: 'Fixture Community',
      slug: 'fixture-community',
      ownerUserId: OWNER_ID,
      status: FleetScopeStatus.ACTIVE,
    };
    open = null;
    isAdmin = true;
    admins = [{ userId: ADMIN_ID }];
    manager = {
      findOne: jest.fn((entity: unknown) =>
        Promise.resolve(entity === FleetCommunityEntity ? community : open),
      ),
      find: jest.fn((entity: unknown) =>
        Promise.resolve(
          entity === UserProfileEntity
            ? [
                { userId: OWNER_ID, username: 'MidNiteShadow' },
                { userId: ADMIN_ID, username: 'Deputy' },
              ]
            : admins,
        ),
      ),
      exists: jest.fn(() => Promise.resolve(isAdmin)),
      save: jest.fn((_entity: unknown, row: object) =>
        Promise.resolve(
          row instanceof OwnershipTransferEntity && !row.id
            ? Object.assign(row, { id: TRANSFER_ID })
            : row,
        ),
      ),
      create: jest.fn((entity: unknown, data: object) =>
        entity === OwnershipTransferEntity
          ? Object.assign(new OwnershipTransferEntity(), data)
          : { ...data },
      ),
      update: jest.fn(() => Promise.resolve({})),
      count: jest.fn(() => Promise.resolve(0)),
      insert: jest.fn(() => Promise.resolve()),
    };
    bump = jest.fn(() => Promise.resolve(2));
    record = jest.fn(() => Promise.resolve());
    createNotification = jest.fn(() => Promise.resolve({}));
    service = new OwnershipTransferService(
      {
        manager,
        transaction: jest.fn((work: (m: typeof manager) => Promise<unknown>) =>
          work(manager),
        ),
      } as unknown as DataSource,
      { bump } as unknown as FleetAuthorisationRevisionService,
      { record } as unknown as ScopeGovernanceLogService,
      { createNotification } as unknown as NotificationService,
    );
  });

  afterEach(() => {
    process.env.APP_FRONTEND_URL = savedFrontendUrl;
  });

  /** Every change of the given kind the log was given. */
  const logged = (action: ScopeGovernanceActionKind): object[] =>
    record.mock.calls
      .map(([, entry]) => entry as { action: ScopeGovernanceActionKind })
      .filter(entry => entry.action === action);

  describe('where ownership stands', () => {
    it('shows the Owner the open offer and whom they may offer it to', async () => {
      open = offer();

      const standing = await service.standing(COMMUNITY_ID, OWNER_ID);

      expect(standing.offer).toEqual(
        expect.objectContaining({
          id: TRANSFER_ID,
          from: { userId: OWNER_ID, username: 'MidNiteShadow' },
          to: { userId: ADMIN_ID, username: 'Deputy' },
          state: OwnershipTransferState.PENDING,
        }),
      );
      expect(standing.eligible).toEqual([
        { userId: ADMIN_ID, username: 'Deputy' },
      ]);
    });

    it('shows the Admin offered it the offer, and nobody to offer it to', async () => {
      open = offer();

      const standing = await service.standing(COMMUNITY_ID, ADMIN_ID);

      expect(standing.offer?.id).toBe(TRANSFER_ID);
      expect(standing.eligible).toEqual([]);
    });

    it('shows anybody else nothing', async () => {
      open = offer();

      await expect(service.standing(COMMUNITY_ID, OTHER_ID)).resolves.toEqual({
        offer: null,
        eligible: [],
      });
    });

    it('shows nobody an offer that has expired', async () => {
      open = offer({ expiresAt: new Date(Date.now() - 1) });

      const standing = await service.standing(COMMUNITY_ID, OWNER_ID);

      expect(standing.offer).toBeNull();
    });

    it('refuses a Community that does not exist', async () => {
      community = null;

      await expect(
        service.standing(COMMUNITY_ID, OWNER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('offering it', () => {
    const makeOffer = () => service.offer(COMMUNITY_ID, ADMIN_ID, OWNER_ID);

    it('refuses anybody but the Owner', async () => {
      await expect(
        service.offer(COMMUNITY_ID, ADMIN_ID, OTHER_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses a Community that is not open', async () => {
      community = { ...community, status: FleetScopeStatus.CLOSED };

      await expect(makeOffer()).rejects.toBeInstanceOf(ConflictException);
    });

    it('offers it only to one of the Community’s Admins', async () => {
      isAdmin = false;

      await expect(makeOffer()).rejects.toBeInstanceOf(BadRequestException);
      expect(manager.exists).toHaveBeenCalledWith(ScopeRoleAssignmentEntity, {
        where: {
          communityId: COMMUNITY_ID,
          fleetId: IsNull(),
          armadaId: IsNull(),
          userId: ADMIN_ID,
          role: FleetScopeRole.ADMIN,
          validTo: IsNull(),
        },
      });
    });

    it('refuses a second offer while one is open', async () => {
      open = offer();

      await expect(makeOffer()).rejects.toThrow(
        new ConflictException(
          'An offer is already open. Cancel it before making another.',
        ),
      );
    });

    // The one-open-offer index would refuse the new row otherwise.
    it('lapses an expired offer before making a new one', async () => {
      const expired = offer({ expiresAt: new Date(Date.now() - 1) });
      open = expired;

      await makeOffer();

      expect(expired.status).toBe(OwnershipTransferStatus.LAPSED);
      expect(expired.answeredAt).toBeInstanceOf(Date);
    });

    it('makes a seven-day offer, logs it and tells the Admin', async () => {
      const made = await makeOffer();

      expect(made.state).toBe(OwnershipTransferState.PENDING);
      expect(made.expiresAt.getTime() - made.offeredAt.getTime()).toBe(
        OWNERSHIP_OFFER_DAYS * DAY,
      );
      expect(logged(ScopeGovernanceActionKind.OWNERSHIP_OFFERED)).toEqual([
        {
          scope: communityScope(COMMUNITY_ID),
          action: ScopeGovernanceActionKind.OWNERSHIP_OFFERED,
          actorUserId: OWNER_ID,
          subjectUserId: ADMIN_ID,
          transferId: TRANSFER_ID,
        },
      ]);
      expect(createNotification).toHaveBeenCalledWith({
        target: NotificationTarget.USER,
        userId: ADMIN_ID,
        severity: NotificationSeverity.INFO,
        title: 'Ownership of Fixture Community offered to you',
        body:
          'MidNiteShadow has offered you ownership of Fixture Community. ' +
          'Accept or decline it on the Community’s page within 7 days.',
        linkUrl: 'https://sto.example/fleets/communities/fixture-community',
      });
    });

    it('sends no link when the site’s address is not configured', async () => {
      delete process.env.APP_FRONTEND_URL;

      await makeOffer();

      expect(createNotification.mock.calls[0][0]).not.toHaveProperty('linkUrl');
    });

    it('calls the Owner its Owner when they have no username', async () => {
      manager.find.mockImplementation((entity: unknown) =>
        Promise.resolve(entity === UserProfileEntity ? [] : admins),
      );

      await makeOffer();

      expect(createNotification.mock.calls[0][0].body).toMatch(
        /^Its Owner has offered you/,
      );
    });

    // The offer stands on the Community's page whether or not it is sent.
    it('keeps the offer when the notification cannot be sent', async () => {
      createNotification.mockRejectedValue(new Error('down'));

      await expect(makeOffer()).resolves.toEqual(
        expect.objectContaining({ id: TRANSFER_ID }),
      );
    });
  });

  describe('cancelling it', () => {
    it('lets the Owner take an open offer back', async () => {
      open = offer();

      await service.cancel(COMMUNITY_ID, TRANSFER_ID, OWNER_ID);

      expect(open.status).toBe(OwnershipTransferStatus.CANCELLED);
      expect(logged(ScopeGovernanceActionKind.OWNERSHIP_CANCELLED)).toEqual([
        {
          scope: communityScope(COMMUNITY_ID),
          action: ScopeGovernanceActionKind.OWNERSHIP_CANCELLED,
          actorUserId: OWNER_ID,
          asSiteAdmin: undefined,
          subjectUserId: ADMIN_ID,
          transferId: TRANSFER_ID,
        },
      ]);
    });

    it('refuses anybody but the Owner', async () => {
      open = offer();

      await expect(
        service.cancel(COMMUNITY_ID, TRANSFER_ID, ADMIN_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses an offer that does not exist', async () => {
      await expect(
        service.cancel(COMMUNITY_ID, TRANSFER_ID, OWNER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses an offer that has expired', async () => {
      open = offer({ expiresAt: new Date(Date.now() - 1) });

      await expect(
        service.cancel(COMMUNITY_ID, TRANSFER_ID, OWNER_ID),
      ).rejects.toThrow(new ConflictException('This offer has expired.'));
    });

    it('refuses an offer that has been answered', async () => {
      open = offer({
        status: OwnershipTransferStatus.DECLINED,
        answeredAt: new Date(),
      });

      await expect(
        service.cancel(COMMUNITY_ID, TRANSFER_ID, OWNER_ID),
      ).rejects.toThrow(
        new ConflictException('This offer has already been declined.'),
      );
    });

    it('refuses a Community that does not exist', async () => {
      community = null;

      await expect(
        service.cancel(COMMUNITY_ID, TRANSFER_ID, OWNER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('declining it', () => {
    it('lets the Admin offered it say no', async () => {
      open = offer();

      await service.decline(COMMUNITY_ID, TRANSFER_ID, ADMIN_ID);

      expect(open.status).toBe(OwnershipTransferStatus.DECLINED);
      expect(logged(ScopeGovernanceActionKind.OWNERSHIP_DECLINED)).toHaveLength(
        1,
      );
    });

    // Nobody but the Admin may answer it, and nobody else learns it exists.
    it('reports an offer to somebody else as missing', async () => {
      open = offer();

      await expect(
        service.decline(COMMUNITY_ID, TRANSFER_ID, OTHER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('accepting it', () => {
    const accept = () => service.accept(COMMUNITY_ID, TRANSFER_ID, ADMIN_ID);

    beforeEach(() => {
      open = offer();
    });

    it('locks the Community, then the offer', async () => {
      await accept();

      expect(manager.findOne).toHaveBeenNthCalledWith(1, FleetCommunityEntity, {
        where: { id: COMMUNITY_ID },
        lock: { mode: 'pessimistic_write' },
      });
      expect(manager.findOne).toHaveBeenNthCalledWith(
        2,
        OwnershipTransferEntity,
        {
          where: { id: TRANSFER_ID, communityId: COMMUNITY_ID },
          lock: { mode: 'pessimistic_write' },
        },
      );
    });

    it('makes them the Owner and the former Owner an Admin', async () => {
      await accept();

      expect(community?.ownerUserId).toBe(ADMIN_ID);
      expect(manager.save).toHaveBeenCalledWith(
        ScopeRoleAssignmentEntity,
        expect.objectContaining({
          communityId: COMMUNITY_ID,
          fleetId: null,
          userId: OWNER_ID,
          role: FleetScopeRole.ADMIN,
          grantedByUserId: ADMIN_ID,
          reason: FORMER_OWNER_REASON,
        }),
      );
      expect(open?.status).toBe(OwnershipTransferStatus.ACCEPTED);
      expect(logged(ScopeGovernanceActionKind.OWNERSHIP_ACCEPTED)).toEqual([
        expect.objectContaining({
          actorUserId: ADMIN_ID,
          subjectUserId: OWNER_ID,
          transferId: TRANSFER_ID,
        }),
      ]);
      expect(logged(ScopeGovernanceActionKind.ROLE_ASSIGNED)).toEqual([
        expect.objectContaining({
          subjectUserId: OWNER_ID,
          role: FleetScopeRole.ADMIN,
          reason: FORMER_OWNER_REASON,
        }),
      ]);
      expect(bump).toHaveBeenCalledWith(
        FleetScopeKind.COMMUNITY,
        COMMUNITY_ID,
        manager,
      );
    });

    // A denial left behind would still take a power from the new Owner.
    it('ends whatever the new Owner held anywhere in the Community, each logged (FC-039)', async () => {
      admins = [
        {
          id: 'role-1',
          communityId: COMMUNITY_ID,
          fleetId: null,
          armadaId: null,
          userId: ADMIN_ID,
          role: FleetScopeRole.ADMIN,
        },
      ];

      await accept();

      expect(manager.find).toHaveBeenCalledWith(ScopeRoleAssignmentEntity, {
        where: {
          communityId: COMMUNITY_ID,
          userId: ADMIN_ID,
          validTo: IsNull(),
        },
      });
      expect(manager.find).toHaveBeenCalledWith(ScopeCapabilityGrantEntity, {
        where: {
          communityId: COMMUNITY_ID,
          subjectUserId: ADMIN_ID,
          validTo: IsNull(),
        },
      });
      expect(manager.update).toHaveBeenCalledWith(
        ScopeRoleAssignmentEntity,
        { id: 'role-1' },
        { validTo: expect.any(Date) },
      );
      expect(manager.insert).toHaveBeenCalledWith(
        ScopeGovernanceActionEntity,
        expect.objectContaining({
          action: ScopeGovernanceActionKind.ROLE_WITHDRAWN,
          subjectUserId: ADMIN_ID,
          reason: ENDED_BY_OWNERSHIP,
          idempotencyKey: 'ENDED:role-1',
        }),
      );
    });

    it('refuses a Community that has closed', async () => {
      community = { ...community, status: FleetScopeStatus.CLOSED };

      await expect(accept()).rejects.toBeInstanceOf(ConflictException);
    });

    // A site administrator moved it meanwhile.
    it('refuses when ownership has moved since the offer', async () => {
      community = { ...community, ownerUserId: OTHER_ID };

      await expect(accept()).rejects.toThrow(
        new ConflictException('Ownership has changed since this was offered.'),
      );
    });

    it('refuses somebody who is no longer an Admin', async () => {
      isAdmin = false;

      await expect(accept()).rejects.toBeInstanceOf(ConflictException);
      expect(community?.ownerUserId).toBe(OWNER_ID);
    });

    it('says so when they own the most Communities allowed', async () => {
      manager.save.mockImplementation((entity: unknown, row: object) =>
        entity === FleetCommunityEntity
          ? Promise.reject(
              new QueryFailedError(
                'UPDATE',
                [],
                new Error('a user may own at most 10 live Fleet Communities'),
              ),
            )
          : Promise.resolve(row),
      );

      await expect(accept()).rejects.toThrow(
        new ConflictException(
          'They already own 10 Fleet Communities, the most anybody may.',
        ),
      );
    });

    it.each([
      [
        'another database refusal',
        new QueryFailedError('UPDATE', [], new Error('deadlock')),
      ],
      ['anything else', new Error('connection lost')],
    ])('passes %s on', async (_label, failure) => {
      manager.save.mockImplementation((entity: unknown, row: object) =>
        entity === FleetCommunityEntity
          ? Promise.reject(failure)
          : Promise.resolve(row),
      );

      await expect(accept()).rejects.toBe(failure);
    });
  });

  describe('cancelling it as part of another change', () => {
    const em = () => manager as unknown as EntityManager;

    it('does nothing when there is no open offer', async () => {
      await service.cancelOpenWithin(em(), COMMUNITY_ID, {
        actorUserId: OWNER_ID,
      });

      expect(manager.save).not.toHaveBeenCalled();
    });

    it('leaves an offer to somebody else alone', async () => {
      open = offer();

      await service.cancelOpenWithin(em(), COMMUNITY_ID, {
        actorUserId: OWNER_ID,
        onlyTo: OTHER_ID,
      });

      expect(open.status).toBe(OwnershipTransferStatus.PENDING);
    });

    it('cancels the offer to the Admin named, and says who did', async () => {
      open = offer();

      await service.cancelOpenWithin(em(), COMMUNITY_ID, {
        actorUserId: SITE_ADMIN_ID,
        asSiteAdmin: true,
        onlyTo: ADMIN_ID,
      });

      expect(open.status).toBe(OwnershipTransferStatus.CANCELLED);
      expect(logged(ScopeGovernanceActionKind.OWNERSHIP_CANCELLED)).toEqual([
        expect.objectContaining({
          actorUserId: SITE_ADMIN_ID,
          asSiteAdmin: true,
        }),
      ]);
    });
  });

  describe('a site administrator’s dispute action', () => {
    it('shows the Owner, the Admins and any open offer', async () => {
      open = offer();

      await expect(service.disputeView(COMMUNITY_ID)).resolves.toEqual({
        communityId: COMMUNITY_ID,
        name: 'Fixture Community',
        status: FleetScopeStatus.ACTIVE,
        owner: { userId: OWNER_ID, username: 'MidNiteShadow' },
        admins: [{ userId: ADMIN_ID, username: 'Deputy' }],
        offer: expect.objectContaining({ id: TRANSFER_ID }),
      });
    });

    it('shows no offer once it has expired, and an unnamed Owner as unnamed', async () => {
      open = offer({ expiresAt: new Date(Date.now() - 1) });
      manager.find.mockImplementation((entity: unknown) =>
        Promise.resolve(entity === UserProfileEntity ? [] : admins),
      );

      const view = await service.disputeView(COMMUNITY_ID);

      expect(view.offer).toBeNull();
      expect(view.owner!.username).toBeNull();
    });

    it('requires a reason', async () => {
      await expect(
        service.reassign(COMMUNITY_ID, ADMIN_ID, '  ', SITE_ADMIN_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('moves it only to one of the Community’s Admins', async () => {
      isAdmin = false;

      await expect(
        service.reassign(
          COMMUNITY_ID,
          ADMIN_ID,
          'Owner vanished',
          SITE_ADMIN_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    // The former Owner keeps no role: the dispute is about them.
    it('moves it with no acceptance, cancelling any offer, and gives the former Owner nothing', async () => {
      open = offer({ toUserId: OTHER_ID });

      await service.reassign(
        COMMUNITY_ID,
        ADMIN_ID,
        ' Owner vanished ',
        SITE_ADMIN_ID,
      );

      expect(community?.ownerUserId).toBe(ADMIN_ID);
      expect(open.status).toBe(OwnershipTransferStatus.CANCELLED);
      expect(manager.save).not.toHaveBeenCalledWith(
        ScopeRoleAssignmentEntity,
        expect.anything(),
      );
      expect(logged(ScopeGovernanceActionKind.OWNERSHIP_REASSIGNED)).toEqual([
        {
          scope: communityScope(COMMUNITY_ID),
          action: ScopeGovernanceActionKind.OWNERSHIP_REASSIGNED,
          actorUserId: SITE_ADMIN_ID,
          asSiteAdmin: true,
          subjectUserId: ADMIN_ID,
          reason: 'Owner vanished',
        },
      ]);
      expect(bump).toHaveBeenCalledWith(
        FleetScopeKind.COMMUNITY,
        COMMUNITY_ID,
        manager,
      );
    });
  });

  it('describes a party whose account has gone as nobody in particular', async () => {
    open = offer({ fromUserId: null });

    const standing = await service.standing(COMMUNITY_ID, ADMIN_ID);

    expect(standing.offer?.from).toEqual({ userId: '', username: null });
  });

  describe('where an offer stands', () => {
    const now = new Date('2026-09-27T12:00:00.000Z');

    it.each([
      [
        OwnershipTransferStatus.PENDING,
        now.getTime() + 1,
        OwnershipTransferState.PENDING,
      ],
      [
        OwnershipTransferStatus.PENDING,
        now.getTime(),
        OwnershipTransferState.EXPIRED,
      ],
      [
        OwnershipTransferStatus.LAPSED,
        now.getTime() + DAY,
        OwnershipTransferState.EXPIRED,
      ],
      [
        OwnershipTransferStatus.ACCEPTED,
        now.getTime() - DAY,
        OwnershipTransferState.ACCEPTED,
      ],
      [
        OwnershipTransferStatus.DECLINED,
        now.getTime() - DAY,
        OwnershipTransferState.DECLINED,
      ],
      [
        OwnershipTransferStatus.CANCELLED,
        now.getTime() - DAY,
        OwnershipTransferState.CANCELLED,
      ],
    ])('reads %s expiring at %i as %s', (status, expires, state) => {
      expect(stateOf({ status, expiresAt: new Date(expires) }, now)).toBe(
        state,
      );
    });
  });

  describe("on the Owner's departure (FC-038)", () => {
    const REASON = 'The Owner closed their STO Info account.';

    it('hands it to the longest-serving Admin who can take it, and tells them', async () => {
      admins = [{ userId: OWNER_ID }, { userId: ADMIN_ID }];

      await expect(
        service.handToSuccessor(COMMUNITY_ID, OWNER_ID, REASON),
      ).resolves.toBe(ADMIN_ID);
      expect(community!.ownerUserId).toBe(ADMIN_ID);
      expect(logged(ScopeGovernanceActionKind.OWNERSHIP_REASSIGNED)).toEqual([
        expect.objectContaining({
          actorUserId: OWNER_ID,
          subjectUserId: ADMIN_ID,
          reason: REASON,
        }),
      ]);
      expect(bump).toHaveBeenCalled();
      expect(createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: ADMIN_ID,
          title: 'You are now the Owner of Fixture Community',
          linkUrl: 'https://sto.example/fleets/communities/fixture-community',
        }),
      );
    });

    it('passes over an Admin whose account is closed or who owns the most allowed', async () => {
      admins = [{ userId: ADMIN_ID }, { userId: OTHER_ID }];
      manager.exists.mockImplementation((_entity: unknown, options: unknown) =>
        Promise.resolve(
          (options as { where: { id?: string } }).where.id !== ADMIN_ID,
        ),
      );
      manager.count.mockResolvedValue(10);

      await expect(
        service.handToSuccessor(COMMUNITY_ID, OWNER_ID, REASON),
      ).resolves.toBeNull();
      expect(community!.ownerUserId).toBe(OWNER_ID);
      expect(record).not.toHaveBeenCalled();
      expect(createNotification).not.toHaveBeenCalled();
    });

    it('keeps the hand-over when the notice cannot be sent, or has nowhere to link', async () => {
      delete process.env.APP_FRONTEND_URL;
      createNotification.mockRejectedValue(new Error('down'));

      await expect(
        service.handToSuccessor(COMMUNITY_ID, OWNER_ID, REASON),
      ).resolves.toBe(ADMIN_ID);
      expect(createNotification).toHaveBeenCalledWith(
        expect.not.objectContaining({ linkUrl: expect.anything() }),
      );
    });

    it('shows a closed Community whose Owner was erased as having none', async () => {
      community = { ...community!, ownerUserId: null };

      await expect(service.disputeView(COMMUNITY_ID)).resolves.toEqual(
        expect.objectContaining({ owner: null }),
      );
    });
  });
});
