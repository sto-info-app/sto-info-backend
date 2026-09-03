import { Test, TestingModule } from '@nestjs/testing';

import { jest } from '@jest/globals';

import { CharacterCommendationController } from './character-commendation.controller';
import { CharacterCommendationService } from './character-commendation.service';
import { UpdateCharacterCommendationProgressDto } from './dto/update-character-commendation-progress.dto';

describe('CharacterCommendationController', () => {
  let controller: CharacterCommendationController;
  let service: CharacterCommendationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CharacterCommendationController],
      providers: [
        {
          provide: CharacterCommendationService,
          useValue: {
            getCommendations: jest.fn<(...args: any[]) => Promise<any>>(),
            getProgress: jest.fn<(...args: any[]) => Promise<any>>(),
            getSummary: jest.fn<(...args: any[]) => Promise<any>>(),
            updateProgress: jest.fn<(...args: any[]) => Promise<any>>(),
          },
        },
      ],
    }).compile();

    controller = module.get<CharacterCommendationController>(
      CharacterCommendationController,
    );
    service = module.get<CharacterCommendationService>(
      CharacterCommendationService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should delegate getCommendations to service', async () => {
    (
      service.getCommendations as jest.Mock<(...args: any[]) => Promise<any>>
    ).mockResolvedValue([{ id: 'commendation-1' }]);

    const result = await controller.getCommendations();

    expect(result).toEqual([{ id: 'commendation-1' }]);
    expect(service.getCommendations).toHaveBeenCalledWith();
  });

  it('should delegate getProgress to service', async () => {
    (
      service.getProgress as jest.Mock<(...args: any[]) => Promise<any>>
    ).mockResolvedValue([{ id: 'progress-1' }]);

    const result = await controller.getProgress('user-1', 'character-1');

    expect(result).toEqual([{ id: 'progress-1' }]);
    expect(service.getProgress).toHaveBeenCalledWith('character-1', 'user-1');
  });

  it('should delegate getSummary to service', async () => {
    const summary = {
      totalRanks: 6,
      maxPossibleRanks: 44,
      overallCompletionPercentage: 14,
      completedCommendations: 1,
      totalCommendations: 11,
    };
    (
      service.getSummary as jest.Mock<(...args: any[]) => Promise<any>>
    ).mockResolvedValue(summary);

    const result = await controller.getSummary('user-1', 'character-1');

    expect(result).toEqual(summary);
    expect(service.getSummary).toHaveBeenCalledWith('character-1', 'user-1');
  });

  it('should delegate updateProgress to service', async () => {
    const dto: UpdateCharacterCommendationProgressDto = { currentRank: 2 };
    (
      service.updateProgress as jest.Mock<(...args: any[]) => Promise<any>>
    ).mockResolvedValue({ id: 'progress-1' });

    const result = await controller.updateProgress(
      'user-1',
      'character-1',
      'commendation-1',
      dto,
    );

    expect(result).toEqual({ id: 'progress-1' });
    expect(service.updateProgress).toHaveBeenCalledWith(
      'character-1',
      'user-1',
      'commendation-1',
      dto,
    );
  });
});
