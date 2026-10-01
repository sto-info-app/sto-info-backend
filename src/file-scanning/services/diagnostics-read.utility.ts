import { EntityManager } from 'typeorm';

import { SiteAdminActionKind } from 'src/audit/site-admin/site-admin-action.enum';
import { recordSiteAdminAction } from 'src/audit/site-admin/site-admin-action.utility';

/** What a site admin read on Scan Diagnostics (FC-042). */
export type DiagnosticsReadSubject =
  'DIAGNOSTICS' | 'REJECTIONS' | 'ASSET' | 'FAILED_JOBS';

/**
 * The fixed reason each read is logged with. A read takes no reason from
 * the site admin: looking is the reason.
 */
export const DIAGNOSTICS_READ_REASONS: Readonly<
  Record<DiagnosticsReadSubject, string>
> = {
  DIAGNOSTICS: 'Read Scan Diagnostics',
  REJECTIONS: 'Read the refused assets on Scan Diagnostics',
  ASSET: 'Read an asset’s scan outcome on Scan Diagnostics',
  FAILED_JOBS: 'Read the failed jobs on Scan Diagnostics',
};

/**
 * Logs one read of Scan Diagnostics in the site admin log (FC-042).
 *
 * Steve's decision of 30 September 2026: the diagnostics stay ADMIN-only,
 * and every read of them is logged. The subject is the asset read, when one
 * was; otherwise `ALL`, since the site admin log keeps a subject whole or not
 * at all. The detail says which page, and which queue, never anything read.
 *
 * @param manager - The database.
 * @param adminUserId - The site admin reading.
 * @param subject - What was read.
 * @param subjectId - The asset read, when one was.
 * @param detail - Which page and queue.
 */
export async function recordDiagnosticsRead(
  manager: EntityManager,
  adminUserId: string,
  subject: DiagnosticsReadSubject,
  subjectId: string | null = null,
  detail: Record<string, string | number> | null = null,
): Promise<void> {
  await recordSiteAdminAction(manager, {
    action: SiteAdminActionKind.SCAN_DIAGNOSTICS_VIEWED,
    actorUserId: adminUserId,
    subject: { kind: subject, id: subjectId ?? 'ALL' },
    reason: DIAGNOSTICS_READ_REASONS[subject],
    detail,
  });
}
