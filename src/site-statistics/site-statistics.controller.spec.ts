import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { ROLES_KEY } from 'src/auth/roles.decorator';
import { UserRole } from 'src/user/enums/user-role.enum';

import { SiteStatisticsController } from './site-statistics.controller';
import { SiteStatisticsDto } from './site-statistics.dto';
import { SiteStatisticsService } from './site-statistics.service';

describe('SiteStatisticsController (FC-053)', () => {
  const statistics = {
    generatedAt: new Date('2026-10-22T15:30:00.000Z'),
  } as SiteStatisticsDto;

  let read: jest.Mock<() => Promise<SiteStatisticsDto>>;
  let controller: SiteStatisticsController;

  beforeEach(() => {
    read = jest.fn(() => Promise.resolve(statistics));
    controller = new SiteStatisticsController({
      read,
    } as unknown as SiteStatisticsService);
  });

  it('reads the statistics', async () => {
    await expect(controller.read()).resolves.toBe(statistics);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('is for administrators only', () => {
    expect(Reflect.getMetadata(ROLES_KEY, SiteStatisticsController)).toEqual([
      UserRole.ADMIN,
    ]);
  });
});
