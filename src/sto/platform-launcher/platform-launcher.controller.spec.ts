import { Test, TestingModule } from '@nestjs/testing';
import { PlatformLauncherController } from './platform-launcher.controller';
import { PlatformLauncherService } from './platform-launcher.service';

describe('PlatformLauncherController', () => {
  let controller: PlatformLauncherController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlatformLauncherController],
      providers: [PlatformLauncherService],
    }).compile();

    controller = module.get<PlatformLauncherController>(PlatformLauncherController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
