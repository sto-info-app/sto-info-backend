import {
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';

import { File as MulterFile } from 'multer';
import { ImageUploadsService } from 'src/shared/utilities/image-uploads.service';
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
  private readonly logger = new Logger(CharacterService.name);

  constructor(
    @InjectRepository(CharacterEntity)
    private readonly characterRepository: Repository<CharacterEntity>,
    @InjectRepository(AccountEntity)
    private readonly accountRepository: Repository<AccountEntity>,
    @InjectRepository(GeneralFactionEntity)
    private readonly generalFactionRepository: Repository<GeneralFactionEntity>,
    @InjectRepository(FactionEntity)
    private readonly factionRepository: Repository<FactionEntity>,
    @InjectRepository(SexEntity)
    private readonly sexRepository: Repository<SexEntity>,
    @InjectRepository(CharacterClassEntity)
    private readonly classRepository: Repository<CharacterClassEntity>,
    @InjectRepository(RecruitTypeEntity)
    private readonly recruitTypeRepository: Repository<RecruitTypeEntity>,
    @InjectRepository(SpeciesEntity)
    private readonly speciesRepository: Repository<SpeciesEntity>,
    private readonly imageUploadsService: ImageUploadsService,
  ) {}

  private normalizeHandle(handle: string): string {
    return handle.trim().toLowerCase();
  }

  private generateSlug(handle: string): string {
    return handle.trim().replace('#', '~');
  }

  private async assertHandleUniqueForAccount(
    account: AccountEntity,
    handle: string | undefined,
    excludeCharacterId?: string,
  ): Promise<void> {
    if (!handle) {
      return;
    }

    const fullHandleNormalized = this.normalizeHandle(
      `${handle}@${account.handle}`,
    );

    const where: Record<string, unknown> = {
      accountId: account.id,
      fullHandleNormalized,
    };
    if (excludeCharacterId) {
      where.id = Not(excludeCharacterId);
    }

    const existing = await this.characterRepository.findOne({ where });
    if (existing) {
      throw new ConflictException(
        'Character handle already exists for this account',
      );
    }
  }

  private async requireOwnedAccount(
    accountId: string,
    userId: string,
  ): Promise<AccountEntity> {
    const account = await this.accountRepository.findOne({
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

  async create(
    createCharacterDto: CreateCharacterDto,
    userId: string,
  ): Promise<CharacterEntity> {
    const account = await this.requireOwnedAccount(
      createCharacterDto.accountId,
      userId,
    );

    await this.assertHandleUniqueForAccount(account, createCharacterDto.handle);

    const fullHandle = `${createCharacterDto.handle}@${account.handle}`;
    const fullHandleNormalized = this.normalizeHandle(fullHandle);
    const fullHandleSlug = this.generateSlug(fullHandle);

    const newCharacter = this.characterRepository.create({
      ...createCharacterDto,
      fullHandle,
      fullHandleNormalized,
      fullHandleSlug,
    });

    try {
      await this.characterRepository.save(newCharacter);
      return newCharacter;
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to save a new character',
        error,
      );
    }
  }

  async findAllForAccount(
    accountId: string,
    userId: string,
  ): Promise<CharacterEntity[]> {
    await this.requireOwnedAccount(accountId, userId);

    return this.characterRepository.find({
      where: { accountId },
      relations: [
        'generalFaction',
        'faction',
        'faction.ranks',
        'sex',
        'class',
        'recruitType',
        'species',
      ],
      order: { handle: 'ASC' },
    });
  }

  /**
   * Finds a character by its URL slug.
   *
   * @param handleSlug Slug to look for.
   * @returns The character if found, otherwise `null`.
   */
  async findOneBySlug(handleSlug: string): Promise<CharacterEntity | null> {
    return this.characterRepository.findOne({
      where: { fullHandleSlug: handleSlug },
      relations: [
        'account',
        'generalFaction',
        'faction',
        'faction.ranks',
        'sex',
        'class',
        'recruitType',
        'species',
      ],
    });
  }

  async findOneForUser(id: string, userId: string): Promise<CharacterEntity> {
    const character = await this.characterRepository.findOne({
      where: { id },
      relations: [
        'account',
        'generalFaction',
        'faction',
        'faction.ranks',
        'sex',
        'class',
        'recruitType',
        'species',
      ],
    });

    if (!character) {
      throw new NotFoundException(`Character with ID "${id}" not found`);
    }

    if (character.account.userId !== userId) {
      throw new ForbiddenException('You do not have access to this character');
    }

    return character;
  }

  async updateForUser(
    id: string,
    userId: string,
    updateCharacterDto: UpdateCharacterDto,
  ): Promise<CharacterEntity> {
    const character = await this.findOneForUser(id, userId);

    if (
      typeof updateCharacterDto.handle === 'string' &&
      updateCharacterDto.handle !== character.handle
    ) {
      await this.assertHandleUniqueForAccount(
        character.account,
        updateCharacterDto.handle,
        character.id,
      );

      character.fullHandle = `${updateCharacterDto.handle}@${character.account.handle}`;
      character.fullHandleNormalized = this.normalizeHandle(
        character.fullHandle,
      );
      character.fullHandleSlug = this.generateSlug(character.fullHandle);
    }

    Object.assign(character, updateCharacterDto);
    await this.characterRepository.save(character);
    return character;
  }

  async removeForUser(id: string, userId: string): Promise<void> {
    const character = await this.findOneForUser(id, userId);
    await this.characterRepository.softDelete(character.id);
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
    file: MulterFile,
  ): Promise<CharacterEntity> {
    this.logger.debug(
      `[uploadProfileImage] Starting upload - CharacterId: ${id}, UserId: ${userId}`,
    );

    try {
      const character = await this.findOneForUser(id, userId);
      this.logger.debug(
        `[uploadProfileImage] Character found - Handle: ${character.fullHandle}, ExistingProfilePictureId: ${character.profilePictureId || 'none'}`,
      );

      const existingProfilePictureId = character.profilePictureId;

      this.logger.debug(
        `[uploadProfileImage] Starting Cloudflare Images upload - CharacterId: ${id}, UserId: ${userId}`,
      );

      character.profilePictureId =
        await this.imageUploadsService.uploadImageToCloudflareImages(
          userId,
          file,
          'character',
          id,
        );

      this.logger.debug(
        `[uploadProfileImage] Cloudflare Images upload complete - NewProfilePictureId: ${character.profilePictureId}`,
      );

      if (!character.profilePictureId) {
        this.logger.error(
          `[uploadProfileImage] Upload returned null/undefined - CharacterId: ${id}`,
        );
        throw new InternalServerErrorException('Profile picture upload failed');
      }

      this.logger.debug(
        `[uploadProfileImage] Saving character to database - CharacterId: ${id}`,
      );

      const updatedCharacter = await this.characterRepository.save(character);

      this.logger.log(
        `[uploadProfileImage] Character saved successfully - CharacterId: ${id}, ProfilePictureId: ${updatedCharacter.profilePictureId}`,
      );

      if (existingProfilePictureId) {
        this.logger.debug(
          `[uploadProfileImage] Deleting old image - ProfilePictureId: ${existingProfilePictureId}`,
        );
        try {
          await this.imageUploadsService.deleteImageFromCloudflareImages(
            existingProfilePictureId,
          );
          this.logger.debug(
            `[uploadProfileImage] Old image deleted - ProfilePictureId: ${existingProfilePictureId}`,
          );
        } catch (error) {
          this.logger.error(
            `[uploadProfileImage] Failed to delete old profile image from Cloudflare Images - ProfilePictureId: ${existingProfilePictureId}, Error: ${error.message}`,
            error.stack,
          );
        }
      }

      return updatedCharacter;
    } catch (error) {
      this.logger.error(
        `[uploadProfileImage] Upload failed - CharacterId: ${id}, UserId: ${userId}, Error: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  // --- Reference Data Methods ---

  async getGeneralFactions(): Promise<GeneralFactionEntity[]> {
    return this.generalFactionRepository.find({ order: { name: 'ASC' } });
  }

  async getFactions(): Promise<FactionEntity[]> {
    return this.factionRepository.find({ order: { name: 'ASC' } });
  }

  async getSexes(): Promise<SexEntity[]> {
    return this.sexRepository.find({ order: { name: 'ASC' } });
  }

  async getClasses(): Promise<CharacterClassEntity[]> {
    return this.classRepository.find({ order: { name: 'ASC' } });
  }

  async getRecruitTypes(): Promise<RecruitTypeEntity[]> {
    return this.recruitTypeRepository.find({ order: { name: 'ASC' } });
  }

  /**
   * Fetches species filtered by faction and recruit type.
   */
  async getSpecies(
    factionId?: string,
    recruitTypeId?: string,
  ): Promise<SpeciesEntity[]> {
    const query = this.speciesRepository.createQueryBuilder('species');

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
