import { jest } from '@jest/globals';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ImageUploadsService } from 'src/shared/utilities/image-uploads.service';
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
  let imageUploadsService: ImageUploadsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CharacterService,
        {
          provide: getRepositoryToken(CharacterEntity),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            update: jest.fn(),
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
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(FactionEntity),
          useValue: {
            find: jest.fn(),
            createQueryBuilder: jest.fn(),
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
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(SpeciesEntity),
          useValue: {
            find: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: ImageUploadsService,
          useValue: {
            uploadImageToCloudflareImages: jest.fn(),
            deleteImageFromCloudflareImages: jest.fn(),
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
    imageUploadsService = module.get<ImageUploadsService>(ImageUploadsService);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    const createDto = {
      accountId: 'account-1',
      handle: 'Char1',
      generalFactionId: 'gen-1',
      factionId: 'fac-1',
      sexId: 'sex-1',
      classId: 'class-1',
      speciesId: 'spec-1',
    };

    it('should create and save a new character', async () => {
      const account = { id: 'account-1', userId: 'user-1', handle: 'Handle' };
      const character = {
        id: 'char-1',
        ...createDto,
        fullHandle: 'Char1@Handle',
      };

      (
        accountRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(account);
      (
        characterRepository.findOne as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue(null);
      (characterRepository.create as jest.Mock).mockReturnValue(character);
      (
        characterRepository.save as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(character);

      const result = await service.create(createDto as any, 'user-1');

      expect(result).toEqual(character);
      expect(characterRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          fullHandle: 'Char1@Handle',
          fullHandleNormalized: 'char1@handle',
          fullHandleSlug: 'Char1@Handle',
        }),
      );
      expect(characterRepository.save).toHaveBeenCalled();
    });

    it('should throw ForbiddenException if account is not owned by user', async () => {
      (
        accountRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({
        id: 'account-1',
        userId: 'other',
      });

      await expect(service.create(createDto as any, 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw ConflictException if character handle already exists for account', async () => {
      (
        accountRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({
        id: 'account-1',
        userId: 'user-1',
      });
      (
        characterRepository.findOne as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue({
        id: 'existing',
      });

      await expect(service.create(createDto as any, 'user-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw NotFoundException if account does not exist', async () => {
      (
        accountRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(null);

      await expect(service.create(createDto as any, 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw InternalServerErrorException if save fails', async () => {
      const account = { id: 'account-1', userId: 'user-1', handle: 'Handle' };
      (
        accountRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(account);
      (
        characterRepository.findOne as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue(null);
      (
        characterRepository.save as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockRejectedValue(new Error('Save failed'));

      await expect(service.create(createDto as any, 'user-1')).rejects.toThrow(
        'Failed to save a new character',
      );
    });

    it('should throw BadRequestException if dto is missing', async () => {
      await expect(service.create(null as any, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if accountId is missing', async () => {
      await expect(service.create({} as any, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if userId is missing', async () => {
      await expect(service.create(createDto as any, '')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('findAllForAccount', () => {
    it('should return all characters for an account', async () => {
      const account = { id: 'account-1', userId: 'user-1' };
      const characters = [{ id: 'char-1' }];

      (
        accountRepository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(account);
      (
        characterRepository.find as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(characters);

      const result = await service.findAllForAccount('account-1', 'user-1');
      expect(result).toEqual(characters);
      expect(characterRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { accountId: 'account-1' },
          relations: expect.objectContaining({
            generalFaction: true,
            faction: expect.objectContaining({ ranks: true }),
            species: true,
          }),
        }),
      );
    });

    it('should throw BadRequestException if accountId is missing', async () => {
      await expect(service.findAllForAccount('', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if userId is missing', async () => {
      await expect(service.findAllForAccount('acc-1', '')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('findOneBySlug', () => {
    it('should return a character by slug', async () => {
      const character = { id: 'char-1', fullHandleSlug: 'Char~1234@Acc' };
      (
        characterRepository.findOne as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue(character);

      const result = await service.findOneBySlug('Char~1234@Acc');

      expect(result).toEqual(character);
      expect(characterRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { fullHandleSlug: 'Char~1234@Acc' },
          relations: expect.objectContaining({
            account: true,
            species: true,
          }),
        }),
      );
    });

    it('should return null if character not found by slug', async () => {
      (
        characterRepository.findOne as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue(null);

      const result = await service.findOneBySlug('non-existent');

      expect(result).toBeNull();
    });

    it('should throw BadRequestException if slug is missing', async () => {
      await expect(service.findOneBySlug('')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('findOneForUser', () => {
    it('should return an owned character', async () => {
      const character = { id: 'char-1', account: { userId: 'user-1' } };
      (
        characterRepository.findOne as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue(character);

      const result = await service.findOneForUser('char-1', 'user-1');
      expect(result).toEqual(character);
    });

    it('should throw NotFoundException if character does not exist', async () => {
      (
        characterRepository.findOne as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue(null);
      await expect(service.findOneForUser('char-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException if character is not owned by user', async () => {
      const character = { id: 'char-1', account: { userId: 'other' } };
      (
        characterRepository.findOne as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue(character);

      await expect(service.findOneForUser('char-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw BadRequestException if id is missing', async () => {
      await expect(service.findOneForUser('', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if userId is missing', async () => {
      await expect(service.findOneForUser('char-1', '')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('updateForUser', () => {
    it('should update an owned character and return the re-fetched entity', async () => {
      const existingCharacter = {
        id: 'char-1',
        handle: 'Old',
        accountId: 'acc-1',
        account: { handle: 'Acc', userId: 'user-1' },
      };
      const updatedCharacter = {
        id: 'char-1',
        handle: 'New',
        fullHandle: 'New@Acc',
        fullHandleNormalized: 'new@acc',
        fullHandleSlug: 'New@Acc',
        accountId: 'acc-1',
        account: { handle: 'Acc', userId: 'user-1' },
      };
      const updateDto = { handle: 'New' };

      (
        characterRepository.findOne as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      )
        .mockResolvedValueOnce(existingCharacter) // findOneForUser (initial load)
        .mockResolvedValueOnce(null) // assertHandleUniqueForAccount
        .mockResolvedValueOnce(updatedCharacter); // findOneForUser (re-fetch)
      (
        characterRepository.update as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue({
        affected: 1,
      });

      const result = await service.updateForUser(
        'char-1',
        'user-1',
        updateDto as any,
      );

      expect(result).toEqual(updatedCharacter);
      expect(characterRepository.update).toHaveBeenCalledWith(
        'char-1',
        expect.objectContaining({
          handle: 'New',
          fullHandle: 'New@Acc',
          fullHandleNormalized: 'new@acc',
          fullHandleSlug: 'New@Acc',
        }),
      );
      expect(characterRepository.save).not.toHaveBeenCalled();
    });

    it('should persist FK field changes via update() not save()', async () => {
      const existingCharacter = {
        id: 'char-1',
        handle: "K'Rana",
        accountId: 'acc-1',
        account: { handle: 'Acc', userId: 'user-1' },
        recruitTypeId: 'old-recruit-type-id',
        recruitType: { id: 'old-recruit-type-id', name: 'Standard' },
      };
      const refetchedCharacter = {
        ...existingCharacter,
        recruitTypeId: 'new-recruit-type-id',
        recruitType: { id: 'new-recruit-type-id', name: 'Elite' },
      };
      const updateDto = { recruitTypeId: 'new-recruit-type-id' };

      (
        characterRepository.findOne as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      )
        .mockResolvedValueOnce(existingCharacter) // findOneForUser (initial load)
        .mockResolvedValueOnce(refetchedCharacter); // findOneForUser (re-fetch)
      (
        characterRepository.update as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue({
        affected: 1,
      });

      const result = await service.updateForUser(
        'char-1',
        'user-1',
        updateDto as any,
      );

      expect(characterRepository.update).toHaveBeenCalledWith(
        'char-1',
        expect.objectContaining({ recruitTypeId: 'new-recruit-type-id' }),
      );
      expect(result.recruitTypeId).toBe('new-recruit-type-id');
      expect(characterRepository.save).not.toHaveBeenCalled();
    });

    it('should skip handle uniqueness check if handle is same', async () => {
      const character = {
        id: 'char-1',
        handle: 'Same',
        accountId: 'acc-1',
        account: { handle: 'Acc', userId: 'user-1' },
      };
      const updateDto = { handle: 'Same', notes: 'new notes' };

      (
        characterRepository.findOne as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      )
        .mockResolvedValueOnce(character) // findOneForUser (initial load)
        .mockResolvedValueOnce(character); // findOneForUser (re-fetch)
      (
        characterRepository.update as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue({
        affected: 1,
      });

      await service.updateForUser('char-1', 'user-1', updateDto as any);

      // 2 calls: initial load + re-fetch (no uniqueness check since handle unchanged)
      expect(characterRepository.findOne).toHaveBeenCalledTimes(2);
      expect(characterRepository.update).toHaveBeenCalledWith(
        'char-1',
        expect.objectContaining({ notes: 'new notes' }),
      );
      expect(characterRepository.save).not.toHaveBeenCalled();
    });

    it('should handle partial updates without handle', async () => {
      const character = {
        id: 'char-1',
        handle: 'Same',
        accountId: 'acc-1',
        account: { handle: 'Acc', userId: 'user-1' },
      };
      const updateDto = { notes: 'only notes' };

      (
        characterRepository.findOne as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      )
        .mockResolvedValueOnce(character) // findOneForUser (initial load)
        .mockResolvedValueOnce(character); // findOneForUser (re-fetch)
      (
        characterRepository.update as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue({
        affected: 1,
      });

      await service.updateForUser('char-1', 'user-1', updateDto as any);

      // 2 calls: initial load + re-fetch (no handle in dto)
      expect(characterRepository.findOne).toHaveBeenCalledTimes(2);
      expect(characterRepository.update).toHaveBeenCalledWith(
        'char-1',
        expect.objectContaining({ notes: 'only notes' }),
      );
      expect(characterRepository.save).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if id is missing', async () => {
      await expect(service.updateForUser('', 'user-1', {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if userId is missing', async () => {
      await expect(service.updateForUser('char-1', '', {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if dto is missing', async () => {
      await expect(
        service.updateForUser('char-1', 'user-1', null as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('removeForUser', () => {
    it('should soft delete an owned character', async () => {
      const character = { id: 'char-1', account: { userId: 'user-1' } };
      (
        characterRepository.findOne as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue(character);
      (
        characterRepository.softDelete as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue({
        affected: 1,
      });

      await service.removeForUser('char-1', 'user-1');
      expect(characterRepository.softDelete).toHaveBeenCalledWith('char-1');
    });

    it('should throw BadRequestException if id is missing', async () => {
      await expect(service.removeForUser('', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if userId is missing', async () => {
      await expect(service.removeForUser('char-1', '')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('Reference Data Lookups', () => {
    it('should get sexes', async () => {
      const data = [{ name: 'Male' }];
      (
        sexRepository.find as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(data);
      expect(await service.getSexes()).toEqual(data);
    });

    it('should get classes', async () => {
      const data = [{ name: 'Tac' }];
      (
        classRepository.find as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(data);
      expect(await service.getClasses()).toEqual(data);
    });

    describe('getGeneralFactions', () => {
      let queryBuilder: any;

      beforeEach(() => {
        queryBuilder = {
          innerJoin: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest
            .fn<(...args: any[]) => Promise<any>>()
            .mockResolvedValue([{ name: 'Federation' }]),
        };
        (
          generalFactionRepository.createQueryBuilder as jest.Mock
        ).mockReturnValue(queryBuilder);
      });

      it('should get all general factions when no filter', async () => {
        const result = await service.getGeneralFactions();
        expect(result).toEqual([{ name: 'Federation' }]);
        expect(queryBuilder.innerJoin).not.toHaveBeenCalled();
      });

      it('should filter by factionId', async () => {
        await service.getGeneralFactions('fac-1');
        expect(queryBuilder.innerJoin).toHaveBeenCalledWith(
          'generalFaction.factions',
          'faction',
          'faction.id = :factionId',
          { factionId: 'fac-1' },
        );
      });
    });

    describe('getFactions', () => {
      let queryBuilder: any;

      beforeEach(() => {
        queryBuilder = {
          innerJoin: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest
            .fn<(...args: any[]) => Promise<any>>()
            .mockResolvedValue([{ name: 'Starfleet' }]),
        };
        (factionRepository.createQueryBuilder as jest.Mock).mockReturnValue(
          queryBuilder,
        );
      });

      it('should get all factions when no filter', async () => {
        const result = await service.getFactions();
        expect(result).toEqual([{ name: 'Starfleet' }]);
        expect(queryBuilder.innerJoin).not.toHaveBeenCalled();
      });

      it('should filter by generalFactionId', async () => {
        await service.getFactions('gen-1');
        expect(queryBuilder.innerJoin).toHaveBeenCalledWith(
          'faction.generalFactions',
          'generalFaction',
          'generalFaction.id = :generalFactionId',
          { generalFactionId: 'gen-1' },
        );
      });
    });

    describe('getRecruitTypes', () => {
      let queryBuilder: any;

      beforeEach(() => {
        queryBuilder = {
          innerJoin: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest
            .fn<(...args: any[]) => Promise<any>>()
            .mockResolvedValue([{ name: 'Standard' }]),
        };
        (recruitTypeRepository.createQueryBuilder as jest.Mock).mockReturnValue(
          queryBuilder,
        );
      });

      it('should get all recruit types when no filter', async () => {
        const result = await service.getRecruitTypes();
        expect(result).toEqual([{ name: 'Standard' }]);
        expect(queryBuilder.innerJoin).not.toHaveBeenCalled();
      });

      it('should filter by factionId', async () => {
        await service.getRecruitTypes('fac-1');
        expect(queryBuilder.innerJoin).toHaveBeenCalledWith(
          'recruitType.factions',
          'faction',
          'faction.id = :factionId',
          { factionId: 'fac-1' },
        );
      });
    });

    describe('getSpecies', () => {
      let queryBuilder: any;

      beforeEach(() => {
        queryBuilder = {
          innerJoin: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest
            .fn<(...args: any[]) => Promise<any>>()
            .mockResolvedValue([{ name: 'Human' }]),
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

  describe('assertHandleUniqueForAccount (private)', () => {
    it('should return early if handle is not provided', async () => {
      // We can trigger this via create/update if we bypass DTO validation in tests
      // To trigger !handle, we'd need to call it with undefined.
      // In updateForUser, it's only called if handle is provided.
      // But we can test it specifically if we want 100%.
      // I'll add a helper to access private for coverage if needed, or just call it through a proxy.
      await (service as any).assertHandleUniqueForAccount(
        { id: 'acc-1', handle: 'Handle' },
        undefined,
      );
      expect(characterRepository.findOne).not.toHaveBeenCalled();
    });
  });

  describe('uploadProfileImage', () => {
    const mockFile = {
      buffer: Buffer.from('test'),
      originalname: 'test.jpg',
      mimetype: 'image/jpeg',
      size: 100,
    } as any;

    it('should upload a profile image and update character', async () => {
      const character = {
        id: 'char-1',
        account: { userId: 'user-1' },
        profilePictureId: 'old-img-id',
      };
      (
        characterRepository.findOne as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue(character);
      (
        imageUploadsService.uploadImageToCloudflareImages as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue('new-img-id');
      (
        characterRepository.save as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({
        ...character,
        profilePictureId: 'new-img-id',
      });
      (
        imageUploadsService.deleteImageFromCloudflareImages as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue('old-img-id');

      const result = await service.uploadProfileImage(
        'char-1',
        'user-1',
        mockFile,
      );

      expect(result.profilePictureId).toBe('new-img-id');
      expect(
        imageUploadsService.uploadImageToCloudflareImages,
      ).toHaveBeenCalledWith('user-1', mockFile, 'character', 'char-1');
      expect(
        imageUploadsService.deleteImageFromCloudflareImages,
      ).toHaveBeenCalledWith('old-img-id');
    });

    it('should throw InternalServerErrorException if upload returns no key', async () => {
      const character = { id: 'char-1', account: { userId: 'user-1' } };
      (
        characterRepository.findOne as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue(character);
      (
        imageUploadsService.uploadImageToCloudflareImages as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue(null);

      await expect(
        service.uploadProfileImage('char-1', 'user-1', mockFile),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should log and rethrow non-Error thrown values from the upload flow', async () => {
      (
        characterRepository.findOne as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockRejectedValue('boom');

      await expect(
        service.uploadProfileImage('char-1', 'user-1', mockFile),
      ).rejects.toBe('boom');

      const loggerErrorSpy = Logger.prototype.error as unknown as jest.Mock;
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[uploadProfileImage] Upload failed'),
        undefined,
      );
    });

    it('should swallow error if old image deletion fails', async () => {
      const character = {
        id: 'char-1',
        account: { userId: 'user-1' },
        profilePictureId: 'old-img-id',
      };
      (
        characterRepository.findOne as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue(character);
      (
        imageUploadsService.uploadImageToCloudflareImages as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue('new-img-id');
      (
        characterRepository.save as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({
        ...character,
        profilePictureId: 'new-img-id',
      });
      (
        imageUploadsService.deleteImageFromCloudflareImages as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockRejectedValue(new Error('Delete failed'));

      const result = await service.uploadProfileImage(
        'char-1',
        'user-1',
        mockFile,
      );

      expect(result.profilePictureId).toBe('new-img-id');
    });

    it('should swallow non-Error thrown values if old image deletion fails', async () => {
      const character = {
        id: 'char-1',
        account: { userId: 'user-1' },
        profilePictureId: 'old-img-id',
      };
      (
        characterRepository.findOne as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue(character);
      (
        imageUploadsService.uploadImageToCloudflareImages as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue('new-img-id');
      (
        characterRepository.save as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({
        ...character,
        profilePictureId: 'new-img-id',
      });
      (
        imageUploadsService.deleteImageFromCloudflareImages as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockRejectedValue('Delete failed');

      const result = await service.uploadProfileImage(
        'char-1',
        'user-1',
        mockFile,
      );

      expect(result.profilePictureId).toBe('new-img-id');
    });

    it('should not try to delete if no old image exists', async () => {
      const character = {
        id: 'char-1',
        account: { userId: 'user-1' },
        profilePictureId: null,
      };
      (
        characterRepository.findOne as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue(character);
      (
        imageUploadsService.uploadImageToCloudflareImages as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue('new-img-id');
      (
        characterRepository.save as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({
        ...character,
        profilePictureId: 'new-img-id',
      });

      await service.uploadProfileImage('char-1', 'user-1', mockFile);

      expect(
        imageUploadsService.deleteImageFromCloudflareImages,
      ).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if id is missing', async () => {
      await expect(
        service.uploadProfileImage('', 'user-1', mockFile),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if userId is missing', async () => {
      await expect(
        service.uploadProfileImage('char-1', '', mockFile),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if file is missing', async () => {
      await expect(
        service.uploadProfileImage('char-1', 'user-1', null as any),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
