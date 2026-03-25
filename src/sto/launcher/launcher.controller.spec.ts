import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LauncherEntity } from './entities/launcher.entity';
import { LauncherController } from './launcher.controller';
import { LauncherService } from './launcher.service';

describe('LauncherController', () => {
  let controller: LauncherController;
  let service: LauncherService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LauncherController],
      providers: [
        {
          provide: LauncherService,
          useValue: {
            findAll: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(LauncherEntity),
          useValue: {},
        },
      ],
    }).compile();

    controller = module.get<LauncherController>(LauncherController);
    service = module.get<LauncherService>(LauncherService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('should return all launchers', async () => {
      const expected = [
        { id: '1', name: 'Launcher 1' },
        { id: '2', name: 'Launcher 2' },
      ];
      (service.findAll as jest.Mock).mockResolvedValue(expected);

      const result = await controller.findAll();

      expect(result).toEqual(expected);
      expect(service.findAll).toHaveBeenCalled();
    });
  });
});
