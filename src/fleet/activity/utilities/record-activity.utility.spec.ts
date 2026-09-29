import { InMemoryManager } from '../../../../test/in-memory-manager';
import { ActivityEventEntity } from '../entities/activity-event.entity';
import { ActivityType, ActivityVisibility } from '../enums/activity.enums';
import { recordActivity } from './record-activity.utility';

const AT = new Date('2026-09-28T12:00:00.000Z');

describe('recordActivity', () => {
  let db: InMemoryManager;

  beforeEach(() => {
    db = new InMemoryManager();
  });

  it('records each item with its type’s visibility, filling what was not said', async () => {
    await recordActivity(db.asManager(), [
      {
        communityId: 'community-1',
        type: ActivityType.MEMBER_JOINED,
        idempotencyKey: 'MEMBER_JOINED:action-1',
        occurredAt: AT,
      },
      {
        communityId: 'community-1',
        fleetId: 'fleet-1',
        armadaId: null,
        type: ActivityType.HOLDINGS_RECORDED,
        actorUserId: 'user-1',
        subjectUserId: 'user-2',
        sourceId: 'change-1',
        detail: { holdingCode: 'STARBASE' },
        idempotencyKey: 'HOLDINGS_RECORDED:change-1',
        occurredAt: AT,
      },
    ]);

    expect(db.rows(ActivityEventEntity)).toEqual([
      {
        id: expect.any(String),
        communityId: 'community-1',
        fleetId: null,
        armadaId: null,
        type: ActivityType.MEMBER_JOINED,
        visibility: ActivityVisibility.MEMBERS,
        actorUserId: null,
        subjectUserId: null,
        sourceId: null,
        detail: null,
        idempotencyKey: 'MEMBER_JOINED:action-1',
        occurredAt: AT,
      },
      expect.objectContaining({
        fleetId: 'fleet-1',
        visibility: ActivityVisibility.SCOPE,
        actorUserId: 'user-1',
        subjectUserId: 'user-2',
        sourceId: 'change-1',
        detail: { holdingCode: 'STARBASE' },
      }),
    ]);
  });

  it('records an item once, however often it is replayed', async () => {
    const item = {
      communityId: 'community-1',
      type: ActivityType.ROSTER_IMPORTED,
      idempotencyKey: 'ROSTER_IMPORTED:import-1',
      occurredAt: AT,
    };

    await recordActivity(db.asManager(), [item]);
    await recordActivity(db.asManager(), [item]);

    expect(db.rows(ActivityEventEntity)).toHaveLength(1);
  });

  it('asks nothing of the database for nothing', async () => {
    const createQueryBuilder = jest.spyOn(db, 'createQueryBuilder');

    await recordActivity(db.asManager(), []);

    expect(createQueryBuilder).not.toHaveBeenCalled();
  });
});
