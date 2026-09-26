import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { DataSource } from 'typeorm';

import { CharacterEntity } from 'src/sto/character/entities/character.entity';
import { FactionEntity } from 'src/sto/character/entities/faction.entity';
import { UserProfileEntity } from 'src/user/entities/user-profile.entity';

import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { FleetRecruitmentState } from '../../enums/fleet-recruitment-state.enum';
import { CharacterFleetMapper } from '../../mappers/character-fleet.mapper';
import { FleetApplicationActionEntity } from '../entities/fleet-application-action.entity';
import { FleetApplicationEntity } from '../entities/fleet-application.entity';
import { FleetRecruitmentSettingsEntity } from '../entities/fleet-recruitment-settings.entity';
import { ApplicationQuestionKind } from '../enums/application-question-kind.enum';
import { FleetApplicationActionKind } from '../enums/fleet-application-action-kind.enum';
import { FleetApplicationRoute } from '../enums/fleet-application-route.enum';
import { FleetApplicationStatus } from '../enums/fleet-application-status.enum';
import { ApplicationEvidenceService } from './application-evidence.service';
import { FleetApplicationService } from './fleet-application.service';
import { RecruitmentEligibilityService } from './recruitment-eligibility.service';
import { RecruitmentMembershipService } from './recruitment-membership.service';
import {
  CurrentRecruitment,
  RecruitmentSettingsService,
} from './recruitment-settings.service';

const FLEET = { id: 'fleet-1', communityId: 'community-1' } as StoFleetEntity;
const CHARACTER = {
  id: 'character-1',
  handle: 'Kell Marr',
  fullHandle: 'Kell Marr@kell',
  fullHandleNormalized: 'kell marr@kell',
  level: 65,
  factionId: 'faction-1',
} as CharacterEntity;
const QUESTION = {
  id: 'q-why',
  kind: ApplicationQuestionKind.SHORT_TEXT,
  prompt: 'Why?',
  required: true,
  options: [],
};
const EVIDENCE = {
  listed: true,
  latestExportAt: new Date('2026-09-20T12:00:00Z'),
  listedSince: new Date('2026-09-01T12:00:00Z'),
  rank: 'Member',
  everListed: true,
};

/**
 * Builds how the Fleet recruits.
 *
 * @param changes - Fields to override.
 * @returns The Fleet's current recruitment.
 */
function recruitment(
  changes: Partial<CurrentRecruitment> = {},
): CurrentRecruitment {
  return {
    settings: { id: 'settings-2' } as FleetRecruitmentSettingsEntity,
    version: 2,
    recruitmentState: FleetRecruitmentState.APPLICATION,
    requirementsText: null,
    minimumLevel: null,
    factionIds: [],
    questions: [QUESTION],
    ...changes,
  };
}

/**
 * Builds an application.
 *
 * @param changes - Fields to override.
 * @returns The application.
 */
function application(
  changes: Partial<FleetApplicationEntity> = {},
): FleetApplicationEntity {
  return {
    id: 'application-1',
    communityId: 'community-1',
    fleetId: 'fleet-1',
    applicantUserId: 'applicant-1',
    characterId: 'character-1',
    route: FleetApplicationRoute.APPLICATION,
    status: FleetApplicationStatus.PENDING,
    settingsId: 'settings-2',
    answers: [{ questionId: 'q-why', value: 'Friends' }],
    invitationId: null,
    submittedAt: new Date('2026-09-25T09:00:00Z'),
    decidedAt: null,
    decidedByUserId: null,
    decisionNote: null,
    withdrawnAt: null,
    revision: 1,
    fleet: FLEET,
    character: CHARACTER,
    ...changes,
  } as FleetApplicationEntity;
}

describe('FleetApplicationService', () => {
  let current: CurrentRecruitment;
  let stored: FleetApplicationEntity | null;
  let pendingExists: boolean;
  let manager: Record<string, jest.Mock>;
  let eligibility: Record<string, jest.Mock>;
  let membership: Record<string, jest.Mock>;
  let evidence: { forCharacter: jest.Mock };
  let service: FleetApplicationService;

  beforeEach(() => {
    current = recruitment();
    stored = application();
    pendingExists = false;
    manager = {
      findOne: jest.fn((entity: unknown) => {
        switch (entity) {
          case FleetApplicationEntity:
            return Promise.resolve(stored);
          case FleetRecruitmentSettingsEntity:
            return Promise.resolve({ version: 2, questions: [QUESTION] });
          case CharacterEntity:
            return Promise.resolve(CHARACTER);
          default:
            return Promise.resolve(null);
        }
      }),
      findOneOrFail: jest.fn(() => Promise.resolve(stored)),
      find: jest.fn((entity: unknown) => {
        switch (entity) {
          case CharacterEntity:
            return Promise.resolve([CHARACTER]);
          case FactionEntity:
            return Promise.resolve([{ id: 'faction-1', name: 'Dominion' }]);
          case UserProfileEntity:
            return Promise.resolve([
              { userId: 'applicant-1', username: 'Kell' },
              { userId: 'officer-1', username: 'Tovan' },
            ]);
          case FleetApplicationActionEntity:
            return Promise.resolve([
              {
                action: FleetApplicationActionKind.SUBMITTED,
                actorUserId: 'applicant-1',
                note: null,
                createdAt: new Date('2026-09-25T09:00:00Z'),
              },
              {
                action: FleetApplicationActionKind.ACCEPTED,
                actorUserId: null,
                note: null,
                createdAt: new Date('2026-09-25T09:00:00Z'),
              },
            ]);
          case FleetApplicationEntity:
            return Promise.resolve([stored]);
          default:
            return Promise.resolve([]);
        }
      }),
      findAndCount: jest.fn(() => Promise.resolve([[stored], 1])),
      exists: jest.fn(() => Promise.resolve(pendingExists)),
      create: jest.fn((_entity: unknown, data: object) => ({ ...data })),
      save: jest.fn((_entity: unknown, data: object) =>
        Promise.resolve({ id: 'application-1', ...data }),
      ),
    };
    eligibility = {
      loadFleet: jest.fn(() => Promise.resolve(FLEET)),
      assertVisible: jest.fn(() => Promise.resolve()),
      assertNotOwner: jest.fn(),
      requireCharacter: jest.fn(() => Promise.resolve(CHARACTER)),
    };
    membership = {
      assertMayJoin: jest.fn(() => Promise.resolve()),
      grantWithin: jest.fn(() => Promise.resolve({ id: 'membership-1' })),
    };
    evidence = { forCharacter: jest.fn(() => Promise.resolve(EVIDENCE)) };
    const dataSource = {
      manager,
      transaction: jest.fn((work: (m: typeof manager) => Promise<unknown>) =>
        work(manager),
      ),
    };
    service = new FleetApplicationService(
      dataSource as unknown as DataSource,
      {
        current: jest.fn(() => Promise.resolve(current)),
      } as unknown as RecruitmentSettingsService,
      eligibility as unknown as RecruitmentEligibilityService,
      membership as unknown as RecruitmentMembershipService,
      evidence as unknown as ApplicationEvidenceService,
      {
        toSummaryDto: jest.fn(() => ({ id: 'fleet-1' })),
      } as unknown as CharacterFleetMapper,
    );
  });

  /** The entities saved to one table, in order. */
  const savedTo = (entity: unknown): Record<string, unknown>[] =>
    manager.save.mock.calls
      .filter(([target]) => target === entity)
      .map(([, data]) => data as Record<string, unknown>);

  describe('submit', () => {
    const submit = (settingsVersion = 2, value: unknown = ' Friends ') =>
      service.submit('community-1', 'fleet-1', 'applicant-1', {
        characterId: 'character-1',
        settingsVersion,
        answers: [{ questionId: 'q-why', value: value as string }],
      });

    it('records the application, its answers and the form it answered', async () => {
      const mine = await submit();

      expect(savedTo(FleetApplicationEntity)).toEqual([
        {
          communityId: 'community-1',
          fleetId: 'fleet-1',
          applicantUserId: 'applicant-1',
          characterId: 'character-1',
          route: FleetApplicationRoute.APPLICATION,
          status: FleetApplicationStatus.PENDING,
          settingsId: 'settings-2',
          answers: [{ questionId: 'q-why', value: 'Friends' }],
        },
      ]);
      expect(savedTo(FleetApplicationActionEntity)).toEqual([
        {
          applicationId: 'application-1',
          action: FleetApplicationActionKind.SUBMITTED,
          actorUserId: 'applicant-1',
          note: null,
        },
      ]);
      expect(mine).toEqual(
        expect.objectContaining({
          id: 'application-1',
          fleet: { id: 'fleet-1' },
          characterName: 'Kell Marr@kell',
          status: FleetApplicationStatus.PENDING,
        }),
      );
    });

    it('checks the Fleet, the person and the Character before writing', async () => {
      await submit();

      expect(eligibility.assertVisible).toHaveBeenCalledWith(
        FLEET,
        'applicant-1',
      );
      expect(eligibility.assertNotOwner).toHaveBeenCalledWith(
        FLEET,
        'applicant-1',
      );
      expect(membership.assertMayJoin).toHaveBeenCalledWith(
        manager,
        'fleet-1',
        'applicant-1',
      );
      expect(eligibility.requireCharacter).toHaveBeenCalledWith(
        manager,
        FLEET,
        'character-1',
        'applicant-1',
        current,
      );
    });

    it('records no form for a Fleet that never saved one', async () => {
      current = recruitment({ settings: null, version: 0, questions: [] });

      await service.submit('community-1', 'fleet-1', 'applicant-1', {
        characterId: 'character-1',
        settingsVersion: 0,
        answers: [],
      });

      expect(savedTo(FleetApplicationEntity)[0].settingsId).toBeNull();
    });

    it('refuses answers to a form the Fleet has since changed', async () => {
      await expect(submit(1)).rejects.toThrow('changed its application form');
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('refuses a second pending application for the same Character', async () => {
      pendingExists = true;

      await expect(submit()).rejects.toThrow(
        'That Character already has an application waiting with this Fleet.',
      );
    });

    it('refuses answers that do not fit the form', async () => {
      await expect(submit(2, '')).rejects.toBeInstanceOf(BadRequestException);
    });

    it.each([
      [FleetRecruitmentState.OPEN, 'join it instead'],
      [FleetRecruitmentState.INVITE_ONLY, 'by invitation only'],
      [FleetRecruitmentState.CLOSED, 'not recruiting'],
    ])(
      'refuses an application to a Fleet that is %s',
      async (state, message) => {
        current = recruitment({ recruitmentState: state });

        await expect(submit()).rejects.toThrow(message);
      },
    );
  });

  describe('join', () => {
    beforeEach(() => {
      current = recruitment({ recruitmentState: FleetRecruitmentState.OPEN });
      stored = application({
        route: FleetApplicationRoute.OPEN_JOIN,
        status: FleetApplicationStatus.ACCEPTED,
      });
    });

    const join = () =>
      service.join('community-1', 'fleet-1', 'applicant-1', {
        characterId: 'character-1',
      });

    it('records the join as accepted as it is made, and grants membership', async () => {
      await join();

      const [saved] = savedTo(FleetApplicationEntity);
      expect(saved).toEqual(
        expect.objectContaining({
          route: FleetApplicationRoute.OPEN_JOIN,
          status: FleetApplicationStatus.ACCEPTED,
          answers: [],
          decidedByUserId: null,
        }),
      );
      expect(saved.decidedAt).toBe(saved.submittedAt);
      expect(
        savedTo(FleetApplicationActionEntity).map(action => [
          action.action,
          action.actorUserId,
        ]),
      ).toEqual([
        [FleetApplicationActionKind.SUBMITTED, 'applicant-1'],
        [FleetApplicationActionKind.ACCEPTED, null],
      ]);
      expect(membership.grantWithin).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({
          fleet: FLEET,
          userId: 'applicant-1',
          characterId: 'character-1',
          applicationId: 'application-1',
          actorUserId: null,
        }),
      );
    });

    it('holds the Character to the Fleet’s requirements', async () => {
      await join();

      expect(eligibility.requireCharacter).toHaveBeenCalledWith(
        manager,
        FLEET,
        'character-1',
        'applicant-1',
        current,
      );
    });

    it('records no form for a Fleet that never saved one', async () => {
      current = recruitment({
        recruitmentState: FleetRecruitmentState.OPEN,
        settings: null,
      });

      await join();

      expect(savedTo(FleetApplicationEntity)[0].settingsId).toBeNull();
    });

    it('refuses a join to a Fleet that takes applications', async () => {
      current = recruitment();

      await expect(join()).rejects.toThrow(
        'This Fleet takes new members by application.',
      );
      expect(membership.grantWithin).not.toHaveBeenCalled();
    });
  });

  describe('withdraw', () => {
    it('withdraws a pending application of the applicant’s own', async () => {
      const pending = application();
      stored = pending;

      await service.withdraw('application-1', 'applicant-1');

      expect(pending.status).toBe(FleetApplicationStatus.WITHDRAWN);
      expect(pending.withdrawnAt).toBeInstanceOf(Date);
      expect(pending.revision).toBe(2);
      expect(manager.findOne).toHaveBeenCalledWith(FleetApplicationEntity, {
        where: { id: 'application-1', applicantUserId: 'applicant-1' },
        lock: { mode: 'pessimistic_write' },
      });
      expect(savedTo(FleetApplicationActionEntity)[0].action).toBe(
        FleetApplicationActionKind.WITHDRAWN,
      );
    });

    it('does not find somebody else’s application', async () => {
      stored = null;

      await expect(
        service.withdraw('application-1', 'someone-else'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to withdraw a decided application', async () => {
      stored = application({ status: FleetApplicationStatus.REJECTED });

      await expect(
        service.withdraw('application-1', 'applicant-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('decide', () => {
    const decide = (
      decision: 'ACCEPT' | 'REJECT',
      note?: string,
      revision = 1,
      decider = 'officer-1',
    ) =>
      service.decide('community-1', 'fleet-1', 'application-1', decider, {
        decision,
        note,
        revision,
      });

    it('accepts, granting membership over the locked application', async () => {
      const pending = application();
      stored = pending;

      await decide('ACCEPT', '  Welcome aboard  ');

      expect(manager.findOne).toHaveBeenCalledWith(FleetApplicationEntity, {
        where: {
          id: 'application-1',
          fleetId: 'fleet-1',
          communityId: 'community-1',
        },
        lock: { mode: 'pessimistic_write' },
      });
      expect(membership.grantWithin).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({
          userId: 'applicant-1',
          characterId: 'character-1',
          applicationId: 'application-1',
          actorUserId: 'officer-1',
        }),
      );
      expect(pending).toEqual(
        expect.objectContaining({
          status: FleetApplicationStatus.ACCEPTED,
          decidedByUserId: 'officer-1',
          decisionNote: 'Welcome aboard',
          revision: 2,
        }),
      );
      expect(savedTo(FleetApplicationActionEntity)[0]).toEqual(
        expect.objectContaining({
          action: FleetApplicationActionKind.ACCEPTED,
          actorUserId: 'officer-1',
          note: 'Welcome aboard',
        }),
      );
    });

    it('accepts without a note', async () => {
      const pending = application();
      stored = pending;

      await decide('ACCEPT');

      expect(pending.decisionNote).toBeNull();
    });

    it('rejects with its reason, and grants nothing', async () => {
      const pending = application();
      stored = pending;

      await decide('REJECT', 'Not this season');

      expect(membership.grantWithin).not.toHaveBeenCalled();
      expect(pending.status).toBe(FleetApplicationStatus.REJECTED);
      expect(pending.decisionNote).toBe('Not this season');
      expect(savedTo(FleetApplicationActionEntity)[0].action).toBe(
        FleetApplicationActionKind.REJECTED,
      );
    });

    it('refuses a rejection without a reason before touching anything', async () => {
      await expect(decide('REJECT', '   ')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(manager.findOne).not.toHaveBeenCalled();
    });

    it('does not find an application of another Fleet', async () => {
      stored = null;

      await expect(decide('ACCEPT')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to let somebody decide their own application', async () => {
      await expect(
        decide('ACCEPT', undefined, 1, 'applicant-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses an application already decided', async () => {
      stored = application({ status: FleetApplicationStatus.WITHDRAWN });

      await expect(decide('ACCEPT')).rejects.toThrow(
        'already been decided or withdrawn',
      );
    });

    it('refuses a decision made against an older revision', async () => {
      await expect(decide('ACCEPT', undefined, 3)).rejects.toThrow(
        'changed since you opened it',
      );
      expect(membership.grantWithin).not.toHaveBeenCalled();
    });
  });

  describe('page', () => {
    it('lists pending applications oldest first by default', async () => {
      const page = await service.page('fleet-1', {});

      expect(manager.findAndCount).toHaveBeenCalledWith(
        FleetApplicationEntity,
        {
          where: { fleetId: 'fleet-1', status: FleetApplicationStatus.PENDING },
          order: { submittedAt: 'ASC', id: 'ASC' },
          skip: 0,
          take: 25,
        },
      );
      expect(page).toEqual({
        items: [
          {
            id: 'application-1',
            status: FleetApplicationStatus.PENDING,
            route: FleetApplicationRoute.APPLICATION,
            applicantUsername: 'Kell',
            characterName: 'Kell Marr@kell',
            characterLevel: 65,
            factionName: 'Dominion',
            submittedAt: stored?.submittedAt,
            decidedAt: null,
          },
        ],
        page: 1,
        pageSize: 25,
        total: 1,
      });
    });

    it('reads the status and page asked for', async () => {
      await service.page('fleet-1', {
        status: FleetApplicationStatus.ACCEPTED,
        page: 3,
        pageSize: 10,
      });

      expect(manager.findAndCount).toHaveBeenCalledWith(
        FleetApplicationEntity,
        expect.objectContaining({
          where: {
            fleetId: 'fleet-1',
            status: FleetApplicationStatus.ACCEPTED,
          },
          skip: 20,
          take: 10,
        }),
      );
    });

    it('reads nothing more for an empty page', async () => {
      manager.findAndCount.mockImplementationOnce(() =>
        Promise.resolve([[], 0]),
      );

      await expect(service.page('fleet-1', {})).resolves.toEqual(
        expect.objectContaining({ items: [], total: 0 }),
      );
      expect(manager.find).not.toHaveBeenCalled();
    });

    it('names a Character that has since been deleted, and no faction', async () => {
      manager.find.mockImplementation(() => Promise.resolve([]));

      const page = await service.page('fleet-1', {});

      expect(page.items[0]).toEqual(
        expect.objectContaining({
          applicantUsername: null,
          characterName: 'A deleted Character',
          characterLevel: null,
          factionName: null,
        }),
      );
    });

    it('names no faction the catalogue has lost', async () => {
      manager.find.mockImplementation((entity: unknown) =>
        Promise.resolve(entity === CharacterEntity ? [CHARACTER] : []),
      );

      const page = await service.page('fleet-1', {});

      expect(page.items[0].factionName).toBeNull();
      expect(page.items[0].characterLevel).toBe(65);
    });
  });

  describe('detail', () => {
    it('shows the answers beside their questions, the evidence and the history', async () => {
      stored = application({
        status: FleetApplicationStatus.ACCEPTED,
        decidedByUserId: 'officer-1',
        decidedAt: new Date('2026-09-26T09:00:00Z'),
        decisionNote: 'Welcome',
        revision: 2,
      });

      const detail = await service.detail('fleet-1', 'application-1');

      expect(detail).toEqual(
        expect.objectContaining({
          answers: [
            {
              questionId: 'q-why',
              prompt: 'Why?',
              kind: ApplicationQuestionKind.SHORT_TEXT,
              value: 'Friends',
            },
          ],
          settingsVersion: 2,
          decisionNote: 'Welcome',
          decidedByUsername: 'Tovan',
          revision: 2,
          evidence: EVIDENCE,
          history: [
            expect.objectContaining({
              action: FleetApplicationActionKind.SUBMITTED,
              actorUsername: 'Kell',
            }),
            expect.objectContaining({
              action: FleetApplicationActionKind.ACCEPTED,
              actorUsername: null,
            }),
          ],
        }),
      );
      expect(evidence.forCharacter).toHaveBeenCalledWith('fleet-1', CHARACTER);
    });

    it('shows an unanswered optional question with no answer', async () => {
      stored = application({ answers: [] });

      const detail = await service.detail('fleet-1', 'application-1');

      expect(detail.answers[0].value).toBeNull();
    });

    it('shows no questions and version 0 for a Fleet that had no form', async () => {
      stored = application({ settingsId: null });

      const detail = await service.detail('fleet-1', 'application-1');

      expect(detail.answers).toEqual([]);
      expect(detail.settingsVersion).toBe(0);
      expect(detail.decidedByUsername).toBeNull();
      expect(manager.findOne).not.toHaveBeenCalledWith(
        FleetRecruitmentSettingsEntity,
        expect.anything(),
      );
    });

    it('names no decider whose account has no username', async () => {
      stored = application({ decidedByUserId: 'officer-9' });

      const detail = await service.detail('fleet-1', 'application-1');

      expect(detail.decidedByUsername).toBeNull();
    });

    it('names no actor whose account has no username', async () => {
      manager.find.mockImplementation((entity: unknown) =>
        Promise.resolve(
          entity === FleetApplicationActionEntity
            ? [
                {
                  action: FleetApplicationActionKind.SUBMITTED,
                  actorUserId: 'ghost',
                  note: null,
                  createdAt: new Date(),
                },
              ]
            : entity === CharacterEntity
              ? [CHARACTER]
              : [],
        ),
      );

      const detail = await service.detail('fleet-1', 'application-1');

      expect(detail.history[0].actorUsername).toBeNull();
    });

    it('gives no evidence about a Character that has been deleted', async () => {
      manager.findOne.mockImplementation((entity: unknown) =>
        Promise.resolve(
          entity === FleetApplicationEntity
            ? stored
            : entity === CharacterEntity
              ? null
              : { version: 2, questions: [QUESTION] },
        ),
      );

      const detail = await service.detail('fleet-1', 'application-1');

      expect(detail.evidence).toEqual({
        listed: false,
        latestExportAt: null,
        listedSince: null,
        rank: null,
        everListed: false,
      });
      expect(evidence.forCharacter).not.toHaveBeenCalled();
    });

    it('does not find an application of another Fleet', async () => {
      stored = null;

      await expect(
        service.detail('fleet-2', 'application-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listMine', () => {
    it('lists the person’s own applications with their Fleets, newest first', async () => {
      await expect(service.listMine('applicant-1')).resolves.toEqual([
        {
          id: 'application-1',
          fleet: { id: 'fleet-1' },
          status: FleetApplicationStatus.PENDING,
          route: FleetApplicationRoute.APPLICATION,
          characterName: 'Kell Marr@kell',
          submittedAt: stored?.submittedAt,
          decidedAt: null,
          decisionNote: null,
        },
      ]);
      expect(manager.find).toHaveBeenCalledWith(
        FleetApplicationEntity,
        expect.objectContaining({
          where: { applicantUserId: 'applicant-1' },
          order: { submittedAt: 'DESC', id: 'DESC' },
          take: 100,
        }),
      );
    });
  });
});
