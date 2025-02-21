import { UserProfileEntity } from '../entities/user-profile.entity';

export class UpdatedUserProfileResultDto {
  affected: number;
  userProfileData: Partial<UserProfileEntity>;

  constructor(affected: number, userProfileData: Partial<UserProfileEntity>) {
    this.affected = affected;
    this.userProfileData = userProfileData;
  }
}
