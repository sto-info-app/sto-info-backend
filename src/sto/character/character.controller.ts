import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserId } from 'src/auth/user-id.decorator';
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
