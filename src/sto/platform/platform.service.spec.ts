import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformEntity } from './entities/platform.entity';
import { PlatformService } from './platform.service';

describe('PlatformService', () => {
  let service: PlatformService;
  let repository: Repository<PlatformEntity>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformService,
        {
          provide: getRepositoryToken(PlatformEntity),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            merge: jest.fn(),
            remove: jest.fn(),
            softDelete: jest.fn(),
            createQueryBuilder: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              getMany: jest.fn(),
            }),
          },
        },
      ],
    }).compile();

    service = module.get<PlatformService>(PlatformService);
    repository = module.get<Repository<PlatformEntity>>(
      getRepositoryToken(PlatformEntity),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return all platforms', async () => {
      const platforms = [{ id: '1', name: 'Windows' }];
      (repository.find as jest.Mock).mockResolvedValue(platforms);

      const result = await service.findAll();

      expect(result).toEqual(platforms);
      expect(repository.find).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should return a platform by id', async () => {
      const platform = { id: '1', name: 'Windows' };
      (repository.findOne as jest.Mock).mockResolvedValue(platform);

      const result = await service.findOne('1');

      expect(result).toEqual(platform);
      expect(repository.findOne).toHaveBeenCalledWith({ where: { id: '1' } });
    });

    it('should throw BadRequestException if id is missing', async () => {
      await expect(service.findOne('')).rejects.toThrow(BadRequestException);
    });
  });

  describe('findOneByName', () => {
    it('should return a platform by name', async () => {
      const platform = { id: '1', name: 'Windows' };
      (repository.findOne as jest.Mock).mockResolvedValue(platform);

      const result = await service.findOneByName('Windows');

      expect(result).toEqual(platform);
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { name: 'Windows' },
      });
    });

    it('should throw BadRequestException if name is missing', async () => {
      await expect(service.findOneByName('')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('findAllSoftDeletedOlderThanOneWeek', () => {
    it('should return soft deleted platforms older than one week', async () => {
      const platforms = [
        { id: '1', name: 'OldPlatform', deletedAt: new Date('2020-01-01') },
      ];
      const queryBuilder = repository.createQueryBuilder();
      (queryBuilder.getMany as jest.Mock).mockResolvedValue(platforms);

      const result = await service.findAllSoftDeletedOlderThanOneWeek();

      expect(result).toEqual(platforms);
      expect(queryBuilder.where).toHaveBeenCalledWith(
        'platform.deletedAt IS NOT NULL',
      );
      expect(queryBuilder.andWhere).toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('should create and save a new platform', async () => {
      const dto = { name: 'PlayStation' };
      const platform = { id: '1', name: 'PlayStation' };
      (repository.create as jest.Mock).mockReturnValue(platform);
      (repository.save as jest.Mock).mockResolvedValue(platform);

      const result = await service.create(dto);

      expect(result).toEqual(platform);
      expect(repository.create).toHaveBeenCalledWith(dto);
      expect(repository.save).toHaveBeenCalledWith(platform);
    });

    it('should throw InternalServerErrorException on save failure', async () => {
      const dto = { name: 'PlayStation' };
      const platform = { id: '1', name: 'PlayStation' };
      (repository.create as jest.Mock).mockReturnValue(platform);
      (repository.save as jest.Mock).mockRejectedValue(new Error('DB Error'));

      await expect(service.create(dto)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('should throw BadRequestException if dto is missing', async () => {
      await expect(service.create(null as any)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('update', () => {
    it('should update a platform', async () => {
      const platform = { id: '1', name: 'Windows' };
      const dto = { name: 'Windows Updated' };
      const updated = { id: '1', name: 'Windows Updated' };

      (repository.findOne as jest.Mock).mockResolvedValue(platform);
      (repository.merge as jest.Mock).mockReturnValue(updated);
      (repository.save as jest.Mock).mockResolvedValue(updated);

      const result = await service.update('1', dto);

      expect(result).toEqual(updated);
      expect(repository.merge).toHaveBeenCalledWith(platform, dto);
      expect(repository.save).toHaveBeenCalledWith(updated);
    });

    it('should throw InternalServerErrorException on update failure', async () => {
      const platform = { id: '1', name: 'Windows' };
      const dto = { name: 'Updated' };

      (repository.findOne as jest.Mock).mockResolvedValue(platform);
      (repository.merge as jest.Mock).mockReturnValue(platform);
      (repository.save as jest.Mock).mockRejectedValue(new Error('DB Error'));

      await expect(service.update('1', dto)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('should throw BadRequestException if id is missing', async () => {
      await expect(service.update('', {})).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if dto is missing', async () => {
      await expect(service.update('1', null as any)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('remove', () => {
    it('should hard delete a platform', async () => {
      const platform = { id: '1', name: 'Windows' };
      (repository.findOne as jest.Mock).mockResolvedValue(platform);
      (repository.remove as jest.Mock).mockResolvedValue(platform);

      await service.remove('1');

      expect(repository.remove).toHaveBeenCalledWith(platform);
    });

    it('should throw InternalServerErrorException on remove failure', async () => {
      const platform = { id: '1', name: 'Windows' };
      (repository.findOne as jest.Mock).mockResolvedValue(platform);
      (repository.remove as jest.Mock).mockRejectedValue(new Error('DB Error'));

      await expect(service.remove('1')).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('should throw BadRequestException if id is missing', async () => {
      await expect(service.remove('')).rejects.toThrow(BadRequestException);
    });
  });

  describe('softRemove', () => {
    it('should soft delete a platform', async () => {
      const platform = { id: '1', name: 'Windows' };
      (repository.findOne as jest.Mock).mockResolvedValue(platform);
      (repository.softDelete as jest.Mock).mockResolvedValue({ affected: 1 });

      await service.softRemove('1');

      expect(repository.softDelete).toHaveBeenCalledWith('1');
    });

    it('should throw InternalServerErrorException on soft delete failure', async () => {
      const platform = { id: '1', name: 'Windows' };
      (repository.findOne as jest.Mock).mockResolvedValue(platform);
      (repository.softDelete as jest.Mock).mockRejectedValue(
        new Error('DB Error'),
      );

      await expect(service.softRemove('1')).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('should throw BadRequestException if id is missing', async () => {
      await expect(service.softRemove('')).rejects.toThrow(BadRequestException);
    });
  });

  describe('handleCron', () => {
    it('should hard delete soft-deleted platforms older than one week', async () => {
      const platforms = [
        { id: '1', name: 'Old1' },
        { id: '2', name: 'Old2' },
      ];

      jest
        .spyOn(service, 'findAllSoftDeletedOlderThanOneWeek')
        .mockResolvedValue(platforms as any);
      jest.spyOn(service, 'remove').mockResolvedValue(undefined);

      await service.handleCron();

      expect(service.remove).toHaveBeenCalledWith('1');
      expect(service.remove).toHaveBeenCalledWith('2');
    });

    it('should throw InternalServerErrorException if hard delete fails', async () => {
      const platforms = [{ id: '1', name: 'Old' }];

      jest
        .spyOn(service, 'findAllSoftDeletedOlderThanOneWeek')
        .mockResolvedValue(platforms as any);
      jest
        .spyOn(service, 'remove')
        .mockRejectedValue(new Error('Delete failed'));

      await expect(service.handleCron()).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });
});
