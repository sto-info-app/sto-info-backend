import { Test, TestingModule } from '@nestjs/testing';
import { PlatformLauncherService } from './platform-launcher.service';

describe('PlatformLauncherService', () => {
  let service: PlatformLauncherService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PlatformLauncherService],
    }).compile();

    service = module.get<PlatformLauncherService>(PlatformLauncherService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
