import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { OptionalJwtAuthGuard } from 'src/auth/optional-jwt-auth.guard';
import { Public } from 'src/auth/public.decorator';
import { OptionalUserId } from 'src/auth/user-id.decorator';
import { RegistryAccountDto } from './dto/registry-account.dto';
import { RegistryCharacterDto } from './dto/registry-character.dto';
import {
  PaginatedRegistryProfilesDto,
  RegistryProfileDto,
} from './dto/registry-profile.dto';
import { RegistryQueryDto } from './dto/registry-query.dto';
import { RegistryService } from './registry.service';

/**
 * Public read access to the Galactic Personnel Registry.
 *
 * These routes are intentionally open — {@link OptionalJwtAuthGuard} lets an
 * anonymous request straight through — but a token is honoured when one is
 * sent, so the response can hide members the caller has blocked or been
 * blocked by and can say how the caller relates to the member they are
 * viewing. Every response is an explicitly mapped DTO, see `RegistryService`,
 * so no private field is reachable through this controller either way.
 */
@ApiTags('Galactic Personnel Registry')
@ApiBearerAuth()
@UseGuards(OptionalJwtAuthGuard)
@Controller('registry')
export class RegistryController {
  /**
   * Creates an instance of RegistryController.
   *
   * @param _registryService - The registry service.
   */
  constructor(private readonly _registryService: RegistryService) {}

  /**
   * Lists publicly visible members.
   *
   * @param query - Search, sort and pagination options.
   * @param viewerId - The authenticated caller's user ID, or null.
   * @returns A page of member summaries.
   */
  @Public()
  @Get('profiles')
  @ApiOperation({ summary: 'List publicly visible registry members' })
  @ApiOkResponse({
    description: 'A page of members.',
    type: PaginatedRegistryProfilesDto,
  })
  findProfiles(
    @Query() query: RegistryQueryDto,
    @OptionalUserId() viewerId: string | null,
  ): Promise<PaginatedRegistryProfilesDto> {
    return this._registryService.findProfiles(query, viewerId);
  }

  /**
   * Retrieves a single publicly visible member.
   *
   * @param username - The member's profile username.
   * @param viewerId - The authenticated caller's user ID, or null.
   * @returns The member's public profile.
   */
  @Public()
  @Get('profiles/:username')
  @ApiOperation({ summary: 'Get a registry member by username' })
  @ApiOkResponse({ description: 'The member.', type: RegistryProfileDto })
  @ApiNotFoundResponse({ description: 'No publicly visible member matches.' })
  findProfile(
    @Param('username') username: string,
    @OptionalUserId() viewerId: string | null,
  ): Promise<RegistryProfileDto> {
    return this._registryService.findProfileByUsername(username, viewerId);
  }

  /**
   * Retrieves a publicly visible STO account.
   *
   * @param username - The owning member's profile username.
   * @param accountSlug - The account's URL slug.
   * @param viewerId - The authenticated caller's user ID, or null.
   * @returns The account's public detail view.
   */
  @Public()
  @Get('profiles/:username/:accountSlug')
  @ApiOperation({ summary: 'Get a publicly visible STO account' })
  @ApiOkResponse({ description: 'The account.', type: RegistryAccountDto })
  @ApiNotFoundResponse({ description: 'No publicly visible account matches.' })
  findAccount(
    @Param('username') username: string,
    @Param('accountSlug') accountSlug: string,
    @OptionalUserId() viewerId: string | null,
  ): Promise<RegistryAccountDto> {
    return this._registryService.findAccount(username, accountSlug, viewerId);
  }

  /**
   * Retrieves a publicly visible captain.
   *
   * @param username - The owning member's profile username.
   * @param accountSlug - The owning account's URL slug.
   * @param characterSlug - The captain's URL slug.
   * @param viewerId - The authenticated caller's user ID, or null.
   * @returns The captain's public detail view.
   */
  @Public()
  @Get('profiles/:username/:accountSlug/:characterSlug')
  @ApiOperation({ summary: 'Get a publicly visible captain' })
  @ApiOkResponse({ description: 'The captain.', type: RegistryCharacterDto })
  @ApiNotFoundResponse({ description: 'No publicly visible captain matches.' })
  findCharacter(
    @Param('username') username: string,
    @Param('accountSlug') accountSlug: string,
    @Param('characterSlug') characterSlug: string,
    @OptionalUserId() viewerId: string | null,
  ): Promise<RegistryCharacterDto> {
    return this._registryService.findCharacter(
      username,
      accountSlug,
      characterSlug,
      viewerId,
    );
  }
}
