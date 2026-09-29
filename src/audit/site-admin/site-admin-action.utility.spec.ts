import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { EntityManager } from 'typeorm';

import { CurrentContextHelper } from 'src/shared/context/current-context.helper';

import { SiteAdminActionEntity } from './site-admin-action.entity';
import { SiteAdminActionKind } from './site-admin-action.enum';
import { recordSiteAdminAction } from './site-admin-action.utility';

describe('recordSiteAdminAction (FC-039)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * A transaction that keeps what it is given.
   *
   * @returns It, and its insert.
   */
  const transaction = () => {
    const insert = jest.fn<(...args: unknown[]) => Promise<void>>(() =>
      Promise.resolve(),
    );

    return { manager: { insert } as unknown as EntityManager, insert };
  };

  it('writes the action in the caller’s transaction, with the request’s IP address', async () => {
    jest.spyOn(CurrentContextHelper, 'ip', 'get').mockReturnValue('192.0.2.7');
    const { manager, insert } = transaction();

    await recordSiteAdminAction(manager, {
      action: SiteAdminActionKind.CUSTOM_TRACKING_SUPPRESSED,
      actorUserId: 'admin-1',
      targetUserId: 'owner-1',
      subject: { kind: 'CUSTOM_TRACKING_FIELD', id: 'field-1' },
      reason: 'Offensive name',
      detail: { level: 'FIELD' },
    });

    expect(insert).toHaveBeenCalledWith(SiteAdminActionEntity, {
      action: SiteAdminActionKind.CUSTOM_TRACKING_SUPPRESSED,
      actorUserId: 'admin-1',
      targetUserId: 'owner-1',
      subjectKind: 'CUSTOM_TRACKING_FIELD',
      subjectId: 'field-1',
      reason: 'Offensive name',
      detail: { level: 'FIELD' },
      ipAddress: '192.0.2.7',
    });
  });

  it('leaves out what the action has none of, and an IP address outside a request', async () => {
    jest.spyOn(CurrentContextHelper, 'ip', 'get').mockReturnValue(null);
    const { manager, insert } = transaction();

    await recordSiteAdminAction(manager, {
      action: SiteAdminActionKind.USER_ENABLED,
      actorUserId: 'admin-1',
      reason: 'Appeal upheld',
    });

    expect(insert).toHaveBeenCalledWith(SiteAdminActionEntity, {
      action: SiteAdminActionKind.USER_ENABLED,
      actorUserId: 'admin-1',
      targetUserId: null,
      subjectKind: null,
      subjectId: null,
      reason: 'Appeal upheld',
      detail: null,
      ipAddress: null,
    });
  });
});
