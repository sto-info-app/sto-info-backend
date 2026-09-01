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
import { UserRole } from './enums/user-role.enum';
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

  describe('getSettings', () => {
    it('should return the settings for a valid user', async () => {
      (
        userProfileRepository.findOne as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue({ userId: 'uuid', privacyMode: true });

      await expect(service.getSettings('uuid')).resolves.toEqual({
        privacyMode: true,
      });
      expect(userProfileRepository.findOne).toHaveBeenCalledWith({
        where: { userId: 'uuid' },
      });
    });

    it('should throw when the user id is missing', async () => {
      await expect(service.getSettings('')).rejects.toThrow(HttpException);
      expect(userProfileRepository.findOne).not.toHaveBeenCalled();
    });

    it('should throw when the user id is not a valid uuid', async () => {
      (validatorsService.validateUuid as jest.Mock).mockReturnValue(false);

      await expect(service.getSettings('bad')).rejects.toThrow(HttpException);
      expect(userProfileRepository.findOne).not.toHaveBeenCalled();
    });

    it('should throw when the profile does not exist', async () => {
      (
        userProfileRepository.findOne as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue(null);

      await expect(service.getSettings('uuid')).rejects.toThrow(HttpException);
    });
  });

  describe('updateSettings', () => {
    it('should persist and return the updated settings', async () => {
      const profile = { userId: 'uuid', privacyMode: false };
      (
        userProfileRepository.findOne as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue(profile);
      (
        userProfileRepository.save as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockImplementation(async (value: any) => value);

      await expect(
        service.updateSettings('uuid', { privacyMode: true }),
      ).resolves.toEqual({ privacyMode: true });
      expect(userProfileRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ privacyMode: true }),
      );
    });

    it('should throw when the profile does not exist', async () => {
      (
        userProfileRepository.findOne as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue(null);

      await expect(
        service.updateSettings('uuid', { privacyMode: true }),
      ).rejects.toThrow(HttpException);
      expect(userProfileRepository.save).not.toHaveBeenCalled();
    });
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

    it('should honour an explicit registry opt-in', async () => {
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({
        id: '1',
        profile: { userId: '1', publiclyVisible: false },
      });
      (
        userProfileRepository.save as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue({ userId: '1' });
      (
        userProfileRepository.findOne as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue({ userId: '1', publiclyVisible: true });

      await service.updateUserProfile('1', {
        publiclyVisible: true,
      } as any);

      expect(userProfileRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ publiclyVisible: true }),
      );
    });

    it('should honour an explicit registry opt-out', async () => {
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({
        id: '1',
        profile: { userId: '1', publiclyVisible: true },
      });
      (
        userProfileRepository.save as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue({ userId: '1' });
      (
        userProfileRepository.findOne as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue({ userId: '1', publiclyVisible: false });

      await service.updateUserProfile('1', {
        publiclyVisible: false,
      } as any);

      expect(userProfileRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ publiclyVisible: false }),
      );
    });

    it('should preserve the stored visibility when the flag is omitted', async () => {
      (
        userRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({
        id: '1',
        profile: { userId: '1', publiclyVisible: true },
      });
      (
        userProfileRepository.save as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue({ userId: '1' });
      (
        userProfileRepository.findOne as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue({ userId: '1', publiclyVisible: true });

      await service.updateUserProfile('1', { firstName: 'N' } as any);

      expect(userProfileRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ publiclyVisible: true }),
      );
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

  describe('searchUsers', () => {
    it('returns paginated users with defaults when page/pageSize not provided', async () => {
      const mockUsers = [
        {
          id: 'u1',
          role: UserRole.ADMIN,
          lastLoginAt: new Date('2026-05-01T09:00:00.000Z'),
          profile: { username: 'kirk', firstName: 'James', lastName: 'Kirk' },
        },
      ];
      const qb: any = {
        innerJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: (jest.fn() as any).mockResolvedValue([mockUsers, 1]),
      };
      (userRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      const result = await service.searchUsers({ q: 'kirk' });

      expect(userRepository.createQueryBuilder).toHaveBeenCalledWith('u');
      expect(qb.innerJoin).toHaveBeenCalledWith('u.profile', 'p');
      expect(qb.select).toHaveBeenCalledWith([
        'u.id',
        'u.role',
        'u.lastLoginAt',
        'p.username',
        'p.firstName',
        'p.lastName',
      ]);

      // No address is searched: a site notification is not an email, and the
      // screen that picks its reader says nothing about one.
      const [clause, parameters] = qb.where.mock.calls[0] as [
        string,
        Record<string, string>,
      ];

      expect(clause).not.toContain('email');
      expect(clause).toContain('p.username ILIKE :term');
      expect(clause).toContain('p.firstName ILIKE :term');
      expect(clause).toContain('p.lastName ILIKE :term');
      expect(clause).toContain("CONCAT(p.firstName, ' ', p.lastName)");
      expect(parameters).toEqual({ term: '%kirk%' });
      expect(qb.andWhere).toHaveBeenCalledWith('u.deletedAt IS NULL');
      expect(qb.orderBy).toHaveBeenCalledWith('p.username', 'ASC');
      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(5);
      expect(result).toEqual({
        items: [
          {
            id: 'u1',
            username: 'kirk',
            fullName: 'James Kirk',
            role: UserRole.ADMIN,
            lastLoginAt: new Date('2026-05-01T09:00:00.000Z'),
          },
        ],
        total: 1,
        page: 1,
        pageSize: 5,
      });
    });

    it('returns paginated users with custom page and pageSize', async () => {
      const mockUsers = [
        {
          id: 'u2',
          role: UserRole.USER,
          lastLoginAt: null,
          profile: null,
        },
      ];
      const qb: any = {
        innerJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: (jest.fn() as any).mockResolvedValue([mockUsers, 10]),
      };
      (userRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      const result = await service.searchUsers({
        q: 'spock',
        page: 2,
        pageSize: 3,
      });

      expect(qb.skip).toHaveBeenCalledWith(3);
      expect(qb.take).toHaveBeenCalledWith(3);
      // An account that has never signed in, and a member who gave no name,
      // carry nothing rather than a stand-in, so the screen can say so in its
      // own words.
      expect(result).toEqual({
        items: [
          {
            id: 'u2',
            username: '',
            fullName: null,
            role: UserRole.USER,
            lastLoginAt: null,
          },
        ],
        total: 10,
        page: 2,
        pageSize: 3,
      });
    });

    it('names a member by whichever half of their name they gave', async () => {
      const qb: any = {
        innerJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: (jest.fn() as any).mockResolvedValue([
          [
            {
              id: 'u3',
              role: UserRole.USER,
              lastLoginAt: null,
              profile: {
                username: 'mccoy',
                firstName: null,
                lastName: 'McCoy',
              },
            },
          ],
          1,
        ]),
      };
      (userRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      const result = await service.searchUsers({ q: 'mccoy' });

      expect(result.items[0].fullName).toBe('McCoy');
    });

    it('returns empty list when no users match', async () => {
      const qb: any = {
        innerJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: (jest.fn() as any).mockResolvedValue([[], 0]),
      };
      (userRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      const result = await service.searchUsers({ q: 'nonexistent' });

      expect(result).toEqual({
        items: [],
        total: 0,
        page: 1,
        pageSize: 5,
      });
    });
  });
});
