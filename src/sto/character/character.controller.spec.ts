import { BadRequestException } from '@nestjs/common';
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

    it('should throw if file is missing', async () => {
      await expect(
        controller.uploadProfileImage('user-1', 'char-1', undefined as any),
      ).rejects.toThrow(BadRequestException);
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
    it('should evaluate limits when env is set', async () => {
      await jest.isolateModulesAsync(async () => {
        process.env.MAX_IMAGE_SIZE_IN_BYTES = '1048576';

        await import('./character.controller');
      });
    });

    it('should evaluate limits when env is not set', async () => {
      await jest.isolateModulesAsync(async () => {
        const originalEnv = process.env.MAX_IMAGE_SIZE_IN_BYTES;
        delete process.env.MAX_IMAGE_SIZE_IN_BYTES;

        await import('./character.controller');
        process.env.MAX_IMAGE_SIZE_IN_BYTES = originalEnv;
      });
    });
  });
});
