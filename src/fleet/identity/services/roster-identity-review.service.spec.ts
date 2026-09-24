import { ConflictException, Logger, NotFoundException } from '@nestjs/common';

import { DataSource, EntityTarget, FindOperator } from 'typeorm';

import { RosterImportSourceEntity } from '../../imports/entities/roster-import-source.entity';
import { RosterIdentityAliasEntity } from '../entities/roster-identity-alias.entity';
import { RosterIdentityCandidateEntity } from '../entities/roster-identity-candidate.entity';
import { RosterIdentityDecisionEntity } from '../entities/roster-identity-decision.entity';
import { RosterIdentityCandidateKind } from '../enums/roster-identity-candidate-kind.enum';
import { RosterIdentityCandidateState } from '../enums/roster-identity-candidate-state.enum';
import { RosterIdentityCollisionReason } from '../enums/roster-identity-collision-reason.enum';
import { RosterIdentityConfidence } from '../enums/roster-identity-confidence.enum';
import { RosterIdentityDecisionAction } from '../enums/roster-identity-decision-action.enum';
import { RosterIdentitySignal } from '../enums/roster-identity-signal.enum';
import { RosterIdentityQueueService } from './roster-identity-queue.service';
import { RosterIdentityReviewService } from './roster-identity-review.service';

const FLEET_ID = 'fleet-1';
const CANDIDATE_ID = 'candidate-1';
const USER_ID = 'user-1';

describe('RosterIdentityReviewService', () => {
  let candidate: RosterIdentityCandidateEntity;
  let manager: {
    findAndCount: jest.Mock;
    findOne: jest.Mock;
    findOneOrFail: jest.Mock;
    find: jest.Mock;
    insert: jest.Mock;
    update: jest.Mock;
    query: jest.Mock;
  };
  let queue: { enqueue: jest.Mock };
  let service: RosterIdentityReviewService;
  let decisions: Array<Partial<RosterIdentityDecisionEntity>>;

  const alias = (
    id: string,
    characterName: string,
  ): Partial<RosterIdentityAliasEntity> => ({
    id,
    identityId: `identity-${id}`,
    characterName,
    accountHandle: '@one',
    firstObservedAt: new Date('2024-01-01T00:00:00Z'),
    lastObservedAt: new Date('2024-01-01T00:00:00Z'),
  });

  beforeEach(() => {
    candidate = Object.assign(new RosterIdentityCandidateEntity(), {
      id: CANDIDATE_ID,
      fleetId: FLEET_ID,
      kind: RosterIdentityCandidateKind.CHARACTER_RENAME,
      state: RosterIdentityCandidateState.OPEN,
      fromAliasId: 'alias-a',
      toAliasId: 'alias-b',
      fromHandleNormalised: null,
      toHandleNormalised: null,
      earlierImportId: 'import-1',
      laterImportId: 'import-2',
      confidence: RosterIdentityConfidence.HIGH,
      signals: [{ signal: RosterIdentitySignal.LEVEL_NOT_LOWER, held: true }],
      collisionReasons: [],
      stale: false,
      revision: 0,
      createdAt: new Date('2024-03-01T00:00:00Z'),
      links: [
        {
          candidateId: CANDIDATE_ID,
          fromAliasId: 'alias-a',
          toAliasId: 'alias-b',
        },
      ],
    });
    decisions = [];

    manager = {
      findAndCount: jest.fn(() => Promise.resolve([[candidate], 1])),
      findOne: jest.fn(() => Promise.resolve(candidate)),
      findOneOrFail: jest.fn(() => Promise.resolve(candidate)),
      find: jest.fn((entity: EntityTarget<unknown>) => {
        switch (entity) {
          case RosterIdentityAliasEntity:
            return Promise.resolve([
              alias('alias-a', 'Kira'),
              alias('alias-b', 'Nerys'),
            ]);
          case RosterImportSourceEntity:
            return Promise.resolve([
              { id: 'import-1', exportedAt: new Date('2024-01-01T00:00:00Z') },
            ]);
          default:
            return Promise.resolve(decisions);
        }
      }),
      insert: jest.fn(() => Promise.resolve()),
      update: jest.fn(
        (_entity: unknown, _criteria: unknown, values: object) => {
          Object.assign(candidate, values);

          return Promise.resolve();
        },
      ),
      query: jest.fn(() => Promise.resolve([])),
    };
    queue = { enqueue: jest.fn(() => Promise.resolve()) };

    service = new RosterIdentityReviewService(
      {
        manager,
        transaction: jest.fn((work: (m: unknown) => Promise<unknown>) =>
          work(manager),
        ),
      } as unknown as DataSource,
      queue as unknown as RosterIdentityQueueService,
    );

    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('listing', () => {
    it('reads one Fleet, open ones first, newest first within', async () => {
      await service.list(FLEET_ID, {});

      expect(manager.findAndCount).toHaveBeenCalledWith(
        RosterIdentityCandidateEntity,
        {
          where: { fleetId: FLEET_ID },
          relations: { links: true },
          order: { state: 'ASC', createdAt: 'DESC', id: 'DESC' },
          skip: 0,
          take: 20,
        },
      );
    });

    it('narrows to one state, and pages', async () => {
      await service.list(FLEET_ID, {
        state: RosterIdentityCandidateState.CONFIRMED,
        page: 3,
        pageSize: 10,
      });

      expect(manager.findAndCount).toHaveBeenCalledWith(
        RosterIdentityCandidateEntity,
        expect.objectContaining({
          where: {
            fleetId: FLEET_ID,
            state: RosterIdentityCandidateState.CONFIRMED,
          },
          skip: 20,
          take: 10,
        }),
      );
    });

    it('describes each candidate with its names, exports and history', async () => {
      decisions = [
        {
          candidateId: CANDIDATE_ID,
          action: RosterIdentityDecisionAction.UNDO,
          fromState: RosterIdentityCandidateState.CONFIRMED,
          toState: RosterIdentityCandidateState.OPEN,
          revision: 2,
          reason: 'Two different people',
          decidedAt: new Date('2024-03-03T00:00:00Z'),
          actor: null,
        },
        {
          candidateId: CANDIDATE_ID,
          action: RosterIdentityDecisionAction.CONFIRM,
          fromState: RosterIdentityCandidateState.OPEN,
          toState: RosterIdentityCandidateState.CONFIRMED,
          revision: 1,
          reason: null,
          decidedAt: new Date('2024-03-02T00:00:00Z'),
          actor: { profile: { username: 'Sisko' } } as never,
        },
        { candidateId: 'somebody-else', revision: 1 },
      ];

      const page = await service.list(FLEET_ID, {});

      expect(page).toMatchObject({ total: 1, page: 1, pageSize: 20 });
      expect(page.items).toEqual([
        {
          id: CANDIDATE_ID,
          kind: RosterIdentityCandidateKind.CHARACTER_RENAME,
          state: RosterIdentityCandidateState.OPEN,
          decidable: true,
          confidence: RosterIdentityConfidence.HIGH,
          signals: [
            { signal: RosterIdentitySignal.LEVEL_NOT_LOWER, held: true },
          ],
          collisionReasons: [],
          stale: false,
          revision: 0,
          earlier: {
            importId: 'import-1',
            exportedAt: new Date('2024-01-01T00:00:00Z'),
          },
          later: { importId: 'import-2', exportedAt: null },
          links: [
            {
              from: {
                aliasId: 'alias-a',
                identityId: 'identity-alias-a',
                characterName: 'Kira',
                accountHandle: '@one',
                firstObservedAt: new Date('2024-01-01T00:00:00Z'),
                lastObservedAt: new Date('2024-01-01T00:00:00Z'),
              },
              to: expect.objectContaining({
                aliasId: 'alias-b',
                characterName: 'Nerys',
              }),
            },
          ],
          decisions: [
            expect.objectContaining({
              action: RosterIdentityDecisionAction.UNDO,
              reason: 'Two different people',
              actorUsername: null,
            }),
            expect.objectContaining({
              action: RosterIdentityDecisionAction.CONFIRM,
              actorUsername: 'Sisko',
            }),
          ],
          createdAt: new Date('2024-03-01T00:00:00Z'),
        },
      ]);
    });

    it('reads names, exports and decisions once for the whole page', async () => {
      await service.list(FLEET_ID, {});

      expect(manager.find).toHaveBeenCalledTimes(3);
      expect(manager.find).toHaveBeenCalledWith(
        RosterIdentityDecisionEntity,
        expect.objectContaining({
          relations: { actor: { profile: true } },
          order: { revision: 'DESC' },
        }),
      );

      const [, aliasQuery] = manager.find.mock.calls.find(
        ([entity]) => entity === RosterIdentityAliasEntity,
      ) as [unknown, { where: { id: FindOperator<string[]> } }];

      expect(aliasQuery.where.id.value).toEqual(['alias-a', 'alias-b']);
    });

    it('lists an account rename’s Characters in name order', async () => {
      candidate.links = [
        {
          candidateId: CANDIDATE_ID,
          fromAliasId: 'alias-b',
          toAliasId: 'alias-a',
        },
        {
          candidateId: CANDIDATE_ID,
          fromAliasId: 'alias-a',
          toAliasId: 'alias-b',
        },
      ] as never;

      const { items } = await service.list(FLEET_ID, {});

      expect(items[0].links.map(link => link.from.characterName)).toEqual([
        'Kira',
        'Nerys',
      ]);
    });

    // An import removed since, and a reviewer whose account has no profile.
    it('says nothing it cannot find rather than failing', async () => {
      manager.find.mockImplementation((entity: EntityTarget<unknown>) =>
        Promise.resolve(
          entity === RosterIdentityAliasEntity
            ? [alias('alias-a', 'Kira'), alias('alias-b', 'Nerys')]
            : entity === RosterImportSourceEntity
              ? []
              : [
                  {
                    candidateId: CANDIDATE_ID,
                    revision: 1,
                    actor: {} as never,
                  },
                ],
        ),
      );

      const { items } = await service.list(FLEET_ID, {});

      expect(items[0].earlier.exportedAt).toBeNull();
      expect(items[0].decisions[0].actorUsername).toBeNull();
    });

    it('says a collision cannot be decided', async () => {
      candidate.collisionReasons = [
        RosterIdentityCollisionReason.SEVERAL_PARTNERS,
      ];

      const { items } = await service.list(FLEET_ID, {});

      expect(items[0].decidable).toBe(false);
    });

    it('says a decided one cannot be decided again', async () => {
      candidate.state = RosterIdentityCandidateState.REJECTED;

      const { items } = await service.list(FLEET_ID, {});

      expect(items[0].decidable).toBe(false);
    });

    it('reads nothing more for an empty page', async () => {
      manager.findAndCount.mockResolvedValue([[], 0]);

      await expect(service.list(FLEET_ID, {})).resolves.toMatchObject({
        items: [],
        total: 0,
      });
      expect(manager.find).not.toHaveBeenCalled();
    });
  });

  describe('deciding', () => {
    const decide = (
      action: RosterIdentityDecisionAction,
      revision = candidate.revision,
      reason?: string,
    ): ReturnType<RosterIdentityReviewService['decide']> =>
      service.decide(FLEET_ID, CANDIDATE_ID, USER_ID, {
        action,
        revision,
        reason,
      });

    it('takes the Fleet’s identity lock, then locks the candidate', async () => {
      await decide(RosterIdentityDecisionAction.CONFIRM);

      expect(manager.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [`fleet-roster-identity:${FLEET_ID}`],
      );
      expect(manager.findOne).toHaveBeenCalledWith(
        RosterIdentityCandidateEntity,
        {
          where: { id: CANDIDATE_ID, fleetId: FLEET_ID },
          lock: { mode: 'pessimistic_write' },
        },
      );
    });

    it.each([
      [
        RosterIdentityDecisionAction.CONFIRM,
        RosterIdentityCandidateState.CONFIRMED,
      ],
      [
        RosterIdentityDecisionAction.REJECT,
        RosterIdentityCandidateState.REJECTED,
      ],
    ])('records %s as the next revision', async (action, toState) => {
      const decided = await decide(action);

      expect(manager.insert).toHaveBeenCalledWith(
        RosterIdentityDecisionEntity,
        {
          candidateId: CANDIDATE_ID,
          fleetId: FLEET_ID,
          action,
          fromState: RosterIdentityCandidateState.OPEN,
          toState,
          revision: 1,
          actorUserId: USER_ID,
          reason: null,
        },
      );
      expect(manager.update).toHaveBeenCalledWith(
        RosterIdentityCandidateEntity,
        { id: CANDIDATE_ID },
        { state: toState, revision: 1 },
      );
      expect(decided).toMatchObject({ state: toState, revision: 1 });
    });

    it.each([
      RosterIdentityCandidateState.CONFIRMED,
      RosterIdentityCandidateState.REJECTED,
    ])('undoes a %s one, with its reason', async state => {
      Object.assign(candidate, { state, revision: 1 });

      await decide(RosterIdentityDecisionAction.UNDO, 1, 'Two people');

      expect(manager.insert).toHaveBeenCalledWith(
        RosterIdentityDecisionEntity,
        expect.objectContaining({
          action: RosterIdentityDecisionAction.UNDO,
          fromState: state,
          toState: RosterIdentityCandidateState.OPEN,
          revision: 2,
          reason: 'Two people',
        }),
      );
    });

    // The recompute works out which aliases share an identity from what
    // was confirmed; the decision itself touches no alias and no account.
    it('asks for the Fleet’s identities to follow, once committed', async () => {
      const order: string[] = [];

      manager.update.mockImplementation(() => {
        order.push('update');

        return Promise.resolve();
      });
      queue.enqueue.mockImplementation(() => {
        order.push('enqueue');

        return Promise.resolve();
      });

      await decide(RosterIdentityDecisionAction.CONFIRM);

      expect(order).toEqual(['update', 'enqueue']);
      expect(queue.enqueue).toHaveBeenCalledWith(FLEET_ID);
      expect(manager.update).not.toHaveBeenCalledWith(
        RosterIdentityAliasEntity,
        expect.anything(),
        expect.anything(),
      );
    });

    it('reports a candidate of another Fleet as missing', async () => {
      manager.findOne.mockResolvedValue(null);

      await expect(
        decide(RosterIdentityDecisionAction.CONFIRM),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(manager.insert).not.toHaveBeenCalled();
    });

    it('refuses a decision on a revision the reviewer did not see', async () => {
      await expect(
        decide(RosterIdentityDecisionAction.CONFIRM, 3),
      ).rejects.toThrow(/changed since you loaded it/);
      expect(manager.insert).not.toHaveBeenCalled();
      expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('refuses to decide a collision', async () => {
      candidate.collisionReasons = [
        RosterIdentityCollisionReason.SEVERAL_PARTNERS,
      ];

      await expect(decide(RosterIdentityDecisionAction.REJECT)).rejects.toThrow(
        /more than one reading/,
      );
    });

    it.each([
      [
        RosterIdentityDecisionAction.CONFIRM,
        RosterIdentityCandidateState.REJECTED,
        /Only an open candidate can be confirmed/,
      ],
      [
        RosterIdentityDecisionAction.REJECT,
        RosterIdentityCandidateState.CONFIRMED,
        /Only an open candidate can be rejected/,
      ],
      [
        RosterIdentityDecisionAction.UNDO,
        RosterIdentityCandidateState.OPEN,
        /no decision to undo/,
      ],
    ])('refuses %s from %s', async (action, state, message) => {
      candidate.state = state;

      const attempt = decide(action, 0, 'reason');

      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await expect(attempt).rejects.toThrow(message);
    });
  });
});
