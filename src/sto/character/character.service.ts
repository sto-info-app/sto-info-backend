import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isValidCloudflareImageUrl } from 'src/shared/constants/image.constants';
import { stringifyError } from 'src/shared/utilities/error.utility';
import {
  generateSlug,
  normalizeHandle,
} from 'src/shared/utilities/handle.utility';
import { ImageUploadsService } from 'src/shared/utilities/image-uploads.service';

import { Not, Repository } from 'typeorm';
import { AccountEntity } from '../account/entities/account.entity';
import { CreateCharacterDto } from './dto/create-character.dto';
import { UpdateCharacterDto } from './dto/update-character.dto';
import { CharacterClassEntity } from './entities/character-class.entity';
import { CharacterEntity } from './entities/character.entity';
import { FactionEntity } from './entities/faction.entity';
import { GeneralFactionEntity } from './entities/general-faction.entity';
import { RecruitTypeEntity } from './entities/recruit-type.entity';
import { SexEntity } from './entities/sex.entity';
import { SpeciesEntity } from './entities/species.entity';

@Injectable()
export class CharacterService {
  private readonly _logger = new Logger(CharacterService.name);

  /**
   * Creates an instance of CharacterService.
   *
   * @param _characterRepository - The character repository.
   * @param _accountRepository - The account repository.
   * @param _generalFactionRepository - The general faction repository.
   * @param _factionRepository - The faction repository.
   * @param _sexRepository - The sex repository.
   * @param _classRepository - The class repository.
   * @param _recruitTypeRepository - The recruit type repository.
   * @param _speciesRepository - The species repository.
   * @param _imageUploadsService - The image uploads service.
   */
  constructor(
    @InjectRepository(CharacterEntity)
    private readonly _characterRepository: Repository<CharacterEntity>,
    @InjectRepository(AccountEntity)
    private readonly _accountRepository: Repository<AccountEntity>,
    @InjectRepository(GeneralFactionEntity)
    private readonly _generalFactionRepository: Repository<GeneralFactionEntity>,
    @InjectRepository(FactionEntity)
    private readonly _factionRepository: Repository<FactionEntity>,
    @InjectRepository(SexEntity)
    private readonly _sexRepository: Repository<SexEntity>,
    @InjectRepository(CharacterClassEntity)
    private readonly _classRepository: Repository<CharacterClassEntity>,
    @InjectRepository(RecruitTypeEntity)
    private readonly _recruitTypeRepository: Repository<RecruitTypeEntity>,
    @InjectRepository(SpeciesEntity)
    private readonly _speciesRepository: Repository<SpeciesEntity>,
    private readonly _imageUploadsService: ImageUploadsService,
  ) {}

  /**
   * Sanitizes a Cloudflare image URL from persisted data.
   *
   * @param imageUrl - Candidate image URL.
   * @returns A valid Cloudflare image URL, or `null` when invalid.
   */
  private sanitizeCloudflareImageUrl(imageUrl?: string | null): string | null {
    if (!isValidCloudflareImageUrl(imageUrl)) {
      return null;
    }

    return imageUrl;
  }

  /**
   * Sanitizes icon URL fields on character relation data.
   *
   * @param character - Character to sanitize in-place.
   * @returns The sanitized character.
   */
  private sanitizeCharacterImageUrls(
    character: CharacterEntity,
  ): CharacterEntity {
    if (character.generalFaction) {
      character.generalFaction.iconUrl = this.sanitizeCloudflareImageUrl(
        character.generalFaction.iconUrl,
      );
    }

    if (character.faction) {
      character.faction.iconUrl = this.sanitizeCloudflareImageUrl(
        character.faction.iconUrl,
      );

      if (Array.isArray(character.faction.ranks)) {
        character.faction.ranks.forEach(rank => {
          rank.iconUrl = this.sanitizeCloudflareImageUrl(rank.iconUrl);
        });
      }
    }

    if (character.recruitType) {
      character.recruitType.iconUrl = this.sanitizeCloudflareImageUrl(
        character.recruitType.iconUrl,
      );
    }

    return character;
  }

  /**
   * Sanitizes icon URL fields on lookup entities that expose `iconUrl`.
   *
   * @param entities - Lookup entities to sanitize.
   * @returns The sanitized entities.
   */
  private sanitizeLookupImageUrls<T extends { iconUrl: string | null }>(
    entities: T[],
  ): T[] {
    return entities.map(entity => {
      entity.iconUrl = this.sanitizeCloudflareImageUrl(entity.iconUrl);
      return entity;
    });
  }

  /**
   * Asserts that the handle is unique for the account.
   *
   * @param account - The account.
   * @param handle - The handle.
   * @param excludeCharacterId - The exclude character id.
   */
  private async assertHandleUniqueForAccount(
    account: AccountEntity,
    handle: string | undefined,
    excludeCharacterId?: string,
  ): Promise<void> {
    if (!handle) {
      return;
    }

    const fullHandleNormalized = normalizeHandle(`${handle}@${account.handle}`);

    const where: Record<string, unknown> = {
      accountId: account.id,
      fullHandleNormalized,
    };
    if (excludeCharacterId) {
      where.id = Not(excludeCharacterId);
    }

    const existing = await this._characterRepository.findOne({ where });
    if (existing) {
      throw new ConflictException(
        'Character handle already exists for this account',
      );
    }
  }

  /**
   * Ensures the account belongs to the authenticated user.
   *
   * @param accountId - The account id.
   * @param userId - The user id.
   * @returns A promise that resolves when the operation completes.
   */
  private async requireOwnedAccount(
    accountId: string,
    userId: string,
  ): Promise<AccountEntity> {
    const account = await this._accountRepository.findOne({
      where: { id: accountId },
    });

    if (!account) {
      throw new NotFoundException(`Account with ID "${accountId}" not found`);
    }

    if (account.userId !== userId) {
      throw new ForbiddenException('You do not have access to this account');
    }

    return account;
  }

  /**
   * Creates the value.
   *
   * @param createCharacterDto - The create character dto.
   * @param userId - The user id.
   * @returns A promise that resolves when the operation completes.
   */
  async create(
    createCharacterDto: CreateCharacterDto,
    userId: string,
  ): Promise<CharacterEntity> {
    if (!createCharacterDto) {
      throw new BadRequestException('Character data is required');
    }

    if (!createCharacterDto.accountId) {
      throw new BadRequestException('Account ID is required');
    }

    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    const account = await this.requireOwnedAccount(
      createCharacterDto.accountId,
      userId,
    );

    await this.assertHandleUniqueForAccount(account, createCharacterDto.handle);

    const fullHandle = `${createCharacterDto.handle}@${account.handle}`;
    const fullHandleNormalized = normalizeHandle(fullHandle);
    const fullHandleSlug = generateSlug(fullHandle);

    const newCharacter = this._characterRepository.create({
      ...createCharacterDto,
      fullHandle,
      fullHandleNormalized,
      fullHandleSlug,
    });

    try {
      await this._characterRepository.save(newCharacter);
      return newCharacter;
    } catch (error: unknown) {
      throw new InternalServerErrorException('Failed to save a new character', {
        cause: error,
      });
    }
  }

  /**
   * Finds all for account.
   *
   * @param accountId - The account id.
   * @param userId - The user id.
   * @returns A promise that resolves when the operation completes.
   */
  async findAllForAccount(
    accountId: string,
    userId: string,
  ): Promise<CharacterEntity[]> {
    if (!accountId) {
      throw new BadRequestException('Account ID is required');
    }

    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    await this.requireOwnedAccount(accountId, userId);

    const characters = await this._characterRepository.find({
      where: { accountId },
      relations: {
        generalFaction: true,
        faction: { ranks: true },
        sex: true,
        class: true,
        recruitType: true,
        species: true,
      },
      order: { handle: 'ASC' },
    });

    return characters.map(character =>
      this.sanitizeCharacterImageUrls(character),
    );
  }

  /**
   * Finds a character by its URL slug.
   *
   * @param handleSlug Slug to look for.
   * @returns The character if found, otherwise `null`.
   */
  async findOneBySlug(handleSlug: string): Promise<CharacterEntity | null> {
    if (!handleSlug) {
      throw new BadRequestException('Handle slug is required');
    }

    const character = await this._characterRepository.findOne({
      where: { fullHandleSlug: handleSlug },
      relations: {
        account: true,
        generalFaction: true,
        faction: { ranks: true },
        sex: true,
        class: true,
        recruitType: true,
        species: true,
      },
    });

    if (!character) {
      return null;
    }

    return this.sanitizeCharacterImageUrls(character);
  }

  /**
   * Finds one for user.
   *
   * @param id - The id.
   * @param userId - The user id.
   * @returns A promise that resolves when the operation completes.
   */
  async findOneForUser(id: string, userId: string): Promise<CharacterEntity> {
    if (!id) {
      throw new BadRequestException('Character ID is required');
    }

    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    const character = await this._characterRepository.findOne({
      where: { id },
      relations: {
        account: true,
        generalFaction: true,
        faction: { ranks: true },
        sex: true,
        class: true,
        recruitType: true,
        species: true,
      },
    });

    if (!character) {
      throw new NotFoundException(`Character with ID "${id}" not found`);
    }

    if (character.account.userId !== userId) {
      throw new ForbiddenException('You do not have access to this character');
    }

    return this.sanitizeCharacterImageUrls(character);
  }

  /**
   * Updates for user.
   *
   * @param id - The id.
   * @param userId - The user id.
   * @param updateCharacterDto - The update character dto.
   * @returns A promise that resolves when the operation completes.
   */
  async updateForUser(
    id: string,
    userId: string,
    updateCharacterDto: UpdateCharacterDto,
  ): Promise<CharacterEntity> {
    if (!id) {
      throw new BadRequestException('Character ID is required');
    }

    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    if (!updateCharacterDto) {
      throw new BadRequestException('Update data is required');
    }

    const character = await this.findOneForUser(id, userId);

    const updateData: Partial<CharacterEntity> = {
      ...updateCharacterDto,
    } as Partial<CharacterEntity>;

    if (
      typeof updateCharacterDto.handle === 'string' &&
      updateCharacterDto.handle !== character.handle
    ) {
      await this.assertHandleUniqueForAccount(
        character.account,
        updateCharacterDto.handle,
        character.id,
      );

      const fullHandle = `${updateCharacterDto.handle}@${character.account.handle}`;
      updateData.fullHandle = fullHandle;
      updateData.fullHandleNormalized = normalizeHandle(fullHandle);
      updateData.fullHandleSlug = generateSlug(fullHandle);
    }

    await this._characterRepository.update(id, updateData);
    return this.findOneForUser(id, userId);
  }

  /**
   * Removes for user.
   *
   * @param id - The id.
   * @param userId - The user id.
   */
  async removeForUser(id: string, userId: string): Promise<void> {
    if (!id) {
      throw new BadRequestException('Character ID is required');
    }

    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    const character = await this.findOneForUser(id, userId);
    await this._characterRepository.softDelete(character.id);
  }

  /**
   * Uploads a profile image for a character.
   *
   * @param id Character ID.
   * @param userId Authenticated user ID.
   * @param file File to upload.
   * @returns The updated character.
   */
  async uploadProfileImage(
    id: string,
    userId: string,
    file: Express.Multer.File,
  ): Promise<CharacterEntity> {
    this.assertUploadProfileImageArgs(id, userId, file);

    this._logger.debug(
      `[uploadProfileImage] Starting upload - CharacterId: ${id}, UserId: ${userId}`,
    );

    try {
      const character = await this.findOneForUser(id, userId);
      this._logger.debug(
        `[uploadProfileImage] Character found - Handle: ${character.fullHandle}, ExistingProfilePictureId: ${character.profilePictureId || 'none'}`,
      );

      const existingProfilePictureId = character.profilePictureId;

      this._logger.debug(
        `[uploadProfileImage] Starting Cloudflare Images upload - CharacterId: ${id}, UserId: ${userId}`,
      );

      character.profilePictureId =
        await this._imageUploadsService.uploadImageToCloudflareImages(
          userId,
          file,
          'character',
          id,
        );

      this._logger.debug(
        `[uploadProfileImage] Cloudflare Images upload complete - NewProfilePictureId: ${character.profilePictureId}`,
      );

      if (!character.profilePictureId) {
        this._logger.error(
          `[uploadProfileImage] Upload returned null/undefined - CharacterId: ${id}`,
        );
        throw new InternalServerErrorException('Profile picture upload failed');
      }

      this._logger.debug(
        `[uploadProfileImage] Saving character to database - CharacterId: ${id}`,
      );

      const updatedCharacter = await this._characterRepository.save(character);

      this._logger.log(
        `[uploadProfileImage] Character saved successfully - CharacterId: ${id}, ProfilePictureId: ${updatedCharacter.profilePictureId}`,
      );

      await this.tryDeleteOldProfileImage(existingProfilePictureId);

      return updatedCharacter;
    } catch (error: unknown) {
      const message = stringifyError(error);

      const stack = error instanceof Error ? error.stack : undefined;
      this._logger.error(
        `[uploadProfileImage] Upload failed - CharacterId: ${id}, UserId: ${userId}, Error: ${message}`,
        stack,
      );
      throw error;
    }
  }

  /**
   * Validates the profile image upload arguments.
   *
   * @param id - The id.
   * @param userId - The user id.
   * @param file - The uploaded file.
   */
  private assertUploadProfileImageArgs(
    id: string,
    userId: string,
    file: Express.Multer.File,
  ): void {
    if (!id) {
      throw new BadRequestException('Character ID is required');
    }

    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    if (!file) {
      throw new BadRequestException('File is required');
    }
  }

  /**
   * Deletes the previously stored profile image, if any.
   *
   * @param existingProfilePictureId - The existing profile picture id.
   */
  private async tryDeleteOldProfileImage(
    existingProfilePictureId: string | null | undefined,
  ): Promise<void> {
    if (!existingProfilePictureId) {
      return;
    }

    this._logger.debug(
      `[uploadProfileImage] Deleting old image - ProfilePictureId: ${existingProfilePictureId}`,
    );
    try {
      await this._imageUploadsService.deleteImageFromCloudflareImages(
        existingProfilePictureId,
      );
      this._logger.debug(
        `[uploadProfileImage] Old image deleted - ProfilePictureId: ${existingProfilePictureId}`,
      );
    } catch (error: unknown) {
      const message = stringifyError(error);

      const stack = error instanceof Error ? error.stack : undefined;
      this._logger.error(
        `[uploadProfileImage] Failed to delete old profile image from Cloudflare Images - ProfilePictureId: ${existingProfilePictureId}, Error: ${message}`,
        stack,
      );
    }
  }

  // --- Reference Data Methods ---

  /**
   * Gets general factions.
   *
   * @param factionId - The faction id.
   * @returns A promise that resolves when the operation completes.
   */
  async getGeneralFactions(
    factionId?: string,
  ): Promise<GeneralFactionEntity[]> {
    const query =
      this._generalFactionRepository.createQueryBuilder('generalFaction');

    if (factionId) {
      query.innerJoin(
        'generalFaction.factions',
        'faction',
        'faction.id = :factionId',
        { factionId },
      );
    }

    const generalFactions = await query
      .orderBy('generalFaction.name', 'ASC')
      .getMany();

    return this.sanitizeLookupImageUrls(generalFactions);
  }

  /**
   * Gets factions.
   *
   * @param generalFactionId - The general faction id.
   * @returns A promise that resolves when the operation completes.
   */
  async getFactions(generalFactionId?: string): Promise<FactionEntity[]> {
    const query = this._factionRepository.createQueryBuilder('faction');

    if (generalFactionId) {
      query.innerJoin(
        'faction.generalFactions',
        'generalFaction',
        'generalFaction.id = :generalFactionId',
        { generalFactionId },
      );
    }

    const factions = await query.orderBy('faction.name', 'ASC').getMany();

    return this.sanitizeLookupImageUrls(factions);
  }

  /**
   * Gets sexes.
   *
   * @returns A promise that resolves when the operation completes.
   */
  async getSexes(): Promise<SexEntity[]> {
    return this._sexRepository.find({ order: { name: 'ASC' } });
  }

  /**
   * Gets character classes.
   *
   * @returns A promise that resolves when the operation completes.
   */
  async getClasses(): Promise<CharacterClassEntity[]> {
    return this._classRepository.find({ order: { name: 'ASC' } });
  }

  /**
   * Gets recruit types.
   *
   * @param factionId - The faction id.
   * @returns A promise that resolves when the operation completes.
   */
  async getRecruitTypes(factionId?: string): Promise<RecruitTypeEntity[]> {
    const query = this._recruitTypeRepository.createQueryBuilder('recruitType');

    if (factionId) {
      query.innerJoin(
        'recruitType.factions',
        'faction',
        'faction.id = :factionId',
        { factionId },
      );
    }

    const recruitTypes = await query
      .orderBy('recruitType.name', 'ASC')
      .getMany();

    return this.sanitizeLookupImageUrls(recruitTypes);
  }

  /**
   * Fetches species filtered by faction and recruit type.
   */
  async getSpecies(
    factionId?: string,
    recruitTypeId?: string,
  ): Promise<SpeciesEntity[]> {
    const query = this._speciesRepository.createQueryBuilder('species');

    if (factionId) {
      query.innerJoin(
        'species.factions',
        'faction',
        'faction.id = :factionId',
        { factionId },
      );
    }

    if (recruitTypeId) {
      query.innerJoin(
        'species.recruitTypes',
        'recruitType',
        'recruitType.id = :recruitTypeId',
        { recruitTypeId },
      );
    }

    return query.orderBy('species.name', 'ASC').getMany();
  }
}
