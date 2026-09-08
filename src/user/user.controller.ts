import * as crypto from 'node:crypto';
import { extname } from 'node:path';

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Put,
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
import type { Request } from 'express';
import { memoryStorage } from 'multer';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserId } from 'src/auth/user-id.decorator';
import {
  DEFAULT_MULTER_LIMITS,
  isAllowedImageMimeType,
} from 'src/shared/constants/file-upload.constants';
import { FileSizeExceptionFilter } from 'src/shared/filters/file-size-exception.filter';

import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { UpdateUserSettingsDto } from './dto/update-user-settings.dto';
import { UpdatedUserProfileResultDto } from './dto/updated-user-profile-result.dto';
import { UserSettingsDto } from './dto/user-settings.dto';
import { UserEntity } from './entities/user.entity';
import { UserService } from './user.service';

@ApiTags('App User')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('user')
export class UserController {
  /**
   * Creates an instance of UserController.
   *
   * @param _userService - The user service.
   */
  constructor(private readonly _userService: UserService) {}

  /**
   * Filter for image file uploads.
   *
   * @param _req Request object.
   * @param file File to be validated.
   * @param callback Callback function.
   */
  public static readonly imageFileFilter = (
    _req: Request,
    file: Express.Multer.File,
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
    return await this._userService.findById(userId);
  }

  /**
   * Retrieves the authenticated user's application settings.
   *
   * @param userId Authenticated user ID (injected).
   * @returns The user's settings.
   */
  @ApiOperation({ summary: 'Get the current user settings' })
  @ApiOkResponse({ type: UserSettingsDto })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
  @Get('settings')
  @HttpCode(HttpStatus.OK)
  async getSettings(@UserId() userId: string): Promise<UserSettingsDto> {
    return this._userService.getSettings(userId);
  }

  /**
   * Updates the authenticated user's application settings.
   *
   * @param userId Authenticated user ID (injected).
   * @param settings Settings to persist.
   * @returns The updated settings.
   */
  @ApiOperation({ summary: 'Update the current user settings' })
  @ApiOkResponse({ type: UserSettingsDto })
  @ApiBadRequestResponse({ description: 'Settings fail validation.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
  @Put('settings')
  @HttpCode(HttpStatus.OK)
  async updateSettings(
    @UserId() userId: string,
    @Body() settings: UpdateUserSettingsDto,
  ): Promise<UserSettingsDto> {
    return this._userService.updateSettings(userId, settings);
  }

  /**
   * Closes the authenticated user's account.
   *
   * Marks user-linked data as deleted immediately and schedules permanent
   * deletion via retention cron jobs.
   *
   * @param userId Authenticated user ID (injected).
   */
  @ApiOperation({
    summary: 'Close the current user account',
    description:
      'Marks user-linked data as deleted and revokes active sessions. Permanent deletion is performed later by scheduled retention jobs.',
  })
  @ApiOkResponse({ description: 'Account closure has been accepted.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
  @ApiNotFoundResponse({
    description:
      'User does not exist, or the authenticated user id is invalid.',
  })
  @Delete('close-account')
  @HttpCode(HttpStatus.OK)
  async closeAccount(@UserId() userId: string): Promise<{ success: true }> {
    await this._userService.closeAccount(userId);
    return { success: true };
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
      'Updates profile fields for the authenticated user. The user id is resolved from the bearer token.',
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
    const result = await this._userService.updateUserProfile(
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
          +process.env.MAX_IMAGE_SIZE_IN_BYTES! ||
          DEFAULT_MULTER_LIMITS.fileSize,
        fieldSize:
          +process.env.MAX_IMAGE_SIZE_IN_BYTES! ||
          DEFAULT_MULTER_LIMITS.fieldSize,
        files: DEFAULT_MULTER_LIMITS.files,
        fields: DEFAULT_MULTER_LIMITS.fields,
        parts: DEFAULT_MULTER_LIMITS.parts,
        headerPairs: DEFAULT_MULTER_LIMITS.headerPairs,
      },
    }),
  )
  async updateUserProfilePic(@UserId() userId: string, @Req() req: Request) {
    const file = (req as any)?.file as Express.Multer.File | undefined;
    if (!file) {
      throw new HttpException('Image file is required', HttpStatus.BAD_REQUEST);
    }

    const uniqueSuffix = Date.now().toString() + '-' + crypto.randomUUID();
    file.filename = `${file.fieldname}-${uniqueSuffix}${extname(file.originalname)}`;

    const result = await this._userService.uploadProfilePicture(userId, file);

    return new UpdatedUserProfileResultDto(
      result.affected,
      instanceToPlain(result.userProfileData),
    );
  }
}
