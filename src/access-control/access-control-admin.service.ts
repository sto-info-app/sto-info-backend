import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { UserEntity } from '../user/entities/user.entity';
import { ASSIGNABLE_USER_ROLES, UserRole } from '../user/enums/user-role.enum';
import { AccessControlService } from './access-control.service';
import { PermissionDto, UserAccessSummaryDto } from './dto/permission.dto';
import { SetLimitOverrideDto } from './dto/set-limit-override.dto';
import { SetPermissionOverrideDto } from './dto/set-permission-override.dto';
import { SetUserRoleDto } from './dto/set-user-role.dto';
import { PermissionEntity } from './entities/permission.entity';
import { UserLimitOverrideEntity } from './entities/user-limit-override.entity';
import { UserPermissionOverrideEntity } from './entities/user-permission-override.entity';

/**
 * Administrative management of member roles, and of the per-user permission and
 * limit overrides that depart from them.
 *
 * Separate from {@link AccessControlService}, which answers "what may this user
 * do" on every request and must stay cheap. This service is the write side and
 * runs only from administration screens.
 *
 * A role is the blunt instrument and an override the fine one: giving somebody
 * the curator role hands them the whole job, while an override adjusts one
 * capability for one person. Both are available here because neither expresses
 * the other well.
 *
 * Every change is logged with the acting administrator, because an override is
 * a decision about a specific person and needs to remain reviewable long after
 * whoever made it has forgotten.
 */
@Injectable()
export class AccessControlAdminService {
  private readonly _logger = new Logger(AccessControlAdminService.name);

  /**
   * Creates an instance of AccessControlAdminService.
   *
   * @param _permissionRepository - Repository of known permissions.
   * @param _permissionOverrideRepository - Repository of per-user permission overrides.
   * @param _limitOverrideRepository - Repository of per-user limit exemptions.
   * @param _userRepository - Repository used to confirm the target user exists.
   * @param _accessControlService - Used to report the user's effective permissions.
   */
  constructor(
    @InjectRepository(PermissionEntity)
    private readonly _permissionRepository: Repository<PermissionEntity>,
    @InjectRepository(UserPermissionOverrideEntity)
    private readonly _permissionOverrideRepository: Repository<UserPermissionOverrideEntity>,
    @InjectRepository(UserLimitOverrideEntity)
    private readonly _limitOverrideRepository: Repository<UserLimitOverrideEntity>,
    @InjectRepository(UserEntity)
    private readonly _userRepository: Repository<UserEntity>,
    private readonly _accessControlService: AccessControlService,
  ) {}

  /**
   * Lists every permission the application recognises.
   *
   * @returns The known permissions, ordered by module then code.
   */
  async listPermissions(): Promise<PermissionDto[]> {
    const permissions = await this._permissionRepository.find({
      order: { module: 'ASC', code: 'ASC' },
    });

    return permissions.map(permission => ({
      id: permission.id,
      code: permission.code,
      name: permission.name,
      description: permission.description,
      module: permission.module,
    }));
  }

  /**
   * Reports what a user may currently do and which overrides are in force.
   *
   * @param userId - The user to describe.
   * @returns The user's effective permissions and active overrides.
   * @throws NotFoundException when the user does not exist.
   */
  async getUserAccessSummary(userId: string): Promise<UserAccessSummaryDto> {
    const user = await this.requireUser(userId);

    const [effectivePermissions, overrides] = await Promise.all([
      this._accessControlService.getPermissionCodes(userId),
      this._permissionOverrideRepository.find({
        where: { userId },
        order: { createdAt: 'DESC' },
      }),
    ]);

    const permissionsById = await this.mapPermissionCodesById();

    return {
      userId,
      role: user.role,
      effectivePermissions: [...effectivePermissions].sort((a, b) =>
        a.localeCompare(b),
      ),
      overrides: overrides.map(override => ({
        id: override.id,
        permissionCode: permissionsById.get(override.permissionId) ?? '',
        effect: override.effect,
        reason: override.reason,
        grantedByUserId: override.grantedByUserId,
        expiresAt: override.expiresAt,
        createdAt: override.createdAt,
      })),
    };
  }

  /**
   * Grants or withholds a permission for a user.
   *
   * Re-applying the same permission updates the existing override rather than
   * adding a second one, so repeating the request is harmless.
   *
   * @param userId - The user the override applies to.
   * @param dto - The override to apply.
   * @param actingUserId - The administrator making the change.
   * @returns The user's updated access summary.
   * @throws NotFoundException when the user or permission does not exist.
   */
  async setPermissionOverride(
    userId: string,
    dto: SetPermissionOverrideDto,
    actingUserId: string,
  ): Promise<UserAccessSummaryDto> {
    await this.assertUserExists(userId);

    const permission = await this._permissionRepository.findOne({
      where: { code: dto.permissionCode },
    });

    if (!permission) {
      throw new NotFoundException('Permission not found');
    }

    const existing = await this._permissionOverrideRepository.findOne({
      where: { userId, permissionId: permission.id, deletedAt: IsNull() },
    });

    if (existing) {
      await this._permissionOverrideRepository.update(existing.id, {
        effect: dto.effect,
        reason: dto.reason,
        grantedByUserId: actingUserId,
        expiresAt: dto.expiresAt ?? null,
      });
    } else {
      await this._permissionOverrideRepository.save(
        this._permissionOverrideRepository.create({
          userId,
          permissionId: permission.id,
          effect: dto.effect,
          reason: dto.reason,
          grantedByUserId: actingUserId,
          expiresAt: dto.expiresAt ?? null,
        }),
      );
    }

    this._logger.log(
      `Permission override ${dto.effect} '${dto.permissionCode}' applied to user ${userId} by ${actingUserId}`,
    );

    return this.getUserAccessSummary(userId);
  }

  /**
   * Withdraws a permission override, returning the user to their role default.
   *
   * @param userId - The user the override applies to.
   * @param permissionCode - The permission code to stop overriding.
   * @param actingUserId - The administrator making the change.
   * @returns The user's updated access summary.
   * @throws NotFoundException when the user, permission or override does not exist.
   */
  async removePermissionOverride(
    userId: string,
    permissionCode: string,
    actingUserId: string,
  ): Promise<UserAccessSummaryDto> {
    await this.assertUserExists(userId);

    const permission = await this._permissionRepository.findOne({
      where: { code: permissionCode },
    });

    if (!permission) {
      throw new NotFoundException('Permission not found');
    }

    const existing = await this._permissionOverrideRepository.findOne({
      where: { userId, permissionId: permission.id, deletedAt: IsNull() },
    });

    if (!existing) {
      throw new NotFoundException('Permission override not found');
    }

    await this._permissionOverrideRepository.softDelete(existing.id);

    this._logger.log(
      `Permission override '${permissionCode}' withdrawn from user ${userId} by ${actingUserId}`,
    );

    return this.getUserAccessSummary(userId);
  }

  /**
   * Sets which role a member holds.
   *
   * Three changes are refused, and all three are refused here as well as in
   * {@link SetUserRoleDto} so that the rule holds however the service is
   * called:
   *
   * - assigning ADMIN, which is granted outside the application;
   * - changing an administrator's role, so administrators cannot unmake each
   *   other or be demoted by a mistaken click;
   * - changing your own, which is how an administrator locks themselves out.
   *
   * Sessions are left alone. Permissions are resolved from the database on
   * every request, so the change takes effect immediately; the member's access
   * token still names their old role, but that is only a hint for the client
   * and neither of the assignable roles reaches an administration screen with
   * it.
   *
   * @param userId - The member whose role is changing.
   * @param dto - The role to give them.
   * @param actingUserId - The administrator making the change.
   * @returns The member's updated access summary.
   * @throws BadRequestException when an administrator targets themselves.
   * @throws ForbiddenException when ADMIN is assigned, or the target holds it.
   * @throws NotFoundException when the member does not exist.
   */
  async setUserRole(
    userId: string,
    dto: SetUserRoleDto,
    actingUserId: string,
  ): Promise<UserAccessSummaryDto> {
    if (userId === actingUserId) {
      throw new BadRequestException('You cannot change your own role');
    }

    if (!ASSIGNABLE_USER_ROLES.includes(dto.role)) {
      throw new ForbiddenException(
        'The administrator role is granted outside the application',
      );
    }

    const user = await this.requireUser(userId);

    if (user.role === UserRole.ADMIN) {
      throw new ForbiddenException(
        'Administrator roles are managed outside the application',
      );
    }

    if (user.role !== dto.role) {
      await this._userRepository.update(userId, { role: dto.role });

      this._logger.log(
        `Role changed from '${user.role}' to '${dto.role}' for user ${userId} by ${actingUserId}`,
      );
    }

    return this.getUserAccessSummary(userId);
  }

  /**
   * Grants a user a replacement value for a configured limit.
   *
   * Re-applying the same key updates the existing exemption rather than adding
   * a second one.
   *
   * @param userId - The user the exemption applies to.
   * @param dto - The exemption to apply.
   * @param actingUserId - The administrator making the change.
   * @throws NotFoundException when the user does not exist.
   */
  async setLimitOverride(
    userId: string,
    dto: SetLimitOverrideDto,
    actingUserId: string,
  ): Promise<void> {
    await this.assertUserExists(userId);

    const existing = await this._limitOverrideRepository.findOne({
      where: { userId, limitKey: dto.limitKey, deletedAt: IsNull() },
    });

    if (existing) {
      await this._limitOverrideRepository.update(existing.id, {
        limitValue: dto.limitValue,
        reason: dto.reason,
        grantedByUserId: actingUserId,
        expiresAt: dto.expiresAt ?? null,
      });
    } else {
      await this._limitOverrideRepository.save(
        this._limitOverrideRepository.create({
          userId,
          limitKey: dto.limitKey,
          limitValue: dto.limitValue,
          reason: dto.reason,
          grantedByUserId: actingUserId,
          expiresAt: dto.expiresAt ?? null,
        }),
      );
    }

    this._logger.log(
      `Limit override ${dto.limitKey}=${dto.limitValue} applied to user ${userId} by ${actingUserId}`,
    );
  }

  /**
   * Lists a user's live limit exemptions.
   *
   * @param userId - The user to read exemptions for.
   * @returns The exemptions currently recorded.
   * @throws NotFoundException when the user does not exist.
   */
  async listLimitOverrides(userId: string): Promise<UserLimitOverrideEntity[]> {
    await this.assertUserExists(userId);

    return this._limitOverrideRepository.find({
      where: { userId },
      order: { limitKey: 'ASC' },
    });
  }

  /**
   * Withdraws a limit exemption, returning the user to the configured default.
   *
   * @param userId - The user the exemption applies to.
   * @param limitKey - The configuration key to stop overriding.
   * @param actingUserId - The administrator making the change.
   * @throws NotFoundException when the user or exemption does not exist.
   */
  async removeLimitOverride(
    userId: string,
    limitKey: string,
    actingUserId: string,
  ): Promise<void> {
    await this.assertUserExists(userId);

    const existing = await this._limitOverrideRepository.findOne({
      where: { userId, limitKey, deletedAt: IsNull() },
    });

    if (!existing) {
      throw new NotFoundException('Limit override not found');
    }

    await this._limitOverrideRepository.softDelete(existing.id);

    this._logger.log(
      `Limit override '${limitKey}' withdrawn from user ${userId} by ${actingUserId}`,
    );
  }

  /**
   * Builds a lookup of permission code by permission ID.
   *
   * @returns The lookup map.
   */
  private async mapPermissionCodesById(): Promise<Map<string, string>> {
    const permissions = await this._permissionRepository.find({
      select: { id: true, code: true },
    });

    return new Map(
      permissions.map(permission => [permission.id, permission.code]),
    );
  }

  /**
   * Loads the target user, reading the role their baseline permissions come
   * from.
   *
   * @param userId - The user to load.
   * @returns The user, with their identifier and role.
   * @throws NotFoundException when the user does not exist.
   */
  private async requireUser(userId: string): Promise<UserEntity> {
    const user = await this._userRepository.findOne({
      where: { id: userId },
      select: { id: true, role: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  /**
   * Requires that the target user exists.
   *
   * @param userId - The user to confirm.
   * @throws NotFoundException when the user does not exist.
   */
  private async assertUserExists(userId: string): Promise<void> {
    const exists = await this._userRepository.exists({
      where: { id: userId },
    });

    if (!exists) {
      throw new NotFoundException('User not found');
    }
  }
}
