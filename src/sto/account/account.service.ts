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
import {
  buildCloudflareImageUrl,
  isValidCloudflareImageUrl,
} from 'src/shared/constants/image.constants';
import { PlatformLauncherEntity } from '../platform-launcher/entities/platform-launcher.entity';

import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { AccountEntity } from './entities/account.entity';

/**
 * Account list API shape enriched with resolved account background image URL.
 */
export type AccountListItem = AccountEntity & {
  accountTypeImageUrl: string;
};

@Injectable()
export class AccountService {
  private static readonly _fallbackAccountTypeImageId =
    '8ab52131-6f11-408a-d9df-3c1acaa46d00';

  /**
   * Creates an instance of AccountService.
   *
   * @param _accountRepository - The account repository.
   * @param _platformLauncherRepository - The platform-launcher repository.
   */
  constructor(
    @InjectRepository(AccountEntity)
    private readonly _accountRepository: Repository<AccountEntity>,
    @InjectRepository(PlatformLauncherEntity)
    private readonly _platformLauncherRepository: Repository<PlatformLauncherEntity>,
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
   * Builds a deterministic lookup key for platform-launcher mappings.
   *
   * @param platformId - Optional platform ID.
   * @param launcherId - Optional launcher ID.
   * @returns A deterministic key in the format `<platformId>|<launcherId>`.
   */
  private buildPlatformLauncherLookupKey(
    platformId?: string | null,
    launcherId?: string | null,
  ): string {
    return `${platformId ?? ''}|${launcherId ?? ''}`;
  }

  /**
   * Resolves the account card background URL from platform-launcher mappings.
   *
   * Resolution order:
   * 1) Exact platform + launcher
   * 2) Platform default (platform + null launcher)
   * 3) Launcher default (null platform + launcher)
   * 4) Global default (null platform + null launcher)
   * 5) Static fallback URL
   *
   * @param account - The account to resolve for.
   * @param backgroundImageLookup - A mapping from lookup key to URL.
   * @returns The selected account background image URL.
   */
  private resolveAccountTypeImageUrl(
    account: AccountEntity,
    backgroundImageLookup: Map<string, string>,
  ): string {
    const exact = backgroundImageLookup.get(
      this.buildPlatformLauncherLookupKey(
        account.platformId,
        account.launcherId,
      ),
    );
    if (exact) {
      return exact;
    }

    const platformDefault = backgroundImageLookup.get(
      this.buildPlatformLauncherLookupKey(account.platformId, null),
    );
    if (platformDefault) {
      return platformDefault;
    }

    const launcherDefault = backgroundImageLookup.get(
      this.buildPlatformLauncherLookupKey(null, account.launcherId),
    );
    if (launcherDefault) {
      return launcherDefault;
    }

    const globalDefault = backgroundImageLookup.get(
      this.buildPlatformLauncherLookupKey(null, null),
    );
    if (globalDefault) {
      return globalDefault;
    }

    return buildCloudflareImageUrl(
      AccountService._fallbackAccountTypeImageId,
      'public',
    );
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

    const existing = await this._accountRepository.findOne({ where });
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

    const newAccount = this._accountRepository.create({
      ...createAccountDto,
      handleNormalized,
      handleSlug,
    });

    try {
      await this._accountRepository.save(newAccount);
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
  async findAllUsersAccounts(userId: string): Promise<AccountListItem[]> {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    const accounts = await this._accountRepository.find({
      where: {
        user: {
          id: userId,
        },
      },
      relations: {
        platform: true,
        launcher: true,
      },
      order: { handle: 'ASC', username: 'ASC', createdAt: 'ASC' },
    });

    const platformLaunchers = await this._platformLauncherRepository.find({
      select: {
        platformId: true,
        launcherId: true,
        backgroundImageUrl: true,
      },
    });

    const backgroundImageLookup = new Map<string, string>();
    for (const mapping of platformLaunchers) {
      if (!isValidCloudflareImageUrl(mapping.backgroundImageUrl)) {
        continue;
      }

      const key = this.buildPlatformLauncherLookupKey(
        mapping.platformId,
        mapping.launcherId,
      );
      backgroundImageLookup.set(key, mapping.backgroundImageUrl);
    }

    return accounts.map(account => ({
      ...account,
      accountTypeImageUrl: this.resolveAccountTypeImageUrl(
        account,
        backgroundImageLookup,
      ),
    }));
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

    const account = await this._accountRepository.findOne({
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

    return this._accountRepository.findOne({
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
    const account = await this._accountRepository.findOne({
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

    await this._accountRepository.update(id, updateAccountDto);
    const updatedAccount = await this._accountRepository.findOne({
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
    await this._accountRepository.save(account);
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

    const deleteResponse = await this._accountRepository.softDelete(id);
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
    const deleteResponse = await this._accountRepository.softDelete(account.id);
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
    return this._accountRepository.find({ withDeleted: true });
  }

  /**
   * Permanently deletes accounts soft-deleted more than 7 days ago.
   *
   * Intended to be invoked by a scheduled job.
   */
  async hardDeleteOlderThanOneWeek(): Promise<void> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    await this._accountRepository.delete({ deletedAt: LessThan(sevenDaysAgo) });
  }
}
