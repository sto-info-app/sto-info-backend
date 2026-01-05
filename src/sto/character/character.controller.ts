import {
  Body,
  Controller,
  Delete,
  Get,
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
import { memoryStorage, File as MulterFile } from 'multer';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserId } from 'src/auth/user-id.decorator';
import { FileSizeExceptionFilter } from 'src/shared/filters/file-size-exception.filter';
import { CharacterService } from './character.service';
import { CreateCharacterRequestDto } from './dto/create-character-request.dto';
import { UpdateCharacterDto } from './dto/update-character.dto';

@ApiTags('STO Character APIs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('character')
export class CharacterController {
  constructor(private readonly characterService: CharacterService) {}

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
      limits: {
        fileSize: +process.env.MAX_IMAGE_SIZE_IN_BYTES,
        files: 1,
        fields: 0,
        headerPairs: 50,
      },
    }),
  )
  @ApiOkResponse({ description: 'Successfully uploaded the profile image.' })
  @ApiBadRequestResponse({ description: 'Failed to upload the profile image.' })
  uploadProfileImage(
    @UserId() userId: string,
    @Param('id') id: string,
    @UploadedFile() file: MulterFile,
  ) {
    return this.characterService.uploadProfileImage(id, userId, file);
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

  // --- Lookup Endpoints ---

  @Get('lookup/general-factions')
  @ApiOkResponse({ description: 'Successfully retrieved general factions.' })
  getGeneralFactions() {
    return this.characterService.getGeneralFactions();
  }

  @Get('lookup/factions')
  @ApiOkResponse({ description: 'Successfully retrieved factions.' })
  getFactions() {
    return this.characterService.getFactions();
  }

  @Get('lookup/sexes')
  @ApiOkResponse({ description: 'Successfully retrieved sexes.' })
  getSexes() {
    return this.characterService.getSexes();
  }

  @Get('lookup/classes')
  @ApiOkResponse({ description: 'Successfully retrieved classes.' })
  getClasses() {
    return this.characterService.getClasses();
  }

  @Get('lookup/recruit-types')
  @ApiOkResponse({ description: 'Successfully retrieved recruit types.' })
  getRecruitTypes() {
    return this.characterService.getRecruitTypes();
  }

  @Get('lookup/species')
  @ApiOkResponse({ description: 'Successfully retrieved species.' })
  getSpecies(
    @Query('factionId') factionId?: string,
    @Query('recruitTypeId') recruitTypeId?: string,
  ) {
    return this.characterService.getSpecies(factionId, recruitTypeId);
  }
}
