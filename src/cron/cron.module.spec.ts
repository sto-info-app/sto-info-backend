import { jest } from '@jest/globals';

import { CronModule } from './cron.module';

jest.mock('@nestjs/schedule', () => ({
  ScheduleModule: {
    forRoot: jest.fn(() => ({})),
  },
  // no-op Cron decorator
  Cron: () => () => {},
  // minimal CronExpression mock used in cron.service.ts
  CronExpression: {
    EVERY_DAY_AT_MIDNIGHT: '0 0 * * *',
  },
}));

describe('CronModule', () => {
  it('should be defined', () => {
    expect(new CronModule()).toBeDefined();
  });
});
