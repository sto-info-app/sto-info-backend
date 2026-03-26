import { jest } from '@jest/globals';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { AuditLoginAttemptEntity } from 'src/audit/entities/audit-login-attempt.entity';
import { MailService } from 'src/mail/mail.service';
import { CurrentContextHelper } from 'src/shared/context/current-context.helper';
import { UserRefreshTokenService } from 'src/user-refresh-token/user-refresh-token.service';
import { UserProfileEntity } from 'src/user/entities/user-profile.entity';
import { UserEntity } from 'src/user/entities/user.entity';
import { UserService } from 'src/user/user.service';
import { QueryFailedError, Repository } from 'typeorm';

import { AuthService } from './auth.service';

jest.mock('bcrypt');
jest.mock('class-validator', () => {
  const actual = jest.requireActual('class-validator') as Record<
    string,
    unknown
  >;
  return {
    ...actual,
    validateOrReject: jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue(true),
  };
});
jest.mock('ejs', () => ({
  renderFile: jest
    .fn<(...args: any[]) => Promise<any>>()
    .mockResolvedValue('<html></html>'),
}));
jest.mock('html-to-text', () => ({
  convert: jest.fn().mockReturnValue('text'),
}));

describe('AuthService', () => {
  let service: AuthService;
  let userRepository: Repository<UserEntity>;
  let userProfileRepository: Repository<UserProfileEntity>;
  let loginAttemptRepository: Repository<AuditLoginAttemptEntity>;
  let jwtService: JwtService;
  let userService: UserService;
  let mailService: MailService;
  let refreshTokenService: UserRefreshTokenService;
  let consoleErrorSpy: jest.SpiedFunction<(...args: any[]) => any>;

  beforeAll(() => {
    // Suppress console.error during tests
    consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
  });

  afterAll(() => {
    // Restore console.error after tests
    consoleErrorSpy.mockRestore();
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getRepositoryToken(UserEntity),
          useValue: {
            create: jest.fn().mockImplementation(val => val),
            save: jest.fn(),
            findOne: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(UserProfileEntity),
          useValue: {
            create: jest.fn().mockImplementation(val => val),
            save: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(AuditLoginAttemptEntity),
          useValue: {
            save: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn(),
            verify: jest.fn(),
          },
        },
        {
          provide: UserService,
          useValue: {
            doesEmailExist: jest.fn(),
            doesUsernameExist: jest.fn(),
            findByEmail: jest.fn(),
          },
        },
        {
          provide: MailService,
          useValue: {
            sendVerificationEmail: jest.fn(),
            sendEmailToUser: jest.fn(),
            sendUserLoggedInNotification: jest.fn(),
            sendPasswordResetEmail: jest.fn(),
            sendPasswordChangedEmail: jest.fn(),
          },
        },
        {
          provide: UserRefreshTokenService,
          useValue: {
            create: jest.fn(),
            revokeToken: jest.fn(),
            revokeAllTokensForUser: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    userRepository = module.get(getRepositoryToken(UserEntity));
    userProfileRepository = module.get(getRepositoryToken(UserProfileEntity));
    loginAttemptRepository = module.get(
      getRepositoryToken(AuditLoginAttemptEntity),
    );
    jwtService = module.get(JwtService);
    userService = module.get(UserService);
    mailService = module.get(MailService);
    refreshTokenService = module.get(UserRefreshTokenService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    const dto = {
      email: 'test@example.com',
      username: 'testuser',
      password: 'Password123!',
      confirmPassword: 'Password123!',
      firstName: 'Test',
      lastName: 'User',
    };

    it('should successfully register a user', async () => {
      (
        userService.doesEmailExist as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue(false);
      (
        userService.doesUsernameExist as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue(false);
      (
        bcrypt.hash as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue('hashed');
      (userRepository.create as jest.Mock).mockReturnValue({});
      (userProfileRepository.create as jest.Mock).mockReturnValue({});
      (
        userRepository.save as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({
        id: '1',
        email: dto.email,
      });

      const result = await service.register(dto as any);

      expect(result).toBeDefined();
      expect(mailService.sendVerificationEmail).toHaveBeenCalled();
    });

    it.each([
      [
        'email exists',
        { emailExist: true },
        ConflictException,
        'Email already in use',
      ],
      [
        'username exists',
        { usernameExist: true },
        ConflictException,
        'Username already in use',
      ],
      [
        'missing password',
        { password: '' },
        BadRequestException,
        'Password is required',
      ],
      [
        'mismatch password',
        { confirmPassword: 'wrong' },
        BadRequestException,
        'Passwords do not match',
      ],
    ])(
      'should throw %s',
      async (
        name: string,
        overrides: any,
        errorType: any,
        errorMsg: string,
      ) => {
        expect(name).toBeDefined();
        const testDto = { ...dto, ...overrides };
        (
          userService.doesEmailExist as jest.Mock<
            (...args: any[]) => Promise<any>
          >
        ).mockResolvedValue(overrides.emailExist || false);
        (
          userService.doesUsernameExist as jest.Mock<
            (...args: any[]) => Promise<any>
          >
        ).mockResolvedValue(overrides.usernameExist || false);

        const promise = service.register(testDto);
        await expect(promise).rejects.toThrow(errorType);
        await expect(promise).rejects.toThrow(errorMsg);
      },
    );

    it('should throw ConflictException if user already registered (DB conflict)', async () => {
      (
        userService.doesEmailExist as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue(false);
      (
        userService.doesUsernameExist as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue(false);
      (
        userRepository.save as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockRejectedValue(
        new QueryFailedError('query', [], {
          message: 'duplicate key value',
        } as any),
      );

      await expect(service.register(dto as any)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw InternalServerErrorException on unexpected save error', async () => {
      (
        userService.doesEmailExist as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue(false);
      (
        userService.doesUsernameExist as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue(false);
      (
        userRepository.save as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockRejectedValue(new Error('Unexpected'));

      await expect(service.register(dto as any)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('should throw error if savedUser is null', async () => {
      (
        userService.doesEmailExist as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue(false);
      (
        userService.doesUsernameExist as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue(false);
      (
        userRepository.save as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(null);

      await expect(service.register(dto as any)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('verifyEmail', () => {
    it('should verify email successfully', async () => {
      const user = {
        email: 'test@example.com',
        emailVerificationTokenExpiry: new Date(Date.now() + 10000),
      };
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(user);
      (
        userRepository.save as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(user);

      const result = await service.verifyEmail('token');

      expect(result.emailVerified).toBe(true);
      expect(mailService.sendEmailToUser).toHaveBeenCalled();
    });

    it('should throw BadRequestException if token is missing', async () => {
      await expect(service.verifyEmail('')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException if user not found', async () => {
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(null);
      await expect(service.verifyEmail('token')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if token expired', async () => {
      const user = {
        emailVerificationTokenExpiry: new Date(Date.now() - 10000),
      };
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(user);
      await expect(service.verifyEmail('token')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if emailVerificationTokenExpiry is missing', async () => {
      const user = {
        emailVerificationTokenExpiry: null,
      };
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(user);

      await expect(service.verifyEmail('token')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('resendVerificationEmail', () => {
    it('should resend successfully', async () => {
      const user = { email: 'test@example.com', emailVerified: false };
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(user);
      await service.resendVerificationEmail('token');
      expect(mailService.sendVerificationEmail).toHaveBeenCalled();
    });

    it('should throw NotFoundException if token not found', async () => {
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(null);
      await expect(service.resendVerificationEmail('token')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if already verified', async () => {
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({
        emailVerified: true,
      });
      await expect(service.resendVerificationEmail('token')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('validateUser', () => {
    it('should return user if valid', async () => {
      const user = {
        id: '1',
        comparePassword: jest
          .fn<(...args: any[]) => Promise<any>>()
          .mockResolvedValue(true),
      };
      (
        userService.findByEmail as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(user);

      const result = await service.validateUser('e', 'p');
      expect(result).toBeDefined();
    });

    it('should return null if invalid password', async () => {
      const user = {
        comparePassword: jest
          .fn<(...args: any[]) => Promise<any>>()
          .mockResolvedValue(false),
      };
      (
        userService.findByEmail as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(user);

      const result = await service.validateUser('e', 'p');
      expect(result).toBeNull();
    });

    it('should NOT set context if userUuid already set in validateUser', async () => {
      const user = {
        id: '1',
        comparePassword: jest
          .fn<(...args: any[]) => Promise<any>>()
          .mockResolvedValue(true),
      };
      (
        userService.findByEmail as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(user);
      const spySet = jest.spyOn(CurrentContextHelper, 'userUuid', 'set');
      jest
        .spyOn(CurrentContextHelper, 'userUuid', 'get')
        .mockReturnValue('already-set');

      await service.validateUser('e', 'p');

      expect(spySet).not.toHaveBeenCalled();
      spySet.mockRestore();
    });

    it('should return null if user not found', async () => {
      (
        userService.findByEmail as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(null);
      const result = await service.validateUser('e', 'p');
      expect(result).toBeNull();
    });
  });

  describe('validateUserFromPayload', () => {
    it('should return user and set context if user exists', async () => {
      const user = { id: 'uuid-123', email: 'test@example.com' };
      const payload = { sub: 'uuid-123', email: 'test@example.com' };
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(user);
      const spySet = jest.spyOn(CurrentContextHelper, 'userUuid', 'set');
      jest.spyOn(CurrentContextHelper, 'userUuid', 'get').mockReturnValue(null);

      const result = await service.validateUserFromPayload(payload as any);

      expect(result).toEqual(user);
      expect(spySet).toHaveBeenCalledWith('uuid-123');
      spySet.mockRestore();
    });

    it('should NOT set context if userUuid already set in validateUserFromPayload', async () => {
      const user = { id: 'uuid-123', email: 'test@example.com' };
      const payload = { sub: 'uuid-123', email: 'test@example.com' };
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(user);
      const spySet = jest.spyOn(CurrentContextHelper, 'userUuid', 'set');
      jest
        .spyOn(CurrentContextHelper, 'userUuid', 'get')
        .mockReturnValue('already-set');

      await service.validateUserFromPayload(payload as any);

      expect(spySet).not.toHaveBeenCalled();
      spySet.mockRestore();
    });

    it('should return null if user not found', async () => {
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(null);
      const result = await service.validateUserFromPayload({
        sub: '1',
        email: 'e',
      } as any);
      expect(result).toBeNull();
    });
  });

  describe('login', () => {
    it('should return tokens on successful login', async () => {
      const user = {
        id: '1',
        email: 'test@example.com',
        emailVerified: true,
        isAccountDisabled: false,
        deletedAt: null,
        profile: { firstName: 'Test' },
      };
      jest.spyOn(service, 'validateUser').mockResolvedValue(user);
      (jwtService.sign as jest.Mock).mockReturnValue('token');

      const result = await service.login({ email: 'e', password: 'p' });

      expect(result.access_token).toBe('token');
      expect(mailService.sendUserLoggedInNotification).toHaveBeenCalledWith(
        'test@example.com',
        'Test',
      );
    });

    it('should use fallback "Captain!" if profile name is missing in login', async () => {
      const user = {
        id: '1',
        email: 'test@example.com',
        emailVerified: true,
        isAccountDisabled: false,
        deletedAt: null,
        profile: { firstName: null },
      };
      jest.spyOn(service, 'validateUser').mockResolvedValue(user);
      (jwtService.sign as jest.Mock).mockReturnValue('token');

      await service.login({ email: 'e', password: 'p' });

      expect(mailService.sendUserLoggedInNotification).toHaveBeenCalledWith(
        'test@example.com',
        'Captain!',
      );
    });

    it('should use fallback "Captain!" if profile is missing in login', async () => {
      const user = {
        id: '1',
        email: 'test@example.com',
        emailVerified: true,
        isAccountDisabled: false,
        deletedAt: null,
        profile: null,
      };
      jest.spyOn(service, 'validateUser').mockResolvedValue(user);
      (jwtService.sign as jest.Mock).mockReturnValue('token');

      await service.login({ email: 'e', password: 'p' });

      expect(mailService.sendUserLoggedInNotification).toHaveBeenCalledWith(
        'test@example.com',
        'Captain!',
      );
    });

    it.each([
      ['missing email', { email: '', password: 'p' }, HttpStatus.UNAUTHORIZED],
      [
        'missing password',
        { email: 'e', password: '' },
        HttpStatus.UNAUTHORIZED,
      ],
      ['invalid credentials', null, HttpStatus.UNAUTHORIZED],
      ['account disabled', { isAccountDisabled: true }, HttpStatus.FORBIDDEN],
      ['account deleted', { deletedAt: new Date() }, HttpStatus.FORBIDDEN],
      ['email not verified', { emailVerified: false }, HttpStatus.UNAUTHORIZED],
    ])(
      'should throw HttpException for %s',
      async (name, userMock, expectedStatus) => {
        if (name !== 'missing email' && name !== 'missing password') {
          jest.spyOn(service, 'validateUser').mockResolvedValue(
            userMock
              ? {
                  id: '1',
                  email: 'e',
                  emailVerified: true,
                  isAccountDisabled: false,
                  deletedAt: null,
                  ...userMock,
                }
              : null,
          );
        }

        const promise = service.login({
          email: 'e',
          password: 'p',
          ...(userMock && typeof userMock === 'object' ? userMock : {}),
        } as any);
        await expect(promise).rejects.toThrow(HttpException);
        const error: any = await promise.catch(e => e);
        expect(error.status).toBe(expectedStatus);
      },
    );
  });

  describe('requestPasswordReset', () => {
    it('should request reset successfully with fallback "Captain!"', async () => {
      const user = { email: 'test@example.com', profile: null };
      (
        userService.findByEmail as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(user);
      await service.requestPasswordReset('test@example.com');
      expect(mailService.sendPasswordResetEmail).toHaveBeenCalledWith(
        'test@example.com',
        expect.any(String),
        'Captain!',
      );
    });

    it('should use profile firstName in requestPasswordReset if available', async () => {
      const user = {
        email: 'test@example.com',
        profile: { firstName: 'James' },
      };
      (
        userService.findByEmail as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(user);
      await service.requestPasswordReset('test@example.com');
      expect(mailService.sendPasswordResetEmail).toHaveBeenCalledWith(
        'test@example.com',
        expect.any(String),
        'James',
      );
    });

    it('should throw BadRequestException for invalid email format', async () => {
      await expect(service.requestPasswordReset('invalid')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if user not found', async () => {
      (
        userService.findByEmail as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(null);
      await expect(
        service.requestPasswordReset('test@example.com'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if reset already requested', async () => {
      const user = {
        passwordResetToken: 't',
        passwordResetTokenExpiry: new Date(Date.now() + 10000),
      };
      (
        userService.findByEmail as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(user);
      await expect(
        service.requestPasswordReset('test@example.com'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('resetPassword', () => {
    it('should reset password successfully', async () => {
      const user = {
        id: '1',
        email: 'test@example.com',
        passwordResetTokenExpiry: new Date(Date.now() + 10000),
        profile: null,
      };
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(user);
      (
        bcrypt.hash as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue('hashed');

      await service.resetPassword('token', 'newpass');
      expect(userRepository.save).toHaveBeenCalled();
      expect(mailService.sendPasswordChangedEmail).toHaveBeenCalledWith(
        expect.any(String),
        'Captain!',
      );
    });

    it('should use profile firstName in resetPassword if available', async () => {
      const user = {
        id: '1',
        email: 'test@example.com',
        passwordResetTokenExpiry: new Date(Date.now() + 10000),
        profile: { firstName: 'Bones' },
      };
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(user);
      (
        bcrypt.hash as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue('hashed');

      await service.resetPassword('token', 'newpass');
      expect(mailService.sendPasswordChangedEmail).toHaveBeenCalledWith(
        expect.any(String),
        'Bones',
      );
    });

    it.each([
      ['missing token', '', 'p', BadRequestException],
      ['missing password', 't', '', BadRequestException],
      ['invalid token', 't', 'p', NotFoundException], // user not found
    ])('should throw for %s', async (name, token, pass, errorType) => {
      if (name === 'invalid token')
        (
          userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
        ).mockResolvedValue(null);
      await expect(service.resetPassword(token, pass)).rejects.toThrow(
        errorType,
      );
    });

    it('should throw BadRequestException if token expired', async () => {
      const user = { passwordResetTokenExpiry: new Date(Date.now() - 10000) };
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(user);
      await expect(service.resetPassword('token', 'pass')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if passwordResetTokenExpiry is missing', async () => {
      const user = { passwordResetTokenExpiry: null };
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(user);

      await expect(service.resetPassword('token', 'pass')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('refreshToken', () => {
    it('should refresh token successfully', async () => {
      const payload = { sub: '1', jti: 'jti' };
      (jwtService.verify as jest.Mock).mockReturnValue(payload);
      const token = { isRevoked: false, jwtId: 'jti', tokenId: 'hashed' };
      const user = { id: '1', email: 'e', refreshTokens: [token] };
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(user);
      (
        bcrypt.compare as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(true);
      (jwtService.sign as jest.Mock).mockReturnValue('new-token');

      const result = await service.refreshToken('old-token');
      expect(result.access_token).toBe('new-token');
    });

    it('should handle non-Error thrown values during refreshToken validation', async () => {
      jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined as unknown as void);

      (jwtService.verify as jest.Mock).mockReturnValue({
        sub: '1',
        jti: 'jti',
      });
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockRejectedValue('boom');

      await expect(service.refreshToken('t')).rejects.toThrow(
        UnauthorizedException,
      );

      expect(console.error).toHaveBeenCalledWith(
        'Refresh token validation failed:',
        'boom',
      );
    });

    it('should throw UnauthorizedException if user not found', async () => {
      (jwtService.verify as jest.Mock).mockReturnValue({ sub: '1' });
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(null);
      await expect(service.refreshToken('t')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException if no matching token', async () => {
      (jwtService.verify as jest.Mock).mockReturnValue({
        sub: '1',
        jti: 'jti',
      });
      const user = {
        id: '1',
        refreshTokens: [{ isRevoked: false, jwtId: 'wrong' }],
      };
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(user);
      await expect(service.refreshToken('t')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException if bcrypt compare fails', async () => {
      (jwtService.verify as jest.Mock).mockReturnValue({
        sub: '1',
        jti: 'jti',
      });
      const user = {
        id: '1',
        refreshTokens: [{ isRevoked: false, jwtId: 'jti', tokenId: 'h' }],
      };
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(user);
      (
        bcrypt.compare as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(false);
      await expect(service.refreshToken('t')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('revokeToken', () => {
    it('should revoke token', async () => {
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({});
      await service.revokeToken('1', 't');
      expect(refreshTokenService.revokeToken).toHaveBeenCalled();
    });

    it('should throw NotFound if user not found', async () => {
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(null);
      await expect(service.revokeToken('1', 't')).rejects.toThrow(
        HttpException,
      );
    });
  });

  describe('utility methods', () => {
    it('generateToken should return hex string', () => {
      const t = service.generateToken();
      expect(t.length).toBe(64);
    });

    it('generateTokenExpiryDate should return future date', () => {
      const d = service.generateTokenExpiryDate();
      expect(d.getTime()).toBeGreaterThan(Date.now());
    });

    it('calculateExpiryTime should return correct date', () => {
      const now = new Date();
      const exp = service.calculateExpiryTime(1);
      expect(exp.getHours()).toBe((now.getHours() + 1) % 24);
    });
  });

  describe('logLoginAttempt', () => {
    it('should save login attempt', async () => {
      await service.logLoginAttempt('e', 'ip', true);
      expect(loginAttemptRepository.save).toHaveBeenCalled();
    });
  });
});
