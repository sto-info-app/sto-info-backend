import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { jest } from '@jest/globals';

import { CharacterOwnershipService } from './character-ownership.service';
import { CharacterEntity } from './entities/character.entity';

describe('CharacterOwnershipService', () => {
  let service: CharacterOwnershipService;
  let characterRepository: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CharacterOwnershipService,
        {
          provide: getRepositoryToken(CharacterEntity),
          useValue: {
            findOne: jest.fn<(...args: any[]) => Promise<any>>(),
          },
        },
      ],
    }).compile();

    service = module.get<CharacterOwnershipService>(CharacterOwnershipService);
    characterRepository = module.get(getRepositoryToken(CharacterEntity));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return the character when it belongs to the user', async () => {
    const character = {
      id: 'character-1',
      account: { id: 'account-1', userId: 'user-1' },
    };
    characterRepository.findOne.mockResolvedValue(character);

    await expect(
      service.requireOwnedCharacter('character-1', 'user-1'),
    ).resolves.toBe(character);

    expect(characterRepository.findOne).toHaveBeenCalledWith({
      where: { id: 'character-1' },
      relations: { account: true, generalFaction: true },
    });
  });

  it('should throw NotFoundException when the character does not exist', async () => {
    characterRepository.findOne.mockResolvedValue(null);

    await expect(
      service.requireOwnedCharacter('missing', 'user-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('should throw ForbiddenException when the character belongs to another user', async () => {
    characterRepository.findOne.mockResolvedValue({
      id: 'character-1',
      account: { id: 'account-1', userId: 'someone-else' },
    });

    await expect(
      service.requireOwnedCharacter('character-1', 'user-1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should throw ForbiddenException when the character has no account', async () => {
    characterRepository.findOne.mockResolvedValue({
      id: 'character-1',
      account: null,
    });

    await expect(
      service.requireOwnedCharacter('character-1', 'user-1'),
    ).rejects.toThrow(ForbiddenException);
  });
});
