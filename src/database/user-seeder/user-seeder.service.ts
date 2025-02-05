import { Injectable } from '@nestjs/common';

import * as bcrypt from 'bcrypt';

import { User } from 'src/user/entities/user.entity';
import { UserService } from 'src/user/user.service';

@Injectable()
export class UserSeederService {
  constructor(private readonly userService: UserService) {}

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
        const user = new User();
        user.email = process.env.DATASEED_USER_EMAIL;
        user.username = process.env.DATASEED_USER_USERNAME;
        user.firstName = process.env.DATASEED_USER_FIRSTNAME;
        user.lastName = process.env.DATASEED_USER_LASTNAME;
        user.password = await bcrypt.hash(
          process.env.DATASEED_USER_PASSWORD,
          +process.env.AUTH_SALT_ROUNDS,
        );
        user.emailVerified = true;

        await this.userService.seedUser(user);
      }
    }
  }
}
