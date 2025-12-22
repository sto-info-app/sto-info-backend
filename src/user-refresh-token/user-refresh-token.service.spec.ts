import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserRefreshTokenEntity } from './entities/user-refresh-token.entity';
import { UserRefreshTokenService } from './user-refresh-token.service';

describe('UserRefreshTokenService', () => {
  let service: UserRefreshTokenService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserRefreshTokenService,
        {
          provide: getRepositoryToken(UserRefreshTokenEntity),
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<UserRefreshTokenService>(UserRefreshTokenService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
