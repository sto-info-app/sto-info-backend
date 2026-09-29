import { jest } from '@jest/globals';
import { EntityManager } from 'typeorm';

import { NotificationSeverity } from 'src/notification/enums/notification-severity.enum';
import { NotificationOutboxKind } from 'src/notification/outbox/notification-outbox-kind.enum';
import { NotificationOutboxEntity } from 'src/notification/outbox/notification-outbox.entity';
import { NotificationOutboxRegistry } from 'src/notification/outbox/notification-outbox.registry';

import { FleetAudienceService } from '../../authorisation/fleet-audience.service';
import { CharacterFleetProposalEntity } from '../../entities/character-fleet-proposal.entity';
import { CharacterFleetProposalStatus } from '../../enums/character-fleet-proposal-status.enum';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { ProposalNoticeHandler } from './proposal-notice.handler';

const OWNER_ID = 'owner-1';
const NOW = new Date('2026-09-28T12:00:00.000Z');
const NOTICE = {
  userId: OWNER_ID,
  kind: NotificationOutboxKind.ROSTER_ASSOCIATION_PROPOSED,
  subjectId: 'proposal-1',
} as NotificationOutboxEntity;

describe('ProposalNoticeHandler', () => {
  let proposal: Record<string, unknown> | null;
  let manager: { findOne: jest.Mock<() => Promise<unknown>> };
  let audience: { canViewScope: jest.Mock<() => Promise<boolean>> };
  let registry: { register: jest.Mock };
  let handler: ProposalNoticeHandler;
  const site = process.env.APP_FRONTEND_URL;

  beforeEach(() => {
    process.env.APP_FRONTEND_URL = 'https://sto.example';
    proposal = {
      id: 'proposal-1',
      fleetId: 'fleet-1',
      status: CharacterFleetProposalStatus.PENDING,
      expiresAt: new Date('2026-10-28T12:00:00.000Z'),
      character: {
        handle: 'Kira Nerys',
        fullHandle: 'Kira Nerys@kira#1234',
        account: { userId: OWNER_ID, handle: '@kira#1234' },
      },
      fleet: { exactGameName: 'Fixture Fleet' },
    };
    manager = { findOne: jest.fn(async () => proposal) };
    audience = { canViewScope: jest.fn(async () => true) };
    registry = { register: jest.fn() };
    handler = new ProposalNoticeHandler(
      registry as unknown as NotificationOutboxRegistry,
      audience as unknown as FleetAudienceService,
    );
  });

  afterEach(() => {
    process.env.APP_FRONTEND_URL = site;
  });

  const compose = () =>
    handler.compose(NOTICE, manager as unknown as EntityManager, NOW);

  it('registers for proposals with the outbox', () => {
    handler.onModuleInit();

    expect(registry.register).toHaveBeenCalledWith(handler);
    expect(handler.kinds).toEqual([
      NotificationOutboxKind.ROSTER_ASSOCIATION_PROPOSED,
    ]);
  });

  it('asks the owner, linking to the Character’s page', async () => {
    await expect(compose()).resolves.toEqual({
      title: 'Is Kira Nerys@kira#1234 in Fixture Fleet?',
      body:
        'Fixture Fleet has asked whether Kira Nerys@kira#1234 is one of its ' +
        'members. Confirm or decline it on the Character’s page by ' +
        '28 October 2026.',
      severity: NotificationSeverity.INFO,
      linkUrl:
        'https://sto.example/dashboard/accounts/%40kira~1234/Kira%20Nerys',
    });
    expect(manager.findOne).toHaveBeenCalledWith(CharacterFleetProposalEntity, {
      where: { id: 'proposal-1' },
      relations: { character: { account: true }, fleet: true },
    });
    expect(audience.canViewScope).toHaveBeenCalledWith(
      { kind: FleetScopeKind.FLEET, id: 'fleet-1' },
      OWNER_ID,
    );
  });

  it('sends no link without a site address', async () => {
    delete process.env.APP_FRONTEND_URL;

    await expect(compose()).resolves.toEqual(
      expect.objectContaining({ linkUrl: null }),
    );
  });

  it.each([
    ['it has gone', () => (proposal = null)],
    ['its Fleet has gone', () => (proposal!.fleet = null)],
    [
      'it was answered',
      () => (proposal!.status = CharacterFleetProposalStatus.DECLINED),
    ],
    [
      'it has expired',
      () => (proposal!.expiresAt = new Date('2026-09-01T00:00:00.000Z')),
    ],
    [
      'the Character is somebody else’s now',
      () =>
        ((proposal!.character as { account: { userId: string } }).account = {
          userId: 'somebody-else',
        }),
    ],
    ['its account has gone', () => (proposal!.character = {})],
  ])('sets it aside when %s', async (_label, arrange) => {
    arrange();

    await expect(compose()).resolves.toBeNull();
    expect(audience.canViewScope).not.toHaveBeenCalled();
  });

  it('sets it aside while the owner may not see the Fleet', async () => {
    audience.canViewScope.mockResolvedValue(false);

    await expect(compose()).resolves.toBeNull();
  });
});
