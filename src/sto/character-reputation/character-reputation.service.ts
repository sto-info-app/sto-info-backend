import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CharacterOwnershipService } from 'src/sto/character/character-ownership.service';
import { Repository } from 'typeorm';
import { UpdateCharacterReputationProgressDto } from './dto/update-character-reputation-progress.dto';
import { CharacterReputationProgressEntity } from './entities/character-reputation-progress.entity';
import {
  CharacterReputationEntity,
  REPUTATION_MAX_TIER,
} from './entities/character-reputation.entity';

export interface CharacterReputationSummary {
  totalTiers: number;
  maxPossibleTiers: number;
  overallCompletionPercentage: number;
  completedReputations: number;
  totalReputations: number;
}

@Injectable()
export class CharacterReputationService {
  /**
   * Creates an instance of CharacterReputationService.
   *
   * @param _reputationRepository - The reputation repository.
   * @param _progressRepository - The progress repository.
   * @param _characterOwnership - The shared character ownership guard.
   */
  constructor(
    @InjectRepository(CharacterReputationEntity)
    private readonly _reputationRepository: Repository<CharacterReputationEntity>,
    @InjectRepository(CharacterReputationProgressEntity)
    private readonly _progressRepository: Repository<CharacterReputationProgressEntity>,
    private readonly _characterOwnership: CharacterOwnershipService,
  ) {}

  /**
   * Gets the reputation catalog.
   *
   * @returns A promise that resolves when the operation completes.
   */
  async getReputations(): Promise<CharacterReputationEntity[]> {
    return this._reputationRepository.find({
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  /**
   * Gets reputation progress for a character.
   *
   * @param characterId - The character id.
   * @param userId - The user id.
   * @returns A promise that resolves when the operation completes.
   */
  async getProgress(
    characterId: string,
    userId: string,
  ): Promise<CharacterReputationProgressEntity[]> {
    await this._characterOwnership.requireOwnedCharacter(characterId, userId);

    const allReputations = await this.getReputations();

    const existingProgress = await this._progressRepository.find({
      where: { characterId },
      relations: { reputation: true },
    });

    const progressMap = new Map(existingProgress.map(p => [p.reputationId, p]));

    // Return one record per reputation, synthesising zero-progress entries for untracked reputations
    return allReputations.map(reputation => {
      const existing = progressMap.get(reputation.id);
      if (existing) {
        return existing;
      }

      const synthetic = new CharacterReputationProgressEntity();
      synthetic.id = '';
      synthetic.characterId = characterId;
      synthetic.reputationId = reputation.id;
      synthetic.reputation = reputation;
      synthetic.currentTier = 0;
      return synthetic;
    });
  }

  /**
   * Updates reputation progress for a character.
   *
   * @param characterId - The character id.
   * @param userId - The user id.
   * @param reputationId - The reputation id.
   * @param dto - The dto.
   * @returns A promise that resolves when the operation completes.
   */
  async updateProgress(
    characterId: string,
    userId: string,
    reputationId: string,
    dto: UpdateCharacterReputationProgressDto,
  ): Promise<CharacterReputationProgressEntity> {
    await this._characterOwnership.requireOwnedCharacter(characterId, userId);

    const reputation = await this._reputationRepository.findOne({
      where: { id: reputationId },
    });
    if (!reputation) {
      throw new NotFoundException(
        `Reputation with ID "${reputationId}" not found`,
      );
    }

    let progress = await this._progressRepository.findOne({
      where: { characterId, reputationId },
      relations: { reputation: true },
    });

    if (!progress) {
      progress = this._progressRepository.create({
        characterId,
        reputationId,
        currentTier: dto.currentTier,
      });
    } else {
      progress.currentTier = dto.currentTier;
    }

    await this._progressRepository.save(progress);

    progress.reputation = reputation;
    return progress;
  }

  /**
   * Gets the reputation summary for a character.
   *
   * @param characterId - The character id.
   * @param userId - The user id.
   * @returns A promise that resolves when the operation completes.
   */
  async getSummary(
    characterId: string,
    userId: string,
  ): Promise<CharacterReputationSummary> {
    await this._characterOwnership.requireOwnedCharacter(characterId, userId);

    const allReputations = await this._reputationRepository.find();
    const existingProgress = await this._progressRepository.find({
      where: { characterId },
    });

    const progressMap = new Map(existingProgress.map(p => [p.reputationId, p]));

    let totalTiers = 0;
    let completedReputations = 0;

    for (const reputation of allReputations) {
      const progress = progressMap.get(reputation.id);
      const tier = progress?.currentTier ?? 0;
      totalTiers += tier;

      if (tier >= REPUTATION_MAX_TIER) {
        completedReputations++;
      }
    }

    const maxPossibleTiers = allReputations.length * REPUTATION_MAX_TIER;

    return {
      totalTiers,
      maxPossibleTiers,
      overallCompletionPercentage:
        maxPossibleTiers > 0
          ? Math.round((totalTiers / maxPossibleTiers) * 100)
          : 0,
      completedReputations,
      totalReputations: allReputations.length,
    };
  }
}
