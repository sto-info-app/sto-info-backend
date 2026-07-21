import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CharacterEntity } from './entities/character.entity';

/**
 * Shared character ownership guard used by per-character feature services
 * (reputations, R&D, …) to assert that a character exists and belongs to the
 * authenticated user before reading or writing its data.
 */
@Injectable()
export class CharacterOwnershipService {
  /**
   * Creates an instance of CharacterOwnershipService.
   *
   * @param _characterRepository - The character repository.
   */
  constructor(
    @InjectRepository(CharacterEntity)
    private readonly _characterRepository: Repository<CharacterEntity>,
  ) {}

  /**
   * Ensures the character belongs to the authenticated user.
   *
   * @param characterId - The character id.
   * @param userId - The user id.
   * @returns A promise that resolves when the operation completes.
   */
  async requireOwnedCharacter(
    characterId: string,
    userId: string,
  ): Promise<CharacterEntity> {
    const character = await this._characterRepository.findOne({
      where: { id: characterId },
      relations: { account: true },
    });

    if (!character) {
      throw new NotFoundException(
        `Character with ID "${characterId}" not found`,
      );
    }

    if (character.account?.userId !== userId) {
      throw new ForbiddenException('You do not have access to this character');
    }

    return character;
  }
}
