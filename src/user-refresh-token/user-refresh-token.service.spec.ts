import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserRefreshTokenEntity } from './entities/user-refresh-token.entity';
import { UserRefreshTokenService } from './user-refresh-token.service';

describe('UserRefreshTokenService', () => {
  let service: UserRefreshTokenService;
  let repository: Repository<UserRefreshTokenEntity>;

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
    repository = module.get<Repository<UserRefreshTokenEntity>>(
      getRepositoryToken(UserRefreshTokenEntity),
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should revoke all non-revoked tokens for a user', async () => {
    const updateSpy = jest
      .spyOn(repository, 'update')
      .mockResolvedValue({} as any);

    const userId = 'test-user-id';

    await service.revokeAllTokensForUser(userId);

    expect(updateSpy).toHaveBeenCalledWith(
      { user: { id: userId }, isRevoked: false },
      { isRevoked: true },
    );
  });
});
