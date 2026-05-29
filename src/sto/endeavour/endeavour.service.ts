import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AccountEntity } from 'src/sto/account/entities/account.entity';
import { Repository } from 'typeorm';
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
  constructor(
    @InjectRepository(EndeavourPerkEntity)
    private readonly perkRepository: Repository<EndeavourPerkEntity>,
    @InjectRepository(AccountEndeavourProgressEntity)
    private readonly progressRepository: Repository<AccountEndeavourProgressEntity>,
    @InjectRepository(AccountEntity)
    private readonly accountRepository: Repository<AccountEntity>,
  ) {}

  private async requireOwnedAccount(
    accountId: string,
    userId: string,
  ): Promise<AccountEntity> {
    const account = await this.accountRepository.findOne({
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

  async getPerks(
    category?: 'Space' | 'Ground',
  ): Promise<EndeavourPerkEntity[]> {
    const where = category ? { category } : {};
    return this.perkRepository.find({
      where,
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  async getProgress(
    accountId: string,
    userId: string,
    query: EndeavourProgressQueryDto,
  ): Promise<AccountEndeavourProgressEntity[]> {
    await this.requireOwnedAccount(accountId, userId);

    const allPerks = await this.getPerks(query.category);

    const existingProgress = await this.progressRepository.find({
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

  async updateProgress(
    accountId: string,
    userId: string,
    perkId: string,
    dto: UpdateEndeavourProgressDto,
  ): Promise<AccountEndeavourProgressEntity> {
    await this.requireOwnedAccount(accountId, userId);

    const perk = await this.perkRepository.findOne({ where: { id: perkId } });
    if (!perk) {
      throw new NotFoundException(
        `Endeavour perk with ID "${perkId}" not found`,
      );
    }

    let progress = await this.progressRepository.findOne({
      where: { accountId, endeavourPerkId: perkId },
      relations: { endeavourPerk: true },
    });

    if (!progress) {
      progress = this.progressRepository.create({
        accountId,
        endeavourPerkId: perkId,
        currentNodes: dto.currentNodes,
      });
    } else {
      progress.currentNodes = dto.currentNodes;
    }

    await this.progressRepository.save(progress);

    progress.endeavourPerk = perk;
    return progress;
  }

  async getSummary(
    accountId: string,
    userId: string,
  ): Promise<EndeavourSummary> {
    await this.requireOwnedAccount(accountId, userId);

    const allPerks = await this.perkRepository.find();
    const existingProgress = await this.progressRepository.find({
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
