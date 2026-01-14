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
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { instanceToPlain } from 'class-transformer';
import { Request } from 'express';
import { memoryStorage, File as MulterFile } from 'multer';
import * as crypto from 'node:crypto';
import { extname } from 'node:path';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserId } from 'src/auth/user-id.decorator';
import {
  DEFAULT_MULTER_LIMITS,
  isAllowedImageMimeType,
} from 'src/shared/constants/file-upload.constants';
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
   * Filter for image file uploads.
   *
   * @param _req Request object.
   * @param file File to be validated.
   * @param callback Callback function.
   */
  public static readonly imageFileFilter = (
    _req: Request,
    file: MulterFile,
    callback: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    if (isAllowedImageMimeType(file.mimetype)) {
      callback(null, true);
    } else {
      callback(
        new BadRequestException(
          'Invalid file type. Only PNG, JPG, or JPEGs are allowed.',
        ),
        false,
      );
    }
  };

  /**
   * Retrieves the authenticated user's details.
   *
   * @param userId Authenticated user ID (injected).
   * @returns The user entity.
   */
  @ApiOperation({
    summary: 'Get the current user',
    description:
      'Returns the authenticated user record including the associated profile. Requires a valid JWT bearer token.',
  })
  @ApiOkResponse({
    description: 'User retrieved successfully.',
    type: UserEntity,
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
  @ApiNotFoundResponse({
    description:
      'User does not exist, or the authenticated user id is not a valid UUID.',
  })
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
  @ApiOperation({
    summary: 'Update the current user profile',
    description:
      'Updates profile fields for the authenticated user. The body currently requires a userId field for validation, but the server persists changes against the authenticated user id.',
  })
  @ApiOkResponse({
    description:
      'Profile updated successfully. If no changes were detected, affected may be 0.',
    type: UpdatedUserProfileResultDto,
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
  @ApiBadRequestResponse({
    description: 'Request body is missing or fails validation.',
  })
  @ApiConflictResponse({
    description: 'Username already exists.',
  })
  @ApiNotFoundResponse({
    description: 'User/profile not found for the authenticated user id.',
  })
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
  @ApiOperation({
    summary: 'Upload a new profile picture',
    description:
      'Uploads an image to Cloudflare Images and stores the resulting image id on the user profile. Accepts a single file field named profilePicture.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['profilePicture'],
      properties: {
        profilePicture: {
          type: 'string',
          format: 'binary',
          description: 'PNG, JPG, or JPEG image file.',
        },
      },
    },
  })
  @ApiOkResponse({
    description: 'Profile picture updated successfully.',
    type: UpdatedUserProfileResultDto,
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
  @ApiBadRequestResponse({
    description:
      'No file was supplied, or the file type is not allowed (PNG/JPG/JPEG only).',
  })
  @ApiPayloadTooLargeResponse({
    description: 'Uploaded file exceeds the configured maximum image size.',
  })
  @ApiNotFoundResponse({
    description: 'User/profile not found for the authenticated user id.',
  })
  @Post('update-profile-pic')
  @HttpCode(HttpStatus.OK)
  @UseFilters(FileSizeExceptionFilter)
  @UseInterceptors(
    FileInterceptor('profilePicture', {
      storage: memoryStorage(),
      fileFilter: UserController.imageFileFilter,
      limits: {
        fileSize:
          +process.env.MAX_IMAGE_SIZE_IN_BYTES ||
          DEFAULT_MULTER_LIMITS.fileSize,
        fieldSize:
          +process.env.MAX_IMAGE_SIZE_IN_BYTES ||
          DEFAULT_MULTER_LIMITS.fieldSize,
        files: DEFAULT_MULTER_LIMITS.files,
        fields: DEFAULT_MULTER_LIMITS.fields,
        parts: DEFAULT_MULTER_LIMITS.parts,
        headerPairs: DEFAULT_MULTER_LIMITS.headerPairs,
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
