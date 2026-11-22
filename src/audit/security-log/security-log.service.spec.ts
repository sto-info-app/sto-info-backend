import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { DataSource } from 'typeorm';

import { ModerationHoldActionEntity } from 'src/fleet/chat/holds/moderation-hold-action.entity';
import { RosterErasureEntity } from 'src/fleet/erasure/roster-erasure.entity';
import { FleetInvestigationGrantEntity } from 'src/fleet/governance/entities/fleet-investigation-grant.entity';
import { ScopeGovernanceActionEntity } from 'src/fleet/governance/entities/scope-governance-action.entity';
import { RetentionRunEntity } from 'src/fleet/retention/retention-run.entity';
import { UserProfileEntity } from 'src/user/entities/user-profile.entity';

import { SiteAdminActionEntity } from '../site-admin/site-admin-action.entity';
import { SecurityLogSource } from './security-log.dto';
import {
  SECURITY_LOG_PAGE_SIZE,
  SecurityLogService,
} from './security-log.service';

/** Each source's table, as the metadata names it. */
const TABLES = new Map<unknown, string>([
  [SiteAdminActionEntity, 'sto_info_app.site_admin_action'],
  [ScopeGovernanceActionEntity, 'sto_info_app.scope_governance_action'],
  [ModerationHoldActionEntity, 'sto_info_app.moderation_hold_action'],
  [FleetInvestigationGrantEntity, 'sto_info_app.fleet_investigation_grant'],
  [RosterErasureEntity, 'sto_info_app.roster_erasure'],
  [RetentionRunEntity, 'sto_info_app.retention_run'],
]);

describe('SecurityLogService (FC-039)', () => {
  let query: jest.Mock<
    (sql: string, parameters?: unknown[]) => Promise<unknown>
  >;
  let find: jest.Mock<(...args: unknown[]) => Promise<unknown[]>>;
  let service: SecurityLogService;

  beforeEach(() => {
    query = jest.fn(() => Promise.resolve([{ total: 0 }]));
    find = jest.fn(() => Promise.resolve([]));
    service = new SecurityLogService({
      query,
      getMetadata: (entity: unknown) => ({ tablePath: TABLES.get(entity) }),
      manager: { find },
    } as unknown as DataSource);
  });

  /**
   * Answers the count, then the page.
   *
   * @param total - How many there are.
   * @param rows - The page's rows.
   */
  const answering = (total: number, rows: unknown[]) => {
    query
      .mockResolvedValueOnce([{ total }])
      .mockResolvedValueOnce(rows as never);
  };

  it('reads every source, newest first, a page at a time', async () => {
    answering(51, []);

    await expect(service.list(undefined, 2)).resolves.toEqual({
      items: [],
      total: 51,
      page: 2,
      pageSize: SECURITY_LOG_PAGE_SIZE,
    });

    const [count, page] = query.mock.calls;

    for (const table of TABLES.values()) {
      const [schema, name] = table.split('.');

      expect(count[0]).toContain(`FROM "${schema}"."${name}"`);
    }

    expect(count[0].split(' UNION ALL ')).toHaveLength(TABLES.size);
    expect(page[0]).toMatch(
      /ORDER BY "at" DESC, "id" DESC LIMIT \$1 OFFSET \$2$/,
    );
    expect(page[1]).toEqual([SECURITY_LOG_PAGE_SIZE, SECURITY_LOG_PAGE_SIZE]);
    // With nobody to name, it asks nobody's name.
    expect(find).not.toHaveBeenCalled();
  });

  it('reads a site admin’s Fleet actions only, not an Owner’s', async () => {
    await service.list(SecurityLogSource.FLEET);

    const [[count]] = query.mock.calls;

    expect(count).not.toContain('UNION ALL');
    expect(count).toContain('"sto_info_app"."scope_governance_action"');
    expect(count).toContain('WHERE "asSiteAdmin"');
  });

  it.each([
    [SecurityLogSource.SITE_ADMIN, 'site_admin_action'],
    [SecurityLogSource.HOLD, 'moderation_hold_action'],
    [SecurityLogSource.INVESTIGATION, 'fleet_investigation_grant'],
    [SecurityLogSource.ERASURE, 'roster_erasure'],
    [SecurityLogSource.RETENTION, 'retention_run'],
  ])('reads %s from %s alone', async (source, name) => {
    await service.list(source);

    const [[count]] = query.mock.calls;

    expect(count).not.toContain('UNION ALL');
    expect(count).toContain(`"sto_info_app"."${name}"`);
    // Read alone, it names the columns the outer query orders by.
    expect(count).toContain('"id" AS "id"');
    expect(count).toMatch(/ AS "at"/);
    expect(count).toMatch(/ AS "detail" FROM /);
  });

  it('names each actor and target it can, and keeps the entry as its log wrote it', async () => {
    const at = '2026-09-29T10:00:00.000Z';

    answering(2, [
      {
        source: SecurityLogSource.SITE_ADMIN,
        id: 'entry-1',
        at,
        action: 'USER_DISABLED',
        actorUserId: 'admin-1',
        targetUserId: 'gone-1',
        subjectKind: null,
        subjectId: null,
        reason: 'Spamming',
        detail: null,
      },
      {
        source: SecurityLogSource.RETENTION,
        id: 'run-1',
        at,
        action: 'CHAT',
        actorUserId: null,
        targetUserId: null,
        subjectKind: null,
        subjectId: null,
        reason: null,
        detail: { counts: { messages: 3 }, complete: true },
      },
    ]);
    find.mockResolvedValue([{ userId: 'admin-1', username: 'Admiral' }]);

    const { items } = await service.list(undefined);

    expect(find).toHaveBeenCalledWith(
      UserProfileEntity,
      expect.objectContaining({ select: { userId: true, username: true } }),
    );
    expect(items).toEqual([
      {
        source: SecurityLogSource.SITE_ADMIN,
        id: 'entry-1',
        at: new Date(at),
        action: 'USER_DISABLED',
        actor: { userId: 'admin-1', username: 'Admiral' },
        target: { userId: 'gone-1', username: null },
        subjectKind: null,
        subjectId: null,
        reason: 'Spamming',
        detail: null,
      },
      expect.objectContaining({
        source: SecurityLogSource.RETENTION,
        actor: null,
        target: null,
        detail: { counts: { messages: 3 }, complete: true },
      }),
    ]);
  });
});
