import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CharacterOwnershipService } from 'src/sto/character/character-ownership.service';
import { Not, Repository } from 'typeorm';
import { UpdateCharacterSpecializationProgressDto } from './dto/update-character-specialization-progress.dto';
import { UpdateCharacterSpecializationSlotDto } from './dto/update-character-specialization-slot.dto';
import { CharacterSpecializationProgressEntity } from './entities/character-specialization-progress.entity';
import { CharacterSpecializationEntity } from './entities/character-specialization.entity';

export interface CharacterSpecializationSummary {
  totalPoints: number;
  maxPossiblePoints: number;
  overallCompletionPercentage: number;
  completedSpecializations: number;
  totalSpecializations: number;
  primarySpecializationName: string | null;
  secondarySpecializationName: string | null;
}

@Injectable()
export class CharacterSpecializationService {
  /**
   * Creates an instance of CharacterSpecializationService.
   *
   * @param _specializationRepository - The specialization catalog repository.
   * @param _progressRepository - The progress repository.
   * @param _characterOwnership - The shared character ownership guard.
   */
  constructor(
    @InjectRepository(CharacterSpecializationEntity)
    private readonly _specializationRepository: Repository<CharacterSpecializationEntity>,
    @InjectRepository(CharacterSpecializationProgressEntity)
    private readonly _progressRepository: Repository<CharacterSpecializationProgressEntity>,
    private readonly _characterOwnership: CharacterOwnershipService,
  ) {}

  /**
   * Gets the captain specialization catalog.
   *
   * @returns A promise that resolves when the operation completes.
   */
  async getSpecializations(): Promise<CharacterSpecializationEntity[]> {
    return this._specializationRepository.find({
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  /**
   * Gets specialization progress for a character.
   *
   * @param characterId - The character id.
   * @param userId - The user id.
   * @returns A promise that resolves when the operation completes.
   */
  async getProgress(
    characterId: string,
    userId: string,
  ): Promise<CharacterSpecializationProgressEntity[]> {
    await this._characterOwnership.requireOwnedCharacter(characterId, userId);

    const allSpecializations = await this.getSpecializations();

    const existingProgress = await this._progressRepository.find({
      where: { characterId },
      relations: { specialization: true },
    });

    const progressMap = new Map(
      existingProgress.map(p => [p.specializationId, p]),
    );

    // Return one record per specialization, synthesising zero-progress entries
    // for the ones the character has never spent a point in.
    return allSpecializations.map(specialization => {
      const existing = progressMap.get(specialization.id);
      if (existing) {
        return existing;
      }

      const synthetic = new CharacterSpecializationProgressEntity();
      synthetic.id = '';
      synthetic.characterId = characterId;
      synthetic.specializationId = specialization.id;
      synthetic.specialization = specialization;
      synthetic.pointsSpent = 0;
      synthetic.slot = null;
      return synthetic;
    });
  }

  /**
   * Updates the points spent in one specialization for a character.
   *
   * @param characterId - The character id.
   * @param userId - The user id.
   * @param specializationId - The specialization id.
   * @param dto - The dto.
   * @returns A promise that resolves when the operation completes.
   */
  async updateProgress(
    characterId: string,
    userId: string,
    specializationId: string,
    dto: UpdateCharacterSpecializationProgressDto,
  ): Promise<CharacterSpecializationProgressEntity> {
    await this._characterOwnership.requireOwnedCharacter(characterId, userId);

    const specialization = await this._requireSpecialization(specializationId);

    // Secondary-only specializations cap at fewer points than the DTO's upper
    // bound allows, so the per-specialization maximum is checked here.
    if (dto.pointsSpent > specialization.maxPoints) {
      throw new BadRequestException(
        `"${specialization.name}" accepts at most ${specialization.maxPoints} specialization points`,
      );
    }

    const progress = await this._findOrCreateProgress(
      characterId,
      specializationId,
    );
    progress.pointsSpent = dto.pointsSpent;

    await this._progressRepository.save(progress);

    progress.specialization = specialization;
    return progress;
  }

  /**
   * Activates a specialization in the character's Primary or Secondary slot, or
   * deactivates it. The release of any existing holder and the claim of the
   * requested slot are performed within a single transaction so slot
   * assignment remains atomic under the partial unique slot index.
   *
   * @param characterId - The character id.
   * @param userId - The user id.
   * @param specializationId - The specialization id.
   * @param dto - The dto.
   * @returns A promise that resolves when the operation completes.
   */
  async updateSlot(
    characterId: string,
    userId: string,
    specializationId: string,
    dto: UpdateCharacterSpecializationSlotDto,
  ): Promise<CharacterSpecializationProgressEntity> {
    await this._characterOwnership.requireOwnedCharacter(characterId, userId);

    const specialization = await this._requireSpecialization(specializationId);

    const slot = dto.slot ?? null;

    if (slot === 'primary' && specialization.type !== 'primary') {
      throw new BadRequestException(
        `"${specialization.name}" is a secondary-only specialization and cannot be slotted as primary`,
      );
    }

    return this._progressRepository.manager.transaction(async manager => {
      const progressRepository = manager.getRepository(
        CharacterSpecializationProgressEntity,
      );

      if (slot) {
        await progressRepository.update(
          { characterId, slot, specializationId: Not(specializationId) },
          { slot: null },
        );
      }

      const progress = await this._findOrCreateProgress(
        characterId,
        specializationId,
        progressRepository,
      );
      progress.slot = slot;

      await progressRepository.save(progress);

      progress.specialization = specialization;
      return progress;
    });
  }

  /**
   * Gets the specialization summary for a character.
   *
   * @param characterId - The character id.
   * @param userId - The user id.
   * @returns A promise that resolves when the operation completes.
   */
  async getSummary(
    characterId: string,
    userId: string,
  ): Promise<CharacterSpecializationSummary> {
    await this._characterOwnership.requireOwnedCharacter(characterId, userId);

    const allSpecializations = await this._specializationRepository.find();
    const existingProgress = await this._progressRepository.find({
      where: { characterId },
    });

    const progressMap = new Map(
      existingProgress.map(p => [p.specializationId, p]),
    );

    let totalPoints = 0;
    let maxPossiblePoints = 0;
    let completedSpecializations = 0;
    let primarySpecializationName: string | null = null;
    let secondarySpecializationName: string | null = null;

    for (const specialization of allSpecializations) {
      const progress = progressMap.get(specialization.id);
      const points = progress?.pointsSpent ?? 0;

      totalPoints += points;
      maxPossiblePoints += specialization.maxPoints;

      if (points >= specialization.maxPoints) {
        completedSpecializations++;
      }

      if (progress?.slot === 'primary') {
        primarySpecializationName = specialization.name;
      } else if (progress?.slot === 'secondary') {
        secondarySpecializationName = specialization.name;
      }
    }

    return {
      totalPoints,
      maxPossiblePoints,
      overallCompletionPercentage:
        maxPossiblePoints > 0
          ? Math.round((totalPoints / maxPossiblePoints) * 100)
          : 0,
      completedSpecializations,
      totalSpecializations: allSpecializations.length,
      primarySpecializationName,
      secondarySpecializationName,
    };
  }

  /**
   * Loads a catalog specialization, throwing when it does not exist.
   *
   * @param specializationId - The specialization id.
   * @returns A promise that resolves when the operation completes.
   */
  private async _requireSpecialization(
    specializationId: string,
  ): Promise<CharacterSpecializationEntity> {
    const specialization = await this._specializationRepository.findOne({
      where: { id: specializationId },
    });

    if (!specialization) {
      throw new NotFoundException(
        `Specialization with ID "${specializationId}" not found`,
      );
    }

    return specialization;
  }

  /**
   * Loads the character's progress row for a specialization, creating an unsaved
   * zero-progress row when the character has never tracked it before.
   *
   * @param characterId - The character id.
   * @param specializationId - The specialization id.
   * @param progressRepository - The repository to use for the lookup and save
   *   operations. Defaults to the service's injected progress repository.
   * @returns A promise that resolves when the operation completes.
   */
  private async _findOrCreateProgress(
    characterId: string,
    specializationId: string,
    progressRepository: Repository<CharacterSpecializationProgressEntity> = this
      ._progressRepository,
  ): Promise<CharacterSpecializationProgressEntity> {
    const existing = await progressRepository.findOne({
      where: { characterId, specializationId },
      relations: { specialization: true },
    });

    return (
      existing ??
      progressRepository.create({
        characterId,
        specializationId,
        pointsSpent: 0,
        slot: null,
      })
    );
  }
}
