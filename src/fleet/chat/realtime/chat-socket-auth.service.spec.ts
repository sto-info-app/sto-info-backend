import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { DataSource } from 'typeorm';

import { AuthService } from 'src/auth/auth.service';

import { ChatSocketAuthService } from './chat-socket-auth.service';

const USER_ID = '32000000-0000-4000-8000-000000000001';
const EXP = 1_790_000_000;

describe('ChatSocketAuthService', () => {
  let jwt: { verifyAsync: jest.Mock<(...args: unknown[]) => Promise<unknown>> };
  let auth: {
    validateUserFromPayload: jest.Mock<
      (...args: unknown[]) => Promise<unknown>
    >;
  };
  let profile: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  let service: ChatSocketAuthService;

  beforeEach(() => {
    jwt = {
      verifyAsync: jest.fn(async () => ({
        sub: USER_ID,
        email: 'kira@example.test',
        tokenUse: 'access',
        exp: EXP,
      })),
    };
    auth = { validateUserFromPayload: jest.fn(async () => ({ id: USER_ID })) };
    profile = jest.fn(async () => ({ userId: USER_ID, username: 'Kira' }));
    service = new ChatSocketAuthService(
      jwt as unknown as JwtService,
      auth as unknown as AuthService,
      { manager: { findOne: profile } } as unknown as DataSource,
    );
  });

  it('names the account, its username, and when the token runs out', async () => {
    await expect(service.identify('token')).resolves.toEqual({
      userId: USER_ID,
      username: 'Kira',
      expiresAt: EXP * 1000,
    });
    expect(jwt.verifyAsync).toHaveBeenCalledWith('token', {
      algorithms: ['HS256'],
    });
  });

  it.each([
    ['nothing', undefined],
    ['a number', 7],
    ['an empty token', ''],
  ])('refuses %s', async (_label, token) => {
    await expect(service.identify(token)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
  });

  it('refuses a token that does not verify', async () => {
    jwt.verifyAsync.mockRejectedValue(new Error('jwt expired'));

    await expect(service.identify('token')).rejects.toThrow(
      'Sign in to use chat.',
    );
  });

  it.each([
    ['a refresh token', { tokenUse: 'refresh', exp: EXP }],
    ['a token that never runs out', { tokenUse: 'access' }],
  ])('refuses %s', async (_label, payload) => {
    jwt.verifyAsync.mockResolvedValue({ sub: USER_ID, ...payload });

    await expect(service.identify('token')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(auth.validateUserFromPayload).not.toHaveBeenCalled();
  });

  it('names nobody for an account without a profile', async () => {
    profile.mockResolvedValue(null);

    await expect(service.identify('token')).resolves.toMatchObject({
      username: null,
    });
  });

  it('refuses an account that has gone or is disabled', async () => {
    auth.validateUserFromPayload.mockResolvedValue(null);

    await expect(service.identify('token')).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
