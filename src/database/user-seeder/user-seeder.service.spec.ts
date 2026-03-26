import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { UserProfileEntity } from 'src/user/entities/user-profile.entity';
import { UserEntity } from 'src/user/entities/user.entity';
import { UserService } from 'src/user/user.service';
import { Repository } from 'typeorm';
import { UserSeederService } from './user-seeder.service';

jest.mock('bcrypt');

describe('UserSeederService', () => {
  let service: UserSeederService;
  let userRepository: Repository<UserEntity>;
  let userProfileRepository: Repository<UserProfileEntity>;
  let userService: UserService;

  const originalEnv = process.env;

  beforeEach(async () => {
    process.env = { ...originalEnv };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserSeederService,
        {
          provide: getRepositoryToken(UserEntity),
          useValue: {
            save: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(UserProfileEntity),
          useValue: {
            save: jest.fn(),
          },
        },
        {
          provide: UserService,
          useValue: {
            findByEmail: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<UserSeederService>(UserSeederService);
    userRepository = module.get<Repository<UserEntity>>(
      getRepositoryToken(UserEntity),
    );
    userProfileRepository = module.get<Repository<UserProfileEntity>>(
      getRepositoryToken(UserProfileEntity),
    );
    userService = module.get<UserService>(UserService);

    process.env.AUTH_SALT_ROUNDS = '10';
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('seed', () => {
    it('should call seedUsers', async () => {
      const seedUsersSpy = jest
        .spyOn(service as any, 'seedUsers')
        .mockResolvedValue(undefined);

      await service.seed();

      expect(seedUsersSpy).toHaveBeenCalled();
      seedUsersSpy.mockRestore();
    });
  });

  describe('seedUsers', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
      process.env.DATASEED_USER_EMAIL = 'test@example.com';
      process.env.DATASEED_USER_USERNAME = 'testuser';
      process.env.DATASEED_USER_FIRSTNAME = 'Test';
      process.env.DATASEED_USER_LASTNAME = 'User';
      process.env.DATASEED_USER_PASSWORD = 'password123';
    });

    it('should not seed in production environment', async () => {
      process.env.NODE_ENV = 'prod';

      await (service as any).seedUsers();

      expect(userService.findByEmail).not.toHaveBeenCalled();
    });

    it('should not seed if environment variables are missing', async () => {
      delete process.env.DATASEED_USER_EMAIL;

      await (service as any).seedUsers();

      expect(userService.findByEmail).not.toHaveBeenCalled();
    });

    it('should create user and profile if user does not exist', async () => {
      (
        userService.findByEmail as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(null);
      (
        bcrypt.hash as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue('hashed-password');
      const savedUser = { id: 'user-id', email: 'test@example.com' };
      (
        userRepository.save as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(savedUser);
      (
        userProfileRepository.save as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue({});

      await (service as any).seedUsers();

      expect(userService.findByEmail).toHaveBeenCalledWith('test@example.com');
      expect(bcrypt.hash).toHaveBeenCalledWith('password123', 10);
      expect(userRepository.save).toHaveBeenCalled();
      expect(userProfileRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-id',
          username: 'testuser',
          firstName: 'Test',
          lastName: 'User',
        }),
      );
    });

    it('should not create user if user already exists', async () => {
      const existingUser = { id: 'existing-id', email: 'test@example.com' };
      (
        userService.findByEmail as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(existingUser);

      await (service as any).seedUsers();

      expect(userService.findByEmail).toHaveBeenCalled();
      expect(userRepository.save).not.toHaveBeenCalled();
      expect(userProfileRepository.save).not.toHaveBeenCalled();
    });

    it('should handle case when user is saved but returns falsy value', async () => {
      (
        userService.findByEmail as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(null);
      (
        bcrypt.hash as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue('hashed-password');
      (
        userRepository.save as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(null);

      await (service as any).seedUsers();

      expect(userRepository.save).toHaveBeenCalled();
      expect(userProfileRepository.save).not.toHaveBeenCalled();
    });
  });
});
