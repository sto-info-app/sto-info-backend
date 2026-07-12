import { jest } from '@jest/globals';
import { HttpException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { MailService } from 'src/mail/mail.service';
import { ImageUploadsService } from 'src/shared/utilities/image-uploads.service';
import { ValidatorsService } from 'src/shared/utilities/validators.service';
import { UserRefreshTokenEntity } from 'src/user-refresh-token/entities/user-refresh-token.entity';
import { AccountEntity } from 'src/sto/account/entities/account.entity';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';
import { Repository } from 'typeorm';
import { UserProfileEntity } from './entities/user-profile.entity';
import { UserEntity } from './entities/user.entity';
import { UserService } from './user.service';

jest.mock('bcrypt');

describe('UserService', () => {
  let service: UserService;
  let userRepository: Repository<UserEntity>;
  let userProfileRepository: Repository<UserProfileEntity>;
  let validatorsService: ValidatorsService;
  let imageUploadsService: ImageUploadsService;
  let mailService: Pick<MailService, 'sendAccountClosureEmail'>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: getRepositoryToken(UserEntity),
          useValue: {
            create: jest.fn().mockImplementation(val => val),
            save: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            softDelete: jest.fn(),
            findOne: jest.fn(),
            count: jest.fn(),
            createQueryBuilder: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnThis(),
              getCount: jest.fn(),
            }),
            manager: {
              transaction: jest.fn(),
            },
          },
        },
        {
          provide: getRepositoryToken(UserProfileEntity),
          useValue: {
            create: jest.fn().mockImplementation(val => val),
            save: jest.fn(),
            update: jest.fn(),
            findOne: jest.fn(),
            count: jest.fn(),
            createQueryBuilder: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnThis(),
              getCount: jest.fn(),
            }),
          },
        },
        {
          provide: ValidatorsService,
          useValue: {
            validateEmail: jest.fn().mockReturnValue(true),
            validateUuid: jest.fn().mockReturnValue(true),
          },
        },
        {
          provide: ImageUploadsService,
          useValue: {
            uploadImageToCloudflareImages: jest.fn(),
            deleteImageFromCloudflareImages: jest.fn(),
          },
        },
        {
          provide: MailService,
          useValue: {
            sendAccountClosureEmail: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    userRepository = module.get<Repository<UserEntity>>(
      getRepositoryToken(UserEntity),
    );
    userProfileRepository = module.get<Repository<UserProfileEntity>>(
      getRepositoryToken(UserProfileEntity),
    );
    validatorsService = module.get<ValidatorsService>(ValidatorsService);
    imageUploadsService = module.get<ImageUploadsService>(ImageUploadsService);
    mailService =
      module.get<Pick<MailService, 'sendAccountClosureEmail'>>(MailService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a user successfully', async () => {
      const dto = { email: 'test@e.com', password: 'pass', username: 'user' }; // NOSONAR
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(null);
      (
        bcrypt.hash as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue('hashed');
      (
        userRepository.save as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({ id: '1', ...dto });

      const result = await service.create(dto as any);
      expect(result.id).toBe('1');
      expect(userRepository.save).toHaveBeenCalled();
    });

    it('should throw if email already exists', async () => {
      const dto = { email: 'exist@e.com', password: 'p' }; // NOSONAR
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({ id: '1' });
      await expect(service.create(dto as any)).rejects.toThrow(
        'Email already in use',
      );
    });

    it('should throw if email invalid', async () => {
      const dto = { email: 'invalid', password: 'p' }; // NOSONAR
      (validatorsService.validateEmail as jest.Mock).mockReturnValue(false);
      await expect(service.create(dto as any)).rejects.toThrow('Invalid email');
    });

    it('should throw if password missing', async () => {
      const dto = { email: 'v@e.com', password: '' }; // NOSONAR
      await expect(service.create(dto as any)).rejects.toThrow(
        'Invalid password',
      );
    });
  });

  describe('update', () => {
    it('should update a user successfully', async () => {
      const dto = { email: 'new@e.com' };
      (
        userRepository.update as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({ affected: 1 });
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({
        id: '1',
        ...dto,
      });

      const result = await service.update('1', dto as any);
      expect(result.email).toBe('new@e.com');
    });

    it('should throw if update fails', async () => {
      (
        userRepository.update as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({ affected: 0 });
      await expect(service.update('1', {} as any)).rejects.toThrow(
        HttpException,
      );
    });

    it('should throw if id is empty', async () => {
      await expect(service.update('', {} as any)).rejects.toThrow(
        HttpException,
      );
    });
  });

  describe('delete', () => {
    it('should delete a user successfully', async () => {
      (
        userRepository.softDelete as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({
        affected: 1,
      });
      await service.delete('1');
      expect(userRepository.softDelete).toHaveBeenCalledWith('1');
    });

    it('should throw if delete fails', async () => {
      (
        userRepository.softDelete as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({
        affected: 0,
      });
      await expect(service.delete('1')).rejects.toThrow(HttpException);
    });

    it('should throw if id is empty', async () => {
      await expect(service.delete('')).rejects.toThrow(HttpException);
    });
  });

  describe('findById', () => {
    it('should find user by id', async () => {
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({ id: '1' });
      const result = await service.findById('1');
      expect(result.id).toBe('1');
    });

    it('should throw if user not found', async () => {
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(null);
      await expect(service.findById('1')).rejects.toThrow(HttpException);
    });

    it('should throw if id is invalid', async () => {
      (validatorsService.validateUuid as jest.Mock).mockReturnValue(false);
      await expect(service.findById('invalid')).rejects.toThrow(HttpException);
    });
  });

  describe('findByEmail', () => {
    it('should find user by email', async () => {
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({ email: 'e' });
      const result = await service.findByEmail('e');
      expect(result).not.toBeNull();
      if (!result) {
        throw new Error('Expected user to be found');
      }
      expect(result.email).toBe('e');
    });
  });

  describe('updateUserEmailVerifiedStatus', () => {
    it('should update status', async () => {
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({ email: 'e' });
      (
        userRepository.save as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({
        email: 'e',
        emailVerified: true,
      });
      await service.updateUserEmailVerifiedStatus('e', true);
      expect(userRepository.save).toHaveBeenCalled();
    });

    it('should throw if no user affected', async () => {
      (
        userRepository.update as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({ affected: 0 });
      await expect(
        service.updateUserEmailVerifiedStatus('e', true),
      ).rejects.toThrow(HttpException);
    });
  });

  describe('validateEmailUsername', () => {
    it('should return true if valid', () => {
      expect(service.validateEmailUsername('e')).toBe(true);
    });

    it('should return false if invalid', () => {
      (validatorsService.validateEmail as jest.Mock).mockReturnValue(false);
      expect(service.validateEmailUsername('e')).toBe(false);
    });

    it('should return false if email is missing', () => {
      expect(service.validateEmailUsername('')).toBe(false);
    });
  });

  describe('updateUserProfile', () => {
    it('should update profile', async () => {
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({
        id: '1',
        profile: { userId: '1' },
      });
      (
        userProfileRepository.save as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue({
        userId: '1',
      });
      (
        userProfileRepository.findOne as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue({
        userId: '1',
      });
      const result = await service.updateUserProfile('1', {
        firstName: 'N',
      } as any);
      expect(result.updatedProfile).toBeDefined();
    });

    it('should return affected 0 if profile unchanged', async () => {
      const profile = { userId: '1', username: 'u' };
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({
        id: '1',
        profile,
      });
      const result = await service.updateUserProfile('1', {
        username: 'u',
      } as any);
      expect(result.affected).toBe(0);
    });

    it('should throw if username already exists', async () => {
      const profile = { userId: '1', username: 'old' };
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({
        id: '1',
        profile,
      });

      const qb = userProfileRepository.createQueryBuilder('u');
      (
        qb.getCount as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(1);

      await expect(
        service.updateUserProfile('1', { username: 'new' } as any),
      ).rejects.toThrow('Username already exists');
    });

    it('should throw if user profile data is missing or mismatched', async () => {
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({
        id: '1',
        profile: { userId: 'wrong' },
      });
      await expect(
        service.updateUserProfile('1', { username: 'u' } as any),
      ).rejects.toThrow('User data not found');
    });

    it('should throw if user profile is missing', async () => {
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({
        id: '1',
        profile: null,
      });
      await expect(
        service.updateUserProfile('1', { username: 'u' } as any),
      ).rejects.toThrow('User data not found');
    });

    it('should throw if save fails', async () => {
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({
        id: '1',
        profile: { userId: '1' },
      });
      (
        userProfileRepository.save as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue(null);
      await expect(
        service.updateUserProfile('1', { username: 'u' } as any),
      ).rejects.toThrow('User profile update failed');
    });

    it('should throw if not found', async () => {
      (
        userProfileRepository.update as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue({
        affected: 0,
      });
      await expect(service.updateUserProfile('1', {} as any)).rejects.toThrow(
        HttpException,
      );
    });

    it('should throw if updatedProfile is missing after save', async () => {
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({
        id: '1',
        profile: { userId: '1', username: 'old' },
      });
      (
        userProfileRepository.save as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue({
        userId: '1',
      });
      (
        userProfileRepository.findOne as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue(null);

      await expect(
        service.updateUserProfile('1', { username: 'new' } as any),
      ).rejects.toThrow('Updated profile not found');
    });

    it('should throw if id is invalid', async () => {
      (validatorsService.validateUuid as jest.Mock).mockReturnValue(false);
      await expect(
        service.updateUserProfile('invalid', {} as any),
      ).rejects.toThrow(HttpException);
    });
  });

  describe('doesUsernameExist', () => {
    it('should return true if count > 0', async () => {
      const qb = userProfileRepository.createQueryBuilder('u');
      (
        qb.getCount as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(1);
      expect(await service.doesUsernameExist('u')).toBe(true);
    });
    it('should return false if count is 0', async () => {
      const qb = userProfileRepository.createQueryBuilder('u');
      (
        qb.getCount as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(0);
      expect(await service.doesUsernameExist('u')).toBe(false);
    });
  });

  describe('doesEmailExist', () => {
    it('should return true if count > 0', async () => {
      const qb = userRepository.createQueryBuilder('u');
      (
        qb.getCount as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(1);
      expect(await service.doesEmailExist('e')).toBe(true);
    });
    it('should return false if count is 0', async () => {
      const qb = userRepository.createQueryBuilder('u');
      (
        qb.getCount as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(0);
      expect(await service.doesEmailExist('e')).toBe(false);
    });
  });

  describe('uploadProfilePicture', () => {
    it('should upload successfully', async () => {
      const file = { buffer: Buffer.from(''), mimetype: 'image/png' };
      const user = {
        id: '1',
        profile: { userId: '1', profilePictureId: 'old' },
      };
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(user);
      (
        imageUploadsService.uploadImageToCloudflareImages as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue('new');
      (
        userProfileRepository.save as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue({
        userId: '1',
        profilePictureId: 'new',
      });

      const result = await service.uploadProfilePicture('1', file as any);
      expect(result.userProfileData.profilePictureId).toBe('new');
      expect(
        imageUploadsService.uploadImageToCloudflareImages,
      ).toHaveBeenCalledWith('1', file, 'user', '1');
      expect(
        imageUploadsService.deleteImageFromCloudflareImages,
      ).toHaveBeenCalledWith('old');
    });

    it('should upload successfully without deleting old picture if not exists', async () => {
      const file = { buffer: Buffer.from(''), mimetype: 'image/png' };
      const user = {
        id: '1',
        profile: { userId: '1', profilePictureId: null },
      };
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(user);
      (
        imageUploadsService.uploadImageToCloudflareImages as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue('new');
      (
        userProfileRepository.save as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue({
        userId: '1',
        profilePictureId: 'new',
      });

      const result = await service.uploadProfilePicture('1', file as any);
      expect(result.userProfileData.profilePictureId).toBe('new');
      expect(
        imageUploadsService.uploadImageToCloudflareImages,
      ).toHaveBeenCalledWith('1', file, 'user', '1');
      expect(
        imageUploadsService.deleteImageFromCloudflareImages,
      ).not.toHaveBeenCalled();
    });

    it('should throw if upload fails (returns null)', async () => {
      const user = { id: '1', profile: { userId: '1' } };
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(user);
      (
        imageUploadsService.uploadImageToCloudflareImages as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue(null);

      await expect(
        service.uploadProfilePicture('1', {} as any),
      ).rejects.toThrow(HttpException);
    });

    it('should throw if user not found', async () => {
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(null);
      await expect(
        service.uploadProfilePicture('1', {} as any),
      ).rejects.toThrow(HttpException);
    });

    it('should throw if profile relation is missing', async () => {
      const user = { id: '1', profile: null };
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(user);

      await expect(
        service.uploadProfilePicture('1', {} as any),
      ).rejects.toThrow(HttpException);
    });

    it('should throw if id invalid', async () => {
      (validatorsService.validateUuid as jest.Mock).mockReturnValue(false);
      await expect(
        service.uploadProfilePicture('invalid', {} as any),
      ).rejects.toThrow(HttpException);
    });

    it('should throw if save returns object without profilePictureId', async () => {
      const user = { id: '1', profile: { userId: '1' } };
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(user);
      (
        imageUploadsService.uploadImageToCloudflareImages as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue('new');
      (
        userProfileRepository.save as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue({});

      await expect(
        service.uploadProfilePicture('1', {} as any),
      ).rejects.toThrow(HttpException);
    });
  });

  describe('closeAccount', () => {
    it('should soft-delete user-linked data in a transaction', async () => {
      const manager = {
        update: jest.fn(async () => ({ affected: 1 })),
        find: jest.fn(async () => [{ id: 'a1' }]),
        softDelete: jest.fn(async () => ({ affected: 1 })),
      };

      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({
        id: '1',
        email: 'captain@example.com',
        profile: { firstName: 'Captain', userId: '1' },
      });

      (
        (userRepository as any).manager.transaction as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockImplementation(
        async (callback: (managerArg: any) => Promise<void>) => {
          await callback(manager);
        },
      );

      await service.closeAccount('1');

      expect(manager.update).toHaveBeenCalledWith(
        UserRefreshTokenEntity,
        { userId: '1', isRevoked: false },
        { isRevoked: true },
      );
      expect(manager.find).toHaveBeenCalledWith(AccountEntity, {
        where: { userId: '1' },
        select: { id: true },
      });
      expect(manager.softDelete).toHaveBeenCalledWith(CharacterEntity, {
        accountId: expect.any(Object),
      });
      expect(manager.softDelete).toHaveBeenCalledWith(AccountEntity, {
        userId: '1',
      });
      expect(manager.softDelete).toHaveBeenCalledWith(UserProfileEntity, {
        userId: '1',
      });
      expect(manager.softDelete).toHaveBeenCalledWith(UserEntity, '1');
      expect(mailService.sendAccountClosureEmail).toHaveBeenCalledWith(
        'captain@example.com',
        'Captain',
      );
    });

    it('should throw if user id is invalid', async () => {
      (validatorsService.validateUuid as jest.Mock).mockReturnValue(false);
      await expect(service.closeAccount('invalid')).rejects.toThrow(
        HttpException,
      );
    });

    it('should throw if user is not found', async () => {
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(null);

      await expect(service.closeAccount('1')).rejects.toThrow('User not found');
    });

    it('should skip character soft-delete when no accounts are owned', async () => {
      const manager = {
        update: jest.fn(async () => ({ affected: 1 })),
        find: jest.fn(async () => []),
        softDelete: jest.fn(async () => ({ affected: 1 })),
      };

      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({
        id: '1',
        email: 'captain@example.com',
        profile: null,
      });

      (
        (userRepository as any).manager.transaction as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockImplementation(
        async (callback: (managerArg: any) => Promise<void>) => {
          await callback(manager);
        },
      );

      await service.closeAccount('1');

      expect(manager.softDelete).not.toHaveBeenCalledWith(CharacterEntity, {
        accountId: expect.any(Object),
      });
      expect(manager.softDelete).toHaveBeenCalledWith(AccountEntity, {
        userId: '1',
      });
      expect(mailService.sendAccountClosureEmail).toHaveBeenCalledWith(
        'captain@example.com',
        'Captain!',
      );
    });

    it('should send the closure email using pre-delete user details', async () => {
      const manager = {
        update: jest.fn(async () => ({ affected: 1 })),
        find: jest.fn(async () => []),
        softDelete: jest.fn(async () => ({ affected: 1 })),
      };

      const user = {
        id: '1',
        email: 'captain@example.com',
        profile: { firstName: 'Captain', userId: '1' },
      };

      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(user);

      (
        (userRepository as any).manager.transaction as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockImplementation(
        async (callback: (managerArg: any) => Promise<void>) => {
          user.email = 'changed@example.com';
          user.profile.firstName = 'Changed';
          await callback(manager);
        },
      );

      await service.closeAccount('1');

      expect(mailService.sendAccountClosureEmail).toHaveBeenCalledWith(
        'captain@example.com',
        'Captain',
      );
    });
  });
});
