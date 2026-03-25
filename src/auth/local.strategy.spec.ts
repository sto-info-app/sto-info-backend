import { UnauthorizedException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { LocalStrategy } from './local.strategy';

describe('LocalStrategy', () => {
  let strategy: LocalStrategy;
  let authService: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocalStrategy,
        {
          provide: AuthService,
          useValue: { validateUser: jest.fn() },
        },
      ],
    }).compile();

    strategy = module.get<LocalStrategy>(LocalStrategy);
    authService = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(strategy).toBeDefined();
  });

  it('validate should return user when credentials are valid', async () => {
    (authService.validateUser as jest.Mock).mockResolvedValue({ id: 'u1' });

    await expect(strategy.validate('e', 'p')).resolves.toEqual({ id: 'u1' });
  });

  it('validate should throw UnauthorizedException when credentials are invalid', async () => {
    (authService.validateUser as jest.Mock).mockResolvedValue(null);

    await expect(strategy.validate('e', 'p')).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
