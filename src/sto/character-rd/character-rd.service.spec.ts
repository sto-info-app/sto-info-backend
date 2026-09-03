import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { jest } from '@jest/globals';

import { CharacterOwnershipService } from 'src/sto/character/character-ownership.service';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';

import { CharacterRdService } from './character-rd.service';
import { UpdateCharacterRdProgressDto } from './dto/update-character-rd-progress.dto';
import { CharacterRdProgressEntity } from './entities/character-rd-progress.entity';
import { CharacterRdSchoolEntity } from './entities/character-rd-school.entity';

describe('CharacterRdService', () => {
  let service: CharacterRdService;

  let schoolRepository: any;
  let progressRepository: any;
  let characterRepository: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CharacterRdService,
        CharacterOwnershipService,
        {
          provide: getRepositoryToken(CharacterRdSchoolEntity),
          useValue: {
            find: jest.fn<(...args: any[]) => Promise<any>>(),
            findOne: jest.fn<(...args: any[]) => Promise<any>>(),
          },
        },
        {
          provide: getRepositoryToken(CharacterRdProgressEntity),
          useValue: {
            find: jest.fn<(...args: any[]) => Promise<any>>(),
            findOne: jest.fn<(...args: any[]) => Promise<any>>(),
            create: jest.fn<(...args: any[]) => any>(),
            save: jest.fn<(...args: any[]) => Promise<any>>(),
          },
        },
        {
          provide: getRepositoryToken(CharacterEntity),
          useValue: {
            findOne: jest.fn<(...args: any[]) => Promise<any>>(),
          },
        },
      ],
    }).compile();

    service = module.get<CharacterRdService>(CharacterRdService);
    schoolRepository = module.get(getRepositoryToken(CharacterRdSchoolEntity));
    progressRepository = module.get(
      getRepositoryToken(CharacterRdProgressEntity),
    );
    characterRepository = module.get(getRepositoryToken(CharacterEntity));

    characterRepository.findOne.mockResolvedValue({
      id: 'character-1',
      account: { id: 'account-1', userId: 'user-1' },
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getSchools', () => {
    it('should query all schools ordered by sortOrder then name', async () => {
      schoolRepository.find.mockResolvedValue([{ id: 'school-1' }]);

      const result = await service.getSchools();

      expect(result).toEqual([{ id: 'school-1' }]);
      expect(schoolRepository.find).toHaveBeenCalledWith({
        order: { sortOrder: 'ASC', name: 'ASC' },
      });
    });
  });

  describe('getProgress', () => {
    const schools = [
      { id: 'school-a', name: 'Beams' },
      { id: 'school-b', name: 'Cannons' },
    ];

    it('should throw NotFoundException when character does not exist', async () => {
      characterRepository.findOne.mockResolvedValue(null);

      await expect(
        service.getProgress('missing-character', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when character belongs to another user', async () => {
      characterRepository.findOne.mockResolvedValue({
        id: 'character-1',
        account: { id: 'account-1', userId: 'other-user' },
      });

      await expect(
        service.getProgress('character-1', 'user-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should return existing and synthetic entries for all schools', async () => {
      schoolRepository.find.mockResolvedValue(schools);
      progressRepository.find.mockResolvedValue([
        {
          id: 'progress-1',
          characterId: 'character-1',
          schoolId: 'school-b',
          school: { id: 'school-b', name: 'Cannons' },
          currentLevel: 12,
        },
      ]);

      const result = await service.getProgress('character-1', 'user-1');

      expect(result).toHaveLength(2);
      expect(
        result.find((item: any) => item.schoolId === 'school-a'),
      ).toMatchObject({
        id: '',
        characterId: 'character-1',
        schoolId: 'school-a',
        currentLevel: 0,
      });
      expect(
        result.find((item: any) => item.schoolId === 'school-b'),
      ).toMatchObject({
        id: 'progress-1',
        currentLevel: 12,
      });
      expect(progressRepository.find).toHaveBeenCalledWith({
        where: { characterId: 'character-1' },
        relations: { school: true },
      });
    });
  });

  describe('updateProgress', () => {
    const dto: UpdateCharacterRdProgressDto = { currentLevel: 15 };

    it('should throw NotFoundException when school does not exist', async () => {
      schoolRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updateProgress('character-1', 'user-1', 'missing-school', dto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should create and save a new progress record when one does not exist', async () => {
      const school = {
        id: 'school-1',
        name: 'Beams',
      };
      const created = {
        id: 'progress-1',
        characterId: 'character-1',
        schoolId: 'school-1',
        currentLevel: dto.currentLevel,
      };

      schoolRepository.findOne.mockResolvedValue(school);
      progressRepository.findOne.mockResolvedValue(null);
      progressRepository.create.mockReturnValue(created);
      progressRepository.save.mockResolvedValue(created);

      const result = await service.updateProgress(
        'character-1',
        'user-1',
        'school-1',
        dto,
      );

      expect(progressRepository.create).toHaveBeenCalledWith({
        characterId: 'character-1',
        schoolId: 'school-1',
        currentLevel: 15,
      });
      expect(progressRepository.save).toHaveBeenCalledWith(created);
      expect(result.school).toEqual(school);
    });

    it('should update and save an existing progress record', async () => {
      const school = {
        id: 'school-2',
        name: 'Cannons',
      };
      const existing = {
        id: 'progress-existing',
        characterId: 'character-1',
        schoolId: 'school-2',
        currentLevel: 3,
        school,
      };

      schoolRepository.findOne.mockResolvedValue(school);
      progressRepository.findOne.mockResolvedValue(existing);
      progressRepository.save.mockResolvedValue(existing);

      const result = await service.updateProgress(
        'character-1',
        'user-1',
        'school-2',
        { currentLevel: 15 },
      );

      expect(progressRepository.create).not.toHaveBeenCalled();
      expect(existing.currentLevel).toBe(15);
      expect(progressRepository.save).toHaveBeenCalledWith(existing);
      expect(result.school).toEqual(school);
    });
  });

  describe('getSummary', () => {
    it('should return zero percentages when no schools exist', async () => {
      schoolRepository.find.mockResolvedValue([]);
      progressRepository.find.mockResolvedValue([]);

      const result = await service.getSummary('character-1', 'user-1');

      expect(result).toEqual({
        totalLevels: 0,
        maxPossibleLevels: 0,
        overallCompletionPercentage: 0,
        completedSchools: 0,
        totalSchools: 0,
      });
    });

    it('should calculate totals, percentages, and completed schools', async () => {
      schoolRepository.find.mockResolvedValue([
        { id: 'school-1' },
        { id: 'school-2' },
        { id: 'school-3' },
      ]);
      progressRepository.find.mockResolvedValue([
        { schoolId: 'school-1', currentLevel: 20 },
        { schoolId: 'school-2', currentLevel: 10 },
      ]);

      const result = await service.getSummary('character-1', 'user-1');

      expect(result).toEqual({
        totalLevels: 30,
        maxPossibleLevels: 60,
        overallCompletionPercentage: 50,
        completedSchools: 1,
        totalSchools: 3,
      });
      expect(progressRepository.find).toHaveBeenCalledWith({
        where: { characterId: 'character-1' },
      });
    });
  });
});
