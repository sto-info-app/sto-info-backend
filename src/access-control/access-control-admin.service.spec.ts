import { Logger, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserEntity } from '../user/entities/user.entity';
import { AccessControlAdminService } from './access-control-admin.service';
import { AccessControlService } from './access-control.service';
import { PERMISSION_CODES } from './constants/permission-codes.constants';
import { PermissionEntity } from './entities/permission.entity';
import { UserLimitOverrideEntity } from './entities/user-limit-override.entity';
import { UserPermissionOverrideEntity } from './entities/user-permission-override.entity';
import { PermissionEffect } from './enums/permission-effect.enum';
import { PermissionModule } from './enums/permission-module.enum';

describe('AccessControlAdminService', () => {
  let service: AccessControlAdminService;
  let permissionRepository: { find: jest.Mock; findOne: jest.Mock };
  let permissionOverrideRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    softDelete: jest.Mock;
  };
  let limitOverrideRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    softDelete: jest.Mock;
  };
  let userRepository: { exists: jest.Mock };
  let accessControlService: { getPermissionCodes: jest.Mock };

  const userId = 'e6d3a1b2-0000-4000-8000-000000000001';
  const adminId = 'e6d3a1b2-0000-4000-8000-0000000000ad';
  const permissionId = 'e6d3a1b2-0000-4000-8000-0000000000p1';

  const permission = {
    id: permissionId,
    code: PERMISSION_CODES.STORYTIME_STORY_CREATE,
    name: 'Create Stories',
    description: 'Create new Storytime Stories.',
    module: PermissionModule.STORYTIME,
  };

  beforeEach(async () => {
    permissionRepository = { find: jest.fn(), findOne: jest.fn() };
    permissionOverrideRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn(input => input),
      save: jest.fn(input => Promise.resolve(input)),
      update: jest.fn().mockResolvedValue(undefined),
      softDelete: jest.fn().mockResolvedValue(undefined),
    };
    limitOverrideRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn(input => input),
      save: jest.fn(input => Promise.resolve(input)),
      update: jest.fn().mockResolvedValue(undefined),
      softDelete: jest.fn().mockResolvedValue(undefined),
    };
    userRepository = { exists: jest.fn().mockResolvedValue(true) };
    accessControlService = {
      getPermissionCodes: jest.fn().mockResolvedValue(new Set<string>()),
    };

    permissionRepository.find.mockResolvedValue([permission]);
    permissionRepository.findOne.mockResolvedValue(permission);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccessControlAdminService,
        {
          provide: getRepositoryToken(PermissionEntity),
          useValue: permissionRepository,
        },
        {
          provide: getRepositoryToken(UserPermissionOverrideEntity),
          useValue: permissionOverrideRepository,
        },
        {
          provide: getRepositoryToken(UserLimitOverrideEntity),
          useValue: limitOverrideRepository,
        },
        { provide: getRepositoryToken(UserEntity), useValue: userRepository },
        { provide: AccessControlService, useValue: accessControlService },
      ],
    }).compile();

    service = module.get<AccessControlAdminService>(AccessControlAdminService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('listPermissions', () => {
    it('returns the known permissions', async () => {
      await expect(service.listPermissions()).resolves.toEqual([
        {
          id: permissionId,
          code: PERMISSION_CODES.STORYTIME_STORY_CREATE,
          name: 'Create Stories',
          description: 'Create new Storytime Stories.',
          module: PermissionModule.STORYTIME,
        },
      ]);
    });
  });

  describe('getUserAccessSummary', () => {
    it('reports effective permissions in a stable order', async () => {
      accessControlService.getPermissionCodes.mockResolvedValue(
        new Set([
          PERMISSION_CODES.STORYTIME_VIEW,
          PERMISSION_CODES.STORYTIME_ARC_CREATE,
        ]),
      );

      const summary = await service.getUserAccessSummary(userId);

      expect(summary.effectivePermissions).toEqual([
        PERMISSION_CODES.STORYTIME_ARC_CREATE,
        PERMISSION_CODES.STORYTIME_VIEW,
      ]);
    });

    it('resolves the permission code for each override', async () => {
      permissionOverrideRepository.find.mockResolvedValue([
        {
          id: 'override-1',
          permissionId,
          effect: PermissionEffect.DENY,
          reason: 'Repeated policy breaches',
          grantedByUserId: adminId,
          expiresAt: null,
          createdAt: new Date('2026-08-15T00:00:00Z'),
        },
      ]);

      const summary = await service.getUserAccessSummary(userId);

      expect(summary.overrides[0].permissionCode).toBe(
        PERMISSION_CODES.STORYTIME_STORY_CREATE,
      );
      expect(summary.overrides[0].effect).toBe(PermissionEffect.DENY);
    });

    it('reports an empty code when the permission has since been removed', async () => {
      permissionRepository.find.mockResolvedValue([]);
      permissionOverrideRepository.find.mockResolvedValue([
        {
          id: 'override-1',
          permissionId: 'unknown',
          effect: PermissionEffect.GRANT,
          reason: 'why',
          grantedByUserId: adminId,
          expiresAt: null,
          createdAt: new Date(),
        },
      ]);

      const summary = await service.getUserAccessSummary(userId);

      expect(summary.overrides[0].permissionCode).toBe('');
    });

    it('throws when the user does not exist', async () => {
      userRepository.exists.mockResolvedValue(false);

      await expect(service.getUserAccessSummary(userId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('setPermissionOverride', () => {
    const dto = {
      permissionCode: PERMISSION_CODES.STORYTIME_STORY_CREATE,
      effect: PermissionEffect.DENY,
      reason: 'Repeated policy breaches',
    };

    it('creates an override when none exists', async () => {
      await service.setPermissionOverride(userId, dto, adminId);

      expect(permissionOverrideRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          permissionId,
          effect: PermissionEffect.DENY,
          grantedByUserId: adminId,
          expiresAt: null,
        }),
      );
    });

    it('records an expiry when one is supplied', async () => {
      const expiresAt = new Date('2027-01-01T00:00:00Z');

      await service.setPermissionOverride(
        userId,
        { ...dto, expiresAt },
        adminId,
      );

      expect(permissionOverrideRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ expiresAt }),
      );
    });

    it('updates the existing override rather than adding a second', async () => {
      permissionOverrideRepository.findOne.mockResolvedValue({
        id: 'override-1',
      });

      await service.setPermissionOverride(userId, dto, adminId);

      expect(permissionOverrideRepository.update).toHaveBeenCalledWith(
        'override-1',
        expect.objectContaining({ effect: PermissionEffect.DENY }),
      );
      expect(permissionOverrideRepository.save).not.toHaveBeenCalled();
    });

    it('throws when the permission is unknown', async () => {
      permissionRepository.findOne.mockResolvedValue(null);

      await expect(
        service.setPermissionOverride(userId, dto, adminId),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws when the user does not exist', async () => {
      userRepository.exists.mockResolvedValue(false);

      await expect(
        service.setPermissionOverride(userId, dto, adminId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('removePermissionOverride', () => {
    it('soft-deletes the override', async () => {
      permissionOverrideRepository.findOne.mockResolvedValue({
        id: 'override-1',
      });

      await service.removePermissionOverride(
        userId,
        PERMISSION_CODES.STORYTIME_STORY_CREATE,
        adminId,
      );

      expect(permissionOverrideRepository.softDelete).toHaveBeenCalledWith(
        'override-1',
      );
    });

    it('throws when the permission is unknown', async () => {
      permissionRepository.findOne.mockResolvedValue(null);

      await expect(
        service.removePermissionOverride(userId, 'nope', adminId),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws when no override is in force', async () => {
      permissionOverrideRepository.findOne.mockResolvedValue(null);

      await expect(
        service.removePermissionOverride(
          userId,
          PERMISSION_CODES.STORYTIME_STORY_CREATE,
          adminId,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws when the user does not exist', async () => {
      userRepository.exists.mockResolvedValue(false);

      await expect(
        service.removePermissionOverride(
          userId,
          PERMISSION_CODES.STORYTIME_STORY_CREATE,
          adminId,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('setLimitOverride', () => {
    const dto = {
      limitKey: 'STORYTIME_MAX_STORIES_PER_USER',
      limitValue: 500,
      reason: 'Prolific creator',
    };

    it('creates an exemption when none exists', async () => {
      await service.setLimitOverride(userId, dto, adminId);

      expect(limitOverrideRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          limitKey: dto.limitKey,
          limitValue: 500,
          grantedByUserId: adminId,
          expiresAt: null,
        }),
      );
    });

    it('records an expiry when one is supplied', async () => {
      const expiresAt = new Date('2027-01-01T00:00:00Z');

      await service.setLimitOverride(userId, { ...dto, expiresAt }, adminId);

      expect(limitOverrideRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ expiresAt }),
      );
    });

    it('updates the existing exemption rather than adding a second', async () => {
      limitOverrideRepository.findOne.mockResolvedValue({ id: 'limit-1' });

      await service.setLimitOverride(userId, dto, adminId);

      expect(limitOverrideRepository.update).toHaveBeenCalledWith(
        'limit-1',
        expect.objectContaining({ limitValue: 500 }),
      );
      expect(limitOverrideRepository.save).not.toHaveBeenCalled();
    });

    it('throws when the user does not exist', async () => {
      userRepository.exists.mockResolvedValue(false);

      await expect(
        service.setLimitOverride(userId, dto, adminId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('listLimitOverrides', () => {
    it('returns the exemptions recorded for the user', async () => {
      limitOverrideRepository.find.mockResolvedValue([{ id: 'limit-1' }]);

      await expect(service.listLimitOverrides(userId)).resolves.toEqual([
        { id: 'limit-1' },
      ]);
    });

    it('throws when the user does not exist', async () => {
      userRepository.exists.mockResolvedValue(false);

      await expect(service.listLimitOverrides(userId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('removeLimitOverride', () => {
    it('soft-deletes the exemption', async () => {
      limitOverrideRepository.findOne.mockResolvedValue({ id: 'limit-1' });

      await service.removeLimitOverride(
        userId,
        'STORYTIME_MAX_STORIES_PER_USER',
        adminId,
      );

      expect(limitOverrideRepository.softDelete).toHaveBeenCalledWith(
        'limit-1',
      );
    });

    it('throws when no exemption is in force', async () => {
      await expect(
        service.removeLimitOverride(userId, 'NOPE', adminId),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws when the user does not exist', async () => {
      userRepository.exists.mockResolvedValue(false);

      await expect(
        service.removeLimitOverride(userId, 'NOPE', adminId),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
