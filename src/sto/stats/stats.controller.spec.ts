import { Test, TestingModule } from '@nestjs/testing';
import { StatsResponseDto } from './dto/stats-response.dto';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

describe('StatsController', () => {
  let controller: StatsController;
  let service: StatsService;

  const mockStats: StatsResponseDto = {
    accountCount: 2,
    lifetimeSubCount: 1,
    characterCount: 5,
    avgLevel: 40,
    minLevel: 10,
    maxLevel: 65,
    bySpecies: [],
    byGeneralFaction: [],
    byFaction: [],
    byClass: [],
    bySex: [],
    byRecruitType: [],
    byLevelRange: [],
    byPlatform: [],
    byLauncher: [],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StatsController],
      providers: [
        {
          provide: StatsService,
          useValue: {
            getStats: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<StatsController>(StatsController);
    service = module.get<StatsService>(StatsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getStats', () => {
    it('should return stats for the authenticated user without an accountId', async () => {
      (service.getStats as jest.Mock).mockResolvedValue(mockStats);

      const result = await controller.getStats('user-1');

      expect(result).toEqual(mockStats);
      expect(service.getStats).toHaveBeenCalledWith('user-1', undefined);
    });

    it('should pass accountId to the service when provided', async () => {
      (service.getStats as jest.Mock).mockResolvedValue(mockStats);

      const result = await controller.getStats('user-1', 'account-1');

      expect(result).toEqual(mockStats);
      expect(service.getStats).toHaveBeenCalledWith('user-1', 'account-1');
    });
  });
});
