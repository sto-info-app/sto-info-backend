import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { IsNull, Repository } from 'typeorm';

import { CharacterOwnershipService } from 'src/sto/character/character-ownership.service';

import { UpdateCharacterCommendationProgressDto } from './dto/update-character-commendation-progress.dto';
import { CharacterCommendationProgressEntity } from './entities/character-commendation-progress.entity';
import {
  CharacterCommendationEntity,
  COMMENDATION_MAX_RANK,
} from './entities/character-commendation.entity';

export interface CharacterCommendationSummary {
  totalRanks: number;
  maxPossibleRanks: number;
  overallCompletionPercentage: number;
  completedCommendations: number;
  totalCommendations: number;
}

/**
 * The allegiances that unlock a faction-specific commendation category. Any
 * other value - "Undecided", or a captain with no allegiance recorded - earns
 * only the categories shared by both factions.
 */
const FACTION_RESTRICTIONS = ['Federation', 'Klingon'];

@Injectable()
export class CharacterCommendationService {
  /**
   * Creates an instance of CharacterCommendationService.
   *
   * @param _commendationRepository - The commendation catalogue repository.
   * @param _progressRepository - The progress repository.
   * @param _characterOwnership - The shared character ownership guard.
   */
  constructor(
    @InjectRepository(CharacterCommendationEntity)
    private readonly _commendationRepository: Repository<CharacterCommendationEntity>,
    @InjectRepository(CharacterCommendationProgressEntity)
    private readonly _progressRepository: Repository<CharacterCommendationProgressEntity>,
    private readonly _characterOwnership: CharacterOwnershipService,
  ) {}

  /**
   * Gets the whole commendation catalogue, both factions included.
   *
   * @returns A promise that resolves when the operation completes.
   */
  async getCommendations(): Promise<CharacterCommendationEntity[]> {
    return this._commendationRepository.find({
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  /**
   * Gets the commendation categories a captain of the given allegiance earns.
   * ---
   * Diplomacy is Federation-side and Marauding is Klingon-side, so an
   * allegiance that is neither (an unaligned Romulan, say) sees only the ten
   * categories both factions share.
   *
   * @param generalFaction - The captain's general allegiance, if recorded.
   * @returns A promise that resolves when the operation completes.
   */
  async getCommendationsForFaction(
    generalFaction?: string | null,
  ): Promise<CharacterCommendationEntity[]> {
    const order = { sortOrder: 'ASC', name: 'ASC' } as const;

    if (!generalFaction || !FACTION_RESTRICTIONS.includes(generalFaction)) {
      return this._commendationRepository.find({
        where: { factionRestriction: IsNull() },
        order,
      });
    }

    return this._commendationRepository.find({
      where: [
        { factionRestriction: IsNull() },
        { factionRestriction: generalFaction },
      ],
      order,
    });
  }

  /**
   * Gets commendation progress for a character.
   *
   * @param characterId - The character id.
   * @param userId - The user id.
   * @returns A promise that resolves when the operation completes.
   */
  async getProgress(
    characterId: string,
    userId: string,
  ): Promise<CharacterCommendationProgressEntity[]> {
    const character = await this._characterOwnership.requireOwnedCharacter(
      characterId,
      userId,
    );

    const commendations = await this.getCommendationsForFaction(
      character.generalFaction?.name,
    );

    const existingProgress = await this._progressRepository.find({
      where: { characterId },
      relations: { commendation: true },
    });

    const progressMap = new Map(
      existingProgress.map(p => [p.commendationId, p]),
    );

    // Return one record per applicable category, synthesising zero-progress
    // entries for the ones never tracked.
    return commendations.map(commendation => {
      const existing = progressMap.get(commendation.id);
      if (existing) {
        return existing;
      }

      const synthetic = new CharacterCommendationProgressEntity();
      synthetic.id = '';
      synthetic.characterId = characterId;
      synthetic.commendationId = commendation.id;
      synthetic.commendation = commendation;
      synthetic.currentRank = 0;
      return synthetic;
    });
  }

  /**
   * Updates commendation progress for a character.
   *
   * @param characterId - The character id.
   * @param userId - The user id.
   * @param commendationId - The commendation id.
   * @param dto - The dto.
   * @returns A promise that resolves when the operation completes.
   */
  async updateProgress(
    characterId: string,
    userId: string,
    commendationId: string,
    dto: UpdateCharacterCommendationProgressDto,
  ): Promise<CharacterCommendationProgressEntity> {
    await this._characterOwnership.requireOwnedCharacter(characterId, userId);

    const commendation = await this._commendationRepository.findOne({
      where: { id: commendationId },
    });
    if (!commendation) {
      throw new NotFoundException(
        `Commendation with ID "${commendationId}" not found`,
      );
    }

    let progress = await this._progressRepository.findOne({
      where: { characterId, commendationId },
      relations: { commendation: true },
    });

    if (!progress) {
      progress = this._progressRepository.create({
        characterId,
        commendationId,
        currentRank: dto.currentRank,
      });
    } else {
      progress.currentRank = dto.currentRank;
    }

    await this._progressRepository.save(progress);

    progress.commendation = commendation;
    return progress;
  }

  /**
   * Gets the commendation summary for a character, counted over the categories
   * that captain's allegiance actually earns.
   *
   * @param characterId - The character id.
   * @param userId - The user id.
   * @returns A promise that resolves when the operation completes.
   */
  async getSummary(
    characterId: string,
    userId: string,
  ): Promise<CharacterCommendationSummary> {
    const character = await this._characterOwnership.requireOwnedCharacter(
      characterId,
      userId,
    );

    const commendations = await this.getCommendationsForFaction(
      character.generalFaction?.name,
    );
    const existingProgress = await this._progressRepository.find({
      where: { characterId },
    });

    const progressMap = new Map(
      existingProgress.map(p => [p.commendationId, p]),
    );

    let totalRanks = 0;
    let completedCommendations = 0;

    for (const commendation of commendations) {
      const rank = progressMap.get(commendation.id)?.currentRank ?? 0;
      totalRanks += rank;

      if (rank >= COMMENDATION_MAX_RANK) {
        completedCommendations++;
      }
    }

    const maxPossibleRanks = commendations.length * COMMENDATION_MAX_RANK;

    return {
      totalRanks,
      maxPossibleRanks,
      overallCompletionPercentage:
        maxPossibleRanks > 0
          ? Math.round((totalRanks / maxPossibleRanks) * 100)
          : 0,
      completedCommendations,
      totalCommendations: commendations.length,
    };
  }
}
