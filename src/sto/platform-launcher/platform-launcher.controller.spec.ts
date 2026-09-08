import { Test, TestingModule } from '@nestjs/testing';

import { jest } from '@jest/globals';

import { PlatformLauncherEntity } from './entities/platform-launcher.entity';
import { PlatformLauncherController } from './platform-launcher.controller';
import { PlatformLauncherService } from './platform-launcher.service';

describe('PlatformLauncherController', () => {
  let controller: PlatformLauncherController;
  let findAllMock: jest.MockedFunction<PlatformLauncherService['findAll']>;

  beforeEach(async () => {
    findAllMock = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlatformLauncherController],
      providers: [
        {
          provide: PlatformLauncherService,
          useValue: {
            findAll: findAllMock,
          } satisfies Pick<PlatformLauncherService, 'findAll'>,
        },
      ],
    }).compile();

    controller = module.get<PlatformLauncherController>(
      PlatformLauncherController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('should return all platform-launcher mappings', async () => {
      const mapping1 = new PlatformLauncherEntity();
      mapping1.platformId = '00000000-0000-0000-0000-000000000001';
      mapping1.launcherId = '00000000-0000-0000-0000-000000000002';

      const mapping2 = new PlatformLauncherEntity();
      mapping2.platformId = '00000000-0000-0000-0000-000000000003';
      mapping2.launcherId = '00000000-0000-0000-0000-000000000004';

      const expected: PlatformLauncherEntity[] = [mapping1, mapping2];
      findAllMock.mockResolvedValue(expected);

      const result = await controller.findAll();

      expect(result).toEqual(expected);
    });
  });
});
