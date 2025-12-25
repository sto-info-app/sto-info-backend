import { JwtStrategy } from './jwt.strategy';

jest.mock('@nestjs/config', () => ({
  ConfigService: jest.fn().mockImplementation(() => ({
    get: jest.fn(),
  })),
}));

jest.mock('src/shared/secrets/secrets.service', () => ({
  SecretsService: jest.fn(),
}));

jest.mock('./auth.service', () => ({
  AuthService: jest.fn(),
}));

describe('JwtStrategy', () => {
  it('should be defined', () => {
    expect(JwtStrategy).toBeDefined();
  });
});
