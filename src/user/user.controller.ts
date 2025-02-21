import {
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { instanceToPlain } from 'class-transformer';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { UpdatedUserProfileResultDto } from './dto/updated-user-profile-result.dto';
import { UserEntity } from './entities/user.entity';
import { UserService } from './user.service';

@ApiTags('App User')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @ApiOkResponse({ description: 'Successfully found the user.' })
  @ApiBadRequestResponse({ description: 'The user cannot be found.' })
  @Get()
  @HttpCode(HttpStatus.OK)
  async findUser(@Req() req): Promise<UserEntity> {
    if (!req.user?.id) {
      throw new HttpException('User not found', HttpStatus.BAD_REQUEST);
    }
    return await this.userService.findById(req.user.id);
  }

  @ApiOkResponse({ description: 'Successfully updated the user profile.' })
  @ApiBadRequestResponse({ description: 'Invalid user data provided.' })
  @Post('update-profile')
  @HttpCode(HttpStatus.OK)
  async updateUserProfile(@Req() req): Promise<UpdatedUserProfileResultDto> {
    const userProfileData: UpdateUserProfileDto = req.body;
    if (!userProfileData) {
      throw new HttpException('User data is required', HttpStatus.BAD_REQUEST);
    }
    const result = await this.userService.updateUserProfile(
      req.user.id,
      userProfileData,
    );

    return new UpdatedUserProfileResultDto(
      result.affected,
      instanceToPlain(result.updatedProfile),
    );
  }
}
