import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { Repository } from 'typeorm';
import { UserEntity } from '../user/entities/user.entity';
import { UserRole } from '../user/enums/user-role.enum';
import { PermissionCode } from './constants/permission-codes.constants';
import { PermissionEntity } from './entities/permission.entity';
import { UserPermissionOverrideEntity } from './entities/user-permission-override.entity';
import { PermissionEffect } from './enums/permission-effect.enum';

/** Shape of the role-derived permission lookup. */
interface PermissionCodeRow {
  code: string;
}

/** Shape of the per-user override lookup. */
interface OverrideRow {
  code: string;
  effect: PermissionEffect;
}

/** CLS key prefix under which a resolved permission set is memoised. */
const CLS_PERMISSIONS_KEY_PREFIX = 'accessControl:permissions:';

/**
 * Resolves what an individual user is allowed to do.
 *
 * Permissions are always read from the database, never from the JWT. The token
 * carries the user's role only as a hint for clients; trusting it here would
 * mean a revoked permission kept working until the access token expired, which
 * defeats the purpose of being able to bar an abusive user immediately.
 *
 * Resolution order is deliberate:
 *
 * 1. a live `DENY` override removes the permission outright;
 * 2. a live `GRANT` override adds it;
 * 3. otherwise the permissions of every group mapped to the user's role apply.
 *
 * `DENY` beating everything is what allows one user to lose a capability
 * without their account being disabled and without inventing a role for them.
 *
 * Results are memoised for the lifetime of the request, so a controller that
 * checks several permissions costs one pair of queries rather than one pair per
 * check.
 */
@Injectable()
export class AccessControlService {
  private readonly _logger = new Logger(AccessControlService.name);

  /**
   * Creates an instance of AccessControlService.
   *
   * @param _userRepository - Repository used to read the user's role.
   * @param _permissionRepository - Repository used to read role-derived permissions.
   * @param _overrideRepository - Repository used to read per-user overrides.
   * @param _cls - Request-scoped storage used to memoise resolved permissions.
   */
  constructor(
    @InjectRepository(UserEntity)
    private readonly _userRepository: Repository<UserEntity>,
    @InjectRepository(PermissionEntity)
    private readonly _permissionRepository: Repository<PermissionEntity>,
    @InjectRepository(UserPermissionOverrideEntity)
    private readonly _overrideRepository: Repository<UserPermissionOverrideEntity>,
    private readonly _cls: ClsService,
  ) {}

  /**
   * Resolves every permission code the user currently holds.
   *
   * @param userId - The user to resolve permissions for.
   * @returns The set of permission codes held, empty when the user is unknown
   *   or their account is disabled.
   */
  async getPermissionCodes(userId: string): Promise<ReadonlySet<string>> {
    const cached = this.readCache(userId);
    if (cached) {
      return cached;
    }

    const resolved = await this.resolvePermissionCodes(userId);
    this.writeCache(userId, resolved);
    return resolved;
  }

  /**
   * Determines whether a user holds a permission.
   *
   * @param userId - The user to check.
   * @param code - The permission code required.
   * @returns True when the user holds the permission.
   */
  async hasPermission(userId: string, code: PermissionCode): Promise<boolean> {
    const codes = await this.getPermissionCodes(userId);
    return codes.has(code);
  }

  /**
   * Requires that a user holds a permission.
   *
   * @param userId - The user to check.
   * @param code - The permission code required.
   * @throws ForbiddenException when the user does not hold the permission.
   */
  async assertPermission(userId: string, code: PermissionCode): Promise<void> {
    if (await this.hasPermission(userId, code)) {
      return;
    }

    // Logged at the point of denial so permission failures are diagnosable
    // without the caller having to reconstruct which check rejected them.
    this._logger.warn(
      `Permission denied: user ${userId} lacks permission '${code}'`,
    );
    throw new ForbiddenException('Insufficient permissions');
  }

  /**
   * Reads a memoised permission set for the current request.
   *
   * @param userId - The user whose permissions were resolved.
   * @returns The memoised set, or null when nothing is cached.
   */
  private readCache(userId: string): ReadonlySet<string> | null {
    if (!this._cls.isActive()) {
      return null;
    }
    return (
      this._cls.get<ReadonlySet<string> | undefined>(
        `${CLS_PERMISSIONS_KEY_PREFIX}${userId}`,
      ) ?? null
    );
  }

  /**
   * Memoises a permission set for the lifetime of the current request.
   *
   * @param userId - The user whose permissions were resolved.
   * @param codes - The resolved permission codes.
   */
  private writeCache(userId: string, codes: ReadonlySet<string>): void {
    if (!this._cls.isActive()) {
      return;
    }
    this._cls.set(`${CLS_PERMISSIONS_KEY_PREFIX}${userId}`, codes);
  }

  /**
   * Resolves a user's permissions from their role and their overrides.
   *
   * A disabled account resolves to no permissions at all, so suspending an
   * account withdraws its Storytime capabilities without needing a matching
   * override for each one.
   *
   * @param userId - The user to resolve permissions for.
   * @returns The set of permission codes held.
   */
  private async resolvePermissionCodes(
    userId: string,
  ): Promise<ReadonlySet<string>> {
    const user = await this._userRepository.findOne({
      where: { id: userId },
      select: { id: true, role: true, isAccountDisabled: true },
    });

    if (!user || user.isAccountDisabled) {
      return new Set<string>();
    }

    const [rolePermissions, overrides] = await Promise.all([
      this.findRolePermissions(user.role),
      this.findOverrides(userId),
    ]);

    const codes = new Set<string>(rolePermissions.map(row => row.code));

    for (const override of overrides) {
      if (override.effect === PermissionEffect.GRANT) {
        codes.add(override.code);
      } else {
        codes.delete(override.code);
      }
    }

    return codes;
  }

  /**
   * Finds the permissions conferred by every group mapped to a role.
   *
   * @param role - The user's role.
   * @returns The permission codes the role confers.
   */
  private findRolePermissions(role: UserRole): Promise<PermissionCodeRow[]> {
    return this._permissionRepository
      .createQueryBuilder('permission')
      .select('DISTINCT permission.code', 'code')
      .innerJoin(
        'permission_group_permission',
        'groupPermission',
        'groupPermission."permissionId" = permission.id',
      )
      .innerJoin(
        'permission_group',
        'permissionGroup',
        'permissionGroup.id = groupPermission."permissionGroupId" AND permissionGroup."deletedAt" IS NULL',
      )
      .innerJoin(
        'role_permission_group',
        'rolePermissionGroup',
        'rolePermissionGroup."permissionGroupId" = permissionGroup.id',
      )
      .where('rolePermissionGroup.role = :role', { role })
      .getRawMany<PermissionCodeRow>();
  }

  /**
   * Finds a user's live, unexpired permission overrides.
   *
   * @param userId - The user to read overrides for.
   * @returns The override rows that currently apply.
   */
  private findOverrides(userId: string): Promise<OverrideRow[]> {
    return this._overrideRepository
      .createQueryBuilder('override')
      .select('permission.code', 'code')
      .addSelect('override.effect', 'effect')
      .innerJoin(
        PermissionEntity,
        'permission',
        'permission.id = override."permissionId"',
      )
      .where('override."userId" = :userId', { userId })
      .andWhere('override."deletedAt" IS NULL')
      .andWhere(
        '(override."expiresAt" IS NULL OR override."expiresAt" > now())',
      )
      .getRawMany<OverrideRow>();
  }
}
