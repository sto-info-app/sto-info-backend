import { Test, TestingModule } from '@nestjs/testing';
import { ConfigCheckService } from './config-check.service';

describe('ConfigCheckService', () => {
  let service: ConfigCheckService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ConfigCheckService],
    }).compile();

    service = module.get<ConfigCheckService>(ConfigCheckService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
