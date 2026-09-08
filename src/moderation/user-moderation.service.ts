import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { UserRefreshTokenService } from '../user-refresh-token/user-refresh-token.service';
import { UserEntity } from '../user/entities/user.entity';
import { UserRole } from '../user/enums/user-role.enum';
import { DisableUserDto } from './dto/disable-user.dto';
import {
  ModeratedUserDto,
  PaginatedModeratedUsersDto,
} from './dto/moderated-user.dto';
import { ModeratedUserQueryDto } from './dto/user-query.dto';
import { ReportService } from './report.service';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/**
 * Administrator actions against member accounts.
 *
 * Disabling reuses the `isAccountDisabled` flag the login path already refuses
 * to authenticate against, so there is one definition of a locked account
 * rather than a second, parallel one. Active sessions are torn down at the same
 * time: without that, a disabled member keeps working until their access token
 * happens to expire.
 *
 * Two accounts are out of reach on purpose — an administrator's own, and any
 * other administrator's. Locking yourself out is never intended, and admins
 * removing each other is an escalation the role model has no way to arbitrate.
 */
@Injectable()
export class UserModerationService {
  private readonly _logger = new Logger(UserModerationService.name);

  /**
   * Creates an instance of UserModerationService.
   *
   * @param _userRepository - The user repository.
   * @param _refreshTokenService - Revokes sessions when an account is disabled.
   * @param _reportService - Closes the reports that led to a disable, and
   *   supplies the per-member report counts shown in the listing.
   */
  constructor(
    @InjectRepository(UserEntity)
    private readonly _userRepository: Repository<UserEntity>,
    private readonly _refreshTokenService: UserRefreshTokenService,
    private readonly _reportService: ReportService,
  ) {}

  /**
   * Lists members for the admin user list, newest registration first.
   *
   * @param query - Search, disabled filter and pagination options.
   * @returns A page of members.
   */
  async findUsers(
    query: ModeratedUserQueryDto,
  ): Promise<PaginatedModeratedUsersDto> {
    const page = query.page && query.page > 0 ? query.page : 1;
    const pageSize = Math.min(
      query.pageSize && query.pageSize > 0 ? query.pageSize : DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE,
    );

    const builder = this._userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.profile', 'profile')
      .where('user.deletedAt IS NULL');

    if (query.search) {
      builder.andWhere(
        '(LOWER(user.email) LIKE LOWER(:search) OR ' +
          'LOWER(profile.username) LIKE LOWER(:search))',
        { search: `%${query.search}%` },
      );
    }

    if (query.disabled !== undefined) {
      builder.andWhere('user.isAccountDisabled = :disabled', {
        disabled: query.disabled,
      });
    }

    const [users, total] = await builder
      .orderBy('user.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    const reportCounts =
      await this._reportService.countUnresolvedByReportedUser(
        users.map(user => user.id),
      );

    return {
      items: users.map(user => this.toModeratedUser(user, reportCounts)),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Retrieves a single member for the admin user list.
   *
   * @param userId - The member's user ID.
   * @returns The member.
   * @throws {NotFoundException} When no such member exists.
   */
  async findUser(userId: string): Promise<ModeratedUserDto> {
    const user = await this.requireUser(userId);
    const reportCounts =
      await this._reportService.countUnresolvedByReportedUser([user.id]);

    return this.toModeratedUser(user, reportCounts);
  }

  /**
   * Disables a member's account.
   *
   * Idempotent: disabling an already-disabled account refreshes the reason and
   * re-revokes any session that slipped through, rather than failing.
   *
   * @param userId - The member to disable.
   * @param adminUserId - The acting administrator's user ID.
   * @param dto - The reason recorded against the account.
   * @returns The updated member.
   * @throws {BadRequestException} When an administrator targets themselves.
   * @throws {ForbiddenException} When the target is another administrator.
   * @throws {NotFoundException} When no such member exists.
   */
  async disableUser(
    userId: string,
    adminUserId: string,
    dto: DisableUserDto,
  ): Promise<ModeratedUserDto> {
    const user = await this.requireModeratableUser(userId, adminUserId);

    user.isAccountDisabled = true;
    user.disabledAt = new Date();
    user.disabledReason = dto.reason ?? null;
    user.disabledById = adminUserId;

    await this._userRepository.save(user);
    await this._refreshTokenService.revokeAllTokensForUser(user.id);

    const actioned = await this._reportService.actionReportsAgainst(
      user.id,
      adminUserId,
    );

    this._logger.log(
      `[disableUser] Account disabled - User: ${user.id}, ` +
        `Admin: ${adminUserId}, Reports closed: ${actioned}`,
    );

    return this.findUser(user.id);
  }

  /**
   * Restores a disabled member's account.
   *
   * Reports already closed against the member stay closed — restoring access
   * is not a statement that the reports were wrong, only that the lock is
   * lifted.
   *
   * @param userId - The member to restore.
   * @param adminUserId - The acting administrator's user ID.
   * @returns The updated member.
   * @throws {BadRequestException} When an administrator targets themselves.
   * @throws {ForbiddenException} When the target is another administrator.
   * @throws {NotFoundException} When no such member exists.
   */
  async enableUser(
    userId: string,
    adminUserId: string,
  ): Promise<ModeratedUserDto> {
    const user = await this.requireModeratableUser(userId, adminUserId);

    user.isAccountDisabled = false;
    user.disabledAt = null;
    user.disabledReason = null;
    user.disabledById = null;

    await this._userRepository.save(user);

    this._logger.log(
      `[enableUser] Account restored - User: ${user.id}, Admin: ${adminUserId}`,
    );

    return this.findUser(user.id);
  }

  // ----- Helpers -----

  /**
   * Loads a member, with their profile attached.
   *
   * @param userId - The member's user ID.
   * @returns The user entity.
   * @throws {NotFoundException} When no such member exists.
   */
  private async requireUser(userId: string): Promise<UserEntity> {
    const user = await this._userRepository.findOne({
      where: { id: userId },
      relations: { profile: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  /**
   * Loads a member and checks the acting administrator is allowed to act on
   * them.
   *
   * @param userId - The member's user ID.
   * @param adminUserId - The acting administrator's user ID.
   * @returns The user entity.
   * @throws {BadRequestException} When an administrator targets themselves.
   * @throws {ForbiddenException} When the target is another administrator.
   * @throws {NotFoundException} When no such member exists.
   */
  private async requireModeratableUser(
    userId: string,
    adminUserId: string,
  ): Promise<UserEntity> {
    if (userId === adminUserId) {
      throw new BadRequestException('You cannot moderate your own account');
    }

    const user = await this.requireUser(userId);

    if (user.role === UserRole.ADMIN) {
      throw new ForbiddenException(
        'Administrator accounts cannot be moderated',
      );
    }

    return user;
  }

  /**
   * Maps a user entity onto its admin DTO.
   *
   * @param user - The user entity, with its profile loaded.
   * @param reportCounts - Unresolved report counts keyed by user ID.
   * @returns The member DTO.
   */
  private toModeratedUser(
    user: UserEntity,
    reportCounts: Map<string, number>,
  ): ModeratedUserDto {
    return {
      id: user.id,
      email: user.email,
      username: user.profile?.username ?? null,
      role: user.role,
      isAccountDisabled: user.isAccountDisabled,
      disabledAt: user.disabledAt,
      disabledReason: user.disabledReason,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      openReportCount: reportCounts.get(user.id) ?? 0,
    };
  }
}
