import {
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  UploadedFile,
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
import { memoryStorage, Multer } from 'multer';
import { extname } from 'node:path';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
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
      fileFilter: (_req, file, cb) => {
        const allowedMimeTypes = ['image/png', 'image/jpg', 'image/jpeg'];
        if (allowedMimeTypes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(
            new HttpException(
              'Invalid file type. Only PNG, JPG, or JPEGs are allowed.',
              HttpStatus.BAD_REQUEST,
            ),
            false,
          );
        }
      },
      limits: {
        fileSize: +process.env.MAX_IMAGE_SIZE_IN_BYTES,
        files: 1,
      },
    }),
  )
  async updateUserProfilePic(
    @Req() req,
    @UploadedFile() file: Multer.File,
  ): Promise<UpdatedUserProfileResultDto> {
    if (!file) {
      throw new HttpException('Image file is required', HttpStatus.BAD_REQUEST);
    }

    const uniqueSuffix = Date.now().toString() + '-' + crypto.randomUUID();
    file.filename = `${file.fieldname}-${uniqueSuffix}${extname(file.originalname)}`;

    const result = await this.userService.uploadProfilePicture(
      req.user.id,
      file,
    );

    return new UpdatedUserProfileResultDto(
      result.affected,
      instanceToPlain(result),
    );
  }
}
