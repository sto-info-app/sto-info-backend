import { Test, TestingModule } from '@nestjs/testing';
import { LauncherController } from './launcher.controller';
import { LauncherService } from './launcher.service';

describe('LauncherController', () => {
  let controller: LauncherController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LauncherController],
      providers: [LauncherService],
    }).compile();

    controller = module.get<LauncherController>(LauncherController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
