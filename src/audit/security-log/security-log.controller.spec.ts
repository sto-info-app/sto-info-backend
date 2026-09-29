import { PATH_METADATA } from '@nestjs/common/constants';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { ROLES_KEY } from 'src/auth/roles.decorator';
import { UserRole } from 'src/user/enums/user-role.enum';

import { SecurityLogController } from './security-log.controller';
import { SecurityLogPageDto, SecurityLogSource } from './security-log.dto';
import { SecurityLogService } from './security-log.service';

describe('SecurityLogController (FC-039)', () => {
  const page = {
    items: [],
    total: 0,
    page: 1,
    pageSize: 50,
  } as SecurityLogPageDto;

  let list: jest.Mock<(...args: unknown[]) => Promise<SecurityLogPageDto>>;
  let controller: SecurityLogController;

  beforeEach(() => {
    list = jest.fn(() => Promise.resolve(page));
    controller = new SecurityLogController({
      list,
    } as unknown as SecurityLogService);
  });

  it('passes the source and page to the service', async () => {
    await expect(
      controller.list({ source: SecurityLogSource.HOLD, page: 3 }),
    ).resolves.toBe(page);
    expect(list).toHaveBeenCalledWith(SecurityLogSource.HOLD, 3);
  });

  it('reads the first page of every source when asked for neither', async () => {
    await controller.list({});

    expect(list).toHaveBeenCalledWith(undefined, 1);
  });

  it('is for administrators only, at admin/security-log', () => {
    expect(Reflect.getMetadata(ROLES_KEY, SecurityLogController)).toEqual([
      UserRole.ADMIN,
    ]);
    expect(Reflect.getMetadata(PATH_METADATA, SecurityLogController)).toBe(
      'admin/security-log',
    );
  });
});
