import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';

import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

import { Account } from './entities/account.entity';

@Injectable()
export class AccountService {
  constructor(
    @InjectRepository(Account)
    private accountRepository: Repository<Account>,
  ) {}

  async create(createAccountDto: CreateAccountDto): Promise<Account> {
    const newAccount = this.accountRepository.create(createAccountDto);

    try {
      await this.accountRepository.save(newAccount);
      return newAccount;
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to save a new account',
        error,
      );
    }
  }

  async findAllUsersAccounts(userId: string): Promise<Account[]> {
    return this.accountRepository.find({
      where: {
        user: {
          id: userId,
        },
      },
    });
  }

  async findOne(id: string): Promise<Account> {
    const account = await this.accountRepository.findOne({
      where: {
        id: id,
      },
    });
    return account;
  }

  async update(
    id: string,
    updateAccountDto: UpdateAccountDto,
  ): Promise<Account> {
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

  async remove(id: string): Promise<void> {
    const deleteResponse = await this.accountRepository.softDelete(id);
    if (!deleteResponse.affected) {
      throw new NotFoundException(`Account with ID "${id}" not found`);
    }
  }

  async findAllSoftDeleted(): Promise<Account[]> {
    return this.accountRepository.find({ withDeleted: true });
  }

  async hardDeleteOlderThanOneWeek(): Promise<void> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    await this.accountRepository.delete({ deletedAt: LessThan(sevenDaysAgo) });
  }
}
