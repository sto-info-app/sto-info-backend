import { jest } from '@jest/globals';
import { BadRequestException, HttpException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { UserController } from './user.controller';
import { UserService } from './user.service';

describe('UserController', () => {
  let controller: UserController;
  let userService: UserService;

  beforeEach(async () => {
    const findByIdMock: jest.MockedFunction<UserService['findById']> =
      jest.fn();
    const updateUserProfileMock: jest.MockedFunction<
      UserService['updateUserProfile']
    > = jest.fn();
    const uploadProfilePictureMock: jest.MockedFunction<
      UserService['uploadProfilePicture']
    > = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        {
          provide: UserService,
          useValue: {
            findById: findByIdMock,
            updateUserProfile: updateUserProfileMock,
            uploadProfilePicture: uploadProfilePictureMock,
          },
        },
      ],
    }).compile();

    controller = module.get<UserController>(UserController);
    userService = module.get<UserService>(UserService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findUser', () => {
    it('should return a user', async () => {
      const user = { id: '1' };
      jest
        .spyOn(userService, 'findById')
        .mockResolvedValue(
          user as unknown as Awaited<ReturnType<UserService['findById']>>,
        );

      expect(await controller.findUser('1')).toBe(user);
    });
  });

  describe('updateUserProfile', () => {
    it('should update profile', async () => {
      const result = { affected: 1, updatedProfile: { firstName: 'N' } };
      jest
        .spyOn(userService, 'updateUserProfile')
        .mockResolvedValue(
          result as unknown as Awaited<
            ReturnType<UserService['updateUserProfile']>
          >,
        );

      const response = await controller.updateUserProfile('1', {
        firstName: 'N',
      } as any);
      expect(response.affected).toBe(1);
    });

    it('should throw if body missing', async () => {
      await expect(
        controller.updateUserProfile('1', null as any),
      ).rejects.toThrow(HttpException);
    });
  });

  describe('updateUserProfilePic', () => {
    it('should upload profile picture', async () => {
      const fileStub: Pick<
        Express.Multer.File,
        'fieldname' | 'originalname' | 'mimetype'
      > &
        Partial<Express.Multer.File> = {
        fieldname: 'profilePicture',
        originalname: 'test.png',
        mimetype: 'image/png',
      };

      const req = { user: { id: '1' }, file: fileStub };

      const result = {
        affected: 1,
        userProfileData: { profilePictureId: 'new' },
      };
      jest
        .spyOn(userService, 'uploadProfilePicture')
        .mockResolvedValue(
          result as unknown as Awaited<
            ReturnType<UserService['uploadProfilePicture']>
          >,
        );

      const response = await controller.updateUserProfilePic('1', req as any);

      expect(fileStub.filename).toContain('profilePicture-');
      expect(fileStub.filename).toContain('.png');
      expect(response.affected).toBe(1);
    });

    it('should throw if file missing', async () => {
      const req = { user: { id: '1' } };
      await expect(
        controller.updateUserProfilePic('1', req as any),
      ).rejects.toThrow(HttpException);
    });

    it('should throw if req is undefined', async () => {
      await expect(
        controller.updateUserProfilePic('1', undefined as unknown as any),
      ).rejects.toThrow(HttpException);
    });
  });

  describe('imageFileFilter', () => {
    it('should allow valid mime types', () => {
      const cb = jest.fn<void, [Error | null, boolean]>();
      UserController.imageFileFilter(
        {} as any,
        { mimetype: 'image/png' } as any,
        cb,
      );
      expect(cb).toHaveBeenCalledWith(null, true);
    });

    it('should reject invalid mime types', () => {
      const cb = jest.fn<void, [Error | null, boolean]>();
      UserController.imageFileFilter(
        {} as any,
        { mimetype: 'text/plain' } as any,
        cb,
      );
      expect(cb).toHaveBeenCalledWith(expect.any(BadRequestException), false);
    });
  });
});
