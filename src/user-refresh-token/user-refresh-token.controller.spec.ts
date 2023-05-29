import { Test, TestingModule } from '@nestjs/testing';
import { UserRefreshTokenController } from './user-refresh-token.controller';
import { UserRefreshTokenService } from './user-refresh-token.service';

describe('UserRefreshTokenController', () => {
  let controller: UserRefreshTokenController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserRefreshTokenController],
      providers: [UserRefreshTokenService],
    }).compile();

    controller = module.get<UserRefreshTokenController>(
      UserRefreshTokenController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
