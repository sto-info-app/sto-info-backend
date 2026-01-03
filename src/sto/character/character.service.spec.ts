import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountEntity } from '../account/entities/account.entity';
import { CharacterService } from './character.service';
import { CharacterClassEntity } from './entities/character-class.entity';
import { CharacterEntity } from './entities/character.entity';
import { FactionEntity } from './entities/faction.entity';
import { GeneralFactionEntity } from './entities/general-faction.entity';
import { RecruitTypeEntity } from './entities/recruit-type.entity';
import { SexEntity } from './entities/sex.entity';
import { SpeciesEntity } from './entities/species.entity';

describe('CharacterService', () => {
  let service: CharacterService;
  let characterRepository: Repository<CharacterEntity>;
  let accountRepository: Repository<AccountEntity>;
  let generalFactionRepository: Repository<GeneralFactionEntity>;
  let factionRepository: Repository<FactionEntity>;
  let sexRepository: Repository<SexEntity>;
  let classRepository: Repository<CharacterClassEntity>;
  let recruitTypeRepository: Repository<RecruitTypeEntity>;
  let speciesRepository: Repository<SpeciesEntity>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CharacterService,
        {
          provide: getRepositoryToken(CharacterEntity),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            softDelete: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(AccountEntity),
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(GeneralFactionEntity),
          useValue: {
            find: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(FactionEntity),
          useValue: {
            find: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(SexEntity),
          useValue: {
            find: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(CharacterClassEntity),
          useValue: {
            find: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(RecruitTypeEntity),
          useValue: {
            find: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(SpeciesEntity),
          useValue: {
            find: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<CharacterService>(CharacterService);
    characterRepository = module.get<Repository<CharacterEntity>>(
      getRepositoryToken(CharacterEntity),
    );
    accountRepository = module.get<Repository<AccountEntity>>(
      getRepositoryToken(AccountEntity),
    );
    generalFactionRepository = module.get<Repository<GeneralFactionEntity>>(
      getRepositoryToken(GeneralFactionEntity),
    );
    factionRepository = module.get<Repository<FactionEntity>>(
      getRepositoryToken(FactionEntity),
    );
    sexRepository = module.get<Repository<SexEntity>>(
      getRepositoryToken(SexEntity),
    );
    classRepository = module.get<Repository<CharacterClassEntity>>(
      getRepositoryToken(CharacterClassEntity),
    );
    recruitTypeRepository = module.get<Repository<RecruitTypeEntity>>(
      getRepositoryToken(RecruitTypeEntity),
    );
    speciesRepository = module.get<Repository<SpeciesEntity>>(
      getRepositoryToken(SpeciesEntity),
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    const createDto = {
      accountId: 'account-1',
      name: 'Char1',
      generalFactionId: 'gen-1',
      factionId: 'fac-1',
      sexId: 'sex-1',
      classId: 'class-1',
      speciesId: 'spec-1',
    };

    it('should create and save a new character', async () => {
      const account = { id: 'account-1', userId: 'user-1', handle: 'Handle' };
      const character = { id: 'char-1', ...createDto, handle: 'Char1@Handle' };

      (accountRepository.findOne as jest.Mock).mockResolvedValue(account);
      (characterRepository.findOne as jest.Mock).mockResolvedValue(null);
      (characterRepository.create as jest.Mock).mockReturnValue(character);
      (characterRepository.save as jest.Mock).mockResolvedValue(character);

      const result = await service.create(createDto as any, 'user-1');

      expect(result).toEqual(character);
      expect(characterRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          handle: 'Char1@Handle',
          nameNormalized: 'char1',
        }),
      );
      expect(characterRepository.save).toHaveBeenCalled();
    });

    it('should throw ForbiddenException if account is not owned by user', async () => {
      (accountRepository.findOne as jest.Mock).mockResolvedValue({
        id: 'account-1',
        userId: 'other',
      });

      await expect(service.create(createDto as any, 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw ConflictException if character name already exists for account', async () => {
      (accountRepository.findOne as jest.Mock).mockResolvedValue({
        id: 'account-1',
        userId: 'user-1',
      });
      (characterRepository.findOne as jest.Mock).mockResolvedValue({
        id: 'existing',
      });

      await expect(service.create(createDto as any, 'user-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw NotFoundException if account does not exist', async () => {
      (accountRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.create(createDto as any, 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw InternalServerErrorException if save fails', async () => {
      const account = { id: 'account-1', userId: 'user-1', handle: 'Handle' };
      (accountRepository.findOne as jest.Mock).mockResolvedValue(account);
      (characterRepository.findOne as jest.Mock).mockResolvedValue(null);
      (characterRepository.save as jest.Mock).mockRejectedValue(
        new Error('Save failed'),
      );

      await expect(service.create(createDto as any, 'user-1')).rejects.toThrow(
        'Failed to save a new character',
      );
    });
  });

  describe('findAllForAccount', () => {
    it('should return all characters for an account', async () => {
      const account = { id: 'account-1', userId: 'user-1' };
      const characters = [{ id: 'char-1' }];

      (accountRepository.findOne as jest.Mock).mockResolvedValue(account);
      (characterRepository.find as jest.Mock).mockResolvedValue(characters);

      const result = await service.findAllForAccount('account-1', 'user-1');
      expect(result).toEqual(characters);
      expect(characterRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { accountId: 'account-1' },
          relations: expect.arrayContaining([
            'generalFaction',
            'faction',
            'species',
          ]),
        }),
      );
    });
  });

  describe('findOneForUser', () => {
    it('should return an owned character', async () => {
      const character = { id: 'char-1', account: { userId: 'user-1' } };
      (characterRepository.findOne as jest.Mock).mockResolvedValue(character);

      const result = await service.findOneForUser('char-1', 'user-1');
      expect(result).toEqual(character);
    });

    it('should throw NotFoundException if character does not exist', async () => {
      (characterRepository.findOne as jest.Mock).mockResolvedValue(null);
      await expect(service.findOneForUser('char-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException if character is not owned by user', async () => {
      const character = { id: 'char-1', account: { userId: 'other' } };
      (characterRepository.findOne as jest.Mock).mockResolvedValue(character);

      await expect(service.findOneForUser('char-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('updateForUser', () => {
    it('should update an owned character', async () => {
      const character = {
        id: 'char-1',
        name: 'Old',
        accountId: 'acc-1',
        account: { handle: 'Acc', userId: 'user-1' },
      };
      const updateDto = { name: 'New' };

      (characterRepository.findOne as jest.Mock)
        .mockResolvedValueOnce(character) // For findOneForUser
        .mockResolvedValueOnce(null); // For assertNameUniqueForAccount
      (characterRepository.save as jest.Mock).mockImplementation(val =>
        Promise.resolve(val),
      );

      const result = await service.updateForUser(
        'char-1',
        'user-1',
        updateDto as any,
      );
      expect(result.name).toBe('New');
      expect(result.handle).toBe('New@Acc');
      expect(characterRepository.save).toHaveBeenCalled();
    });

    it('should skip name uniqueness check if name is same', async () => {
      const character = {
        id: 'char-1',
        name: 'Same',
        accountId: 'acc-1',
        account: { handle: 'Acc', userId: 'user-1' },
      };
      const updateDto = { name: 'Same', notes: 'new notes' };

      (characterRepository.findOne as jest.Mock).mockResolvedValue(character);
      (characterRepository.save as jest.Mock).mockImplementation(val =>
        Promise.resolve(val),
      );

      await service.updateForUser('char-1', 'user-1', updateDto as any);
      expect(characterRepository.findOne).toHaveBeenCalledTimes(1); // Only for findOneForUser
      expect(characterRepository.save).toHaveBeenCalled();
    });

    it('should handle partial updates without name', async () => {
      const character = {
        id: 'char-1',
        name: 'Same',
        accountId: 'acc-1',
        account: { handle: 'Acc', userId: 'user-1' },
      };
      const updateDto = { notes: 'only notes' };

      (characterRepository.findOne as jest.Mock).mockResolvedValue(character);
      (characterRepository.save as jest.Mock).mockImplementation(val =>
        Promise.resolve(val),
      );

      await service.updateForUser('char-1', 'user-1', updateDto as any);
      expect(characterRepository.findOne).toHaveBeenCalledTimes(1);
      expect(characterRepository.save).toHaveBeenCalled();
    });
  });

  describe('removeForUser', () => {
    it('should soft delete an owned character', async () => {
      const character = { id: 'char-1', account: { userId: 'user-1' } };
      (characterRepository.findOne as jest.Mock).mockResolvedValue(character);
      (characterRepository.softDelete as jest.Mock).mockResolvedValue({
        affected: 1,
      });

      await service.removeForUser('char-1', 'user-1');
      expect(characterRepository.softDelete).toHaveBeenCalledWith('char-1');
    });
  });

  describe('Reference Data Lookups', () => {
    it('should get general factions', async () => {
      const data = [{ name: 'Fed' }];
      (generalFactionRepository.find as jest.Mock).mockResolvedValue(data);
      expect(await service.getGeneralFactions()).toEqual(data);
    });

    it('should get factions', async () => {
      const data = [{ name: 'Fac' }];
      (factionRepository.find as jest.Mock).mockResolvedValue(data);
      expect(await service.getFactions()).toEqual(data);
    });

    it('should get sexes', async () => {
      const data = [{ name: 'Male' }];
      (sexRepository.find as jest.Mock).mockResolvedValue(data);
      expect(await service.getSexes()).toEqual(data);
    });

    it('should get classes', async () => {
      const data = [{ name: 'Tac' }];
      (classRepository.find as jest.Mock).mockResolvedValue(data);
      expect(await service.getClasses()).toEqual(data);
    });

    it('should get recruit types', async () => {
      const data = [{ name: 'Std' }];
      (recruitTypeRepository.find as jest.Mock).mockResolvedValue(data);
      expect(await service.getRecruitTypes()).toEqual(data);
    });

    describe('getSpecies', () => {
      let queryBuilder: any;

      beforeEach(() => {
        queryBuilder = {
          innerJoin: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([{ name: 'Human' }]),
        };
        (speciesRepository.createQueryBuilder as jest.Mock).mockReturnValue(
          queryBuilder,
        );
      });

      it('should get all species when no filters', async () => {
        const result = await service.getSpecies();
        expect(result).toEqual([{ name: 'Human' }]);
        expect(queryBuilder.innerJoin).not.toHaveBeenCalled();
      });

      it('should filter by factionId', async () => {
        await service.getSpecies('fac-1');
        expect(queryBuilder.innerJoin).toHaveBeenCalledWith(
          'species.factions',
          'faction',
          'faction.id = :factionId',
          { factionId: 'fac-1' },
        );
      });

      it('should filter by recruitTypeId', async () => {
        await service.getSpecies(undefined, 'rec-1');
        expect(queryBuilder.innerJoin).toHaveBeenCalledWith(
          'species.recruitTypes',
          'recruitType',
          'recruitType.id = :recruitTypeId',
          { recruitTypeId: 'rec-1' },
        );
      });

      it('should filter by both', async () => {
        await service.getSpecies('fac-1', 'rec-1');
        expect(queryBuilder.innerJoin).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('assertNameUniqueForAccount (private)', () => {
    it('should return early if name is not provided', async () => {
      // We can trigger this via create/update if we bypass DTO validation in tests
      // To trigger !name, we'd need to call it with undefined.
      // In updateForUser, it's only called if name is provided.
      // But we can test it specifically if we want 100%.
      // I'll add a helper to access private for coverage if needed, or just call it through a proxy.
      await (service as any).assertNameUniqueForAccount('acc-1', undefined);
      expect(characterRepository.findOne).not.toHaveBeenCalled();
    });
  });
});
