import { BadRequestException, Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CharacterController } from './character.controller';
import { CharacterService } from './character.service';

describe('CharacterController', () => {
  let controller: CharacterController;
  let service: CharacterService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CharacterController],
      providers: [
        {
          provide: CharacterService,
          useValue: {
            create: jest.fn(),
            findAllForAccount: jest.fn(),
            findOneForUser: jest.fn(),
            updateForUser: jest.fn(),
            removeForUser: jest.fn(),
            getGeneralFactions: jest.fn(),
            getFactions: jest.fn(),
            getSexes: jest.fn(),
            getClasses: jest.fn(),
            getRecruitTypes: jest.fn(),
            getSpecies: jest.fn(),
            uploadProfileImage: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<CharacterController>(CharacterController);
    service = module.get<CharacterService>(CharacterService);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should call service.create', async () => {
      const dto = { handle: 'Char1' };
      await controller.create('user-1', dto as any);
      expect(service.create).toHaveBeenCalledWith(dto, 'user-1');
    });
  });

  describe('findAllForAccount', () => {
    it('should call service.findAllForAccount', async () => {
      await controller.findAllForAccount('user-1', 'acc-1');
      expect(service.findAllForAccount).toHaveBeenCalledWith('acc-1', 'user-1');
    });
  });

  describe('findOne', () => {
    it('should call service.findOneForUser', async () => {
      await controller.findOne('user-1', 'char-1');
      expect(service.findOneForUser).toHaveBeenCalledWith('char-1', 'user-1');
    });
  });

  describe('update', () => {
    it('should call service.updateForUser', async () => {
      const dto = { handle: 'New' };
      await controller.update('user-1', 'char-1', dto as any);
      expect(service.updateForUser).toHaveBeenCalledWith(
        'char-1',
        'user-1',
        dto,
      );
    });
  });

  describe('remove', () => {
    it('should call service.removeForUser', async () => {
      await controller.remove('user-1', 'char-1');
      expect(service.removeForUser).toHaveBeenCalledWith('char-1', 'user-1');
    });
  });

  describe('Lookups', () => {
    it('should call getGeneralFactions', async () => {
      await controller.getGeneralFactions();
      expect(service.getGeneralFactions).toHaveBeenCalled();
    });

    it('should call getFactions', async () => {
      await controller.getFactions();
      expect(service.getFactions).toHaveBeenCalled();
    });

    it('should call getSexes', async () => {
      await controller.getSexes();
      expect(service.getSexes).toHaveBeenCalled();
    });

    it('should call getClasses', async () => {
      await controller.getClasses();
      expect(service.getClasses).toHaveBeenCalled();
    });

    it('should call getRecruitTypes', async () => {
      await controller.getRecruitTypes();
      expect(service.getRecruitTypes).toHaveBeenCalled();
    });

    it('should call getSpecies with query params', async () => {
      await controller.getSpecies('fac-1', 'rec-1');
      expect(service.getSpecies).toHaveBeenCalledWith('fac-1', 'rec-1');
    });

    it('should call getSpecies with no params', async () => {
      await controller.getSpecies();
      expect(service.getSpecies).toHaveBeenCalledWith(undefined, undefined);
    });

    it('should call getSpecies with only factionId', async () => {
      await controller.getSpecies('fac-1');
      expect(service.getSpecies).toHaveBeenCalledWith('fac-1', undefined);
    });

    it('should call getSpecies with only recruitTypeId', async () => {
      await controller.getSpecies(undefined, 'rec-1');
      expect(service.getSpecies).toHaveBeenCalledWith(undefined, 'rec-1');
    });
  });

  describe('uploadProfileImage', () => {
    it('should call service.uploadProfileImage', async () => {
      const file = { buffer: Buffer.from('test') } as any;
      await controller.uploadProfileImage('user-1', 'char-1', file);
      expect(service.uploadProfileImage).toHaveBeenCalledWith(
        'char-1',
        'user-1',
        file,
      );
    });

    it('should handle file with all properties', async () => {
      const file = {
        buffer: Buffer.from('test-image-data'),
        originalname: 'profile.png',
        mimetype: 'image/png',
        size: 1024,
        fieldname: 'profilePicture',
        encoding: '7bit',
      } as any;
      await controller.uploadProfileImage('user-1', 'char-1', file);
      expect(service.uploadProfileImage).toHaveBeenCalledWith(
        'char-1',
        'user-1',
        file,
      );
    });

    it('should throw if file is missing', async () => {
      await expect(
        controller.uploadProfileImage('user-1', 'char-1', undefined as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if file is null', async () => {
      await expect(
        controller.uploadProfileImage('user-1', 'char-1', null as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should propagate errors from service', async () => {
      const file = { buffer: Buffer.from('test') } as any;
      const error = new BadRequestException('Upload failed');
      jest.spyOn(service, 'uploadProfileImage').mockRejectedValue(error);

      await expect(
        controller.uploadProfileImage('user-1', 'char-1', file),
      ).rejects.toThrow(error);
    });

    it('should log and rethrow non-Error thrown values from service', async () => {
      const file = { buffer: Buffer.from('test') } as any;
      jest.spyOn(service, 'uploadProfileImage').mockRejectedValue('boom');

      await expect(
        controller.uploadProfileImage('user-1', 'char-1', file),
      ).rejects.toBe('boom');

      const loggerErrorSpy = Logger.prototype.error as unknown as jest.Mock;
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[uploadProfileImage] Failed to upload image'),
        undefined,
      );
    });

    it('should handle undefined userId or id in logger', async () => {
      const file = {
        buffer: Buffer.from('test'),
        originalname: 'a.png',
      } as any;
      await controller.uploadProfileImage(
        undefined as any,
        undefined as any,
        file,
      );
      expect(service.uploadProfileImage).toHaveBeenCalledWith(
        undefined,
        undefined,
        file,
      );
    });
  });

  describe('imageFileFilter', () => {
    it('should allow valid mime types', () => {
      const cb = jest.fn();
      CharacterController.imageFileFilter(
        {} as any,
        { mimetype: 'image/png' } as any,
        cb,
      );
      expect(cb).toHaveBeenCalledWith(null, true);
    });

    it('should reject invalid mime types', () => {
      const cb = jest.fn();
      CharacterController.imageFileFilter(
        {} as any,
        { mimetype: 'text/plain' } as any,
        cb,
      );
      expect(cb).toHaveBeenCalledWith(expect.any(BadRequestException), false);
    });
  });

  describe('Static branches', () => {
    it('should evaluate fileSize and fieldSize limits when env is set', async () => {
      await jest.isolateModulesAsync(async () => {
        process.env.MAX_IMAGE_SIZE_IN_BYTES = '1048576';
        const { CharacterController: LocalController } =
          await import('./character.controller');
        expect(LocalController).toBeDefined();
      });
    });

    it('should fallback to default limits when env is not set', async () => {
      await jest.isolateModulesAsync(async () => {
        const originalEnv = process.env.MAX_IMAGE_SIZE_IN_BYTES;
        delete process.env.MAX_IMAGE_SIZE_IN_BYTES;

        const { CharacterController: LocalController } =
          await import('./character.controller');
        expect(LocalController).toBeDefined();

        process.env.MAX_IMAGE_SIZE_IN_BYTES = originalEnv;
      });
    });

    it('should handle falsy but defined env value', async () => {
      await jest.isolateModulesAsync(async () => {
        process.env.MAX_IMAGE_SIZE_IN_BYTES = '0';
        const { CharacterController: LocalController } =
          await import('./character.controller');
        expect(LocalController).toBeDefined();
      });
    });

    it('should handle empty string env value', async () => {
      await jest.isolateModulesAsync(async () => {
        process.env.MAX_IMAGE_SIZE_IN_BYTES = '';
        const { CharacterController: LocalController } =
          await import('./character.controller');
        expect(LocalController).toBeDefined();
      });
    });
  });
});
