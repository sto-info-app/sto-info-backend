import { Test, TestingModule } from '@nestjs/testing';
import { UserRefreshTokenController } from './user-refresh-token.controller';

describe('UserRefreshTokenController', () => {
  let controller: UserRefreshTokenController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserRefreshTokenController],
    }).compile();

    controller = module.get<UserRefreshTokenController>(
      UserRefreshTokenController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
