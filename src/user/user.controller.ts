import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { instanceToPlain } from 'class-transformer';
import { Request } from 'express';
import { memoryStorage, File as MulterFile } from 'multer';
import * as crypto from 'node:crypto';
import { extname } from 'node:path';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserId } from 'src/auth/user-id.decorator';
import { FileSizeExceptionFilter } from 'src/shared/filters/file-size-exception.filter';
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

  /**
   * Retrieves the authenticated user's details.
   *
   * @param userId Authenticated user ID (injected).
   * @returns The user entity.
   */
  @ApiOkResponse({ description: 'Successfully found the user.' })
  @ApiBadRequestResponse({ description: 'The user cannot be found.' })
  @Get()
  @HttpCode(HttpStatus.OK)
  async findUser(@UserId() userId: string): Promise<UserEntity> {
    return await this.userService.findById(userId);
  }

  /**
   * Updates the authenticated user's profile information.
   *
   * @param userId Authenticated user ID (injected).
   * @param userProfileData Update data payload.
   * @returns Result of the update operation.
   */
  @ApiOkResponse({ description: 'Successfully updated the user profile.' })
  @ApiBadRequestResponse({ description: 'Invalid user data provided.' })
  @Post('update-profile')
  @HttpCode(HttpStatus.OK)
  async updateUserProfile(
    @UserId() userId: string,
    @Body() userProfileData: UpdateUserProfileDto,
  ): Promise<UpdatedUserProfileResultDto> {
    if (!userProfileData) {
      throw new HttpException('User data is required', HttpStatus.BAD_REQUEST);
    }
    const result = await this.userService.updateUserProfile(
      userId,
      userProfileData,
    );

    return new UpdatedUserProfileResultDto(
      result.affected,
      instanceToPlain(result.updatedProfile),
    );
  }

  /**
   * Updates the authenticated user's profile picture.
   *
   * @param userId Authenticated user ID (injected).
   * @param req Request object containing the uploaded file.
   * @returns Result of the update operation.
   */
  @ApiOkResponse({
    description: 'Successfully updated the user profile picture.',
  })
  @ApiBadRequestResponse({ description: 'Invalid image provided.' })
  @Post('update-profile-pic')
  @HttpCode(HttpStatus.OK)
  @UseFilters(FileSizeExceptionFilter)
  @UseInterceptors(
    FileInterceptor('profilePicture', {
      storage: memoryStorage(),
      fileFilter: (
        _req: Request,
        file: MulterFile,
        callback: (error: Error | null, acceptFile: boolean) => void,
      ) => {
        const allowedMimeTypes = ['image/png', 'image/jpg', 'image/jpeg'];
        if (allowedMimeTypes.includes(file.mimetype)) {
          callback(null, true);
        } else {
          callback(
            new BadRequestException(
              'Invalid file type. Only PNG, JPG, or JPEGs are allowed.',
            ),
            false,
          );
        }
      },
      limits: {
        fileSize: +process.env.MAX_IMAGE_SIZE_IN_BYTES,
        fieldSize: +process.env.MAX_IMAGE_SIZE_IN_BYTES,
        files: 1,
        fields: 0,
        parts: 1,
        headerPairs: 50,
      },
    }),
  )
  async updateUserProfilePic(@UserId() userId: string, @Req() req) {
    const file = req?.file as MulterFile | undefined;
    if (!file) {
      throw new HttpException('Image file is required', HttpStatus.BAD_REQUEST);
    }

    const uniqueSuffix = Date.now().toString() + '-' + crypto.randomUUID();
    file.filename = `${file.fieldname}-${uniqueSuffix}${extname(file.originalname)}`;

    const result = await this.userService.uploadProfilePicture(userId, file);

    return new UpdatedUserProfileResultDto(
      result.affected,
      instanceToPlain(result.userProfileData),
    );
  }
}
