import { Test, TestingModule } from '@nestjs/testing';

import { jest } from '@jest/globals';

import { CharacterAdmiraltyController } from './character-admiralty.controller';
import { CharacterAdmiraltyService } from './character-admiralty.service';
import { UpdateCharacterAdmiraltyProgressDto } from './dto/update-character-admiralty-progress.dto';

describe('CharacterAdmiraltyController', () => {
  let controller: CharacterAdmiraltyController;
  let service: CharacterAdmiraltyService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CharacterAdmiraltyController],
      providers: [
        {
          provide: CharacterAdmiraltyService,
          useValue: {
            getCampaigns: jest.fn<(...args: any[]) => Promise<any>>(),
            getProgress: jest.fn<(...args: any[]) => Promise<any>>(),
            getSummary: jest.fn<(...args: any[]) => Promise<any>>(),
            updateProgress: jest.fn<(...args: any[]) => Promise<any>>(),
          },
        },
      ],
    }).compile();

    controller = module.get<CharacterAdmiraltyController>(
      CharacterAdmiraltyController,
    );
    service = module.get<CharacterAdmiraltyService>(CharacterAdmiraltyService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should delegate getCampaigns to service', async () => {
    (
      service.getCampaigns as jest.Mock<(...args: any[]) => Promise<any>>
    ).mockResolvedValue([{ id: 'campaign-1' }]);

    const result = await controller.getCampaigns();

    expect(result).toEqual([{ id: 'campaign-1' }]);
    expect(service.getCampaigns).toHaveBeenCalledWith();
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
      completedCampaigns: 0,
      totalCampaigns: 0,
      totalTourSteps: 0,
      maxPossibleTourSteps: 0,
      overallCompletionPercentage: 0,
    };
    (
      service.getSummary as jest.Mock<(...args: any[]) => Promise<any>>
    ).mockResolvedValue(summary);

    const result = await controller.getSummary('user-1', 'character-1');

    expect(result).toEqual(summary);
    expect(service.getSummary).toHaveBeenCalledWith('character-1', 'user-1');
  });

  it('should delegate updateProgress to service', async () => {
    const dto: UpdateCharacterAdmiraltyProgressDto = {
      currentTier: 6,
      tourOfDutyStep: 3,
    };
    (
      service.updateProgress as jest.Mock<(...args: any[]) => Promise<any>>
    ).mockResolvedValue({
      id: 'progress-1',
    });

    const result = await controller.updateProgress(
      'user-1',
      'character-1',
      'campaign-1',
      dto,
    );

    expect(result).toEqual({ id: 'progress-1' });
    expect(service.updateProgress).toHaveBeenCalledWith(
      'character-1',
      'user-1',
      'campaign-1',
      dto,
    );
  });
});
