import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LauncherEntity } from './entities/launcher.entity';
import { LauncherService } from './launcher.service';

describe('LauncherService', () => {
  let service: LauncherService;
  let repository: Repository<LauncherEntity>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LauncherService,
        {
          provide: getRepositoryToken(LauncherEntity),
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

    service = module.get<LauncherService>(LauncherService);
    repository = module.get<Repository<LauncherEntity>>(
      getRepositoryToken(LauncherEntity),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return all launchers', async () => {
      const launchers = [{ id: '1', name: 'Steam' }];
      (repository.find as jest.Mock).mockResolvedValue(launchers);

      const result = await service.findAll();

      expect(result).toEqual(launchers);
      expect(repository.find).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should return a launcher by id', async () => {
      const launcher = { id: '1', name: 'Steam' };
      (repository.findOne as jest.Mock).mockResolvedValue(launcher);

      const result = await service.findOne('1');

      expect(result).toEqual(launcher);
      expect(repository.findOne).toHaveBeenCalledWith({ where: { id: '1' } });
    });

    it('should throw BadRequestException if id is missing', async () => {
      await expect(service.findOne('')).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if launcher not found', async () => {
      (repository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.findOne('1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findOneByName', () => {
    it('should return a launcher by name', async () => {
      const launcher = { id: '1', name: 'Steam' };
      (repository.findOne as jest.Mock).mockResolvedValue(launcher);

      const result = await service.findOneByName('Steam');

      expect(result).toEqual(launcher);
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { name: 'Steam' },
      });
    });

    it('should throw BadRequestException if name is missing', async () => {
      await expect(service.findOneByName('')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException if launcher not found', async () => {
      (repository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.findOneByName('Steam')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAllSoftDeletedOlderThanOneWeek', () => {
    it('should return soft deleted launchers older than one week', async () => {
      const launchers = [
        { id: '1', name: 'OldLauncher', deletedAt: new Date('2020-01-01') },
      ];
      const queryBuilder = repository.createQueryBuilder();
      (queryBuilder.getMany as jest.Mock).mockResolvedValue(launchers);

      const result = await service.findAllSoftDeletedOlderThanOneWeek();

      expect(result).toEqual(launchers);
      expect(queryBuilder.where).toHaveBeenCalledWith(
        'launcher.deletedAt IS NOT NULL',
      );
      expect(queryBuilder.andWhere).toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('should create and save a new launcher', async () => {
      const dto = { name: 'Epic' };
      const launcher = { id: '1', name: 'Epic' };
      (repository.create as jest.Mock).mockReturnValue(launcher);
      (repository.save as jest.Mock).mockResolvedValue(launcher);

      const result = await service.create(dto);

      expect(result).toEqual(launcher);
      expect(repository.create).toHaveBeenCalledWith(dto);
      expect(repository.save).toHaveBeenCalledWith(launcher);
    });

    it('should throw InternalServerErrorException on save failure', async () => {
      const dto = { name: 'Epic' };
      const launcher = { id: '1', name: 'Epic' };
      (repository.create as jest.Mock).mockReturnValue(launcher);
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
    it('should update a launcher', async () => {
      const launcher = { id: '1', name: 'Steam' };
      const dto = { name: 'Steam Updated' };
      const updated = { id: '1', name: 'Steam Updated' };

      (repository.findOne as jest.Mock).mockResolvedValue(launcher);
      (repository.merge as jest.Mock).mockReturnValue(updated);
      (repository.save as jest.Mock).mockResolvedValue(updated);

      const result = await service.update('1', dto);

      expect(result).toEqual(updated);
      expect(repository.merge).toHaveBeenCalledWith(launcher, dto);
      expect(repository.save).toHaveBeenCalledWith(updated);
    });

    it('should throw InternalServerErrorException on update failure', async () => {
      const launcher = { id: '1', name: 'Steam' };
      const dto = { name: 'Updated' };

      (repository.findOne as jest.Mock).mockResolvedValue(launcher);
      (repository.merge as jest.Mock).mockReturnValue(launcher);
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
    it('should hard delete a launcher', async () => {
      const launcher = { id: '1', name: 'Steam' };
      (repository.findOne as jest.Mock).mockResolvedValue(launcher);
      (repository.remove as jest.Mock).mockResolvedValue(launcher);

      await service.remove('1');

      expect(repository.remove).toHaveBeenCalledWith(launcher);
    });

    it('should throw InternalServerErrorException on remove failure', async () => {
      const launcher = { id: '1', name: 'Steam' };
      (repository.findOne as jest.Mock).mockResolvedValue(launcher);
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
    it('should soft delete a launcher', async () => {
      const launcher = { id: '1', name: 'Steam' };
      (repository.findOne as jest.Mock).mockResolvedValue(launcher);
      (repository.softDelete as jest.Mock).mockResolvedValue({ affected: 1 });

      await service.softRemove('1');

      expect(repository.softDelete).toHaveBeenCalledWith('1');
    });

    it('should throw InternalServerErrorException on soft delete failure', async () => {
      const launcher = { id: '1', name: 'Steam' };
      (repository.findOne as jest.Mock).mockResolvedValue(launcher);
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
    it('should hard delete soft-deleted launchers older than one week', async () => {
      const launchers = [
        { id: '1', name: 'Old1' },
        { id: '2', name: 'Old2' },
      ];

      jest
        .spyOn(service, 'findAllSoftDeletedOlderThanOneWeek')
        .mockResolvedValue(launchers as any);
      jest.spyOn(service, 'remove').mockResolvedValue(undefined);

      await service.handleCron();

      expect(service.remove).toHaveBeenCalledWith('1');
      expect(service.remove).toHaveBeenCalledWith('2');
    });

    it('should throw InternalServerErrorException if hard delete fails', async () => {
      const launchers = [{ id: '1', name: 'Old' }];

      jest
        .spyOn(service, 'findAllSoftDeletedOlderThanOneWeek')
        .mockResolvedValue(launchers as any);
      jest
        .spyOn(service, 'remove')
        .mockRejectedValue(new Error('Delete failed'));

      await expect(service.handleCron()).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });
});
