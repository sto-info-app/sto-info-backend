import { describe, expect, it, jest } from '@jest/globals';

import { UserRole } from 'src/user/enums/user-role.enum';

import { RosterErasureService } from './roster-erasure.service';
import { RosterErasuresController } from './roster-erasures.controller';

describe('RosterErasuresController (FC-038)', () => {
  const erasures = {
    list: jest.fn(async () => []),
    preview: jest.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
      alreadyErased: false,
      rows: 0,
      fleets: [],
    })),
    erase: jest.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
      id: 'e1',
    })),
  };
  const controller = new RosterErasuresController(
    erasures as unknown as RosterErasureService,
  );
  const target = { characterName: 'Kira', accountHandle: '@nerys' };

  it('is for site admins alone', () => {
    expect(Reflect.getMetadata('roles', RosterErasuresController)).toEqual([
      UserRole.ADMIN,
    ]);
  });

  it('passes each request on', async () => {
    await expect(controller.list()).resolves.toEqual([]);
    await controller.preview(target);
    await controller.erase('admin-1', { ...target, reason: 'Verified' });

    expect(erasures.preview).toHaveBeenCalledWith(target);
    expect(erasures.erase).toHaveBeenCalledWith('admin-1', {
      ...target,
      reason: 'Verified',
    });
  });
});
