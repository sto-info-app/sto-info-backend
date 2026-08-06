import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from 'src/auth/public.decorator';
import { RegistryAccountDto } from './dto/registry-account.dto';
import { RegistryCharacterDto } from './dto/registry-character.dto';
import {
  PaginatedRegistryProfilesDto,
  RegistryProfileDto,
} from './dto/registry-profile.dto';
import { RegistryQueryDto } from './dto/registry-query.dto';
import { RegistryService } from './registry.service';

/**
 * Public, unauthenticated read access to the Galactic Personnel Registry.
 *
 * No guard is applied at any level: these routes are intentionally open. Every
 * response is an explicitly mapped DTO — see `RegistryService` — so no private
 * field is reachable through this controller.
 */
@ApiTags('Galactic Personnel Registry')
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
  ): Promise<PaginatedRegistryProfilesDto> {
    return this._registryService.findProfiles(query);
  }

  /**
   * Retrieves a single publicly visible member.
   *
   * @param username - The member's profile username.
   * @returns The member's public profile.
   */
  @Public()
  @Get('profiles/:username')
  @ApiOperation({ summary: 'Get a registry member by username' })
  @ApiOkResponse({ description: 'The member.', type: RegistryProfileDto })
  @ApiNotFoundResponse({ description: 'No publicly visible member matches.' })
  findProfile(
    @Param('username') username: string,
  ): Promise<RegistryProfileDto> {
    return this._registryService.findProfileByUsername(username);
  }

  /**
   * Retrieves a publicly visible STO account.
   *
   * @param username - The owning member's profile username.
   * @param accountSlug - The account's URL slug.
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
  ): Promise<RegistryAccountDto> {
    return this._registryService.findAccount(username, accountSlug);
  }

  /**
   * Retrieves a publicly visible captain.
   *
   * @param username - The owning member's profile username.
   * @param accountSlug - The owning account's URL slug.
   * @param characterSlug - The captain's URL slug.
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
  ): Promise<RegistryCharacterDto> {
    return this._registryService.findCharacter(
      username,
      accountSlug,
      characterSlug,
    );
  }
}
