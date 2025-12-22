import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PlatformLauncherEntity } from './entities/platform-launcher.entity';
import { PlatformLauncherService } from './platform-launcher.service';

describe('PlatformLauncherService', () => {
  let service: PlatformLauncherService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformLauncherService,
        {
          provide: getRepositoryToken(PlatformLauncherEntity),
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<PlatformLauncherService>(PlatformLauncherService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
