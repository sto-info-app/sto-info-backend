import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, EntityTarget } from 'typeorm';

import { ModerationHoldActionEntity } from 'src/fleet/chat/holds/moderation-hold-action.entity';
import { RosterErasureEntity } from 'src/fleet/erasure/roster-erasure.entity';
import { FleetInvestigationGrantEntity } from 'src/fleet/governance/entities/fleet-investigation-grant.entity';
import { ScopeGovernanceActionEntity } from 'src/fleet/governance/entities/scope-governance-action.entity';
import { usernamesFor } from 'src/fleet/recruitment/utilities/recruitment-names.utility';
import { RetentionRunEntity } from 'src/fleet/retention/retention-run.entity';

import { SiteAdminActionEntity } from '../site-admin/site-admin-action.entity';
import {
  SecurityLogEntryDto,
  SecurityLogPageDto,
  SecurityLogPersonDto,
  SecurityLogSource,
} from './security-log.dto';

/** How many entries a page of the Security Log holds. */
export const SECURITY_LOG_PAGE_SIZE = 50;

/** The columns every source is read into, in order. */
const SECURITY_LOG_COLUMNS = [
  'source',
  'id',
  'at',
  'action',
  'actorUserId',
  'targetUserId',
  'subjectKind',
  'subjectId',
  'reason',
  'detail',
] as const;

/** One entry, as the union reads it. */
interface SecurityLogRow {
  readonly source: SecurityLogSource;
  readonly id: string;
  readonly at: Date;
  readonly action: string;
  readonly actorUserId: string | null;
  readonly targetUserId: string | null;
  readonly subjectKind: string | null;
  readonly subjectId: string | null;
  readonly reason: string | null;
  readonly detail: Record<string, unknown> | null;
}

/**
 * The site admins' Security Log (FC-039).
 *
 * Steve's decision of 29 September 2026: one filterable, paged feed of what
 * site admins did and what the retention jobs did — actor, time, scope or
 * subject, action and reason — read from the logs that already hold each:
 *
 * - the site admin log (`site_admin_action`);
 * - a site admin's dispute actions in the Fleet governance log;
 * - hold actions, including each reading and its purpose;
 * - a site admin's looks into a Fleet;
 * - roster erasures;
 * - retention runs.
 *
 * Each source keeps its own retention; the feed adds none. Nothing in it is
 * content: reasons and purposes are the admins' own words, and details are
 * codes, states, counts and IDs.
 */
@Injectable()
export class SecurityLogService {
  /**
   * Creates an instance of SecurityLogService.
   *
   * @param _dataSource - The database.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
  ) {}

  /**
   * A page of the log, newest first.
   *
   * @param source - One source only, or every one.
   * @param page - Which page, from 1.
   * @returns The page.
   */
  async list(
    source: SecurityLogSource | undefined,
    page = 1,
  ): Promise<SecurityLogPageDto> {
    const union = this.union(source);
    const [{ total }] = (await this._dataSource.query(
      `SELECT count(*)::int AS "total" FROM (${union}) AS "log"`,
    )) as Array<{ total: number }>;
    const rows = (await this._dataSource.query(
      `SELECT * FROM (${union}) AS "log" ORDER BY "at" DESC, "id" DESC LIMIT $1 OFFSET $2`,
      [SECURITY_LOG_PAGE_SIZE, (page - 1) * SECURITY_LOG_PAGE_SIZE],
    )) as SecurityLogRow[];
    const names = await usernamesFor(
      this._dataSource.manager,
      rows.flatMap(row => [row.actorUserId, row.targetUserId]),
    );
    const person = (userId: string | null): SecurityLogPersonDto | null =>
      userId === null ? null : { userId, username: names.get(userId) ?? null };

    return {
      items: rows.map((row): SecurityLogEntryDto => ({
        source: row.source,
        id: row.id,
        at: new Date(row.at),
        action: row.action,
        actor: person(row.actorUserId),
        target: person(row.targetUserId),
        subjectKind: row.subjectKind,
        subjectId: row.subjectId,
        reason: row.reason,
        detail: row.detail,
      })),
      total,
      page,
      pageSize: SECURITY_LOG_PAGE_SIZE,
    };
  }

  /**
   * The union of every source asked for, each read into the same columns.
   *
   * @param source - One source only, or every one.
   * @returns The SQL.
   */
  private union(source: SecurityLogSource | undefined): string {
    const table = (entity: EntityTarget<unknown>): string => {
      const [schema, name] = this._dataSource
        .getMetadata(entity)
        .tablePath.split('.');

      return `"${schema}"."${name}"`;
    };
    // Every source names every column itself, so one read alone has the
    // names the outer query orders and pages by.
    const select = (values: readonly string[], from: string): string =>
      `SELECT ${values
        .map((value, index) => `${value} AS "${SECURITY_LOG_COLUMNS[index]}"`)
        .join(', ')} FROM ${from}`;
    const selects: Record<SecurityLogSource, string> = {
      [SecurityLogSource.SITE_ADMIN]: select(
        [
          `'SITE_ADMIN'`,
          '"id"',
          '"createdAt"',
          '"action"::text',
          '"actorUserId"',
          '"targetUserId"',
          '"subjectKind"::text',
          '"subjectId"::text',
          '"reason"::text',
          '"detail"',
        ],
        table(SiteAdminActionEntity),
      ),
      [SecurityLogSource.FLEET]: select(
        [
          `'FLEET'`,
          '"id"',
          '"createdAt"',
          '"action"::text',
          '"actorUserId"',
          '"subjectUserId"',
          `CASE WHEN "armadaId" IS NOT NULL THEN 'ARMADA' WHEN "fleetId" IS NOT NULL THEN 'FLEET' ELSE 'COMMUNITY' END`,
          'COALESCE("armadaId", "fleetId", "communityId")::text',
          '"reason"::text',
          `jsonb_build_object('communityId', "communityId")`,
        ],
        `${table(ScopeGovernanceActionEntity)} WHERE "asSiteAdmin"`,
      ),
      [SecurityLogSource.HOLD]: select(
        [
          `'HOLD'`,
          '"id"',
          '"createdAt"',
          '"action"::text',
          '"actorUserId"',
          'NULL::uuid',
          `'MODERATION_HOLD'`,
          '"holdId"::text',
          '"reason"::text',
          '"detail"',
        ],
        table(ModerationHoldActionEntity),
      ),
      [SecurityLogSource.INVESTIGATION]: select(
        [
          `'INVESTIGATION'`,
          '"id"',
          '"createdAt"',
          `'LOOKED_INTO_FLEET'`,
          '"adminUserId"',
          'NULL::uuid',
          `'FLEET'`,
          '"fleetId"::text',
          '"purpose"::text',
          `jsonb_build_object('expiresAt', "expiresAt")`,
        ],
        table(FleetInvestigationGrantEntity),
      ),
      [SecurityLogSource.ERASURE]: select(
        [
          `'ERASURE'`,
          '"id"',
          '"createdAt"',
          `CASE WHEN "replayed" THEN 'REPLAYED' ELSE 'ERASED' END`,
          '"adminUserId"',
          'NULL::uuid',
          `'ROSTER_ERASURE'`,
          '"id"::text',
          '"reason"::text',
          '"counts"',
        ],
        table(RosterErasureEntity),
      ),
      [SecurityLogSource.RETENTION]: select(
        [
          `'RETENTION'`,
          '"id"',
          '"startedAt"',
          '"job"::text',
          'NULL::uuid',
          'NULL::uuid',
          'NULL::text',
          'NULL::text',
          '"error"::text',
          `jsonb_build_object('counts', "counts", 'complete', "complete", 'finishedAt', "finishedAt")`,
        ],
        table(RetentionRunEntity),
      ),
    };

    return (source === undefined ? Object.values(selects) : [selects[source]])
      .map(select => `(${select})`)
      .join(' UNION ALL ');
  }
}
