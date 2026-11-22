import { EntityManager, IsNull, Not } from 'typeorm';

import { ModerationHoldEntity } from './moderation-hold.entity';
import { ModerationHoldKind } from './moderation-hold.enums';

/**
 * The members whose chat messages are held now (FC-036): the message purge
 * leaves theirs.
 *
 * @param manager - The manager to read through.
 * @returns Their IDs.
 */
export async function heldAuthors(manager: EntityManager): Promise<string[]> {
  const holds = await manager.find(ModerationHoldEntity, {
    where: {
      kind: ModerationHoldKind.MEMBER_MESSAGES,
      releasedAt: IsNull(),
      subjectUserId: Not(IsNull()),
    },
    select: { id: true, subjectUserId: true },
  });

  return holds.map(hold => hold.subjectUserId as string);
}

/**
 * The chat reports held now (FC-036): their deletion waits.
 *
 * @param manager - The manager to read through.
 * @returns Their IDs.
 */
export async function heldReports(manager: EntityManager): Promise<string[]> {
  const holds = await manager.find(ModerationHoldEntity, {
    where: { kind: ModerationHoldKind.CHAT_REPORT, releasedAt: IsNull() },
    select: { id: true, chatReportId: true },
  });

  return holds.map(hold => hold.chatReportId as string);
}

/**
 * The hold in force on a chat report, if any (FC-036).
 *
 * @param manager - The manager to read through.
 * @param chatReportId - The report.
 * @returns It, or null.
 */
export async function holdOnReport(
  manager: EntityManager,
  chatReportId: string,
): Promise<ModerationHoldEntity | null> {
  return manager.findOne(ModerationHoldEntity, {
    where: { chatReportId, releasedAt: IsNull() },
  });
}
