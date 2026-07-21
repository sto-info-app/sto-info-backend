import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';
import { Repository } from 'typeorm';
import { UpdateCharacterRdProgressDto } from './dto/update-character-rd-progress.dto';
import { CharacterRdProgressEntity } from './entities/character-rd-progress.entity';
import {
  CharacterRdSchoolEntity,
  RD_MAX_LEVEL,
} from './entities/character-rd-school.entity';

export interface CharacterRdSummary {
  totalLevels: number;
  maxPossibleLevels: number;
  overallCompletionPercentage: number;
  completedSchools: number;
  totalSchools: number;
}

@Injectable()
export class CharacterRdService {
  /**
   * Creates an instance of CharacterRdService.
   *
   * @param _schoolRepository - The R&D school repository.
   * @param _progressRepository - The progress repository.
   * @param _characterRepository - The character repository.
   */
  constructor(
    @InjectRepository(CharacterRdSchoolEntity)
    private readonly _schoolRepository: Repository<CharacterRdSchoolEntity>,
    @InjectRepository(CharacterRdProgressEntity)
    private readonly _progressRepository: Repository<CharacterRdProgressEntity>,
    @InjectRepository(CharacterEntity)
    private readonly _characterRepository: Repository<CharacterEntity>,
  ) {}

  /**
   * Ensures the character belongs to the authenticated user.
   *
   * @param characterId - The character id.
   * @param userId - The user id.
   * @returns A promise that resolves when the operation completes.
   */
  private async requireOwnedCharacter(
    characterId: string,
    userId: string,
  ): Promise<CharacterEntity> {
    const character = await this._characterRepository.findOne({
      where: { id: characterId },
      relations: { account: true },
    });

    if (!character) {
      throw new NotFoundException(
        `Character with ID "${characterId}" not found`,
      );
    }

    if (character.account?.userId !== userId) {
      throw new ForbiddenException('You do not have access to this character');
    }

    return character;
  }

  /**
   * Gets the R&D school catalog.
   *
   * @returns A promise that resolves when the operation completes.
   */
  async getSchools(): Promise<CharacterRdSchoolEntity[]> {
    return this._schoolRepository.find({
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  /**
   * Gets R&D progress for a character.
   *
   * @param characterId - The character id.
   * @param userId - The user id.
   * @returns A promise that resolves when the operation completes.
   */
  async getProgress(
    characterId: string,
    userId: string,
  ): Promise<CharacterRdProgressEntity[]> {
    await this.requireOwnedCharacter(characterId, userId);

    const allSchools = await this.getSchools();

    const existingProgress = await this._progressRepository.find({
      where: { characterId },
      relations: { school: true },
    });

    const progressMap = new Map(existingProgress.map(p => [p.schoolId, p]));

    // Return one record per school, synthesising zero-progress entries for untracked schools
    return allSchools.map(school => {
      const existing = progressMap.get(school.id);
      if (existing) {
        return existing;
      }

      const synthetic = new CharacterRdProgressEntity();
      synthetic.id = '';
      synthetic.characterId = characterId;
      synthetic.schoolId = school.id;
      synthetic.school = school;
      synthetic.currentLevel = 0;
      return synthetic;
    });
  }

  /**
   * Updates R&D progress for a character.
   *
   * @param characterId - The character id.
   * @param userId - The user id.
   * @param schoolId - The school id.
   * @param dto - The dto.
   * @returns A promise that resolves when the operation completes.
   */
  async updateProgress(
    characterId: string,
    userId: string,
    schoolId: string,
    dto: UpdateCharacterRdProgressDto,
  ): Promise<CharacterRdProgressEntity> {
    await this.requireOwnedCharacter(characterId, userId);

    const school = await this._schoolRepository.findOne({
      where: { id: schoolId },
    });
    if (!school) {
      throw new NotFoundException(`R&D school with ID "${schoolId}" not found`);
    }

    let progress = await this._progressRepository.findOne({
      where: { characterId, schoolId },
      relations: { school: true },
    });

    if (!progress) {
      progress = this._progressRepository.create({
        characterId,
        schoolId,
        currentLevel: dto.currentLevel,
      });
    } else {
      progress.currentLevel = dto.currentLevel;
    }

    await this._progressRepository.save(progress);

    progress.school = school;
    return progress;
  }

  /**
   * Gets the R&D summary for a character.
   *
   * @param characterId - The character id.
   * @param userId - The user id.
   * @returns A promise that resolves when the operation completes.
   */
  async getSummary(
    characterId: string,
    userId: string,
  ): Promise<CharacterRdSummary> {
    await this.requireOwnedCharacter(characterId, userId);

    const allSchools = await this._schoolRepository.find();
    const existingProgress = await this._progressRepository.find({
      where: { characterId },
    });

    const progressMap = new Map(existingProgress.map(p => [p.schoolId, p]));

    let totalLevels = 0;
    let completedSchools = 0;

    for (const school of allSchools) {
      const progress = progressMap.get(school.id);
      const level = progress?.currentLevel ?? 0;
      totalLevels += level;

      if (level >= RD_MAX_LEVEL) {
        completedSchools++;
      }
    }

    const maxPossibleLevels = allSchools.length * RD_MAX_LEVEL;

    return {
      totalLevels,
      maxPossibleLevels,
      overallCompletionPercentage:
        maxPossibleLevels > 0
          ? Math.round((totalLevels / maxPossibleLevels) * 100)
          : 0,
      completedSchools,
      totalSchools: allSchools.length,
    };
  }
}
