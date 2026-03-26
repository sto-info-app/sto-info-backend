import { jest } from '@jest/globals';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountService } from './account.service';
import { AccountEntity } from './entities/account.entity';

describe('AccountService', () => {
  let service: AccountService;
  let repository: Repository<AccountEntity>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountService,
        {
          provide: getRepositoryToken(AccountEntity),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
            softDelete: jest.fn(),
            delete: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AccountService>(AccountService);
    repository = module.get<Repository<AccountEntity>>(
      getRepositoryToken(AccountEntity),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create and save a new account', async () => {
      const dto = { userId: 'user-1', handle: 'h' };
      const account = { id: '1', userId: 'user-1' };
      (
        repository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(null);
      (repository.create as jest.Mock).mockReturnValue(account);
      (
        repository.save as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(account);

      const result = await service.create(dto as any);

      expect(result).toEqual(account);
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { userId: 'user-1', handleNormalized: 'h' },
      });
      expect(repository.create).toHaveBeenCalledWith({
        ...dto,
        handleNormalized: 'h',
        handleSlug: 'h',
      });
      expect(repository.save).toHaveBeenCalledWith(account);
    });

    it('should throw ConflictException if handle already exists for user', async () => {
      const dto = { userId: 'user-1', handle: 'dup' };
      (
        repository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({ id: 'existing' });

      await expect(service.create(dto as any)).rejects.toThrow(
        ConflictException,
      );
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('should treat handle uniqueness as case-insensitive', async () => {
      const dto = { userId: 'user-1', handle: 'DuP' };
      (
        repository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({ id: 'existing' });

      await expect(service.create(dto as any)).rejects.toThrow(
        ConflictException,
      );
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { userId: 'user-1', handleNormalized: 'dup' },
      });
    });

    it('should throw InternalServerErrorException on save failure', async () => {
      const dto = { userId: 'user-1', handle: 'h' };
      const account = { id: '1' };
      (
        repository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(null);
      (repository.create as jest.Mock).mockReturnValue(account);
      (
        repository.save as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockRejectedValue(new Error('DB Error'));

      await expect(service.create(dto as any)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('should return early from handle uniqueness check if handle is missing', async () => {
      const dto = { userId: 'user-1', handle: '' };
      const account = { id: '1' };
      (repository.create as jest.Mock).mockReturnValue(account);
      (
        repository.save as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(account);

      const result = await service.create(dto as any);

      expect(result).toEqual(account);
      expect(repository.findOne).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if dto is missing', async () => {
      await expect(service.create(null as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if userId is missing', async () => {
      await expect(service.create({ handle: 'h' } as any)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('findAllUsersAccounts', () => {
    it('should return all accounts for a user', async () => {
      const accounts = [
        { id: '1', userId: 'user-1' },
        { id: '2', userId: 'user-1' },
      ];
      (
        repository.find as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(accounts);

      const result = await service.findAllUsersAccounts('user-1');

      expect(result).toEqual(accounts);
      expect(repository.find).toHaveBeenCalledWith({
        where: { user: { id: 'user-1' } },
        order: { handle: 'ASC', username: 'ASC', createdAt: 'ASC' },
      });
    });

    it('should throw BadRequestException if userId is missing', async () => {
      await expect(service.findAllUsersAccounts('')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('findOne', () => {
    it('should return an account by id', async () => {
      const account = { id: '1', userId: 'user-1' };
      (
        repository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(account);

      const result = await service.findOne('1');

      expect(result).toEqual(account);
      expect(repository.findOne).toHaveBeenCalledWith({ where: { id: '1' } });
    });

    it('should throw BadRequestException if id is missing', async () => {
      await expect(service.findOne('')).rejects.toThrow(BadRequestException);
    });
  });

  describe('findOneBySlug', () => {
    it('should return an account by slug', async () => {
      const account = { id: '1', handleSlug: 'Steve~1234' };
      (
        repository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(account);

      const result = await service.findOneBySlug('Steve~1234');

      expect(result).toEqual(account);
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { handleSlug: 'Steve~1234' },
      });
    });

    it('should return null if account not found by slug', async () => {
      (
        repository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(null);

      const result = await service.findOneBySlug('non-existent');

      expect(result).toBeNull();
    });

    it('should throw BadRequestException if slug is missing', async () => {
      await expect(service.findOneBySlug('')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('findOneForUser', () => {
    it('should return an account by id for the given user', async () => {
      const account = { id: '1', userId: 'user-1' };
      (
        repository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(account);

      const result = await service.findOneForUser('1', 'user-1');

      expect(result).toEqual(account);
      expect(repository.findOne).toHaveBeenCalledWith({ where: { id: '1' } });
    });

    it('should throw NotFoundException if account not found for user', async () => {
      (
        repository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(null);

      await expect(service.findOneForUser('1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException if account is not owned by user', async () => {
      (
        repository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({
        id: '1',
        userId: 'other-user',
      });

      await expect(service.findOneForUser('1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw BadRequestException if id is missing', async () => {
      await expect(service.findOneForUser('', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if userId is missing', async () => {
      await expect(service.findOneForUser('1', '')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('update', () => {
    it('should update an account', async () => {
      const dto = { accountName: 'Updated Name' };
      const updated = { id: '1', accountName: 'Updated Name' };
      (
        repository.update as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({ affected: 1 });
      (
        repository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(updated);

      const result = await service.update('1', dto as any);

      expect(result).toEqual(updated);
      expect(repository.update).toHaveBeenCalledWith('1', dto);
      expect(repository.findOne).toHaveBeenCalledWith({ where: { id: '1' } });
    });

    it('should throw NotFoundException if account not found after update', async () => {
      const dto = { accountName: 'Updated' };
      (
        repository.update as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({ affected: 1 });
      (
        repository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(null);

      await expect(service.update('1', dto as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if id is missing', async () => {
      await expect(service.update('', {}) as any).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if dto is missing', async () => {
      await expect(service.update('1', null as any)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('updateForUser', () => {
    it('should update an account for the given user', async () => {
      const existing = { id: '1', userId: 'user-1', handle: 'old-handle' };
      const dto = { handle: 'new-handle' };
      (repository.findOne as jest.Mock<(...args: any[]) => Promise<any>>)
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(null);
      (
        repository.save as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({ ...existing, ...dto });

      const result = await service.updateForUser('1', 'user-1', dto as any);

      expect(repository.findOne).toHaveBeenCalledWith({ where: { id: '1' } });
      expect(repository.findOne).toHaveBeenCalledWith({
        where: expect.objectContaining({
          userId: 'user-1',
          handleNormalized: 'new-handle',
        }),
      });
      expect(repository.save).toHaveBeenCalledWith({
        ...existing,
        ...dto,
        handleNormalized: 'new-handle',
        handleSlug: 'new-handle',
      });
      expect(result).toEqual({
        ...existing,
        ...dto,
        handleNormalized: 'new-handle',
        handleSlug: 'new-handle',
      });
    });

    it('should throw ConflictException if new handle already exists for user', async () => {
      const existing = { id: '1', userId: 'user-1', handle: 'old-handle' };
      const dto = { handle: 'dup' };
      (repository.findOne as jest.Mock<(...args: any[]) => Promise<any>>)
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce({ id: 'other' });

      await expect(
        service.updateForUser('1', 'user-1', dto as any),
      ).rejects.toThrow(ConflictException);
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('should treat updated handle uniqueness as case-insensitive', async () => {
      const existing = { id: '1', userId: 'user-1', handle: 'old-handle' };
      const dto = { handle: 'DuP' };
      (repository.findOne as jest.Mock<(...args: any[]) => Promise<any>>)
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce({ id: 'other' });

      await expect(
        service.updateForUser('1', 'user-1', dto as any),
      ).rejects.toThrow(ConflictException);

      expect(repository.findOne).toHaveBeenCalledWith({
        where: expect.objectContaining({
          userId: 'user-1',
          handleNormalized: 'dup',
        }),
      });
    });
    it('should throw ForbiddenException if account is not owned by user', async () => {
      (
        repository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({
        id: '1',
        userId: 'other-user',
      });

      await expect(
        service.updateForUser('1', 'user-1', { handle: 'x' } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should skip handle uniqueness check if handle is same', async () => {
      const existing = { id: '1', userId: 'user-1', handle: 'same' };
      const dto = { handle: 'same' };
      (
        repository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(existing);
      (
        repository.save as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({
        ...existing,
        notes: 'new',
      });

      await service.updateForUser('1', 'user-1', {
        ...dto,
        notes: 'new',
      } as any);

      expect(repository.findOne).toHaveBeenCalledTimes(1); // Only for requireOwnedAccount
      expect(repository.save).toHaveBeenCalled();
    });

    it('should skip handle uniqueness check if handle is not provided', async () => {
      const existing = { id: '1', userId: 'user-1', handle: 'h' };
      const dto = { notes: 'only notes' };
      (
        repository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(existing);
      (
        repository.save as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({ ...existing, ...dto });

      await service.updateForUser('1', 'user-1', dto as any);

      expect(repository.findOne).toHaveBeenCalledTimes(1); // Only for requireOwnedAccount
      expect(repository.save).toHaveBeenCalled();
    });

    it('should throw BadRequestException if id is missing', async () => {
      await expect(service.updateForUser('', 'user-1', {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if userId is missing', async () => {
      await expect(service.updateForUser('1', '', {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if dto is missing', async () => {
      await expect(
        service.updateForUser('1', 'user-1', null as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('remove', () => {
    it('should soft delete an account', async () => {
      (
        repository.softDelete as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({ affected: 1 });

      await service.remove('1');

      expect(repository.softDelete).toHaveBeenCalledWith('1');
    });

    it('should throw NotFoundException if account not found', async () => {
      (
        repository.softDelete as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({ affected: 0 });

      await expect(service.remove('1')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if id is missing', async () => {
      await expect(service.remove('')).rejects.toThrow(BadRequestException);
    });
  });

  describe('removeForUser', () => {
    it('should soft delete an account for the given user', async () => {
      (
        repository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({
        id: '1',
        userId: 'user-1',
      });
      (
        repository.softDelete as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({ affected: 1 });

      await service.removeForUser('1', 'user-1');

      expect(repository.findOne).toHaveBeenCalledWith({ where: { id: '1' } });
      expect(repository.softDelete).toHaveBeenCalledWith('1');
    });

    it('should throw ForbiddenException if account is not owned by user', async () => {
      (
        repository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({
        id: '1',
        userId: 'other-user',
      });

      await expect(service.removeForUser('1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw NotFoundException if softDelete affected is 0', async () => {
      (
        repository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({
        id: '1',
        userId: 'user-1',
      });
      (
        repository.softDelete as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({ affected: 0 });

      await expect(service.removeForUser('1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if id is missing', async () => {
      await expect(service.removeForUser('', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if userId is missing', async () => {
      await expect(service.removeForUser('1', '')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('findAllSoftDeleted', () => {
    it('should return all soft deleted accounts', async () => {
      const accounts = [
        { id: '1', deletedAt: new Date() },
        { id: '2', deletedAt: new Date() },
      ];
      (
        repository.find as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(accounts);

      const result = await service.findAllSoftDeleted();

      expect(result).toEqual(accounts);
      expect(repository.find).toHaveBeenCalledWith({ withDeleted: true });
    });
  });

  describe('hardDeleteOlderThanOneWeek', () => {
    it('should hard delete accounts older than one week', async () => {
      (
        repository.delete as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({ affected: 3 });

      await service.hardDeleteOlderThanOneWeek();

      expect(repository.delete).toHaveBeenCalled();
      const deleteCall = (
        repository.delete as jest.Mock<(...args: any[]) => any>
      ).mock.calls[0][0];
      expect(deleteCall.deletedAt).toBeDefined();
    });
  });
});
