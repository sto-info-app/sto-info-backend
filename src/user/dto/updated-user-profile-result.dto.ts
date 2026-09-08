import { ApiProperty } from '@nestjs/swagger';

import { UserProfileEntity } from '../entities/user-profile.entity';

export class UpdatedUserProfileResultDto {
  @ApiProperty({
    description:
      'Number of rows affected by the update. May be 0 if no changes were detected.',
    example: 1,
    minimum: 0,
  })
  affected: number;

  @ApiProperty({
    description: 'Updated user profile data.',
    type: Object,
  })
  userProfileData: Partial<UserProfileEntity>;

  /**
   * Creates an instance of UpdatedUserProfileResultDto.
   *
   * @param affected - The affected.
   * @param userProfileData - The user profile data.
   */
  constructor(affected: number, userProfileData: Partial<UserProfileEntity>) {
    this.affected = affected;
    this.userProfileData = userProfileData;
  }
}
