import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { ROLES_KEY } from 'src/auth/roles.decorator';
import { UserRole } from 'src/user/enums/user-role.enum';

import { PublicationPauseController } from './publication-pause.controller';
import { PublicationPauseDto } from './publication-pause.dto';
import { PublicationPauseService } from './publication-pause.service';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';

describe('PublicationPauseController', () => {
  const state: PublicationPauseDto = {
    paused: true,
    pausedAt: new Date('2026-09-30T10:30:00.000Z'),
    pausedByUserId: ADMIN_ID,
    pausedByUsername: 'Steve',
    queuePaused: true,
    held: 2,
  };

  let read: jest.Mock<() => Promise<PublicationPauseDto>>;
  let pause: jest.Mock<
    (adminUserId: string, reason: string) => Promise<PublicationPauseDto>
  >;
  let resume: jest.Mock<
    (adminUserId: string, reason: string) => Promise<PublicationPauseDto>
  >;
  let controller: PublicationPauseController;

  beforeEach(() => {
    read = jest.fn(() => Promise.resolve(state));
    pause = jest.fn(() => Promise.resolve(state));
    resume = jest.fn(() => Promise.resolve(state));
    controller = new PublicationPauseController({
      read,
      pause,
      resume,
    } as unknown as PublicationPauseService);
  });

  it('reads the pause', async () => {
    await expect(controller.read()).resolves.toBe(state);
  });

  it('pauses, with the site admin’s reason', async () => {
    await expect(
      controller.pause(ADMIN_ID, { reason: 'Incident' }),
    ).resolves.toBe(state);
    expect(pause).toHaveBeenCalledWith(ADMIN_ID, 'Incident');
  });

  it('resumes, with the site admin’s reason', async () => {
    await expect(controller.resume(ADMIN_ID, { reason: 'Over' })).resolves.toBe(
      state,
    );
    expect(resume).toHaveBeenCalledWith(ADMIN_ID, 'Over');
  });

  it('is for administrators only', () => {
    expect(Reflect.getMetadata(ROLES_KEY, PublicationPauseController)).toEqual([
      UserRole.ADMIN,
    ]);
  });
});
