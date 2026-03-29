import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { CreateAccountRequestDto } from './dto/create-account-request.dto';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { AccountEntity } from './entities/account.entity';

describe('AccountController', () => {
  let controller: AccountController;
  let service: AccountService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AccountController],
      providers: [
        {
          provide: AccountService,
          useValue: {
            create: jest.fn(),
            findAllUsersAccounts: jest.fn(),
            findOneForUser: jest.fn(),
            updateForUser: jest.fn(),
            removeForUser: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(AccountEntity),
          useValue: {},
        },
      ],
    }).compile();

    controller = module.get<AccountController>(AccountController);
    service = module.get<AccountService>(AccountService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should create an account', async () => {
      const userId = 'user-uuid';
      const dto: CreateAccountRequestDto = {
        handle: 'test-handle',
        username: 'testuser',
        email: 'test@example.com',
        notes: 'test notes',
        accountCreatedDate: '2024-01-01',
        publiclyVisible: true,
        platformId: 'platform-uuid',
        launcherId: 'launcher-uuid',
      };
      const expectedCreate: CreateAccountDto = { ...dto, userId };
      const expected = { id: '1', ...expectedCreate };
      (
        service.create as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(expected);

      const result = await controller.create(userId, dto);

      expect(result).toEqual(expected);
      expect(service.create).toHaveBeenCalledWith(expectedCreate);
    });
  });

  describe('findAllUsersAccounts', () => {
    it("should find all user's accounts", async () => {
      const userId = 'user-123';
      const expected = [{ id: '1' }, { id: '2' }];
      (
        service.findAllUsersAccounts as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue(expected);

      const result = await controller.findAllUsersAccounts(userId);

      expect(result).toEqual(expected);
      expect(service.findAllUsersAccounts).toHaveBeenCalledWith(userId);
    });
  });

  describe('findOne', () => {
    it('should find one account by id', async () => {
      const id = 'account-123';
      const userId = 'user-123';
      const expected = { id, handle: 'test-handle' };
      (
        service.findOneForUser as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(expected);

      const result = await controller.findOne(userId, id);

      expect(result).toEqual(expected);
      expect(service.findOneForUser).toHaveBeenCalledWith(id, userId);
    });
  });

  describe('update', () => {
    it('should update an account', async () => {
      const id = 'account-123';
      const userId = 'user-123';
      const dto: UpdateAccountDto = {
        handle: 'updated-handle',
        notes: 'updated notes',
      };
      const expected = { id, ...dto };
      (
        service.updateForUser as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(expected);

      const result = await controller.update(userId, id, dto);

      expect(result).toEqual(expected);
      expect(service.updateForUser).toHaveBeenCalledWith(id, userId, dto);
    });
  });

  describe('remove', () => {
    it('should remove an account', async () => {
      const id = 'account-123';
      const userId = 'user-123';
      const expected = { id };
      (
        service.removeForUser as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(expected);

      const result = await controller.remove(userId, id);

      expect(result).toEqual(expected);
      expect(service.removeForUser).toHaveBeenCalledWith(id, userId);
    });
  });
});
