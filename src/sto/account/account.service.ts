import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Not, Repository } from 'typeorm';

import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { AccountEntity } from './entities/account.entity';

@Injectable()
export class AccountService {
  /**
   * Creates an instance of AccountService.
   *
   * @param accountRepository - The account repository.
   */
  constructor(
    @InjectRepository(AccountEntity)
    private readonly accountRepository: Repository<AccountEntity>,
  ) {}

  /**
   * Normalizes the supplied handle.
   *
   * @param handle - The handle.
   * @returns The result of the operation.
   */
  private normalizeHandle(handle: string): string {
    return handle.trim().toLowerCase();
  }

  /**
   * Generates a URL-safe slug from a handle by replacing '#' with '~'.
   *
   * @param handle Raw handle value.
   * @returns A URL-safe slug.
   */
  private generateSlug(handle: string): string {
    return handle.trim().replaceAll('#', '~');
  }

  /**
   * Ensures a handle is unique for a given user.
   *
   * If `excludeAccountId` is provided, that account is ignored (useful for updates).
   *
   * @param userId Owner user ID.
   * @param handle Proposed handle.
   * @param excludeAccountId Account ID to exclude from uniqueness check.
   * @throws {ConflictException} If another account for the same user already uses the handle.
   */
  private async assertHandleUniqueForUser(
    userId: string,
    handle: string | undefined,
    excludeAccountId?: string,
  ): Promise<void> {
    if (!handle) {
      return;
    }

    const handleNormalized = this.normalizeHandle(handle);

    const where: Record<string, unknown> = { userId, handleNormalized };
    if (excludeAccountId) {
      where.id = Not(excludeAccountId);
    }

    const existing = await this.accountRepository.findOne({ where });
    if (existing) {
      throw new ConflictException('Handle already exists');
    }
  }

  /**
   * Creates a new account.
   *
   * @param createAccountDto Account creation payload.
   * @returns The persisted account entity.
   * @throws {ConflictException} If the handle is already used by the same user.
   * @throws {InternalServerErrorException} If saving fails.
   */
  async create(createAccountDto: CreateAccountDto): Promise<AccountEntity> {
    if (!createAccountDto) {
      throw new BadRequestException('Account data is required');
    }

    if (!createAccountDto.userId) {
      throw new BadRequestException('User ID is required');
    }

    await this.assertHandleUniqueForUser(
      createAccountDto.userId,
      createAccountDto.handle,
    );

    const handleNormalized = this.normalizeHandle(createAccountDto.handle);
    const handleSlug = this.generateSlug(createAccountDto.handle);

    const newAccount = this.accountRepository.create({
      ...createAccountDto,
      handleNormalized,
      handleSlug,
    });

    try {
      await this.accountRepository.save(newAccount);
      return newAccount;
    } catch (error: unknown) {
      throw new InternalServerErrorException('Failed to save a new account', {
        cause: error,
      });
    }
  }

  /**
   * Returns all accounts owned by the specified user.
   *
   * @param userId Owner user ID.
   * @returns List of the user's accounts.
   */
  async findAllUsersAccounts(userId: string): Promise<AccountEntity[]> {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    return this.accountRepository.find({
      where: {
        user: {
          id: userId,
        },
      },
      order: { handle: 'ASC', username: 'ASC', createdAt: 'ASC' },
    });
  }

  /**
   * Finds an account by ID (no ownership check).
   *
   * Note: prefer `findOneForUser` for user-scoped access.
   *
   * @param id Account ID.
   * @returns The account if found, otherwise `null`.
   */
  async findOne(id: string): Promise<AccountEntity | null> {
    if (!id) {
      throw new BadRequestException('Account ID is required');
    }

    const account = await this.accountRepository.findOne({
      where: {
        id: id,
      },
    });
    return account;
  }

  /**
   * Finds an account by its URL slug.
   *
   * @param handleSlug Slug to look for.
   * @returns The account if found, otherwise `null`.
   */
  async findOneBySlug(handleSlug: string): Promise<AccountEntity | null> {
    if (!handleSlug) {
      throw new BadRequestException('Handle slug is required');
    }

    return this.accountRepository.findOne({
      where: { handleSlug },
    });
  }

  /**
   * Loads an account and verifies it is owned by the given user.
   *
   * @param id Account ID.
   * @param userId Owner user ID.
   * @returns The owned account.
   * @throws {NotFoundException} If the account does not exist.
   * @throws {ForbiddenException} If the account is not owned by the user.
   */
  private async requireOwnedAccount(
    id: string,
    userId: string,
  ): Promise<AccountEntity> {
    const account = await this.accountRepository.findOne({
      where: {
        id,
      },
    });

    if (!account) {
      throw new NotFoundException(`Account with ID "${id}" not found`);
    }

    if (account.userId !== userId) {
      throw new ForbiddenException('You do not have access to this account');
    }

    return account;
  }

  /**
   * Finds an account by ID scoped to the given user.
   *
   * @param id Account ID.
   * @param userId Owner user ID.
   * @returns The owned account.
   * @throws {NotFoundException} If the account does not exist.
   * @throws {ForbiddenException} If the account is not owned by the user.
   */
  async findOneForUser(id: string, userId: string): Promise<AccountEntity> {
    if (!id) {
      throw new BadRequestException('Account ID is required');
    }

    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    return this.requireOwnedAccount(id, userId);
  }

  /**
   * Updates an account by ID (no ownership check).
   *
   * Note: prefer `updateForUser` for user-scoped access.
   *
   * @param id Account ID.
   * @param updateAccountDto Partial update payload.
   * @returns The updated account.
   * @throws {NotFoundException} If the account does not exist.
   */
  async update(
    id: string,
    updateAccountDto: UpdateAccountDto,
  ): Promise<AccountEntity> {
    if (!id) {
      throw new BadRequestException('Account ID is required');
    }

    if (!updateAccountDto) {
      throw new BadRequestException('Update data is required');
    }

    await this.accountRepository.update(id, updateAccountDto);
    const updatedAccount = await this.accountRepository.findOne({
      where: {
        id: id,
      },
    });
    if (!updatedAccount) {
      throw new NotFoundException(`Account with ID "${id}" not found`);
    }
    return updatedAccount;
  }

  /**
   * Updates an account owned by the specified user.
   *
   * Performs ownership validation and handle uniqueness enforcement.
   *
   * @param id Account ID.
   * @param userId Owner user ID.
   * @param updateAccountDto Partial update payload.
   * @returns The updated account.
   * @throws {NotFoundException} If the account does not exist.
   * @throws {ForbiddenException} If the account is not owned by the user.
   * @throws {ConflictException} If the updated handle is already used by another account of the user.
   */
  async updateForUser(
    id: string,
    userId: string,
    updateAccountDto: UpdateAccountDto,
  ): Promise<AccountEntity> {
    if (!id) {
      throw new BadRequestException('Account ID is required');
    }

    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    if (!updateAccountDto) {
      throw new BadRequestException('Update data is required');
    }

    const account = await this.requireOwnedAccount(id, userId);

    if (
      typeof updateAccountDto.handle === 'string' &&
      updateAccountDto.handle !== account.handle
    ) {
      await this.assertHandleUniqueForUser(
        userId,
        updateAccountDto.handle,
        account.id,
      );

      account.handleNormalized = this.normalizeHandle(updateAccountDto.handle);
      account.handleSlug = this.generateSlug(updateAccountDto.handle);
    }

    Object.assign(account, updateAccountDto);
    await this.accountRepository.save(account);
    return account;
  }

  /**
   * Soft-deletes an account by ID (no ownership check).
   *
   * Note: prefer `removeForUser` for user-scoped access.
   *
   * @param id Account ID.
   * @throws {NotFoundException} If the account does not exist.
   */
  async remove(id: string): Promise<void> {
    if (!id) {
      throw new BadRequestException('Account ID is required');
    }

    const deleteResponse = await this.accountRepository.softDelete(id);
    if (!deleteResponse.affected) {
      throw new NotFoundException(`Account with ID "${id}" not found`);
    }
  }

  /**
   * Soft-deletes an account owned by the specified user.
   *
   * @param id Account ID.
   * @param userId Owner user ID.
   * @throws {NotFoundException} If the account does not exist.
   * @throws {ForbiddenException} If the account is not owned by the user.
   */
  async removeForUser(id: string, userId: string): Promise<void> {
    if (!id) {
      throw new BadRequestException('Account ID is required');
    }

    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    const account = await this.requireOwnedAccount(id, userId);
    const deleteResponse = await this.accountRepository.softDelete(account.id);
    if (!deleteResponse.affected) {
      throw new NotFoundException(`Account with ID "${id}" not found`);
    }
  }

  /**
   * Returns all accounts including soft-deleted items.
   *
   * @returns Accounts, with soft-deleted rows included.
   */
  async findAllSoftDeleted(): Promise<AccountEntity[]> {
    return this.accountRepository.find({ withDeleted: true });
  }

  /**
   * Permanently deletes accounts soft-deleted more than 7 days ago.
   *
   * Intended to be invoked by a scheduled job.
   */
  async hardDeleteOlderThanOneWeek(): Promise<void> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    await this.accountRepository.delete({ deletedAt: LessThan(sevenDaysAgo) });
  }
}
