import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';

import {
  AccountClosureEvent,
  AccountClosureLedgerService,
} from 'src/user/closure/account-closure-ledger.service';
import { UserProfileEntity } from 'src/user/entities/user-profile.entity';
import { UserEntity } from 'src/user/entities/user.entity';

@Injectable()
export class UserSeederService {
  /**
   * Creates an instance of UserSeederService.
   *
   * @param _userRepository - The user repository.
   * @param _userProfileRepository - The user profile repository.
   * @param _closures - Records the seed user being opened again (FC-042).
   */
  constructor(
    @InjectRepository(UserEntity)
    private readonly _userRepository: Repository<UserEntity>,

    @InjectRepository(UserProfileEntity)
    private readonly _userProfileRepository: Repository<UserProfileEntity>,

    private readonly _closures: AccountClosureLedgerService,
  ) {}

  /**
   * Seeds the configured data.
   *
   * @returns A promise that resolves when the operation completes.
   */
  async seed() {
    await this.seedUsers();
  }

  /**
   * Seeds the default users.
   *
   * @returns A promise that resolves when the operation completes.
   */
  private async seedUsers() {
    const inProduction = process.env.NODE_ENV === 'prod';
    if (inProduction) return;

    if (
      process.env.DATASEED_USER_EMAIL &&
      process.env.DATASEED_USER_USERNAME &&
      process.env.DATASEED_USER_FIRSTNAME &&
      process.env.DATASEED_USER_LASTNAME &&
      process.env.DATASEED_USER_PASSWORD
    ) {
      const existingUser = await this._userRepository.findOne({
        where: { email: process.env.DATASEED_USER_EMAIL },
        relations: { profile: true },
        withDeleted: true,
      });

      if (existingUser?.deletedAt) {
        await this.restoreSeededUser(existingUser);
        return;
      }

      if (!existingUser) {
        const user = new UserEntity();
        user.email = process.env.DATASEED_USER_EMAIL;
        user.password = await bcrypt.hash(
          process.env.DATASEED_USER_PASSWORD,
          +process.env.AUTH_SALT_ROUNDS!,
        );
        user.emailVerified = true;

        const newUser = await this._userRepository.save(user);

        if (newUser) {
          const userProfile = new UserProfileEntity();
          userProfile.userId = newUser.id;
          userProfile.username = process.env.DATASEED_USER_USERNAME;
          userProfile.firstName = process.env.DATASEED_USER_FIRSTNAME;
          userProfile.lastName = process.env.DATASEED_USER_LASTNAME;
          await this._userProfileRepository.save(userProfile);
        }
      }
    }
  }

  /**
   * Restores the configured seed user when the record exists but has been
   * soft-deleted by local account-closure testing.
   *
   * The reopening is written to the account-closure ledger first (FC-042),
   * so the restore check at the next boot does not close the seed user
   * again from its closure's marker.
   *
   * @param existingUser - The matching soft-deleted user entity.
   */
  private async restoreSeededUser(existingUser: UserEntity): Promise<void> {
    await this._closures.record(existingUser.id, AccountClosureEvent.REOPENED);
    await this._userRepository.restore(existingUser.id);

    existingUser.password = await bcrypt.hash(
      process.env.DATASEED_USER_PASSWORD!,
      +process.env.AUTH_SALT_ROUNDS!,
    );
    existingUser.emailVerified = true;
    existingUser.deletedAt = null;

    await this._userRepository.save(existingUser);

    const existingProfile = existingUser.profile;

    if (existingProfile?.deletedAt) {
      await this._userProfileRepository.restore(existingUser.id);
    }

    const userProfile = existingProfile ?? new UserProfileEntity();
    userProfile.userId = existingUser.id;
    userProfile.username = process.env.DATASEED_USER_USERNAME!;
    userProfile.firstName = process.env.DATASEED_USER_FIRSTNAME!;
    userProfile.lastName = process.env.DATASEED_USER_LASTNAME!;

    await this._userProfileRepository.save(userProfile);
  }
}
