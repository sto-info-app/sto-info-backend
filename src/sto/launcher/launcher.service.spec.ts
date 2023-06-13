import { Test, TestingModule } from '@nestjs/testing';
import { LauncherService } from './launcher.service';

describe('LauncherService', () => {
  let service: LauncherService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [LauncherService],
    }).compile();

    service = module.get<LauncherService>(LauncherService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
