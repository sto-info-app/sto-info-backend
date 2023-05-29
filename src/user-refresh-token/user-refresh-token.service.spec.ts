import { Test, TestingModule } from '@nestjs/testing';
import { UserRefreshTokenService } from './user-refresh-token.service';

describe('UserRefreshTokenService', () => {
  let service: UserRefreshTokenService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [UserRefreshTokenService],
    }).compile();

    service = module.get<UserRefreshTokenService>(UserRefreshTokenService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
