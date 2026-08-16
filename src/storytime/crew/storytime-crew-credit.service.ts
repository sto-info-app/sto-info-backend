import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { StorytimeChapterEntity } from '../chapters/entities/storytime-chapter.entity';
import { StorytimeCharacterEntity } from '../characters/entities/storytime-character.entity';
import { StoryCapability } from '../collaboration/storytime-story-capability.enum';
import { StorytimeModerationStatus } from '../enums/storytime-moderation-status.enum';
import { StorytimeOrderingService } from '../shared/storytime-ordering.service';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { CreateCrewCreditDto } from './dto/create-crew-credit.dto';
import { UpdateCrewCreditDto } from './dto/update-crew-credit.dto';
import { StorytimeCrewCreditEntity } from './entities/storytime-crew-credit.entity';
import { StorytimeCrewRoleEntity } from './entities/storytime-crew-role.entity';

/**
 * Who gets credited for what.
 *
 * A credit is public acknowledgement and confers nothing at all. Edit access
 * comes only from an accepted collaboration, so thanking somebody in the
 * credits can never hand them the keys — which is exactly why crediting is a
 * lighter permission than inviting.
 */
@Injectable()
export class StorytimeCrewCreditService {
  private readonly _logger = new Logger(StorytimeCrewCreditService.name);

  /**
   * Creates an instance of StorytimeCrewCreditService.
   *
   * @param _creditRepository - Repository of Crew credits.
   * @param _roleRepository - Repository of Crew roles.
   * @param _chapterRepository - Repository of Chapters, to check the Story.
   * @param _characterRepository - Repository of Characters, to check the Story.
   * @param _storyService - Decides who may manage credits.
   * @param _orderingService - Calculates positions within the credits.
   */
  constructor(
    @InjectRepository(StorytimeCrewCreditEntity)
    private readonly _creditRepository: Repository<StorytimeCrewCreditEntity>,
    @InjectRepository(StorytimeCrewRoleEntity)
    private readonly _roleRepository: Repository<StorytimeCrewRoleEntity>,
    @InjectRepository(StorytimeChapterEntity)
    private readonly _chapterRepository: Repository<StorytimeChapterEntity>,
    @InjectRepository(StorytimeCharacterEntity)
    private readonly _characterRepository: Repository<StorytimeCharacterEntity>,
    private readonly _storyService: StorytimeStoryService,
    private readonly _orderingService: StorytimeOrderingService,
  ) {}

  /**
   * Lists the credits on a Story.
   *
   * @param storyId - The Story.
   * @returns The credits, in credits-roll order.
   */
  findByStory(storyId: string): Promise<StorytimeCrewCreditEntity[]> {
    return this._creditRepository.find({
      where: {
        storyId,
        moderationStatus: StorytimeModerationStatus.ACTIVE,
      },
      order: { orderIndex: 'ASC' },
    });
  }

  /**
   * Lists somebody's own credits across the site.
   *
   * @param userId - The person credited.
   * @returns Their credits.
   */
  findByUser(userId: string): Promise<StorytimeCrewCreditEntity[]> {
    return this._creditRepository.find({
      where: {
        userId,
        moderationStatus: StorytimeModerationStatus.ACTIVE,
      },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Adds a credit to a Story.
   *
   * @param storyId - The Story.
   * @param dto - The credit to add.
   * @param actingUserId - The caller.
   * @returns The credit.
   */
  async create(
    storyId: string,
    dto: CreateCrewCreditDto,
    actingUserId: string,
  ): Promise<StorytimeCrewCreditEntity> {
    await this._storyService.findEditableOrFail(
      storyId,
      actingUserId,
      StoryCapability.MANAGE_CREW,
    );

    await this.assertRoleExists(dto.roleId);
    await this.assertBelongsToStory(storyId, dto.chapterId, dto.characterId);
    await this.assertNotAlreadyCredited(storyId, dto);

    const credit = this._creditRepository.create({
      ...dto,
      storyId,
      chapterId: dto.chapterId ?? null,
      characterId: dto.characterId ?? null,
      orderIndex: await this.nextOrderIndex(storyId),
      createdByUserId: actingUserId,
      updatedByUserId: actingUserId,
    });

    const saved = await this._creditRepository.save(credit);

    this._logger.log(
      `Credit added on Story ${storyId} for member ${dto.userId} by ${actingUserId}`,
    );

    return saved;
  }

  /**
   * Changes a credit's wording or notes.
   *
   * Who is credited, in what role, and against what are not editable: changing
   * any of them makes it a different credit, and a different credit is one
   * that has to be checked for duplicates and permission all over again.
   *
   * @param creditId - The credit.
   * @param dto - The changes.
   * @param actingUserId - The caller.
   * @returns The updated credit.
   */
  async update(
    creditId: string,
    dto: UpdateCrewCreditDto,
    actingUserId: string,
  ): Promise<StorytimeCrewCreditEntity> {
    const credit = await this.findOrFail(creditId);

    await this._storyService.findEditableOrFail(
      credit.storyId,
      actingUserId,
      StoryCapability.MANAGE_CREW,
    );

    Object.assign(credit, dto);
    credit.updatedByUserId = actingUserId;

    return this._creditRepository.save(credit);
  }

  /**
   * Removes a credit.
   *
   * Soft-deleted, so the same person may be credited again in the same role
   * later without colliding with the row that used to say so.
   *
   * @param creditId - The credit.
   * @param actingUserId - The caller.
   */
  async remove(creditId: string, actingUserId: string): Promise<void> {
    const credit = await this.findOrFail(creditId);

    await this._storyService.findEditableOrFail(
      credit.storyId,
      actingUserId,
      StoryCapability.MANAGE_CREW,
    );

    await this._creditRepository.softDelete(creditId);
  }

  /**
   * Loads a credit, or fails.
   *
   * @param creditId - The credit.
   * @returns The credit.
   * @throws NotFoundException when it does not exist.
   */
  private async findOrFail(
    creditId: string,
  ): Promise<StorytimeCrewCreditEntity> {
    const credit = await this._creditRepository.findOne({
      where: { id: creditId },
    });

    if (!credit) {
      throw new NotFoundException('Credit not found');
    }

    return credit;
  }

  /**
   * Requires that the role exists.
   *
   * @param roleId - The role.
   * @throws BadRequestException when no such role exists.
   */
  private async assertRoleExists(roleId: string): Promise<void> {
    const exists = await this._roleRepository.count({ where: { id: roleId } });

    if (exists === 0) {
      throw new BadRequestException('That Crew role does not exist.');
    }
  }

  /**
   * Requires that any named Chapter and Character belong to the Story.
   *
   * Crediting somebody against a Chapter of a different Story would put a name
   * in a credits roll its owner never wrote and cannot remove.
   *
   * @param storyId - The Story being credited.
   * @param chapterId - The Chapter, when the credit names one.
   * @param characterId - The Character, when the credit names one.
   * @throws BadRequestException naming what does not belong.
   */
  private async assertBelongsToStory(
    storyId: string,
    chapterId?: string | null,
    characterId?: string | null,
  ): Promise<void> {
    if (chapterId) {
      const chapter = await this._chapterRepository.findOne({
        where: { id: chapterId },
      });

      if (!chapter || chapter.storyId !== storyId) {
        throw new BadRequestException(
          'That Chapter does not belong to this Story.',
        );
      }
    }

    if (characterId) {
      const character = await this._characterRepository.findOne({
        where: { id: characterId },
      });

      if (!character || character.storyId !== storyId) {
        throw new BadRequestException(
          'That Character does not belong to this Story.',
        );
      }
    }
  }

  /**
   * Requires that this exact credit does not already exist.
   *
   * Caught here as well as by the unique index, so a creator who adds the same
   * credit twice gets a sentence rather than a constraint violation.
   *
   * @param storyId - The Story.
   * @param dto - The credit being added.
   * @throws BadRequestException when the same credit already exists.
   */
  private async assertNotAlreadyCredited(
    storyId: string,
    dto: CreateCrewCreditDto,
  ): Promise<void> {
    const existing = await this._creditRepository.count({
      where: {
        storyId,
        userId: dto.userId,
        roleId: dto.roleId,
        chapterId: dto.chapterId ?? IsNull(),
        characterId: dto.characterId ?? IsNull(),
        deletedAt: IsNull(),
      },
    });

    if (existing > 0) {
      throw new BadRequestException(
        'That member is already credited in this role here.',
      );
    }
  }

  /**
   * Works out where a new credit joins the credits roll.
   *
   * @param storyId - The Story.
   * @returns The order index for the new credit.
   */
  private async nextOrderIndex(storyId: string): Promise<number> {
    const last = await this._creditRepository.findOne({
      where: { storyId },
      order: { orderIndex: 'DESC' },
    });

    return this._orderingService.nextIndex(last?.orderIndex ?? null);
  }

  /**
   * Lists the roles named by a set of credits.
   *
   * @param roleIds - The roles to load.
   * @returns The roles.
   */
  findRolesByIds(roleIds: string[]): Promise<StorytimeCrewRoleEntity[]> {
    if (roleIds.length === 0) {
      return Promise.resolve([]);
    }

    return this._roleRepository.find({ where: { id: In(roleIds) } });
  }
}
