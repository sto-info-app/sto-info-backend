import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { AccountEntity } from 'src/sto/account/entities/account.entity';

import { EndeavourProgressQueryDto } from './dto/endeavour-progress-query.dto';
import { UpdateEndeavourProgressDto } from './dto/update-endeavour-progress.dto';
import { AccountEndeavourProgressEntity } from './entities/account-endeavour-progress.entity';
import { EndeavourPerkEntity } from './entities/endeavour-perk.entity';

export interface EndeavourSummary {
  totalNodes: number;
  maxPossibleNodes: number;
  overallCompletionPercentage: number;
  maxedPerks: number;
  totalPerks: number;
  spaceNodes: number;
  spaceMaxNodes: number;
  spaceCompletionPercentage: number;
  groundNodes: number;
  groundMaxNodes: number;
  groundCompletionPercentage: number;
}

@Injectable()
export class EndeavourService {
  /**
   * Creates an instance of EndeavourService.
   *
   * @param _perkRepository - The perk repository.
   * @param _progressRepository - The progress repository.
   * @param _accountRepository - The account repository.
   */
  constructor(
    @InjectRepository(EndeavourPerkEntity)
    private readonly _perkRepository: Repository<EndeavourPerkEntity>,
    @InjectRepository(AccountEndeavourProgressEntity)
    private readonly _progressRepository: Repository<AccountEndeavourProgressEntity>,
    @InjectRepository(AccountEntity)
    private readonly _accountRepository: Repository<AccountEntity>,
  ) {}

  /**
   * Ensures the account belongs to the authenticated user.
   *
   * @param accountId - The account id.
   * @param userId - The user id.
   * @returns A promise that resolves when the operation completes.
   */
  private async requireOwnedAccount(
    accountId: string,
    userId: string,
  ): Promise<AccountEntity> {
    const account = await this._accountRepository.findOne({
      where: { id: accountId },
    });

    if (!account) {
      throw new NotFoundException(`Account with ID "${accountId}" not found`);
    }

    if (account.userId !== userId) {
      throw new ForbiddenException('You do not have access to this account');
    }

    return account;
  }

  /**
   * Gets endeavour perks.
   *
   * @param category - The category.
   * @returns A promise that resolves when the operation completes.
   */
  async getPerks(
    category?: 'Space' | 'Ground',
  ): Promise<EndeavourPerkEntity[]> {
    const where = category ? { category } : {};
    return this._perkRepository.find({
      where,
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  /**
   * Gets endeavour progress.
   *
   * @param accountId - The account id.
   * @param userId - The user id.
   * @param query - The query.
   * @returns A promise that resolves when the operation completes.
   */
  async getProgress(
    accountId: string,
    userId: string,
    query: EndeavourProgressQueryDto,
  ): Promise<AccountEndeavourProgressEntity[]> {
    await this.requireOwnedAccount(accountId, userId);

    const allPerks = await this.getPerks(query.category);

    const existingProgress = await this._progressRepository.find({
      where: { accountId },
      relations: { endeavourPerk: true },
    });

    const progressMap = new Map(
      existingProgress.map(p => [p.endeavourPerkId, p]),
    );

    // Return one record per perk, synthesising zero-progress entries for untracked perks
    const results = allPerks.map(perk => {
      const existing = progressMap.get(perk.id);
      if (existing) {
        return existing;
      }

      const synthetic = new AccountEndeavourProgressEntity();
      synthetic.id = '';
      synthetic.accountId = accountId;
      synthetic.endeavourPerkId = perk.id;
      synthetic.endeavourPerk = perk;
      synthetic.currentNodes = 0;
      return synthetic;
    });

    const sortBy = query.sortBy ?? 'name';
    const order = query.sortOrder ?? 'ASC';
    const multiplier = order === 'ASC' ? 1 : -1;

    results.sort((a, b) => {
      if (sortBy === 'nodes') {
        const nodeDiff = (a.currentNodes - b.currentNodes) * multiplier;
        if (nodeDiff !== 0) return nodeDiff;
        return a.endeavourPerk.name.localeCompare(b.endeavourPerk.name);
      }
      return (
        a.endeavourPerk.name.localeCompare(b.endeavourPerk.name) * multiplier
      );
    });

    return results;
  }

  /**
   * Updates endeavour progress.
   *
   * @param accountId - The account id.
   * @param userId - The user id.
   * @param perkId - The perk id.
   * @param dto - The dto.
   * @returns A promise that resolves when the operation completes.
   */
  async updateProgress(
    accountId: string,
    userId: string,
    perkId: string,
    dto: UpdateEndeavourProgressDto,
  ): Promise<AccountEndeavourProgressEntity> {
    await this.requireOwnedAccount(accountId, userId);

    const perk = await this._perkRepository.findOne({ where: { id: perkId } });
    if (!perk) {
      throw new NotFoundException(
        `Endeavour perk with ID "${perkId}" not found`,
      );
    }

    let progress = await this._progressRepository.findOne({
      where: { accountId, endeavourPerkId: perkId },
      relations: { endeavourPerk: true },
    });

    if (!progress) {
      progress = this._progressRepository.create({
        accountId,
        endeavourPerkId: perkId,
        currentNodes: dto.currentNodes,
      });
    } else {
      progress.currentNodes = dto.currentNodes;
    }

    await this._progressRepository.save(progress);

    progress.endeavourPerk = perk;
    return progress;
  }

  /**
   * Gets the endeavour summary.
   *
   * @param accountId - The account id.
   * @param userId - The user id.
   * @returns A promise that resolves when the operation completes.
   */
  async getSummary(
    accountId: string,
    userId: string,
  ): Promise<EndeavourSummary> {
    await this.requireOwnedAccount(accountId, userId);

    const allPerks = await this._perkRepository.find();
    const existingProgress = await this._progressRepository.find({
      where: { accountId },
    });

    const progressMap = new Map(
      existingProgress.map(p => [p.endeavourPerkId, p.currentNodes]),
    );

    let totalNodes = 0;
    let maxPossibleNodes = 0;
    let maxedPerks = 0;
    let spaceNodes = 0;
    let spaceMaxNodes = 0;
    let groundNodes = 0;
    let groundMaxNodes = 0;

    for (const perk of allPerks) {
      const nodes = progressMap.get(perk.id) ?? 0;
      totalNodes += nodes;
      maxPossibleNodes += perk.maxNodes;

      if (nodes >= perk.maxNodes) {
        maxedPerks++;
      }

      if (perk.category === 'Space') {
        spaceNodes += nodes;
        spaceMaxNodes += perk.maxNodes;
      } else {
        groundNodes += nodes;
        groundMaxNodes += perk.maxNodes;
      }
    }

    return {
      totalNodes,
      maxPossibleNodes,
      overallCompletionPercentage:
        maxPossibleNodes > 0
          ? Math.round((totalNodes / maxPossibleNodes) * 100)
          : 0,
      maxedPerks,
      totalPerks: allPerks.length,
      spaceNodes,
      spaceMaxNodes,
      spaceCompletionPercentage:
        spaceMaxNodes > 0 ? Math.round((spaceNodes / spaceMaxNodes) * 100) : 0,
      groundNodes,
      groundMaxNodes,
      groundCompletionPercentage:
        groundMaxNodes > 0
          ? Math.round((groundNodes / groundMaxNodes) * 100)
          : 0,
    };
  }
}
