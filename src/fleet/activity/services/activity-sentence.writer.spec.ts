import { EntityManager } from 'typeorm';

import { NewsPostEntity } from 'src/news/entities/news-post.entity';
import { UserProfileEntity } from 'src/user/entities/user-profile.entity';

import { InMemoryManager, Row } from '../../../../test/in-memory-manager';
import { StoArmadaEntity } from '../../entities/sto-armada.entity';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { ArmadaPosition } from '../../enums/armada-position.enum';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { FleetScopeRole } from '../../enums/fleet-scope-role.enum';
import { ScopeEventEntity } from '../../events/entities/scope-event.entity';
import { FleetHoldingTypeEntity } from '../../holdings/entities/fleet-holding-type.entity';
import { ActivityScopeDto } from '../dto/activity.dto';
import { ActivityEventEntity } from '../entities/activity-event.entity';
import { ActivityType } from '../enums/activity.enums';
import { ActivitySentenceWriter } from './activity-sentence.writer';

const FLEET_PLACE: ActivityScopeDto = {
  kind: FleetScopeKind.FLEET,
  name: 'Fixture Fleet',
  path: '/fleets/communities/ufa/fleets/windows/fixture-fleet',
};
const COMMUNITY_PLACE: ActivityScopeDto = {
  kind: FleetScopeKind.COMMUNITY,
  name: 'United Federation Alliance',
  path: '/fleets/communities/ufa',
};
const EVENT = {
  id: 'event-1',
  title: 'Fleet Night',
  timezone: 'Europe/London',
} as ScopeEventEntity;

describe('ActivitySentenceWriter', () => {
  let db: InMemoryManager;
  let writer: ActivitySentenceWriter;

  /**
   * Writes an item.
   *
   * @param row - What differs from an item with nothing to say.
   * @param place - Its scope.
   * @param source - Its source.
   * @returns What the writer made of it.
   */
  const write = (
    row: Partial<ActivityEventEntity>,
    place: ActivityScopeDto = FLEET_PLACE,
    source: Parameters<ActivitySentenceWriter['write']>[3] = null,
  ) =>
    writer.write(
      db as unknown as EntityManager,
      {
        subjectUserId: null,
        detail: null,
        ...row,
      } as ActivityEventEntity,
      place,
      source,
    );

  beforeEach(() => {
    db = new InMemoryManager();
    db.seed(UserProfileEntity, [{ userId: 'user-1', username: 'Kira' }]);
    writer = new ActivitySentenceWriter();
  });

  it('names a news post and links to it', async () => {
    await expect(
      write({ type: ActivityType.NEWS_PUBLISHED }, COMMUNITY_PLACE, {
        post: { title: 'Welcome', slug: 'welcome' } as NewsPostEntity,
      }),
    ).resolves.toEqual({
      sentence: '“Welcome” was published.',
      path: '/fleets/communities/ufa/news/welcome',
    });
  });

  describe('events', () => {
    const eventPath = `${FLEET_PLACE.path}/events/event-1`;

    it.each([
      [
        ActivityType.EVENT_CREATED,
        null,
        'Fleet Night was added to the calendar.',
      ],
      [ActivityType.EVENT_CANCELLED, null, 'Fleet Night was cancelled.'],
      [
        ActivityType.OCCURRENCE_CANCELLED,
        { startsAt: '2030-01-04T20:00:00.000Z' },
        'Fleet Night on Fri 4 Jan was cancelled.',
      ],
      // The day on the event's own clock, not the server's.
      [
        ActivityType.OCCURRENCE_MOVED,
        {
          from: '2030-07-04T23:30:00.000Z',
          to: '2030-07-06T19:30:00.000Z',
        },
        'Fleet Night on Fri 5 Jul moved to Sat 6 Jul.',
      ],
    ])('writes %s', async (type, detail, sentence) => {
      await expect(
        write({ type, detail }, FLEET_PLACE, { event: EVENT }),
      ).resolves.toEqual({ sentence, path: eventPath });
    });
  });

  describe('people', () => {
    it.each([
      [ActivityType.MEMBER_JOINED, null, 'Kira joined.'],
      [ActivityType.MEMBER_LEFT, null, 'Kira left.'],
      [ActivityType.MEMBER_REMOVED, null, 'Kira was removed.'],
      [
        ActivityType.ROLE_APPOINTED,
        { role: FleetScopeRole.OFFICER },
        'Kira was made an Officer.',
      ],
      [
        ActivityType.ROLE_WITHDRAWN,
        { role: FleetScopeRole.ADMIN },
        'Kira is no longer an Admin.',
      ],
      [
        ActivityType.OWNERSHIP_TRANSFERRED,
        null,
        'Kira now owns Fixture Fleet.',
      ],
    ])('writes %s by username', async (type, detail, sentence) => {
      await expect(
        write({ type, detail, subjectUserId: 'user-1' }),
      ).resolves.toEqual({ sentence, path: FLEET_PLACE.path });
    });

    it('calls a role it was not told a Member', async () => {
      await expect(
        write({ type: ActivityType.ROLE_APPOINTED, subjectUserId: 'user-1' }),
      ).resolves.toEqual(
        expect.objectContaining({ sentence: 'Kira was made a Member.' }),
      );
    });

    it.each([
      ['nobody is named', null],
      ['they have no username', 'user-2'],
    ])('says Somebody when %s', async (_label, subjectUserId) => {
      await expect(
        write({ type: ActivityType.MEMBER_JOINED, subjectUserId }),
      ).resolves.toEqual(
        expect.objectContaining({ sentence: 'Somebody joined.' }),
      );
    });
  });

  it('counts a roster import, naming nobody', async () => {
    await expect(
      write({
        type: ActivityType.ROSTER_IMPORTED,
        detail: { members: 48, joined: 3, left: 1 },
      }),
    ).resolves.toEqual({
      sentence:
        'A roster export was imported: 48 members, 3 joined and 1 left.',
      path: `${FLEET_PLACE.path}/history`,
    });
  });

  describe('holdings', () => {
    it('names the holding and links to them', async () => {
      db.seed(FleetHoldingTypeEntity, [{ code: 'STARBASE', name: 'Starbase' }]);

      await expect(
        write({
          type: ActivityType.HOLDINGS_RECORDED,
          detail: { holdingCode: 'STARBASE' },
        }),
      ).resolves.toEqual({
        sentence: 'Starbase tiers were recorded.',
        path: `${FLEET_PLACE.path}/holdings`,
      });
    });

    it('leaves out a holding that has gone', async () => {
      await expect(
        write({
          type: ActivityType.HOLDINGS_RECORDED,
          detail: { holdingCode: 'STARBASE' },
        }),
      ).resolves.toBeNull();
    });
  });

  describe('Armadas', () => {
    const detail = (
      from: ArmadaPosition | null,
      to: ArmadaPosition | null,
    ) => ({
      fleetId: 'fleet-1',
      armadaId: 'armada-1',
      from,
      to,
    });

    beforeEach(() => {
      db.seed(StoFleetEntity, [
        { id: 'fleet-1', exactGameName: 'Fixture Fleet' } as Row,
      ]);
      db.seed(StoArmadaEntity, [
        {
          id: 'armada-1',
          exactGameName: 'Fixture Armada',
          slug: 'fixture-armada',
          platform: { name: 'Windows' },
        } as Row,
      ]);
    });

    it.each([
      [
        ActivityType.ARMADA_FLEET_PLACED,
        detail(null, ArmadaPosition.BETA),
        'Fixture Fleet joined Fixture Armada as a Beta.',
      ],
      [
        ActivityType.ARMADA_FLEET_MOVED,
        detail(ArmadaPosition.GAMMA, ArmadaPosition.ALPHA),
        'Fixture Fleet moved from a Gamma to the Alpha in Fixture Armada.',
      ],
      [
        ActivityType.ARMADA_FLEET_LEFT,
        detail(ArmadaPosition.BETA, null),
        'Fixture Fleet left Fixture Armada.',
      ],
    ])('writes %s, linking to the Armada', async (type, detail, sentence) => {
      await expect(write({ type, detail })).resolves.toEqual({
        sentence,
        path: '/fleets/communities/ufa/armadas/windows/fixture-armada',
      });
    });

    it.each([
      ['Fleet', StoFleetEntity],
      ['Armada', StoArmadaEntity],
    ])('leaves out one whose %s has gone', async (_label, entity) => {
      db.rows(entity).splice(0);

      await expect(
        write({
          type: ActivityType.ARMADA_FLEET_LEFT,
          detail: detail(ArmadaPosition.BETA, null),
        }),
      ).resolves.toBeNull();
    });
  });

  it('says a scope was closed', async () => {
    await expect(
      write({ type: ActivityType.SCOPE_CLOSED }, COMMUNITY_PLACE),
    ).resolves.toEqual({
      sentence: 'United Federation Alliance was closed.',
      path: COMMUNITY_PLACE.path,
    });
  });
});
