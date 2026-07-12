import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AccountEntity } from 'src/sto/account/entities/account.entity';
import { CharacterClassEntity } from 'src/sto/character/entities/character-class.entity';
import { CharacterRankEntity } from 'src/sto/character/entities/character-rank.entity';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';
import { FactionEntity } from 'src/sto/character/entities/faction.entity';
import { GeneralFactionEntity } from 'src/sto/character/entities/general-faction.entity';
import { RecruitTypeEntity } from 'src/sto/character/entities/recruit-type.entity';
import { SexEntity } from 'src/sto/character/entities/sex.entity';
import { SpeciesEntity } from 'src/sto/character/entities/species.entity';
import { AccountEndeavourProgressEntity } from 'src/sto/endeavour/entities/account-endeavour-progress.entity';
import { EndeavourPerkEntity } from 'src/sto/endeavour/entities/endeavour-perk.entity';
import { LauncherEntity } from 'src/sto/launcher/entities/launcher.entity';
import { PlatformEntity } from 'src/sto/platform/entities/platform.entity';
import { IsNull, Repository, SelectQueryBuilder } from 'typeorm';
import { CountItemDto, StatsResponseDto } from './dto/stats-response.dto';

/** Faction name used as the source of truth for level-range tier definitions. */
const LEVEL_RANGE_FACTION = 'Starfleet (2409)';

@Injectable()
export class StatsService {
  /**
   * Creates an instance of StatsService.
   *
   * @param _accountRepository - The account repository.
   * @param _characterRepository - The character repository.
   * @param _characterRankRepository - The character rank repository.
   */
  constructor(
    @InjectRepository(AccountEntity)
    private readonly _accountRepository: Repository<AccountEntity>,
    @InjectRepository(CharacterEntity)
    private readonly _characterRepository: Repository<CharacterEntity>,
    @InjectRepository(CharacterRankEntity)
    private readonly _characterRankRepository: Repository<CharacterRankEntity>,
    @InjectRepository(AccountEndeavourProgressEntity)
    private readonly _progressRepository: Repository<AccountEndeavourProgressEntity>,
    @InjectRepository(EndeavourPerkEntity)
    private readonly _endeavourPerkRepository: Repository<EndeavourPerkEntity>,
  ) {}

  /**
   * Returns pre-computed statistics for the authenticated user, aggregating
   * across all their STO accounts and characters.
   *
   * When `accountId` is supplied the stats are scoped to that single account.
   * The account must belong to the authenticated user; a
   * `NotFoundException` is thrown otherwise.
   *
   * @param userId Authenticated user ID.
   * @param accountId Optional account ID to scope the stats to a single account.
   * @returns Aggregated stats.
   */
  async getStats(
    userId: string,
    accountId?: string,
  ): Promise<StatsResponseDto> {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    let accountCount: number;
    let lifetimeSubCount: number;

    if (accountId) {
      const account = await this._accountRepository.findOne({
        where: { id: accountId, user: { id: userId } },
        select: { id: true, lifetimeSubscription: true },
      });
      if (!account) {
        throw new NotFoundException(`Account with ID "${accountId}" not found`);
      }
      accountCount = 1;
      lifetimeSubCount = account.lifetimeSubscription ? 1 : 0;
    } else {
      [accountCount, lifetimeSubCount] = await Promise.all([
        this._accountRepository.count({ where: { user: { id: userId } } }),
        this._accountRepository.count({
          where: { user: { id: userId }, lifetimeSubscription: true },
        }),
      ]);
    }

    const mgr = this._accountRepository.manager;

    const [
      levelStats,
      groupStats,
      byLevelRange,
      byPlatform,
      byLauncher,
      endeavourStats,
    ] = await Promise.all([
      this.getLevelStats(userId, accountId),
      this.getGroupStats(userId, accountId),
      this.getLevelRangeStats(userId, accountId),
      mgr
        .find(PlatformEntity, {
          where: { deletedAt: IsNull() },
          select: { name: true },
        })
        .then(es => es.map(e => e.name))
        .then(names =>
          this.getAccountGroupStats(userId, 'platform', 'p', names, accountId),
        ),
      mgr
        .find(LauncherEntity, {
          where: { deletedAt: IsNull() },
          select: { name: true },
        })
        .then(es => es.map(e => e.name))
        .then(names =>
          this.getAccountGroupStats(userId, 'launcher', 'l', names, accountId),
        ),
      this.getEndeavourStats(userId, accountId, accountCount),
    ]);

    return {
      accountCount,
      lifetimeSubCount,
      characterCount: levelStats.characterCount,
      avgLevel: levelStats.avgLevel,
      minLevel: levelStats.minLevel,
      maxLevel: levelStats.maxLevel,
      bySpecies: groupStats.bySpecies,
      byGeneralFaction: groupStats.byGeneralFaction,
      byFaction: groupStats.byFaction,
      byClass: groupStats.byClass,
      bySex: groupStats.bySex,
      byRecruitType: groupStats.byRecruitType,
      byLevelRange,
      byPlatform,
      byLauncher,
      ...endeavourStats,
    };
  }

  /**
   * Creates a QueryBuilder for the character table pre-filtered to the given
   * user's accounts and optionally scoped to a single account.
   *
   * Centralises the repeated `innerJoin + where + optional andWhere` setup
   * that every character sub-query requires.
   *
   * @param userId Owner user ID.
   * @param accountId Optional account ID to restrict to one account.
   * @returns A fluent QueryBuilder ready for further composition.
   */
  private characterBaseQb(
    userId: string,
    accountId?: string,
  ): SelectQueryBuilder<CharacterEntity> {
    const qb = this._characterRepository
      .createQueryBuilder('c')
      .innerJoin('c.account', 'a')
      .where('a.userId = :userId', { userId });

    if (accountId) {
      qb.andWhere('c.accountId = :accountId', { accountId });
    }

    return qb;
  }

  /**
   * Clones a character base query and adds a GROUP BY on a single relation,
   * returning raw `{ name, count }` rows sorted descending by count.
   *
   * Centralises the repeated clone → leftJoin → select → groupBy → orderBy
   * pattern used for each categorical character dimension.
   *
   * @param base Pre-built character QueryBuilder (see {@link characterBaseQb}).
   * @param join Relation path to left-join, e.g. `'c.species'`.
   * @param alias Query builder alias for the joined relation.
   * @returns Raw GROUP BY results sorted descending by count.
   */
  private characterDimensionQuery(
    base: SelectQueryBuilder<CharacterEntity>,
    join: string,
    alias: string,
  ): Promise<{ name: string; count: string }[]> {
    return base
      .clone()
      .leftJoin(join, alias)
      .select(
        `COALESCE(${alias}.name, 'Unknown') AS name, COUNT(c.id) AS count`,
      )
      .groupBy(`COALESCE(${alias}.name, 'Unknown')`)
      .orderBy('count', 'DESC')
      .getRawMany<{ name: string; count: string }>();
  }

  /**
   * Queries character level aggregates for all non-deleted characters belonging
   * to the user's accounts, optionally scoped to a single account.
   *
   * Returns zeroes for all fields when the user has no characters.
   *
   * @param userId Owner user ID.
   * @param accountId Optional account ID to restrict the query to one account.
   * @returns Total character count and avg/min/max level values.
   */
  private async getLevelStats(
    userId: string,
    accountId?: string,
  ): Promise<{
    characterCount: number;
    avgLevel: number;
    minLevel: number;
    maxLevel: number;
  }> {
    const qb = this.characterBaseQb(userId, accountId).select([
      'COUNT(c.id) AS "characterCount"',
      'ROUND(AVG(c.level) FILTER (WHERE c.level > 0)) AS "avgLevel"',
      'MIN(c.level) AS "minLevel"',
      'MAX(c.level) AS "maxLevel"',
    ]);

    const raw = await qb.getRawOne<{
      characterCount: string;
      avgLevel: string | null;
      minLevel: string | null;
      maxLevel: string | null;
    }>();

    const characterCount = Number(raw?.characterCount ?? 0);

    if (characterCount === 0) {
      return { characterCount: 0, avgLevel: 0, minLevel: 0, maxLevel: 0 };
    }

    return {
      characterCount,
      avgLevel: Math.round(Number(raw?.avgLevel ?? 0)),
      minLevel: Number(raw?.minLevel ?? 0),
      maxLevel: Number(raw?.maxLevel ?? 0),
    };
  }

  /**
   * Queries character counts grouped by each categorical dimension (species,
   * general faction, faction, class, sex, recruit type) for the user's
   * characters, optionally scoped to a single account. All twelve queries
   * (six aggregations, six reference lookups) run concurrently.
   *
   * Every value from the reference table is present in each group, with
   * `count: 0` for values the user has no characters for. Any aggregated name
   * not found in the reference table (e.g. `"Unknown"` for null relations)
   * is appended at the end. Results within each group are sorted descending
   * by count.
   *
   * @param userId Owner user ID.
   * @param accountId Optional account ID to restrict the query to one account.
   * @returns An object containing a sorted `CountItemDto[]` for each dimension.
   */
  private async getGroupStats(
    userId: string,
    accountId?: string,
  ): Promise<{
    bySpecies: CountItemDto[];
    byGeneralFaction: CountItemDto[];
    byFaction: CountItemDto[];
    byClass: CountItemDto[];
    bySex: CountItemDto[];
    byRecruitType: CountItemDto[];
  }> {
    const base = this.characterBaseQb(userId, accountId);
    const mgr = this._characterRepository.manager;

    const [
      bySpeciesRaw,
      byGeneralFactionRaw,
      byFactionRaw,
      byClassRaw,
      bySexRaw,
      byRecruitTypeRaw,
      allSpeciesNames,
      allGeneralFactionNames,
      allFactionNames,
      allClassNames,
      allSexNames,
      allRecruitTypeNames,
    ] = await Promise.all([
      this.characterDimensionQuery(base, 'c.species', 'species'),
      this.characterDimensionQuery(base, 'c.generalFaction', 'gf'),
      this.characterDimensionQuery(base, 'c.faction', 'f'),
      this.characterDimensionQuery(base, 'c.class', 'cls'),
      this.characterDimensionQuery(base, 'c.sex', 'sex'),
      this.characterDimensionQuery(base, 'c.recruitType', 'rt'),
      mgr
        .find(SpeciesEntity, { select: { name: true } })
        .then(es => es.map(e => e.name)),
      mgr
        .find(GeneralFactionEntity, { select: { name: true } })
        .then(es => es.map(e => e.name)),
      mgr
        .find(FactionEntity, { select: { name: true } })
        .then(es => es.map(e => e.name)),
      mgr
        .find(CharacterClassEntity, { select: { name: true } })
        .then(es => es.map(e => e.name)),
      mgr
        .find(SexEntity, { select: { name: true } })
        .then(es => es.map(e => e.name)),
      mgr
        .find(RecruitTypeEntity, { select: { name: true } })
        .then(es => es.map(e => e.name)),
    ]);

    return {
      bySpecies: this.mergeWithAllNames(bySpeciesRaw, allSpeciesNames),
      byGeneralFaction: this.mergeWithAllNames(
        byGeneralFactionRaw,
        allGeneralFactionNames,
      ),
      byFaction: this.mergeWithAllNames(byFactionRaw, allFactionNames),
      byClass: this.mergeWithAllNames(byClassRaw, allClassNames),
      bySex: this.mergeWithAllNames(bySexRaw, allSexNames),
      byRecruitType: this.mergeWithAllNames(
        byRecruitTypeRaw,
        allRecruitTypeNames,
      ),
    };
  }

  /**
   * Queries account counts grouped by a single account-level relation
   * (platform or launcher), optionally scoped to a single account.
   *
   * Every name in `allNames` is present in the result, with `count: 0` for
   * values the user has no accounts for. Results are sorted descending by
   * count.
   *
   * @param userId Owner user ID.
   * @param relation The relation name on `AccountEntity` to group by.
   * @param alias Query builder alias for the joined relation.
   * @param allNames All possible names for this dimension (for zero-filling).
   * @param accountId Optional account ID to restrict the query to one account.
   * @returns Sorted `CountItemDto[]` for the given dimension.
   */
  private async getAccountGroupStats(
    userId: string,
    relation: 'platform' | 'launcher',
    alias: string,
    allNames: string[],
    accountId?: string,
  ): Promise<CountItemDto[]> {
    const qb = this._accountRepository
      .createQueryBuilder('a')
      .leftJoin(`a.${relation}`, alias)
      .where('a.userId = :userId', { userId })
      .select(
        `COALESCE(${alias}.name, 'Unknown') AS name, COUNT(a.id) AS count`,
      )
      .groupBy(`COALESCE(${alias}.name, 'Unknown')`)
      .orderBy('count', 'DESC');

    if (accountId) {
      qb.andWhere('a.id = :accountId', { accountId });
    }

    const raw = await qb.getRawMany<{ name: string; count: string }>();

    return this.mergeWithAllNames(raw, allNames);
  }

  /**
   * Queries character counts bucketed into the rank tiers defined in the
   * `character_rank` table for the {@link LEVEL_RANGE_FACTION} faction,
   * optionally scoped to a single account.
   *
   * Tiers are loaded from the database and sorted ascending by `levelFrom`,
   * so the response automatically reflects any future changes to the rank
   * table without requiring a code change.
   *
   * Every tier is present in the result even if its count is 0. Characters
   * with a null level or a level that falls outside every defined tier are
   * excluded from all buckets.
   *
   * @param userId Owner user ID.
   * @param accountId Optional account ID to restrict the query to one account.
   * @returns `CountItemDto[]` sorted ascending by level tier.
   */
  private async getLevelRangeStats(
    userId: string,
    accountId?: string,
  ): Promise<CountItemDto[]> {
    const charQb = this.characterBaseQb(userId, accountId)
      .andWhere('c.level IS NOT NULL')
      .select(['c.level AS level', 'COUNT(c.id) AS count'])
      .groupBy('c.level');

    const [tiers, levelCounts] = await Promise.all([
      this._characterRankRepository
        .createQueryBuilder('cr')
        .innerJoin('cr.faction', 'f')
        .where('f.name = :name', { name: LEVEL_RANGE_FACTION })
        .select(['cr.levelFrom', 'cr.levelTo'])
        .orderBy('cr.levelFrom', 'ASC')
        .getMany(),
      charQb.getRawMany<{ level: string; count: string }>(),
    ]);

    const countByLevel = new Map(
      levelCounts.map(r => [Number(r.level), Number(r.count)]),
    );

    return tiers.map(tier => {
      let count = 0;
      for (let lvl = tier.levelFrom; lvl <= tier.levelTo; lvl++) {
        count += countByLevel.get(lvl) ?? 0;
      }
      const name =
        tier.levelFrom === tier.levelTo
          ? `Level ${tier.levelFrom}`
          : `Level ${tier.levelFrom} - ${tier.levelTo}`;
      return { name, count };
    });
  }

  /**
   * Queries endeavour node totals grouped by perk and by category (Space /
   * Ground) for the user's accounts, optionally scoped to a single account.
   *
   * Every known perk appears in `byEndeavourPerk` with a `count` of 0 when the
   * user has no progress for it.  Both categories always appear in
   * `byEndeavourCategory`.
   *
   * `endeavourMaxNodes` is the theoretical maximum: accountCount ×
   * sum-of-all-perk-maxNodes.
   *
   * @param userId Owner user ID.
   * @param accountId Optional account ID to restrict the query to one account.
   * @param accountCount Pre-computed number of accounts in scope.
   * @returns Aggregated endeavour stats.
   */
  private async getEndeavourStats(
    userId: string,
    accountId: string | undefined,
    accountCount: number,
  ): Promise<{
    endeavourTotalNodes: number;
    endeavourMaxNodes: number;
    byEndeavourPerk: CountItemDto[];
    byEndeavourPerkAvg: CountItemDto[];
    byEndeavourCategory: CountItemDto[];
    byEndeavourCategoryPct: CountItemDto[];
  }> {
    const allPerks = await this._endeavourPerkRepository.find({
      select: { name: true, category: true, maxNodes: true, sortOrder: true },
      order: { sortOrder: 'ASC' },
    });

    const qb = this._progressRepository
      .createQueryBuilder('aep')
      .innerJoin('aep.account', 'a')
      .where('a.userId = :userId', { userId });

    if (accountId) {
      qb.andWhere('a.id = :accountId', { accountId });
    }

    const [byPerkRaw, byCategoryRaw, activeAccountCountRaw] = await Promise.all(
      [
        qb
          .clone()
          .innerJoin('aep.endeavourPerk', 'ep')
          .select(['ep.name AS name', 'SUM(aep.currentNodes) AS count'])
          .groupBy('ep.id, ep.name')
          .getRawMany<{ name: string; count: string }>(),
        qb
          .clone()
          .innerJoin('aep.endeavourPerk', 'ep')
          .select(['ep.category AS name', 'SUM(aep.currentNodes) AS count'])
          .groupBy('ep.category')
          .getRawMany<{ name: string; count: string }>(),
        qb
          .clone()
          .select('COUNT(DISTINCT aep.accountId) AS "activeCount"')
          .getRawOne<{ activeCount: string }>(),
      ],
    );

    // Only count accounts that have at least one endeavour record — accounts
    // below level 60 haven't unlocked the system and would skew averages down.
    const activeAccountCount = Number(activeAccountCountRaw?.activeCount ?? 0);

    const totalNodes = byPerkRaw.reduce((sum, r) => sum + Number(r.count), 0);
    const totalPerkMaxNodes = allPerks.reduce((sum, p) => sum + p.maxNodes, 0);

    const categoryMaxPerAccount = new Map<string, number>([
      [
        'Space',
        allPerks
          .filter(p => p.category === 'Space')
          .reduce((sum, p) => sum + p.maxNodes, 0),
      ],
      [
        'Ground',
        allPerks
          .filter(p => p.category === 'Ground')
          .reduce((sum, p) => sum + p.maxNodes, 0),
      ],
    ]);

    const byEndeavourPerkAvg: CountItemDto[] = this.mergeWithAllNames(
      byPerkRaw.map(r => ({
        name: r.name,
        count: String(
          activeAccountCount > 0
            ? Math.round(Number(r.count) / activeAccountCount)
            : 0,
        ),
      })),
      allPerks.map(p => p.name),
    );

    const byEndeavourCategoryPct: CountItemDto[] = ['Space', 'Ground'].map(
      cat => {
        const maxPerAccount = categoryMaxPerAccount.get(cat) ?? 0;
        const totalCatNodes = Number(
          byCategoryRaw.find(r => r.name === cat)?.count ?? 0,
        );
        const maxPossible = activeAccountCount * maxPerAccount;
        return {
          name: cat,
          count:
            maxPossible > 0
              ? Math.round((totalCatNodes / maxPossible) * 100)
              : 0,
        };
      },
    );

    return {
      endeavourTotalNodes: totalNodes,
      endeavourMaxNodes: accountCount * totalPerkMaxNodes,
      byEndeavourPerk: this.mergeWithAllNames(
        byPerkRaw,
        allPerks.map(p => p.name),
      ),
      byEndeavourPerkAvg,
      byEndeavourCategory: this.mergeWithAllNames(byCategoryRaw, [
        'Space',
        'Ground',
      ]),
      byEndeavourCategoryPct,
    };
  }

  /**
   * Merges aggregated GROUP BY results with the full set of known reference
   * names, ensuring every reference value appears in the output even with a
   * `count` of 0.
   *
   * Any aggregated name not present in `allNames` (e.g. `"Unknown"` produced
   * by `COALESCE` for null relations) is appended after the reference entries.
   * The final array is sorted descending by count.
   *
   * @param raw Raw GROUP BY results with string `count` values.
   * @param allNames All known reference names for this dimension.
   * @returns Merged and sorted `CountItemDto[]`.
   */
  private mergeWithAllNames(
    raw: { name: string; count: string }[],
    allNames: string[],
  ): CountItemDto[] {
    const countMap = new Map(raw.map(r => [r.name, Number(r.count)]));
    const knownNames = new Set(allNames);

    const result: CountItemDto[] = allNames.map(name => ({
      name,
      count: countMap.get(name) ?? 0,
    }));

    for (const r of raw) {
      if (!knownNames.has(r.name)) {
        result.push({ name: r.name, count: Number(r.count) });
      }
    }

    return result.sort((a, b) => b.count - a.count);
  }
}
