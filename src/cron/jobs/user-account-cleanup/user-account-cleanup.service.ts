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
  private readonly logger = new Logger(UserAccountCleanupService.name);

  /**
   * Creates an instance of UserAccountCleanupService.
   *
   * @param userRepository - User repository.
   * @param userProfileRepository - User profile repository.
   * @param userRefreshTokenRepository - User refresh token repository.
   * @param accountRepository - Account repository.
   */
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,

    @InjectRepository(UserProfileEntity)
    private readonly userProfileRepository: Repository<UserProfileEntity>,

    @InjectRepository(UserRefreshTokenEntity)
    private readonly userRefreshTokenRepository: Repository<UserRefreshTokenEntity>,

    @InjectRepository(AccountEntity)
    private readonly accountRepository: Repository<AccountEntity>,
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

    const usersToDelete = await this.userRepository.find({
      where: { deletedAt: LessThan(thresholdDate) },
      withDeleted: true,
      select: { id: true },
    });

    if (!usersToDelete.length) {
      this.logger.log(
        `No closed accounts eligible for hard deletion (threshold: ${CLOSED_ACCOUNT_RETENTION_DAYS} days).`,
      );
      return;
    }

    const userIds = usersToDelete.map(user => user.id);

    // Purge dependent records with non-cascading FKs first.
    await this.userRefreshTokenRepository
      .createQueryBuilder()
      .delete()
      .where('"userId" IN (:...userIds)', { userIds })
      .execute();

    await this.userProfileRepository
      .createQueryBuilder()
      .delete()
      .where('"userId" IN (:...userIds)', { userIds })
      .execute();

    // Account rows are cascade-linked to user and remove characters/endeavour
    // rows automatically at the DB level on hard delete.
    await this.accountRepository
      .createQueryBuilder()
      .delete()
      .where('"userId" IN (:...userIds)', { userIds })
      .execute();

    await this.userRepository
      .createQueryBuilder()
      .delete()
      .where('id IN (:...userIds)', { userIds })
      .execute();

    this.logger.log(
      `Hard deleted ${userIds.length} closed user account(s) older than ${CLOSED_ACCOUNT_RETENTION_DAYS} days.`,
    );
  }
}
