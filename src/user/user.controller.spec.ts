import { HttpException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Multer } from 'multer';
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
      const req = { user: { id: '1' } };
      jest
        .spyOn(userService, 'findById')
        .mockResolvedValue(
          user as unknown as Awaited<ReturnType<UserService['findById']>>,
        );

      expect(await controller.findUser(req)).toBe(user);
    });

    it('should throw if user missing in req', async () => {
      const req = {};
      await expect(controller.findUser(req)).rejects.toThrow(HttpException);
    });

    it('should throw if user id missing in req', async () => {
      const req = { user: {} };
      await expect(controller.findUser(req)).rejects.toThrow(HttpException);
    });
  });

  describe('updateUserProfile', () => {
    it('should update profile', async () => {
      const req = { user: { id: '1' }, body: { firstName: 'N' } };
      const result = { affected: 1, updatedProfile: { firstName: 'N' } };
      jest
        .spyOn(userService, 'updateUserProfile')
        .mockResolvedValue(
          result as unknown as Awaited<
            ReturnType<UserService['updateUserProfile']>
          >,
        );

      const response = await controller.updateUserProfile(req);
      expect(response.affected).toBe(1);
    });

    it('should throw if body missing', async () => {
      const req = { user: { id: '1' }, body: null };
      await expect(controller.updateUserProfile(req)).rejects.toThrow(
        HttpException,
      );
    });

    it('should throw if user missing in req', async () => {
      const req = { body: { firstName: 'N' } };
      await expect(controller.updateUserProfile(req)).rejects.toThrow(
        TypeError,
      );
    });
  });

  describe('updateUserProfilePic', () => {
    it('should upload profile picture', async () => {
      const fileStub: Pick<
        Multer.File,
        'fieldname' | 'originalname' | 'mimetype'
      > &
        Partial<Multer.File> = {
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

      const response = await controller.updateUserProfilePic(req);

      expect(fileStub.filename).toContain('profilePicture-');
      expect(fileStub.filename).toContain('.png');
      expect(response.affected).toBe(1);
    });

    it('should throw if file missing', async () => {
      const req = { user: { id: '1' } };
      await expect(controller.updateUserProfilePic(req)).rejects.toThrow(
        HttpException,
      );
    });

    it('should throw if req is undefined', async () => {
      await expect(
        controller.updateUserProfilePic(undefined as unknown as any),
      ).rejects.toThrow(HttpException);
    });

    it('should throw if user missing in req', async () => {
      const fileStub: Pick<Multer.File, 'fieldname' | 'originalname'> &
        Partial<Multer.File> = {
        fieldname: 'profilePicture',
        originalname: 'a.png',
        buffer: Buffer.from(''),
      };

      const req = { file: fileStub };
      await expect(controller.updateUserProfilePic(req)).rejects.toThrow(
        TypeError,
      );
    });
  });

  describe('imageFileFilter', () => {
    it('should allow valid mime types', () => {
      const cb = jest.fn<void, [Error | null, boolean]>();
      UserController.imageFileFilter(
        null as unknown,
        { mimetype: 'image/png' } as unknown as Multer.File,
        cb,
      );
      expect(cb).toHaveBeenCalledWith(null, true);
    });

    it('should reject invalid mime types', () => {
      const cb = jest.fn<void, [Error | null, boolean]>();
      UserController.imageFileFilter(
        null as unknown,
        { mimetype: 'text/plain' } as unknown as Multer.File,
        cb,
      );
      expect(cb).toHaveBeenCalledWith(expect.any(HttpException), false);
    });
  });
});
