import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { jest } from '@jest/globals';

import { CharacterAdmiraltyService } from 'src/sto/character-admiralty/character-admiralty.service';
import { CharacterCommendationService } from 'src/sto/character-commendation/character-commendation.service';
import { CharacterRdService } from 'src/sto/character-rd/character-rd.service';
import { CharacterReputationService } from 'src/sto/character-reputation/character-reputation.service';
import { CharacterSpecializationService } from 'src/sto/character-specialization/character-specialization.service';

import { CharacterOverviewService } from './character-overview.service';

type SummaryMock = jest.Mock<(...args: any[]) => Promise<any>>;

describe('CharacterOverviewService', () => {
  let service: CharacterOverviewService;
  let reputation: { getSummary: SummaryMock };
  let rd: { getSummary: SummaryMock };
  let specialization: { getSummary: SummaryMock };
  let admiralty: { getSummary: SummaryMock };
  let commendation: { getSummary: SummaryMock };

  const summaryMock = () => ({
    getSummary: jest.fn<(...args: any[]) => Promise<any>>(),
  });

  beforeEach(async () => {
    reputation = summaryMock();
    rd = summaryMock();
    specialization = summaryMock();
    admiralty = summaryMock();
    commendation = summaryMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CharacterOverviewService,
        { provide: CharacterReputationService, useValue: reputation },
        { provide: CharacterRdService, useValue: rd },
        { provide: CharacterSpecializationService, useValue: specialization },
        { provide: CharacterAdmiraltyService, useValue: admiralty },
        { provide: CharacterCommendationService, useValue: commendation },
      ],
    }).compile();

    service = module.get<CharacterOverviewService>(CharacterOverviewService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should gather every tracker summary under its own key', async () => {
    reputation.getSummary.mockResolvedValue({
      overallCompletionPercentage: 10,
    });
    rd.getSummary.mockResolvedValue({ overallCompletionPercentage: 20 });
    specialization.getSummary.mockResolvedValue({
      overallCompletionPercentage: 30,
    });
    admiralty.getSummary.mockResolvedValue({ overallCompletionPercentage: 40 });
    commendation.getSummary.mockResolvedValue({
      overallCompletionPercentage: 50,
    });

    const result = await service.getSummary('character-1', 'user-1');

    expect(result).toEqual({
      reputation: { overallCompletionPercentage: 10 },
      rd: { overallCompletionPercentage: 20 },
      specialization: { overallCompletionPercentage: 30 },
      admiralty: { overallCompletionPercentage: 40 },
      commendation: { overallCompletionPercentage: 50 },
    });
  });

  it('should ask every tracker for the same captain and user', async () => {
    for (const tracker of [
      reputation,
      rd,
      specialization,
      admiralty,
      commendation,
    ]) {
      tracker.getSummary.mockResolvedValue({});
    }

    await service.getSummary('character-1', 'user-1');

    for (const tracker of [
      reputation,
      rd,
      specialization,
      admiralty,
      commendation,
    ]) {
      expect(tracker.getSummary).toHaveBeenCalledTimes(1);
      expect(tracker.getSummary).toHaveBeenCalledWith('character-1', 'user-1');
    }
  });

  // The trackers each refuse a captain the user does not own; the first
  // refusal is the answer, and nothing partial is assembled around it.
  it('should surface a tracker refusal rather than a partial summary', async () => {
    reputation.getSummary.mockResolvedValue({});
    rd.getSummary.mockRejectedValue(new ForbiddenException('not yours'));
    specialization.getSummary.mockResolvedValue({});
    admiralty.getSummary.mockResolvedValue({});
    commendation.getSummary.mockResolvedValue({});

    await expect(service.getSummary('character-1', 'user-2')).rejects.toThrow(
      ForbiddenException,
    );
  });
});
