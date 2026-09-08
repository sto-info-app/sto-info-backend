import { Test, TestingModule } from '@nestjs/testing';

import { jest } from '@jest/globals';

import { CharacterRdController } from './character-rd.controller';
import { CharacterRdService } from './character-rd.service';
import { UpdateCharacterRdProgressDto } from './dto/update-character-rd-progress.dto';

describe('CharacterRdController', () => {
  let controller: CharacterRdController;
  let service: CharacterRdService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CharacterRdController],
      providers: [
        {
          provide: CharacterRdService,
          useValue: {
            getSchools: jest.fn<(...args: any[]) => Promise<any>>(),
            getProgress: jest.fn<(...args: any[]) => Promise<any>>(),
            getSummary: jest.fn<(...args: any[]) => Promise<any>>(),
            updateProgress: jest.fn<(...args: any[]) => Promise<any>>(),
          },
        },
      ],
    }).compile();

    controller = module.get<CharacterRdController>(CharacterRdController);
    service = module.get<CharacterRdService>(CharacterRdService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should delegate getSchools to service', async () => {
    (
      service.getSchools as jest.Mock<(...args: any[]) => Promise<any>>
    ).mockResolvedValue([{ id: 'school-1' }]);

    const result = await controller.getSchools();

    expect(result).toEqual([{ id: 'school-1' }]);
    expect(service.getSchools).toHaveBeenCalledWith();
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
      totalLevels: 0,
      maxPossibleLevels: 0,
      overallCompletionPercentage: 0,
      completedSchools: 0,
      totalSchools: 0,
    };
    (
      service.getSummary as jest.Mock<(...args: any[]) => Promise<any>>
    ).mockResolvedValue(summary);

    const result = await controller.getSummary('user-1', 'character-1');

    expect(result).toEqual(summary);
    expect(service.getSummary).toHaveBeenCalledWith('character-1', 'user-1');
  });

  it('should delegate updateProgress to service', async () => {
    const dto: UpdateCharacterRdProgressDto = {
      currentLevel: 12,
    };
    (
      service.updateProgress as jest.Mock<(...args: any[]) => Promise<any>>
    ).mockResolvedValue({
      id: 'progress-1',
    });

    const result = await controller.updateProgress(
      'user-1',
      'character-1',
      'school-1',
      dto,
    );

    expect(result).toEqual({ id: 'progress-1' });
    expect(service.updateProgress).toHaveBeenCalledWith(
      'character-1',
      'user-1',
      'school-1',
      dto,
    );
  });
});
