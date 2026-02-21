import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserId } from 'src/auth/user-id.decorator';
import {
  DEFAULT_MULTER_LIMITS,
  isAllowedImageMimeType,
} from 'src/shared/constants/file-upload.constants';
import { FileSizeExceptionFilter } from 'src/shared/filters/file-size-exception.filter';
import { CharacterService } from './character.service';
import { CreateCharacterRequestDto } from './dto/create-character-request.dto';
import { UpdateCharacterDto } from './dto/update-character.dto';

@ApiTags('STO Character APIs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('character')
export class CharacterController {
  private readonly logger = new Logger(CharacterController.name);

  constructor(private readonly characterService: CharacterService) {}

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
   * Uploads a profile image for a character.
   *
   * @param userId Authenticated user ID (injected).
   * @param id Character ID.
   * @param file The image file.
   * @returns The updated character.
   */
  @Post(':id/profile-image')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        profilePicture: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @UseFilters(FileSizeExceptionFilter)
  @UseInterceptors(
    FileInterceptor('profilePicture', {
      storage: memoryStorage(),
      fileFilter: CharacterController.imageFileFilter,
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
  @ApiOkResponse({ description: 'Successfully uploaded the profile image.' })
  @ApiBadRequestResponse({ description: 'Failed to upload the profile image.' })
  async uploadProfileImage(
    @UserId() userId: string,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    this.logger.debug(
      `[uploadProfileImage] Request received - UserId: ${userId}, CharacterId: ${id}`,
    );

    if (!file) {
      this.logger.error(
        `[uploadProfileImage] No file provided - UserId: ${userId}, CharacterId: ${id}`,
      );
      throw new BadRequestException('Image file is required');
    }

    this.logger.debug(
      `[uploadProfileImage] File metadata - Name: ${file.originalname}, Size: ${file.size} bytes, MimeType: ${file.mimetype}`,
    );

    try {
      const result = await this.characterService.uploadProfileImage(
        id,
        userId,
        file,
      );
      this.logger.log(
        `[uploadProfileImage] Successfully uploaded image - UserId: ${userId}, CharacterId: ${id}`,
      );
      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `[uploadProfileImage] Failed to upload image - UserId: ${userId}, CharacterId: ${id}, Error: ${message}`,
        stack,
      );
      throw error;
    }
  }

  /**
   * Creates a new STO character for an account owned by the authenticated user.
   *
   * @param userId Authenticated user ID (injected).
   * @param createCharacterDto Request payload.
   * @returns The created character.
   */
  @Post()
  @ApiOkResponse({ description: 'Successfully created the character.' })
  @ApiBadRequestResponse({ description: 'Failed to create the character.' })
  create(
    @UserId() userId: string,
    @Body() createCharacterDto: CreateCharacterRequestDto,
  ) {
    return this.characterService.create(createCharacterDto, userId);
  }

  /**
   * Lists all STO characters for a specific account owned by the authenticated user.
   *
   * @param userId Authenticated user ID (injected).
   * @param accountId Account ID.
   * @returns The account's characters.
   */
  @Get()
  @ApiOkResponse({ description: 'Successfully found the account characters.' })
  findAllForAccount(
    @UserId() userId: string,
    @Query('accountId') accountId: string,
  ) {
    return this.characterService.findAllForAccount(accountId, userId);
  }

  /**
   * Retrieves a single STO character by ID for the authenticated user.
   *
   * @param userId Authenticated user ID (injected).
   * @param id Character ID.
   * @returns The requested character.
   */
  @Get(':id')
  @ApiOkResponse({ description: 'Successfully found the character.' })
  @ApiBadRequestResponse({ description: 'Failed to find the character.' })
  findOne(@UserId() userId: string, @Param('id') id: string) {
    return this.characterService.findOneForUser(id, userId);
  }

  /**
   * Updates a STO character for the authenticated user.
   *
   * @param userId Authenticated user ID (injected).
   * @param id Character ID.
   * @param updateCharacterDto Partial update payload.
   * @returns The updated character.
   */
  @Put(':id')
  @ApiOkResponse({ description: 'Successfully updated the character.' })
  @ApiBadRequestResponse({ description: 'Failed to update the character.' })
  update(
    @UserId() userId: string,
    @Param('id') id: string,
    @Body() updateCharacterDto: UpdateCharacterDto,
  ) {
    return this.characterService.updateForUser(id, userId, updateCharacterDto);
  }

  /**
   * Removes (soft-deletes) a STO character for the authenticated user.
   *
   * @param userId Authenticated user ID (injected).
   * @param id Character ID.
   */
  @Delete(':id')
  @ApiOkResponse({ description: 'Successfully removed the character.' })
  @ApiBadRequestResponse({ description: 'Failed to remove the character.' })
  remove(@UserId() userId: string, @Param('id') id: string) {
    return this.characterService.removeForUser(id, userId);
  }

  /**
   * Retrieves a list of general factions.
   *
   * @returns List of general factions.
   */
  @Get('lookup/general-factions')
  @ApiOkResponse({ description: 'Successfully retrieved general factions.' })
  getGeneralFactions() {
    return this.characterService.getGeneralFactions();
  }

  /**
   * Retrieves a list of specific factions.
   *
   * @returns List of factions.
   */
  @Get('lookup/factions')
  @ApiOkResponse({ description: 'Successfully retrieved factions.' })
  getFactions() {
    return this.characterService.getFactions();
  }

  /**
   * Retrieves a list of character sexes.
   *
   * @returns List of sexes.
   */
  @Get('lookup/sexes')
  @ApiOkResponse({ description: 'Successfully retrieved sexes.' })
  getSexes() {
    return this.characterService.getSexes();
  }

  /**
   * Retrieves a list of character classes.
   *
   * @returns List of classes.
   */
  @Get('lookup/classes')
  @ApiOkResponse({ description: 'Successfully retrieved classes.' })
  getClasses() {
    return this.characterService.getClasses();
  }

  /**
   * Retrieves a list of character recruit types.
   *
   * @returns List of recruit types.
   */
  @Get('lookup/recruit-types')
  @ApiOkResponse({ description: 'Successfully retrieved recruit types.' })
  getRecruitTypes() {
    return this.characterService.getRecruitTypes();
  }

  /**
   * Retrieves a list of species, optionally filtered by faction or recruit type.
   *
   * @param factionId Optional faction ID filter.
   * @param recruitTypeId Optional recruit type ID filter.
   * @returns List of species.
   */
  @Get('lookup/species')
  @ApiOkResponse({ description: 'Successfully retrieved species.' })
  getSpecies(
    @Query('factionId') factionId?: string,
    @Query('recruitTypeId') recruitTypeId?: string,
  ) {
    return this.characterService.getSpecies(factionId, recruitTypeId);
  }
}
