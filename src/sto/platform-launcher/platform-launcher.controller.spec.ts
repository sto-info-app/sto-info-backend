import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PlatformLauncherEntity } from './entities/platform-launcher.entity';
import { PlatformLauncherController } from './platform-launcher.controller';
import { PlatformLauncherService } from './platform-launcher.service';

describe('PlatformLauncherController', () => {
  let controller: PlatformLauncherController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlatformLauncherController],
      providers: [
        PlatformLauncherService,
        {
          provide: getRepositoryToken(PlatformLauncherEntity),
          useValue: {},
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
});
