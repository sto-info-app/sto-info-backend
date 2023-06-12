import { Test, TestingModule } from '@nestjs/testing';
import { AccountSeederService } from './account-seeder.service';

describe('AccountSeederService', () => {
  let service: AccountSeederService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AccountSeederService],
    }).compile();

    service = module.get<AccountSeederService>(AccountSeederService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
