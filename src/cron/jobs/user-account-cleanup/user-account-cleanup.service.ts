import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CLOSED_ACCOUNT_RETENTION_DAYS } from 'src/cron/constants/cron.constants';
import { UserRefreshTokenEntity } from 'src/user-refresh-token/entities/user-refresh-token.entity';
import { UserProfileEntity } from 'src/user/entities/user-profile.entity';
import { UserEntity } from 'src/user/entities/user.entity';
import { AccountEntity } from 'src/sto/account/entities/account.entity';
import { LessThan, Repository } from 'typeorm';

@Injectable()
export class UserAccountCleanupService {
  private readonly _logger = new Logger(UserAccountCleanupService.name);

  /**
   * Creates an instance of UserAccountCleanupService.
   *
   * @param _userRepository - User repository.
   * @param _userProfileRepository - User profile repository.
   * @param _userRefreshTokenRepository - User refresh token repository.
   * @param _accountRepository - Account repository.
   */
  constructor(
    @InjectRepository(UserEntity)
    private readonly _userRepository: Repository<UserEntity>,

    @InjectRepository(UserProfileEntity)
    private readonly _userProfileRepository: Repository<UserProfileEntity>,

    @InjectRepository(UserRefreshTokenEntity)
    private readonly _userRefreshTokenRepository: Repository<UserRefreshTokenEntity>,

    @InjectRepository(AccountEntity)
    private readonly _accountRepository: Repository<AccountEntity>,
  ) {}

  /**
   * Permanently deletes soft-deleted user records older than the configured
   * retention threshold.
   */
  async cleanup(): Promise<void> {
    const thresholdDate = new Date();
    thresholdDate.setDate(
      thresholdDate.getDate() - CLOSED_ACCOUNT_RETENTION_DAYS,
    );

    const usersToDelete = await this._userRepository.find({
      where: { deletedAt: LessThan(thresholdDate) },
      withDeleted: true,
      select: { id: true },
    });

    if (!usersToDelete.length) {
      this._logger.log(
        `No closed accounts eligible for hard deletion (threshold: ${CLOSED_ACCOUNT_RETENTION_DAYS} days).`,
      );
      return;
    }

    const userIds = usersToDelete.map(user => user.id);

    // Purge dependent records with non-cascading FKs first.
    await this._userRefreshTokenRepository
      .createQueryBuilder()
      .delete()
      .where('"userId" IN (:...userIds)', { userIds })
      .execute();

    await this._userProfileRepository
      .createQueryBuilder()
      .delete()
      .where('"userId" IN (:...userIds)', { userIds })
      .execute();

    // Account rows are cascade-linked to user and remove characters/endeavour
    // rows automatically at the DB level on hard delete.
    await this._accountRepository
      .createQueryBuilder()
      .delete()
      .where('"userId" IN (:...userIds)', { userIds })
      .execute();

    await this._userRepository
      .createQueryBuilder()
      .delete()
      .where('id IN (:...userIds)', { userIds })
      .execute();

    this._logger.log(
      `Hard deleted ${userIds.length} closed user account(s) older than ${CLOSED_ACCOUNT_RETENTION_DAYS} days.`,
    );
  }
}
