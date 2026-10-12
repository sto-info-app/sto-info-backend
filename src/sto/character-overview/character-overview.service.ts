import { Injectable } from '@nestjs/common';

import {
  CharacterAdmiraltyService,
  CharacterAdmiraltySummary,
} from 'src/sto/character-admiralty/character-admiralty.service';
import {
  CharacterCommendationService,
  CharacterCommendationSummary,
} from 'src/sto/character-commendation/character-commendation.service';
import {
  CharacterRdService,
  CharacterRdSummary,
} from 'src/sto/character-rd/character-rd.service';
import {
  CharacterReputationService,
  CharacterReputationSummary,
} from 'src/sto/character-reputation/character-reputation.service';
import {
  CharacterSpecializationService,
  CharacterSpecializationSummary,
} from 'src/sto/character-specialization/character-specialization.service';

/** Every tracker's summary for one captain, as the Overview tab shows them. */
export interface CharacterOverviewSummary {
  reputation: CharacterReputationSummary;
  rd: CharacterRdSummary;
  specialization: CharacterSpecializationSummary;
  admiralty: CharacterAdmiraltySummary;
  commendation: CharacterCommendationSummary;
}

/**
 * Gathers the five tracker summaries behind one request.
 *
 * The Overview tab wants a figure from every tracker at once, and five round
 * trips for five numbers is the kind of chatter a tab should not make on
 * open. Each tracker still owns its own arithmetic: this only asks all of
 * them together and hands the answers back under one roof.
 */
@Injectable()
export class CharacterOverviewService {
  constructor(
    private readonly _reputation: CharacterReputationService,
    private readonly _rd: CharacterRdService,
    private readonly _specialization: CharacterSpecializationService,
    private readonly _admiralty: CharacterAdmiraltyService,
    private readonly _commendation: CharacterCommendationService,
  ) {}

  /**
   * Fetches every tracker's summary for a captain the user owns.
   *
   * Each tracker checks the captain's ownership itself, so a captain that is
   * not the user's is refused by the first answer back and nothing is
   * assembled from the rest.
   *
   * @param characterId - The captain whose summaries are wanted.
   * @param userId - The user asking, who must own the captain.
   * @returns The five summaries, keyed by tracker.
   */
  async getSummary(
    characterId: string,
    userId: string,
  ): Promise<CharacterOverviewSummary> {
    const [reputation, rd, specialization, admiralty, commendation] =
      await Promise.all([
        this._reputation.getSummary(characterId, userId),
        this._rd.getSummary(characterId, userId),
        this._specialization.getSummary(characterId, userId),
        this._admiralty.getSummary(characterId, userId),
        this._commendation.getSummary(characterId, userId),
      ]);

    return { reputation, rd, specialization, admiralty, commendation };
  }
}
