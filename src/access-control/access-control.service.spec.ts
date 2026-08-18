import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { UserEntity } from '../user/entities/user.entity';
import { UserRole } from '../user/enums/user-role.enum';
import { AccessControlService } from './access-control.service';
import { PERMISSION_CODES } from './constants/permission-codes.constants';
import { PermissionGroupEntity } from './entities/permission-group.entity';
import { PermissionGroupPermissionEntity } from './entities/permission-group-permission.entity';
import { PermissionEntity } from './entities/permission.entity';
import { RolePermissionGroupEntity } from './entities/role-permission-group.entity';
import { UserPermissionOverrideEntity } from './entities/user-permission-override.entity';
import { PermissionEffect } from './enums/permission-effect.enum';

/** Chainable stub standing in for a TypeORM query builder. */
interface QueryBuilderStub {
  select: jest.Mock;
  addSelect: jest.Mock;
  innerJoin: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  getRawMany: jest.Mock;
}

/**
 * Builds a chainable query-builder stub whose terminal `getRawMany` resolves
 * to the supplied rows.
 *
 * @param rows - The rows the query should resolve to.
 * @returns The stubbed query builder.
 */
const createQueryBuilder = (rows: unknown[]): QueryBuilderStub => {
  const builder: QueryBuilderStub = {
    select: jest.fn((): QueryBuilderStub => builder),
    addSelect: jest.fn((): QueryBuilderStub => builder),
    innerJoin: jest.fn((): QueryBuilderStub => builder),
    where: jest.fn((): QueryBuilderStub => builder),
    andWhere: jest.fn((): QueryBuilderStub => builder),
    getRawMany: jest.fn().mockResolvedValue(rows),
  };
  return builder;
};

describe('AccessControlService', () => {
  let service: AccessControlService;
  let userRepository: { findOne: jest.Mock };
  let permissionRepository: { createQueryBuilder: jest.Mock };
  let overrideRepository: { createQueryBuilder: jest.Mock };
  let cls: { isActive: jest.Mock; get: jest.Mock; set: jest.Mock };

  const userId = 'e6d3a1b2-0000-4000-8000-000000000001';

  beforeEach(async () => {
    userRepository = { findOne: jest.fn() };
    permissionRepository = { createQueryBuilder: jest.fn() };
    overrideRepository = { createQueryBuilder: jest.fn() };
    cls = {
      isActive: jest.fn().mockReturnValue(false),
      get: jest.fn(),
      set: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccessControlService,
        { provide: getRepositoryToken(UserEntity), useValue: userRepository },
        {
          provide: getRepositoryToken(PermissionEntity),
          useValue: permissionRepository,
        },
        {
          provide: getRepositoryToken(UserPermissionOverrideEntity),
          useValue: overrideRepository,
        },
        { provide: ClsService, useValue: cls },
      ],
    }).compile();

    service = module.get<AccessControlService>(AccessControlService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Arranges the repositories to return a role's permissions and a user's
   * overrides.
   *
   * @param options - The user, role permissions and overrides to return.
   */
  const arrange = (options: {
    user?: Partial<UserEntity> | null;
    rolePermissions?: string[];
    overrides?: { code: string; effect: PermissionEffect }[];
  }) => {
    userRepository.findOne.mockResolvedValue(
      options.user === undefined
        ? { id: userId, role: UserRole.USER, isAccountDisabled: false }
        : options.user,
    );
    permissionRepository.createQueryBuilder.mockReturnValue(
      createQueryBuilder(
        (options.rolePermissions ?? []).map(code => ({ code })),
      ),
    );
    overrideRepository.createQueryBuilder.mockReturnValue(
      createQueryBuilder(options.overrides ?? []),
    );
  };

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('getPermissionCodes', () => {
    it('returns the permissions conferred by the user role', async () => {
      arrange({
        rolePermissions: [
          PERMISSION_CODES.STORYTIME_VIEW,
          PERMISSION_CODES.STORYTIME_STORY_CREATE,
        ],
      });

      const codes = await service.getPermissionCodes(userId);

      expect([...codes].sort()).toEqual(
        [
          PERMISSION_CODES.STORYTIME_VIEW,
          PERMISSION_CODES.STORYTIME_STORY_CREATE,
        ].sort(),
      );
    });

    it('adds permissions from a GRANT override', async () => {
      arrange({
        rolePermissions: [PERMISSION_CODES.STORYTIME_VIEW],
        overrides: [
          {
            code: PERMISSION_CODES.STORYTIME_MODERATE,
            effect: PermissionEffect.GRANT,
          },
        ],
      });

      const codes = await service.getPermissionCodes(userId);

      expect(codes.has(PERMISSION_CODES.STORYTIME_MODERATE)).toBe(true);
    });

    it('removes permissions from a DENY override even when the role confers them', async () => {
      arrange({
        rolePermissions: [
          PERMISSION_CODES.STORYTIME_VIEW,
          PERMISSION_CODES.STORYTIME_STORY_CREATE,
        ],
        overrides: [
          {
            code: PERMISSION_CODES.STORYTIME_STORY_CREATE,
            effect: PermissionEffect.DENY,
          },
        ],
      });

      const codes = await service.getPermissionCodes(userId);

      expect(codes.has(PERMISSION_CODES.STORYTIME_STORY_CREATE)).toBe(false);
      expect(codes.has(PERMISSION_CODES.STORYTIME_VIEW)).toBe(true);
    });

    it('returns nothing for an unknown user', async () => {
      arrange({ user: null });

      const codes = await service.getPermissionCodes(userId);

      expect(codes.size).toBe(0);
      expect(permissionRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('returns nothing for a disabled account', async () => {
      arrange({
        user: { id: userId, role: UserRole.ADMIN, isAccountDisabled: true },
      });

      const codes = await service.getPermissionCodes(userId);

      expect(codes.size).toBe(0);
    });

    it('uses entity metadata for the permission group joins', async () => {
      arrange({
        user: { id: userId, role: UserRole.ADMIN, isAccountDisabled: false },
        rolePermissions: [PERMISSION_CODES.STORYTIME_MODERATE],
      });

      await service.getPermissionCodes(userId);

      const builder = permissionRepository.createQueryBuilder.mock.results[0]
        .value as QueryBuilderStub;
      expect(builder.innerJoin).toHaveBeenCalledWith(
        PermissionGroupPermissionEntity,
        'group_permission',
        'group_permission."permissionId" = permission.id',
      );
      expect(builder.innerJoin).toHaveBeenCalledWith(
        PermissionGroupEntity,
        'permission_group',
        'permission_group.id = group_permission."permissionGroupId" AND permission_group."deletedAt" IS NULL',
      );
      expect(builder.innerJoin).toHaveBeenCalledWith(
        RolePermissionGroupEntity,
        'role_permission_group',
        'role_permission_group."permissionGroupId" = permission_group.id',
      );
    });

    it('queries using the user role', async () => {
      arrange({
        user: { id: userId, role: UserRole.ADMIN, isAccountDisabled: false },
        rolePermissions: [PERMISSION_CODES.STORYTIME_MODERATE],
      });

      await service.getPermissionCodes(userId);

      const builder = permissionRepository.createQueryBuilder.mock.results[0]
        .value as QueryBuilderStub;
      expect(builder.where).toHaveBeenCalledWith(
        'role_permission_group.role = :role',
        { role: UserRole.ADMIN },
      );
    });

    it('does not read the cache when no request context is active', async () => {
      arrange({ rolePermissions: [PERMISSION_CODES.STORYTIME_VIEW] });

      await service.getPermissionCodes(userId);

      expect(cls.get).not.toHaveBeenCalled();
      expect(cls.set).not.toHaveBeenCalled();
    });

    it('memoises the resolved set for the lifetime of the request', async () => {
      cls.isActive.mockReturnValue(true);
      cls.get.mockReturnValue(undefined);
      arrange({ rolePermissions: [PERMISSION_CODES.STORYTIME_VIEW] });

      await service.getPermissionCodes(userId);

      expect(cls.set).toHaveBeenCalledWith(
        `accessControl:permissions:${userId}`,
        expect.any(Set),
      );
    });

    it('reuses a memoised set instead of querying again', async () => {
      cls.isActive.mockReturnValue(true);
      cls.get.mockReturnValue(new Set([PERMISSION_CODES.STORYTIME_MODERATE]));
      arrange({ rolePermissions: [PERMISSION_CODES.STORYTIME_VIEW] });

      const codes = await service.getPermissionCodes(userId);

      expect(codes.has(PERMISSION_CODES.STORYTIME_MODERATE)).toBe(true);
      expect(userRepository.findOne).not.toHaveBeenCalled();
    });
  });

  describe('hasPermission', () => {
    it('returns true when the permission is held', async () => {
      arrange({ rolePermissions: [PERMISSION_CODES.STORYTIME_VIEW] });

      await expect(
        service.hasPermission(userId, PERMISSION_CODES.STORYTIME_VIEW),
      ).resolves.toBe(true);
    });

    it('returns false when the permission is not held', async () => {
      arrange({ rolePermissions: [PERMISSION_CODES.STORYTIME_VIEW] });

      await expect(
        service.hasPermission(userId, PERMISSION_CODES.STORYTIME_MODERATE),
      ).resolves.toBe(false);
    });
  });

  describe('assertPermission', () => {
    it('resolves when the permission is held', async () => {
      arrange({ rolePermissions: [PERMISSION_CODES.STORYTIME_VIEW] });

      await expect(
        service.assertPermission(userId, PERMISSION_CODES.STORYTIME_VIEW),
      ).resolves.toBeUndefined();
    });

    it('throws when the permission is not held', async () => {
      arrange({ rolePermissions: [] });

      await expect(
        service.assertPermission(userId, PERMISSION_CODES.STORYTIME_MODERATE),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
