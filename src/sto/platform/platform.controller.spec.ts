import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';

describe('PlatformController', () => {
  let controller: PlatformController;
  let findAllMock: jest.MockedFunction<PlatformService['findAll']>;

  beforeEach(async () => {
    findAllMock = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlatformController],
      providers: [
        {
          provide: PlatformService,
          useValue: {
            findAll: findAllMock,
          } satisfies Pick<PlatformService, 'findAll'>,
        },
      ],
    }).compile();

    controller = module.get<PlatformController>(PlatformController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return platforms from the service', async () => {
    const platforms = [{ id: 'p-1' }];

    findAllMock.mockResolvedValue(
      platforms as unknown as Awaited<ReturnType<PlatformService['findAll']>>,
    );

    await expect(controller.findAll()).resolves.toBe(platforms);
  });
});
