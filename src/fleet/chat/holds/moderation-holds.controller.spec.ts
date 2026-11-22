import { PATH_METADATA } from '@nestjs/common/constants';

import { describe, expect, it, jest } from '@jest/globals';

import { ROLES_KEY } from 'src/auth/roles.decorator';
import { UserRole } from 'src/user/enums/user-role.enum';

import { ModerationHoldKind } from './moderation-hold.enums';
import { ModerationHoldService } from './moderation-hold.service';
import { ModerationHoldsController } from './moderation-holds.controller';

const HOLD_ID = '31000000-0000-4000-8000-0000000000b1';
const ADMIN_ID = '31000000-0000-4000-8000-0000000000a1';

describe('ModerationHoldsController', () => {
  it('is for site admins, at admin/moderation-holds', () => {
    expect(Reflect.getMetadata(ROLES_KEY, ModerationHoldsController)).toEqual([
      UserRole.ADMIN,
    ]);
    expect(Reflect.getMetadata(PATH_METADATA, ModerationHoldsController)).toBe(
      'admin/moderation-holds',
    );
  });

  it('passes each route to the service', async () => {
    const answer = jest.fn(() => Promise.resolve('answer'));
    const holds = {
      list: answer,
      place: answer,
      detail: answer,
      extend: answer,
      release: answer,
      read: answer,
    };
    const controller = new ModerationHoldsController(
      holds as unknown as ModerationHoldService,
    );
    const place = {
      kind: ModerationHoldKind.MEMBER_MESSAGES,
      subjectUserId: ADMIN_ID,
      reason: 'Why',
    };
    const extend = { reviewAt: new Date(), reason: 'Why' };
    const read = { purpose: 'Reviewing the case' };

    await expect(controller.list({ active: true })).resolves.toBe('answer');
    await expect(controller.place(ADMIN_ID, place)).resolves.toBe('answer');
    await expect(controller.detail(HOLD_ID)).resolves.toBe('answer');
    await expect(controller.extend(HOLD_ID, ADMIN_ID, extend)).resolves.toBe(
      'answer',
    );
    await expect(
      controller.release(HOLD_ID, ADMIN_ID, { reason: 'Done' }),
    ).resolves.toBe('answer');
    await expect(controller.read(HOLD_ID, ADMIN_ID, read)).resolves.toBe(
      'answer',
    );

    expect(answer.mock.calls).toEqual([
      [true],
      [ADMIN_ID, place],
      [HOLD_ID],
      [HOLD_ID, ADMIN_ID, extend],
      [HOLD_ID, ADMIN_ID, 'Done'],
      [HOLD_ID, ADMIN_ID, read],
    ]);
  });
});
