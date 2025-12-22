import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LauncherEntity } from './entities/launcher.entity';
import { LauncherService } from './launcher.service';

describe('LauncherService', () => {
  let service: LauncherService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LauncherService,
        {
          provide: getRepositoryToken(LauncherEntity),
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<LauncherService>(LauncherService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
