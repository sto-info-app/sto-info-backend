import { Test, TestingModule } from '@nestjs/testing';

import { jest } from '@jest/globals';

import { CharacterOverviewController } from './character-overview.controller';
import { CharacterOverviewService } from './character-overview.service';

describe('CharacterOverviewController', () => {
  let controller: CharacterOverviewController;
  let service: CharacterOverviewService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CharacterOverviewController],
      providers: [
        {
          provide: CharacterOverviewService,
          useValue: {
            getSummary: jest.fn<(...args: any[]) => Promise<any>>(),
          },
        },
      ],
    }).compile();

    controller = module.get<CharacterOverviewController>(
      CharacterOverviewController,
    );
    service = module.get<CharacterOverviewService>(CharacterOverviewService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should delegate getSummary to the service with the captain and user', async () => {
    const summary = { admiralty: { overallCompletionPercentage: 25 } };
    (
      service.getSummary as jest.Mock<(...args: any[]) => Promise<any>>
    ).mockResolvedValue(summary);

    const result = await controller.getSummary('user-1', 'character-1');

    expect(result).toEqual(summary);
    expect(service.getSummary).toHaveBeenCalledWith('character-1', 'user-1');
  });
});
