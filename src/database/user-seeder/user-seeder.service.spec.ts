import { Test, TestingModule } from '@nestjs/testing';
import { UserSeederService } from './user-seeder.service';

describe('UserSeederService', () => {
  let service: UserSeederService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [UserSeederService],
    }).compile();

    service = module.get<UserSeederService>(UserSeederService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
