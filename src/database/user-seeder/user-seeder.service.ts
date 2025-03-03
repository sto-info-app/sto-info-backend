import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import * as bcrypt from 'bcrypt';
import { UserProfileEntity } from 'src/user/entities/user-profile.entity';
import { UserEntity } from 'src/user/entities/user.entity';

import { UserService } from 'src/user/user.service';
import { Repository } from 'typeorm';

@Injectable()
export class UserSeederService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,

    @InjectRepository(UserProfileEntity)
    private readonly userProfileRepository: Repository<UserProfileEntity>,

    private readonly userService: UserService,
  ) {}

  async seed() {
    await this.seedUsers();
  }

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
      const existingUser = await this.userService.findByEmail(
        process.env.DATASEED_USER_EMAIL,
      );

      if (!existingUser) {
        const user = new UserEntity();
        user.email = process.env.DATASEED_USER_EMAIL;
        user.password = await bcrypt.hash(
          process.env.DATASEED_USER_PASSWORD,
          +process.env.AUTH_SALT_ROUNDS,
        );
        user.emailVerified = true;

        const newUser = await this.userRepository.save(user);

        if (newUser) {
          const userProfile = new UserProfileEntity();
          userProfile.userId = newUser.id;
          userProfile.username = process.env.DATASEED_USER_USERNAME;
          userProfile.firstName = process.env.DATASEED_USER_FIRSTNAME;
          userProfile.lastName = process.env.DATASEED_USER_LASTNAME;
          await this.userProfileRepository.save(userProfile);
        }
      }
    }
  }
}
