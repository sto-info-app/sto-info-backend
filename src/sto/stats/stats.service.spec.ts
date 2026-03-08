import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AccountEntity } from 'src/sto/account/entities/account.entity';
import { CharacterRankEntity } from 'src/sto/character/entities/character-rank.entity';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';
import { StatsService } from './stats.service';

/** Returns a fully-chainable query-builder stub. */
function makeQb(terminalOverrides: Record<string, jest.Mock> = {}) {
  return {
    innerJoin: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    clone: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue(null),
    getRawMany: jest.fn().mockResolvedValue([]),
    getMany: jest.fn().mockResolvedValue([]),
    ...terminalOverrides,
  };
}

/**
 * Reference data returned by manager.find() calls, keyed by entity class name.
 * The service queries these to zero-fill group-by dimensions.
 */
const REFERENCE_DATA: Record<string, Array<{ name: string }>> = {
  SpeciesEntity: [{ name: 'Human' }],
  GeneralFactionEntity: [{ name: 'Federation' }],
  FactionEntity: [{ name: 'Starfleet (2409)' }],
  CharacterClassEntity: [{ name: 'Tactical' }],
  SexEntity: [{ name: 'Male' }],
  RecruitTypeEntity: [{ name: 'Standard' }],
  PlatformEntity: [{ name: 'PC' }],
  LauncherEntity: [{ name: 'Arc' }],
};

describe('StatsService', () => {
  let service: StatsService;

  // Repository references exposed for assertions
  let accountRepository: any;
  let characterRepository: any;
  let characterRankRepository: any;

  // Query-builder stubs created fresh for each test
  let levelStatsQb: ReturnType<typeof makeQb>;
  let groupStatsQb: ReturnType<typeof makeQb>;
  let levelRangeCharQb: ReturnType<typeof makeQb>;
  let rankQb: ReturnType<typeof makeQb>;
  let accountQb: ReturnType<typeof makeQb>;

  beforeEach(async () => {
    /*
     * Build QB stubs.
     *
     * characterRepository.createQueryBuilder is called in this order
     * during a single getStats() invocation (synchronous QB setup inside
     * Promise.all entries executes in array order):
     *   call 1 → getLevelStats      → levelStatsQb  (uses getRawOne)
     *   call 2 → getGroupStats      → groupStatsQb  (uses clone + getRawMany ×6)
     *   call 3 → getLevelRangeStats → levelRangeCharQb (uses getRawMany)
     */
    levelStatsQb = makeQb({
      getRawOne: jest.fn().mockResolvedValue({
        characterCount: '5',
        avgLevel: '40',
        minLevel: '10',
        maxLevel: '65',
      }),
    });

    groupStatsQb = makeQb({
      getRawMany: jest.fn().mockResolvedValue([]),
    });

    levelRangeCharQb = makeQb({
      getRawMany: jest.fn().mockResolvedValue([]),
    });

    rankQb = makeQb({
      getMany: jest.fn().mockResolvedValue([
        { levelFrom: 1, levelTo: 9 },
        { levelFrom: 10, levelTo: 19 },
      ]),
    });

    accountQb = makeQb({
      getRawMany: jest.fn().mockResolvedValue([]),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StatsService,
        {
          provide: getRepositoryToken(AccountEntity),
          useValue: {
            count: jest.fn().mockResolvedValue(2),
            findOne: jest.fn().mockResolvedValue(null),
            createQueryBuilder: jest.fn(),
            manager: {
              find: jest
                .fn()
                .mockImplementation((entity: any) =>
                  Promise.resolve(REFERENCE_DATA[entity.name as string] ?? []),
                ),
            },
          },
        },
        {
          provide: getRepositoryToken(CharacterEntity),
          useValue: {
            createQueryBuilder: jest.fn(),
            manager: {
              find: jest
                .fn()
                .mockImplementation((entity: any) =>
                  Promise.resolve(REFERENCE_DATA[entity.name as string] ?? []),
                ),
            },
          },
        },
        {
          provide: getRepositoryToken(CharacterRankEntity),
          useValue: {
            createQueryBuilder: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<StatsService>(StatsService);
    accountRepository = module.get(getRepositoryToken(AccountEntity));
    characterRepository = module.get(getRepositoryToken(CharacterEntity));
    characterRankRepository = module.get(
      getRepositoryToken(CharacterRankEntity),
    );

    // Wire up QB factories with per-call returns in execution order
    (characterRepository.createQueryBuilder as jest.Mock)
      .mockReturnValueOnce(levelStatsQb)
      .mockReturnValueOnce(groupStatsQb)
      .mockReturnValueOnce(levelRangeCharQb);

    (characterRankRepository.createQueryBuilder as jest.Mock).mockReturnValue(
      rankQb,
    );

    (accountRepository.createQueryBuilder as jest.Mock).mockReturnValue(
      accountQb,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // getStats – top-level branching
  // ---------------------------------------------------------------------------

  describe('getStats', () => {
    it('should throw BadRequestException when userId is empty', async () => {
      await expect(service.getStats('')).rejects.toThrow(BadRequestException);
    });

    it('should use count queries when no accountId is provided', async () => {
      accountRepository.count
        .mockResolvedValueOnce(3) // total accounts
        .mockResolvedValueOnce(1); // lifetime subscribers

      const result = await service.getStats('user-1');

      expect(accountRepository.count).toHaveBeenCalledTimes(2);
      expect(result.accountCount).toBe(3);
      expect(result.lifetimeSubCount).toBe(1);
      expect(accountRepository.findOne).not.toHaveBeenCalled();
    });

    it('should use findOne when an accountId is provided', async () => {
      accountRepository.findOne.mockResolvedValue({
        id: 'acc-1',
        lifetimeSubscription: true,
      });

      const result = await service.getStats('user-1', 'acc-1');

      expect(accountRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'acc-1', user: { id: 'user-1' } },
        select: { id: true, lifetimeSubscription: true },
      });
      expect(accountRepository.count).not.toHaveBeenCalled();
      expect(result.accountCount).toBe(1);
      expect(result.lifetimeSubCount).toBe(1);
    });

    it('should throw NotFoundException when the accountId does not belong to the user', async () => {
      accountRepository.findOne.mockResolvedValue(null);

      await expect(service.getStats('user-1', 'unknown-acc')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should set lifetimeSubCount to 0 when the account has no lifetime subscription', async () => {
      accountRepository.findOne.mockResolvedValue({
        id: 'acc-1',
        lifetimeSubscription: false,
      });

      const result = await service.getStats('user-1', 'acc-1');

      expect(result.lifetimeSubCount).toBe(0);
    });

    it('should return a fully populated stats object', async () => {
      const result = await service.getStats('user-1');

      expect(result).toMatchObject({
        accountCount: expect.any(Number),
        lifetimeSubCount: expect.any(Number),
        characterCount: expect.any(Number),
        avgLevel: expect.any(Number),
        minLevel: expect.any(Number),
        maxLevel: expect.any(Number),
        bySpecies: expect.any(Array),
        byGeneralFaction: expect.any(Array),
        byFaction: expect.any(Array),
        byClass: expect.any(Array),
        bySex: expect.any(Array),
        byRecruitType: expect.any(Array),
        byLevelRange: expect.any(Array),
        byPlatform: expect.any(Array),
        byLauncher: expect.any(Array),
      });
    });
  });

  // ---------------------------------------------------------------------------
  // getLevelStats (exercised via getStats)
  // ---------------------------------------------------------------------------

  describe('getLevelStats', () => {
    it('should return zeros for all level fields when the user has no characters', async () => {
      levelStatsQb.getRawOne.mockResolvedValue({
        characterCount: '0',
        avgLevel: null,
        minLevel: null,
        maxLevel: null,
      });

      const result = await service.getStats('user-1');

      expect(result.characterCount).toBe(0);
      expect(result.avgLevel).toBe(0);
      expect(result.minLevel).toBe(0);
      expect(result.maxLevel).toBe(0);
    });

    it('should return correct aggregated level stats when characters exist', async () => {
      levelStatsQb.getRawOne.mockResolvedValue({
        characterCount: '8',
        avgLevel: '42.5',
        minLevel: '5',
        maxLevel: '65',
      });

      const result = await service.getStats('user-1');

      expect(result.characterCount).toBe(8);
      expect(result.avgLevel).toBe(43); // Math.round(42.5)
      expect(result.minLevel).toBe(5);
      expect(result.maxLevel).toBe(65);
    });

    it('should return 0 for avgLevel when the FILTER eliminates all rows', async () => {
      levelStatsQb.getRawOne.mockResolvedValue({
        characterCount: '3',
        avgLevel: null,
        minLevel: '0',
        maxLevel: '0',
      });

      const result = await service.getStats('user-1');

      expect(result.characterCount).toBe(3);
      expect(result.avgLevel).toBe(0);
    });

    it('should return zeros when getRawOne returns undefined', async () => {
      levelStatsQb.getRawOne.mockResolvedValue(undefined);

      const result = await service.getStats('user-1');

      expect(result.characterCount).toBe(0);
      expect(result.avgLevel).toBe(0);
    });

    it('should return 0 for minLevel and maxLevel when they are null', async () => {
      levelStatsQb.getRawOne.mockResolvedValue({
        characterCount: '3',
        avgLevel: '20',
        minLevel: null,
        maxLevel: null,
      });

      const result = await service.getStats('user-1');

      expect(result.minLevel).toBe(0);
      expect(result.maxLevel).toBe(0);
    });

    it('should scope the level stats query to the given account', async () => {
      accountRepository.findOne.mockResolvedValue({
        id: 'acc-1',
        lifetimeSubscription: false,
      });

      await service.getStats('user-1', 'acc-1');

      expect(levelStatsQb.andWhere).toHaveBeenCalledWith(
        'c.accountId = :accountId',
        { accountId: 'acc-1' },
      );
    });
  });

  // ---------------------------------------------------------------------------
  // getLevelRangeStats (exercised via getStats)
  // ---------------------------------------------------------------------------

  describe('getLevelRangeStats', () => {
    it('should format single-level tiers as "Level X"', async () => {
      rankQb.getMany.mockResolvedValue([{ levelFrom: 1, levelTo: 1 }]);
      levelRangeCharQb.getRawMany.mockResolvedValue([]);

      const result = await service.getStats('user-1');

      expect(result.byLevelRange).toEqual([{ name: 'Level 1', count: 0 }]);
    });

    it('should format multi-level tiers as "Level X - Y"', async () => {
      rankQb.getMany.mockResolvedValue([{ levelFrom: 1, levelTo: 9 }]);
      levelRangeCharQb.getRawMany.mockResolvedValue([]);

      const result = await service.getStats('user-1');

      expect(result.byLevelRange).toEqual([{ name: 'Level 1 - 9', count: 0 }]);
    });

    it('should sum character counts across all levels within a tier', async () => {
      rankQb.getMany.mockResolvedValue([{ levelFrom: 1, levelTo: 5 }]);
      levelRangeCharQb.getRawMany.mockResolvedValue([
        { level: '1', count: '2' },
        { level: '3', count: '3' },
        { level: '5', count: '1' },
      ]);

      const result = await service.getStats('user-1');

      expect(result.byLevelRange).toEqual([{ name: 'Level 1 - 5', count: 6 }]);
    });

    it('should return count 0 for tiers that contain no characters', async () => {
      rankQb.getMany.mockResolvedValue([
        { levelFrom: 1, levelTo: 5 },
        { levelFrom: 6, levelTo: 10 },
      ]);
      levelRangeCharQb.getRawMany.mockResolvedValue([
        { level: '3', count: '4' },
      ]);

      const result = await service.getStats('user-1');

      expect(result.byLevelRange).toEqual([
        { name: 'Level 1 - 5', count: 4 },
        { name: 'Level 6 - 10', count: 0 },
      ]);
    });

    it('should exclude character levels that fall outside every defined tier', async () => {
      rankQb.getMany.mockResolvedValue([{ levelFrom: 10, levelTo: 20 }]);
      levelRangeCharQb.getRawMany.mockResolvedValue([
        { level: '5', count: '2' }, // below tier
        { level: '15', count: '3' }, // inside tier
        { level: '25', count: '1' }, // above tier
      ]);

      const result = await service.getStats('user-1');

      expect(result.byLevelRange).toEqual([
        { name: 'Level 10 - 20', count: 3 },
      ]);
    });

    it('should scope the level range query to the given account', async () => {
      accountRepository.findOne.mockResolvedValue({
        id: 'acc-1',
        lifetimeSubscription: false,
      });

      await service.getStats('user-1', 'acc-1');

      expect(levelRangeCharQb.andWhere).toHaveBeenCalledWith(
        'c.accountId = :accountId',
        { accountId: 'acc-1' },
      );
    });
  });

  // ---------------------------------------------------------------------------
  // getGroupStats / mergeWithAllNames (exercised via getStats)
  // ---------------------------------------------------------------------------

  describe('getGroupStats', () => {
    it('should zero-fill a reference name that has no characters', async () => {
      // getRawMany returns no rows; reference data has 'Human' for species
      groupStatsQb.getRawMany.mockResolvedValue([]);

      const result = await service.getStats('user-1');

      expect(result.bySpecies).toContainEqual({ name: 'Human', count: 0 });
    });

    it('should include the count for a reference name that appears in the query results', async () => {
      groupStatsQb.getRawMany
        .mockResolvedValueOnce([{ name: 'Human', count: '7' }]) // bySpecies
        .mockResolvedValue([]);

      const result = await service.getStats('user-1');

      expect(result.bySpecies).toContainEqual({ name: 'Human', count: 7 });
    });

    it('should append aggregated names that are absent from the reference list', async () => {
      // 'Unknown' is not in the SpeciesEntity reference data
      groupStatsQb.getRawMany
        .mockResolvedValueOnce([{ name: 'Unknown', count: '2' }]) // bySpecies
        .mockResolvedValue([]);

      const result = await service.getStats('user-1');

      expect(result.bySpecies.map(r => r.name)).toContain('Unknown');
    });

    it('should sort results by count descending', async () => {
      groupStatsQb.getRawMany
        .mockResolvedValueOnce([
          { name: 'Vulcan', count: '1' },
          { name: 'Human', count: '5' },
        ]) // bySpecies
        .mockResolvedValue([]);

      const result = await service.getStats('user-1');

      const counts = result.bySpecies.map(r => r.count);
      expect(counts).toEqual([...counts].sort((a, b) => b - a));
    });

    it('should scope character group queries to the given account', async () => {
      accountRepository.findOne.mockResolvedValue({
        id: 'acc-1',
        lifetimeSubscription: false,
      });

      await service.getStats('user-1', 'acc-1');

      expect(groupStatsQb.andWhere).toHaveBeenCalledWith(
        'c.accountId = :accountId',
        { accountId: 'acc-1' },
      );
    });
  });

  // ---------------------------------------------------------------------------
  // getAccountGroupStats (exercised via getStats)
  // ---------------------------------------------------------------------------

  describe('getAccountGroupStats', () => {
    it('should zero-fill a reference name that has no matching accounts', async () => {
      // accountQb.getRawMany returns no rows; reference data has 'PC' for platform
      accountQb.getRawMany.mockResolvedValue([]);

      const result = await service.getStats('user-1');

      expect(result.byPlatform).toContainEqual({ name: 'PC', count: 0 });
    });

    it('should scope account group queries to the given account', async () => {
      accountRepository.findOne.mockResolvedValue({
        id: 'acc-1',
        lifetimeSubscription: false,
      });

      await service.getStats('user-1', 'acc-1');

      expect(accountQb.andWhere).toHaveBeenCalledWith('a.id = :accountId', {
        accountId: 'acc-1',
      });
    });
  });
});
