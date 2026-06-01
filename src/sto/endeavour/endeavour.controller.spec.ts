import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { EndeavourProgressQueryDto } from './dto/endeavour-progress-query.dto';
import { UpdateEndeavourProgressDto } from './dto/update-endeavour-progress.dto';
import { EndeavourController } from './endeavour.controller';
import { EndeavourService } from './endeavour.service';

describe('EndeavourController', () => {
  let controller: EndeavourController;
  let service: EndeavourService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EndeavourController],
      providers: [
        {
          provide: EndeavourService,
          useValue: {
            getPerks: jest.fn<(...args: any[]) => Promise<any>>(),
            getProgress: jest.fn<(...args: any[]) => Promise<any>>(),
            getSummary: jest.fn<(...args: any[]) => Promise<any>>(),
            updateProgress: jest.fn<(...args: any[]) => Promise<any>>(),
          },
        },
      ],
    }).compile();

    controller = module.get<EndeavourController>(EndeavourController);
    service = module.get<EndeavourService>(EndeavourService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should delegate getPerks to service', async () => {
    (
      service.getPerks as jest.Mock<(...args: any[]) => Promise<any>>
    ).mockResolvedValue([{ id: 'perk-1' }]);

    const result = await controller.getPerks('Space');

    expect(result).toEqual([{ id: 'perk-1' }]);
    expect(service.getPerks).toHaveBeenCalledWith('Space');
  });

  it('should delegate getProgress to service', async () => {
    const query: EndeavourProgressQueryDto = {
      category: 'Ground',
      sortBy: 'nodes',
      sortOrder: 'DESC',
    };
    (
      service.getProgress as jest.Mock<(...args: any[]) => Promise<any>>
    ).mockResolvedValue([{ id: 'progress-1' }]);

    const result = await controller.getProgress('user-1', 'account-1', query);

    expect(result).toEqual([{ id: 'progress-1' }]);
    expect(service.getProgress).toHaveBeenCalledWith(
      'account-1',
      'user-1',
      query,
    );
  });

  it('should delegate getSummary to service', async () => {
    const summary = {
      totalNodes: 0,
      maxPossibleNodes: 0,
      overallCompletionPercentage: 0,
      maxedPerks: 0,
      totalPerks: 0,
      spaceNodes: 0,
      spaceMaxNodes: 0,
      spaceCompletionPercentage: 0,
      groundNodes: 0,
      groundMaxNodes: 0,
      groundCompletionPercentage: 0,
    };
    (
      service.getSummary as jest.Mock<(...args: any[]) => Promise<any>>
    ).mockResolvedValue(summary);

    const result = await controller.getSummary('user-1', 'account-1');

    expect(result).toEqual(summary);
    expect(service.getSummary).toHaveBeenCalledWith('account-1', 'user-1');
  });

  it('should delegate updateProgress to service', async () => {
    const dto: UpdateEndeavourProgressDto = { currentNodes: 12 };
    (
      service.updateProgress as jest.Mock<(...args: any[]) => Promise<any>>
    ).mockResolvedValue({
      id: 'progress-1',
    });

    const result = await controller.updateProgress(
      'user-1',
      'account-1',
      'perk-1',
      dto,
    );

    expect(result).toEqual({ id: 'progress-1' });
    expect(service.updateProgress).toHaveBeenCalledWith(
      'account-1',
      'user-1',
      'perk-1',
      dto,
    );
  });
});
