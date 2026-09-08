import { Test, TestingModule } from '@nestjs/testing';

import { jest } from '@jest/globals';

import { CharacterReputationController } from './character-reputation.controller';
import { CharacterReputationService } from './character-reputation.service';
import { UpdateCharacterReputationProgressDto } from './dto/update-character-reputation-progress.dto';

describe('CharacterReputationController', () => {
  let controller: CharacterReputationController;
  let service: CharacterReputationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CharacterReputationController],
      providers: [
        {
          provide: CharacterReputationService,
          useValue: {
            getReputations: jest.fn<(...args: any[]) => Promise<any>>(),
            getProgress: jest.fn<(...args: any[]) => Promise<any>>(),
            getSummary: jest.fn<(...args: any[]) => Promise<any>>(),
            updateProgress: jest.fn<(...args: any[]) => Promise<any>>(),
          },
        },
      ],
    }).compile();

    controller = module.get<CharacterReputationController>(
      CharacterReputationController,
    );
    service = module.get<CharacterReputationService>(
      CharacterReputationService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should delegate getReputations to service', async () => {
    (
      service.getReputations as jest.Mock<(...args: any[]) => Promise<any>>
    ).mockResolvedValue([{ id: 'rep-1' }]);

    const result = await controller.getReputations();

    expect(result).toEqual([{ id: 'rep-1' }]);
    expect(service.getReputations).toHaveBeenCalledWith();
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
      totalTiers: 0,
      maxPossibleTiers: 0,
      overallCompletionPercentage: 0,
      completedReputations: 0,
      totalReputations: 0,
    };
    (
      service.getSummary as jest.Mock<(...args: any[]) => Promise<any>>
    ).mockResolvedValue(summary);

    const result = await controller.getSummary('user-1', 'character-1');

    expect(result).toEqual(summary);
    expect(service.getSummary).toHaveBeenCalledWith('character-1', 'user-1');
  });

  it('should delegate updateProgress to service', async () => {
    const dto: UpdateCharacterReputationProgressDto = {
      currentTier: 4,
    };
    (
      service.updateProgress as jest.Mock<(...args: any[]) => Promise<any>>
    ).mockResolvedValue({
      id: 'progress-1',
    });

    const result = await controller.updateProgress(
      'user-1',
      'character-1',
      'rep-1',
      dto,
    );

    expect(result).toEqual({ id: 'progress-1' });
    expect(service.updateProgress).toHaveBeenCalledWith(
      'character-1',
      'user-1',
      'rep-1',
      dto,
    );
  });
});
