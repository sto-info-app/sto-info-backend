import {
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
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
  ) {}

  private normalizeName(name: string): string {
    return name.trim().toLowerCase();
  }

  private async assertNameUniqueForAccount(
    accountId: string,
    name: string | undefined,
    excludeCharacterId?: string,
  ): Promise<void> {
    if (!name) {
      return;
    }

    const nameNormalized = this.normalizeName(name);

    const where: Record<string, unknown> = { accountId, nameNormalized };
    if (excludeCharacterId) {
      where.id = Not(excludeCharacterId);
    }

    const existing = await this.characterRepository.findOne({ where });
    if (existing) {
      throw new ConflictException(
        'Character name already exists for this account',
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

    await this.assertNameUniqueForAccount(
      createCharacterDto.accountId,
      createCharacterDto.name,
    );

    const nameNormalized = this.normalizeName(createCharacterDto.name);
    const handle = `${createCharacterDto.name}@${account.handle}`;

    const newCharacter = this.characterRepository.create({
      ...createCharacterDto,
      nameNormalized,
      handle,
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
        'sex',
        'class',
        'recruitType',
        'species',
      ],
      order: { name: 'ASC' },
    });
  }

  async findOneForUser(id: string, userId: string): Promise<CharacterEntity> {
    const character = await this.characterRepository.findOne({
      where: { id },
      relations: [
        'account',
        'generalFaction',
        'faction',
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
      typeof updateCharacterDto.name === 'string' &&
      updateCharacterDto.name !== character.name
    ) {
      await this.assertNameUniqueForAccount(
        character.accountId,
        updateCharacterDto.name,
        character.id,
      );

      character.nameNormalized = this.normalizeName(updateCharacterDto.name);
      character.handle = `${updateCharacterDto.name}@${character.account.handle}`;
    }

    Object.assign(character, updateCharacterDto);
    await this.characterRepository.save(character);
    return character;
  }

  async removeForUser(id: string, userId: string): Promise<void> {
    const character = await this.findOneForUser(id, userId);
    await this.characterRepository.softDelete(character.id);
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
