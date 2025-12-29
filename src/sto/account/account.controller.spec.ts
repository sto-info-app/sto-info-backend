import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
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
            findOne: jest.fn(),
            update: jest.fn(),
            remove: jest.fn(),
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
      const dto: CreateAccountDto = {
        handle: 'test-handle',
        username: 'testuser',
        email: 'test@example.com',
        notes: 'test notes',
        accountCreatedDate: '2024-01-01',
        publiclyVisible: true,
        platformId: 'platform-uuid',
        launcherId: 'launcher-uuid',
        userId: 'user-uuid',
      };
      const expected = { id: '1', ...dto };
      (service.create as jest.Mock).mockResolvedValue(expected);

      const result = await controller.create(dto);

      expect(result).toEqual(expected);
      expect(service.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('findAllUsersAccounts', () => {
    it("should find all user's accounts", async () => {
      const userId = 'user-123';
      const req = { user: { id: userId } };
      const expected = [{ id: '1' }, { id: '2' }];
      (service.findAllUsersAccounts as jest.Mock).mockResolvedValue(expected);

      const result = await controller.findAllUsersAccounts(req);

      expect(result).toEqual(expected);
      expect(service.findAllUsersAccounts).toHaveBeenCalledWith(userId);
    });
  });

  describe('findOne', () => {
    it('should find one account by id', async () => {
      const id = 'account-123';
      const expected = { id, handle: 'test-handle' };
      (service.findOne as jest.Mock).mockResolvedValue(expected);

      const result = await controller.findOne(id);

      expect(result).toEqual(expected);
      expect(service.findOne).toHaveBeenCalledWith(id);
    });
  });

  describe('update', () => {
    it('should update an account', async () => {
      const id = 'account-123';
      const dto: UpdateAccountDto = {
        handle: 'updated-handle',
        notes: 'updated notes',
      };
      const expected = { id, ...dto };
      (service.update as jest.Mock).mockResolvedValue(expected);

      const result = await controller.update(id, dto);

      expect(result).toEqual(expected);
      expect(service.update).toHaveBeenCalledWith(id, dto);
    });
  });

  describe('remove', () => {
    it('should remove an account', async () => {
      const id = 'account-123';
      const expected = { id };
      (service.remove as jest.Mock).mockResolvedValue(expected);

      const result = await controller.remove(id);

      expect(result).toEqual(expected);
      expect(service.remove).toHaveBeenCalledWith(id);
    });
  });
});
