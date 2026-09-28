import { GeneralFactionEntity } from 'src/sto/character/entities/general-faction.entity';
import { PlatformEntity } from 'src/sto/platform/entities/platform.entity';
import { UserProfileEntity } from 'src/user/entities/user-profile.entity';

import { InMemoryManager, Row } from '../../../../test/in-memory-manager';
import { FleetAudienceService } from '../../authorisation/fleet-audience.service';
import { FleetAuthorisationService } from '../../authorisation/fleet-authorisation.service';
import { FLEET_CAPABILITIES } from '../../authorisation/fleet-capability.constants';
import { ArmadaFleetMembershipEntity } from '../../entities/armada-fleet-membership.entity';
import { FleetCommunityEntity } from '../../entities/fleet-community.entity';
import { StoArmadaEntity } from '../../entities/sto-armada.entity';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { ArmadaPosition } from '../../enums/armada-position.enum';
import { FleetScopeRole } from '../../enums/fleet-scope-role.enum';
import { FleetScopeStatus } from '../../enums/fleet-scope-status.enum';
import { ArmadaActionEntity } from '../entities/armada-action.entity';
import { ArmadaJoinRequestEntity } from '../entities/armada-join-request.entity';
import { ArmadaActionKind } from '../enums/armada-action-kind.enum';
import { ArmadaJoinRequestStatus } from '../enums/armada-join-request-status.enum';
import { ArmadaViewService } from './armada-view.service';

const COMMUNITY_ID = 'community-1';
const ARMADA_ID = 'armada-1';
const SINCE = new Date('2026-09-01T00:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const { ALPHA, BETA, GAMMA } = ArmadaPosition;

/** What the reader is, as the policy would say. */
interface Reader {
  capabilities?: string[];
  roles?: FleetScopeRole[];
  isApprovedMember?: boolean;
}

describe('ArmadaViewService', () => {
  let db: InMemoryManager;
  let readers: Map<string, Reader | null>;
  let hidden: Set<string>;
  let service: ArmadaViewService;
  let armada: StoArmadaEntity;

  /**
   * Seeds the Armada's placements from a sketch.
   *
   * @param sketch - Each Fleet, its position and the Beta it sits under.
   * @param armadaId - The Armada.
   */
  function place(
    sketch: [string, ArmadaPosition, string?][],
    armadaId = ARMADA_ID,
  ): void {
    db.seed(
      ArmadaFleetMembershipEntity,
      sketch.map(([fleetId, position, parent]) => ({
        id: `placement-${fleetId}`,
        communityId: COMMUNITY_ID,
        armadaId,
        fleetId,
        position,
        parentMembershipId: parent === undefined ? null : `placement-${parent}`,
        validFrom: SINCE,
        validTo: null,
        deletedAt: null,
      })),
    );
  }

  /**
   * Seeds a request.
   *
   * @param overrides - Fields to override.
   */
  function request(overrides: Row = {}): void {
    db.seed(ArmadaJoinRequestEntity, [
      {
        id: 'request-1',
        armadaId: ARMADA_ID,
        fleetId: 'f-new',
        requestedByUserId: 'user-asker',
        message: 'Room?',
        status: ArmadaJoinRequestStatus.PENDING,
        createdAt: new Date(Date.now() - DAY),
        expiresAt: new Date(Date.now() + DAY),
        answeredAt: null,
        answeredByUserId: null,
        reason: null,
        ...overrides,
      },
    ]);
  }

  /**
   * Says what the policy concludes about a reader, at every scope.
   *
   * @param userId - The reader.
   * @param reader - What they are, or null when the scope does not resolve.
   */
  function reader(userId: string, reader: Reader | null): void {
    readers.set(userId, reader);
  }

  beforeEach(() => {
    db = new InMemoryManager();
    readers = new Map();
    hidden = new Set();
    armada = {
      id: ARMADA_ID,
      communityId: COMMUNITY_ID,
      exactGameName: 'Sol Armada',
      slug: 'sol-armada',
      platformId: 'pc',
      allegianceFactionId: 'federation',
      status: FleetScopeStatus.ACTIVE,
      deletedAt: null,
    } as unknown as StoArmadaEntity;
    db.seed(StoArmadaEntity, [armada as unknown as Row])
      .seed(PlatformEntity, [{ id: 'pc', name: 'Windows' }])
      .seed(GeneralFactionEntity, [
        { id: 'federation', name: 'Federation' },
        { id: 'undecided', name: 'Undecided' },
      ])
      .seed(
        StoFleetEntity,
        ['a', 'b1', 'b2', 'g1', 'f-new', 'f-loose', 'f-hidden'].map(id => ({
          id,
          communityId: COMMUNITY_ID,
          exactGameName: `Fleet ${id}`,
          slug: id,
          platformId: 'pc',
          platform: { name: 'Windows' },
          allegianceFactionId: 'federation',
          status: FleetScopeStatus.ACTIVE,
          deletedAt: null,
        })),
      )
      .seed(UserProfileEntity, [
        { userId: 'user-manager', username: 'MidNiteShadow' },
        { userId: 'user-asker', username: 'FleetApplicant' },
      ]);
    service = new ArmadaViewService(
      db.asDataSource(),
      {
        authorise: jest.fn((userId: string | null) => {
          const found = userId === null ? undefined : readers.get(userId);

          return Promise.resolve(
            found === null
              ? null
              : {
                  capabilities: new Set(found?.capabilities ?? []),
                  roles: new Set(found?.roles ?? []),
                  isApprovedMember: found?.isApprovedMember ?? false,
                },
          );
        }),
      } as unknown as FleetAuthorisationService,
      {
        canViewScope: jest.fn((ref: { id: string }) =>
          Promise.resolve(!hidden.has(ref.id)),
        ),
      } as unknown as FleetAudienceService,
    );
  });

  describe('an Armada’s shape', () => {
    beforeEach(() => {
      place([
        ['a', ALPHA],
        ['b1', BETA],
        ['g1', GAMMA, 'b1'],
        ['b2', BETA],
      ]);
    });

    it('draws the Alpha, then each Beta with its Gammas', async () => {
      const view = await service.view(armada, null);

      expect(view.structure).toEqual({
        alpha: {
          fleet: {
            id: 'a',
            name: 'Fleet a',
            slug: 'a',
            platformSegment: 'windows',
          },
          position: ALPHA,
          since: SINCE,
        },
        betas: [
          expect.objectContaining({
            fleet: expect.objectContaining({ id: 'b1' }),
            gammas: [expect.objectContaining({ position: GAMMA })],
          }),
          expect.objectContaining({
            fleet: expect.objectContaining({ id: 'b2' }),
            gammas: [],
          }),
        ],
        maxBetas: 3,
        maxGammasPerBeta: 3,
      });
      expect(view).toMatchObject({
        mayManage: false,
        isMember: false,
        openRequests: 0,
      });
    });

    it('keeps a hidden Fleet’s place, without its name', async () => {
      hidden.add('b2');

      const view = await service.view(armada, null);

      expect(view.structure.betas[1].fleet).toEqual({
        id: null,
        name: null,
        slug: null,
        platformSegment: 'windows',
      });
    });

    it('leaves the Alpha slot empty when it is', async () => {
      db.rows<Row>(ArmadaFleetMembershipEntity).shift();

      expect((await service.view(armada, null)).structure.alpha).toBeNull();
    });

    it('counts open requests for a manager', async () => {
      reader('user-manager', {
        capabilities: [FLEET_CAPABILITIES.ARMADA_MANAGE],
      });
      request();

      const view = await service.view(armada, 'user-manager');

      expect(view).toMatchObject({ mayManage: true, openRequests: 1 });
    });

    it.each([
      ['a member through a placed Fleet', { isApprovedMember: true }],
      ['a role holder', { roles: [FleetScopeRole.ADMIN] }],
    ])('counts %s as a member', async (_who, standing) => {
      reader('user-member', standing);

      expect((await service.view(armada, 'user-member')).isMember).toBe(true);
    });

    it('treats a scope that does not resolve as holding nothing', async () => {
      reader('user-gone', null);

      const view = await service.view(armada, 'user-gone');

      expect(view).toMatchObject({ mayManage: false, isMember: false });
    });
  });

  describe('the history', () => {
    beforeEach(() => {
      db.seed(ArmadaActionEntity, [
        {
          armadaId: ARMADA_ID,
          changeId: 'change-1',
          fleetId: 'b1',
          action: ArmadaActionKind.PLACED,
          fromPosition: null,
          fromParentFleetId: null,
          toPosition: BETA,
          toParentFleetId: null,
          actorUserId: 'user-manager',
          reason: null,
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
        },
        {
          armadaId: ARMADA_ID,
          changeId: 'change-2',
          fleetId: 'b1',
          action: ArmadaActionKind.REMOVED,
          fromPosition: BETA,
          fromParentFleetId: null,
          toPosition: null,
          toParentFleetId: null,
          actorUserId: 'user-gone',
          reason: 'Inactive',
          createdAt: new Date('2026-09-02T00:00:00.000Z'),
        },
        {
          armadaId: ARMADA_ID,
          changeId: 'change-2',
          fleetId: 'g1',
          action: ArmadaActionKind.MOVED,
          fromPosition: GAMMA,
          fromParentFleetId: 'b1',
          toPosition: GAMMA,
          toParentFleetId: 'b2',
          actorUserId: 'user-gone',
          reason: 'Inactive',
          createdAt: new Date('2026-09-02T00:00:00.000Z'),
        },
        {
          armadaId: ARMADA_ID,
          changeId: 'change-0',
          fleetId: 'a',
          action: ArmadaActionKind.PLACED,
          fromPosition: null,
          fromParentFleetId: null,
          toPosition: ALPHA,
          toParentFleetId: null,
          actorUserId: null,
          reason: null,
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
        },
      ]);
    });

    it('reads changes newest first, grouping their Fleets, naming nobody to a stranger', async () => {
      const page = await service.history(armada, null, {});

      expect(page).toMatchObject({
        recordersShown: false,
        page: 1,
        pageSize: 25,
        total: 3,
      });
      expect(page.items.map(item => item.changeId)).toEqual([
        'change-2',
        'change-1',
        'change-0',
      ]);
      expect(page.items[0]).toEqual({
        changeId: 'change-2',
        at: new Date('2026-09-02T00:00:00.000Z'),
        recordedBy: null,
        reason: null,
        moves: expect.arrayContaining([
          {
            fleet: expect.objectContaining({ id: 'g1' }),
            action: ArmadaActionKind.MOVED,
            from: {
              position: GAMMA,
              parent: expect.objectContaining({ id: 'b1' }),
            },
            to: {
              position: GAMMA,
              parent: expect.objectContaining({ id: 'b2' }),
            },
          },
          expect.objectContaining({
            action: ArmadaActionKind.REMOVED,
            from: { position: BETA, parent: null },
            to: null,
          }),
        ]),
      });
    });

    it('names who made each change, and why, to a member', async () => {
      reader('user-member', { isApprovedMember: true });

      const page = await service.history(armada, 'user-member', {
        page: 2,
        pageSize: 1,
      });

      expect(page.recordersShown).toBe(true);
      expect(page.items).toEqual([
        expect.objectContaining({
          changeId: 'change-1',
          recordedBy: 'MidNiteShadow',
        }),
      ]);

      const first = await service.history(armada, 'user-member', {
        pageSize: 1,
      });

      expect(first.items[0]).toMatchObject({
        recordedBy: null,
        reason: 'Inactive',
      });
    });

    it('names nobody for a change whose maker has gone', async () => {
      reader('user-member', { isApprovedMember: true });

      const page = await service.history(armada, 'user-member', {});

      expect(page.items[2].recordedBy).toBeNull();
    });
  });

  describe('requests', () => {
    it('lists the open ones by default, naming who asked', async () => {
      request();
      request({ id: 'request-2', status: ArmadaJoinRequestStatus.REJECTED });

      const page = await service.requests(armada, 'user-manager', {});

      expect(page).toMatchObject({ page: 1, pageSize: 25, total: 1 });
      expect(page.items[0]).toMatchObject({
        id: 'request-1',
        status: ArmadaJoinRequestStatus.PENDING,
        armada: {
          id: ARMADA_ID,
          name: 'Sol Armada',
          slug: 'sol-armada',
          platformSegment: 'windows',
          allegiance: 'Federation',
        },
        fleet: expect.objectContaining({ id: 'f-new' }),
        requestedBy: 'FleetApplicant',
        answeredBy: null,
      });
    });

    it('lists those in the status asked for, and calls an overdue one lapsed', async () => {
      request({
        status: ArmadaJoinRequestStatus.REJECTED,
        answeredByUserId: 'user-manager',
        reason: 'Full',
      });
      request({
        id: 'request-2',
        expiresAt: new Date(Date.now() - 1000),
        requestedByUserId: null,
      });

      const rejected = await service.requests(armada, 'user-manager', {
        status: ArmadaJoinRequestStatus.REJECTED,
        page: 1,
        pageSize: 10,
      });
      const pending = await service.requests(armada, 'user-manager', {});

      expect(rejected.items[0]).toMatchObject({
        answeredBy: 'MidNiteShadow',
        reason: 'Full',
      });
      expect(pending.items[0]).toMatchObject({
        status: ArmadaJoinRequestStatus.LAPSED,
        requestedBy: null,
      });
    });

    it('names nobody who has no username', async () => {
      request({
        requestedByUserId: 'user-nameless',
        status: ArmadaJoinRequestStatus.WITHDRAWN,
        answeredByUserId: 'user-nameless',
      });

      const page = await service.requests(armada, 'user-manager', {
        status: ArmadaJoinRequestStatus.WITHDRAWN,
      });

      expect(page.items[0]).toMatchObject({
        requestedBy: null,
        answeredBy: null,
      });
    });

    it('describes no requests as none', async () => {
      await expect(service.describeRequests([], null)).resolves.toEqual([]);
    });

    it('names an Armada on a platform or allegiance it cannot find as blank', async () => {
      const [ref] = await service.armadaRefs([
        {
          ...armada,
          platformId: 'nowhere',
          allegianceFactionId: null,
        } as StoArmadaEntity,
      ]);

      expect(ref).toMatchObject({ platformSegment: '', allegiance: null });
    });
  });

  describe('a Fleet’s Armada', () => {
    /**
     * Reads a Fleet.
     *
     * @param id - The Fleet.
     * @returns It.
     */
    const fleet = (id: string): StoFleetEntity =>
      db
        .rows<Row>(StoFleetEntity)
        .find(row => row.id === id) as unknown as StoFleetEntity;

    it('says where a placed Fleet sits, to anybody', async () => {
      place([
        ['b1', BETA],
        ['g1', GAMMA, 'b1'],
      ]);

      const view = await service.fleetView(fleet('g1'), null);

      expect(view).toEqual({
        placement: {
          armada: expect.objectContaining({ id: ARMADA_ID }),
          position: GAMMA,
          parent: expect.objectContaining({ id: 'b1' }),
          since: SINCE,
          gammaCount: 0,
        },
        mayRequest: false,
        openRequest: null,
        lastAnswered: null,
        choices: [],
        cannotRequestBecause: null,
      });
      expect(
        (await service.fleetView(fleet('b1'), null)).placement,
      ).toMatchObject({
        parent: null,
        gammaCount: 1,
      });
    });

    it('offers a requester the Armadas of its platform and allegiance', async () => {
      reader('user-admin', {
        capabilities: [FLEET_CAPABILITIES.ARMADA_REQUEST],
      });
      db.seed(StoArmadaEntity, [
        {
          ...(armada as unknown as Row),
          id: 'armada-klingon',
          allegianceFactionId: 'klingon',
        },
      ]);

      const view = await service.fleetView(fleet('f-new'), 'user-admin');

      expect(view.mayRequest).toBe(true);
      expect(view.choices.map(choice => choice.id)).toEqual([ARMADA_ID]);
      expect(view.cannotRequestBecause).toBeNull();
    });

    it('shows a requester their open request and the last answer, offering no choice', async () => {
      reader('user-admin', {
        capabilities: [FLEET_CAPABILITIES.ARMADA_REQUEST],
      });
      request();
      request({
        id: 'request-0',
        status: ArmadaJoinRequestStatus.REJECTED,
        reason: 'Full',
        createdAt: new Date(Date.now() - 3 * DAY),
      });

      const view = await service.fleetView(fleet('f-new'), 'user-admin');

      expect(view.openRequest?.id).toBe('request-1');
      expect(view.lastAnswered?.reason).toBe('Full');
      expect(view.choices).toEqual([]);
    });

    it('offers a placed Fleet’s requester nothing to join', async () => {
      reader('user-admin', {
        capabilities: [FLEET_CAPABILITIES.ARMADA_REQUEST],
      });
      place([['b1', BETA]]);

      const view = await service.fleetView(fleet('b1'), 'user-admin');

      expect(view.choices).toEqual([]);
      expect(view.openRequest).toBeNull();
    });

    it.each([
      ['no allegiance', null],
      ['an Undecided one', 'undecided'],
    ])('says why a Fleet with %s cannot ask', async (_what, factionId) => {
      reader('user-admin', {
        capabilities: [FLEET_CAPABILITIES.ARMADA_REQUEST],
      });
      Object.assign(fleet('f-new'), { allegianceFactionId: factionId });

      const view = await service.fleetView(fleet('f-new'), 'user-admin');

      expect(view.cannotRequestBecause).toContain('Federation or Klingon');
      expect(view.choices).toEqual([]);
    });

    it('offers a closed Fleet nothing, whoever reads it', async () => {
      reader('user-admin', {
        capabilities: [FLEET_CAPABILITIES.ARMADA_REQUEST],
      });
      Object.assign(fleet('f-new'), { status: FleetScopeStatus.CLOSED });

      expect(
        (await service.fleetView(fleet('f-new'), 'user-admin')).mayRequest,
      ).toBe(false);
    });

    it('treats a Fleet scope that does not resolve as holding nothing', async () => {
      reader('user-gone', null);

      expect(
        (await service.fleetView(fleet('f-new'), 'user-gone')).mayRequest,
      ).toBe(false);
    });
  });

  describe('a Community’s structure', () => {
    it('draws its open Armadas, then the open Fleets it can see in none', async () => {
      db.seed(StoArmadaEntity, [
        {
          ...(armada as unknown as Row),
          id: 'armada-closed',
          status: FleetScopeStatus.CLOSED,
        },
      ]);
      db.seed(FleetCommunityEntity, [{ id: COMMUNITY_ID }]);
      Object.assign(
        db.rows<Row>(StoFleetEntity).find(row => row.id === 'f-new') as Row,
        { status: FleetScopeStatus.CLOSED },
      );
      place([
        ['a', ALPHA],
        ['b1', BETA],
      ]);
      hidden.add('f-hidden');

      const structure = await service.communityStructure(
        { id: COMMUNITY_ID } as FleetCommunityEntity,
        null,
      );

      expect(structure.armadas).toEqual([
        {
          armada: expect.objectContaining({ id: ARMADA_ID }),
          structure: expect.objectContaining({
            alpha: expect.objectContaining({ position: ALPHA }),
          }),
        },
      ]);
      expect(structure.standaloneFleets.map(ref => ref.id)).toEqual([
        'b2',
        'f-loose',
        'g1',
      ]);
    });
  });

  it('reads Fleets by ID for the reader, and asks nothing for none', async () => {
    const view = await service.view(armada, null);

    expect(view.structure).toEqual({
      alpha: null,
      betas: [],
      maxBetas: 3,
      maxGammasPerBeta: 3,
    });
  });

  it('names a Fleet it cannot find by its place alone', async () => {
    place([['ghost', BETA]]);

    const view = await service.view(armada, null);

    expect(view.structure.betas[0].fleet).toEqual({
      id: null,
      name: null,
      slug: null,
      platformSegment: '',
    });
  });
});
