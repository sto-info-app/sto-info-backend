import { Test, TestingModule } from '@nestjs/testing';

import { jest } from '@jest/globals';

import { CharacterSpecializationController } from './character-specialization.controller';
import { CharacterSpecializationService } from './character-specialization.service';
import { UpdateCharacterSpecializationProgressDto } from './dto/update-character-specialization-progress.dto';
import { UpdateCharacterSpecializationSlotDto } from './dto/update-character-specialization-slot.dto';

describe('CharacterSpecializationController', () => {
  let controller: CharacterSpecializationController;
  let service: CharacterSpecializationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CharacterSpecializationController],
      providers: [
        {
          provide: CharacterSpecializationService,
          useValue: {
            getSpecializations: jest.fn<(...args: any[]) => Promise<any>>(),
            getProgress: jest.fn<(...args: any[]) => Promise<any>>(),
            getSummary: jest.fn<(...args: any[]) => Promise<any>>(),
            updateProgress: jest.fn<(...args: any[]) => Promise<any>>(),
            updateSlot: jest.fn<(...args: any[]) => Promise<any>>(),
          },
        },
      ],
    }).compile();

    controller = module.get<CharacterSpecializationController>(
      CharacterSpecializationController,
    );
    service = module.get<CharacterSpecializationService>(
      CharacterSpecializationService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should delegate getSpecializations to service', async () => {
    (
      service.getSpecializations as jest.Mock<(...args: any[]) => Promise<any>>
    ).mockResolvedValue([{ id: 'spec-1' }]);

    const result = await controller.getSpecializations();

    expect(result).toEqual([{ id: 'spec-1' }]);
    expect(service.getSpecializations).toHaveBeenCalledWith();
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
      totalPoints: 0,
      maxPossiblePoints: 0,
      overallCompletionPercentage: 0,
      completedSpecializations: 0,
      totalSpecializations: 0,
      primarySpecializationName: null,
      secondarySpecializationName: null,
    };
    (
      service.getSummary as jest.Mock<(...args: any[]) => Promise<any>>
    ).mockResolvedValue(summary);

    const result = await controller.getSummary('user-1', 'character-1');

    expect(result).toEqual(summary);
    expect(service.getSummary).toHaveBeenCalledWith('character-1', 'user-1');
  });

  it('should delegate updateProgress to service', async () => {
    const dto: UpdateCharacterSpecializationProgressDto = {
      pointsSpent: 12,
    };
    (
      service.updateProgress as jest.Mock<(...args: any[]) => Promise<any>>
    ).mockResolvedValue({
      id: 'progress-1',
    });

    const result = await controller.updateProgress(
      'user-1',
      'character-1',
      'spec-1',
      dto,
    );

    expect(result).toEqual({ id: 'progress-1' });
    expect(service.updateProgress).toHaveBeenCalledWith(
      'character-1',
      'user-1',
      'spec-1',
      dto,
    );
  });

  it('should delegate updateSlot to service', async () => {
    const dto: UpdateCharacterSpecializationSlotDto = {
      slot: 'primary',
    };
    (
      service.updateSlot as jest.Mock<(...args: any[]) => Promise<any>>
    ).mockResolvedValue({
      id: 'progress-1',
    });

    const result = await controller.updateSlot(
      'user-1',
      'character-1',
      'spec-1',
      dto,
    );

    expect(result).toEqual({ id: 'progress-1' });
    expect(service.updateSlot).toHaveBeenCalledWith(
      'character-1',
      'user-1',
      'spec-1',
      dto,
    );
  });
});
