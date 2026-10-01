import { EntityManager } from 'typeorm';

import { CurrentContextHelper } from 'src/shared/context/current-context.helper';

import { SiteAdminActionEntity } from './site-admin-action.entity';
import { SiteAdminActionKind } from './site-admin-action.enum';

/** One site admin action, as its caller describes it. */
export interface SiteAdminActionEntry {
  readonly action: SiteAdminActionKind;
  /** The site admin, or null for what the system does itself (FC-042). */
  readonly actorUserId: string | null;
  /** The account it acted on, when it acted on one. */
  readonly targetUserId?: string | null;
  /** The record it acted on, when not an account: a kind and an ID. */
  readonly subject?: { readonly kind: string; readonly id: string } | null;
  readonly reason: string;
  /** Codes, states and IDs; never anything a person wrote. */
  readonly detail?: Record<string, unknown> | null;
}

/**
 * Records a site admin action in the caller's transaction (FC-039), with the
 * request's IP address, which the audit policy forgets after 90 days.
 *
 * @param manager - The transaction making the change.
 * @param entry - The action.
 */
export async function recordSiteAdminAction(
  manager: EntityManager,
  entry: SiteAdminActionEntry,
): Promise<void> {
  await manager.insert(SiteAdminActionEntity, {
    action: entry.action,
    actorUserId: entry.actorUserId,
    targetUserId: entry.targetUserId ?? null,
    subjectKind: entry.subject?.kind ?? null,
    subjectId: entry.subject?.id ?? null,
    reason: entry.reason,
    detail: (entry.detail ?? null) as never,
    ipAddress: CurrentContextHelper.ip,
  });
}
