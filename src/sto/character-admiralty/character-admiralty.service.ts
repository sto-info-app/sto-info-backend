import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { CharacterOwnershipService } from 'src/sto/character/character-ownership.service';

import { UpdateCharacterAdmiraltyProgressDto } from './dto/update-character-admiralty-progress.dto';
import {
  ADMIRALTY_MAX_TIER,
  ADMIRALTY_MAX_TOUR_STEP,
  CharacterAdmiraltyCampaignEntity,
} from './entities/character-admiralty-campaign.entity';
import { CharacterAdmiraltyProgressEntity } from './entities/character-admiralty-progress.entity';

export interface CharacterAdmiraltySummary {
  totalTiers: number;
  maxPossibleTiers: number;
  completedCampaigns: number;
  totalCampaigns: number;
  totalTourSteps: number;
  maxPossibleTourSteps: number;
  overallCompletionPercentage: number;
}

@Injectable()
export class CharacterAdmiraltyService {
  constructor(
    @InjectRepository(CharacterAdmiraltyCampaignEntity)
    private readonly _campaignRepository: Repository<CharacterAdmiraltyCampaignEntity>,
    @InjectRepository(CharacterAdmiraltyProgressEntity)
    private readonly _progressRepository: Repository<CharacterAdmiraltyProgressEntity>,
    private readonly _characterOwnership: CharacterOwnershipService,
  ) {}

  async getCampaigns(): Promise<CharacterAdmiraltyCampaignEntity[]> {
    return this._campaignRepository.find({
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  async getProgress(characterId: string, userId: string) {
    await this._characterOwnership.requireOwnedCharacter(characterId, userId);
    const campaigns = await this.getCampaigns();
    const existing = await this._progressRepository.find({
      where: { characterId },
      relations: { campaign: true },
    });
    const byCampaign = new Map(existing.map(item => [item.campaignId, item]));
    return campaigns.map(campaign => {
      const saved = byCampaign.get(campaign.id);
      if (saved) return saved;
      const item = new CharacterAdmiraltyProgressEntity();
      item.id = '';
      item.characterId = characterId;
      item.campaignId = campaign.id;
      item.campaign = campaign;
      item.currentTier = 0;
      item.tourOfDutyStep = 0;
      return item;
    });
  }

  async updateProgress(
    characterId: string,
    userId: string,
    campaignId: string,
    dto: UpdateCharacterAdmiraltyProgressDto,
  ) {
    await this._characterOwnership.requireOwnedCharacter(characterId, userId);
    const campaign = await this._campaignRepository.findOne({
      where: { id: campaignId },
    });
    if (!campaign)
      throw new NotFoundException(
        `Admiralty campaign with ID "${campaignId}" not found`,
      );
    let progress = await this._progressRepository.findOne({
      where: { characterId, campaignId },
    });
    progress ??= this._progressRepository.create({ characterId, campaignId });
    progress.currentTier = dto.currentTier;
    progress.tourOfDutyStep = dto.tourOfDutyStep;
    await this._progressRepository.save(progress);
    progress.campaign = campaign;
    return progress;
  }

  async getSummary(
    characterId: string,
    userId: string,
  ): Promise<CharacterAdmiraltySummary> {
    await this._characterOwnership.requireOwnedCharacter(characterId, userId);
    const campaigns = await this._campaignRepository.find();
    const progress = await this._progressRepository.find({
      where: { characterId },
    });
    const totalTiers = progress.reduce(
      (sum, item) => sum + item.currentTier,
      0,
    );
    const totalTourSteps = progress.reduce(
      (sum, item) => sum + item.tourOfDutyStep,
      0,
    );
    const maxPossibleTiers = campaigns.length * ADMIRALTY_MAX_TIER;
    const maxPossibleTourSteps = campaigns.length * ADMIRALTY_MAX_TOUR_STEP;
    return {
      totalTiers,
      maxPossibleTiers,
      completedCampaigns: progress.filter(
        item => item.currentTier >= ADMIRALTY_MAX_TIER,
      ).length,
      totalCampaigns: campaigns.length,
      totalTourSteps,
      maxPossibleTourSteps,
      overallCompletionPercentage: maxPossibleTiers
        ? Math.round((totalTiers / maxPossibleTiers) * 100)
        : 0,
    };
  }
}
