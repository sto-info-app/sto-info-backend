import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { DataSource, IsNull, Repository } from 'typeorm';

import { CUSTOM_TRACKING_LIMITS } from '../constants/custom-tracking-limits.constants';
import { CustomTrackingSectionEntity } from '../entities/custom-tracking-section.entity';
import { CustomTrackingTargetScope } from '../enums/custom-tracking-target-scope.enum';
import {
  normaliseName,
  tidyName,
} from '../shared/custom-tracking-name.utility';
import {
  CustomTrackingCascadeService,
  CustomTrackingDeletionImpact,
} from './custom-tracking-cascade.service';
import { CustomTrackingDefinitionSupportService } from './custom-tracking-definition-support.service';

/** What a caller may set when creating a Section. */
export interface CustomTrackingSectionInput {
  name: string;
  description: string | null;
  publiclyVisible: boolean;
}

/** What a caller may change about an existing Section. */
export type CustomTrackingSectionChanges = Partial<CustomTrackingSectionInput>;

/**
 * Sections: the outermost grouping, and the only level that names a scope.
 *
 * Creating one is where a user decides whether they are describing their
 * Accounts or their Characters, and that decision is final. Everything beneath
 * inherits it, which is why the scope appears on the Section and on the Field
 * but on nothing that could be moved between them.
 */
@Injectable()
export class CustomTrackingSectionService {
  /**
   * Creates an instance of CustomTrackingSectionService.
   *
   * @param _sectionRepository - Repository of Sections.
   * @param _support - The rules every level of the hierarchy shares.
   * @param _cascade - Marks a branch of the hierarchy as deleted.
   * @param _dataSource - Opens the transaction a cascade or reorder needs.
   */
  constructor(
    @InjectRepository(CustomTrackingSectionEntity)
    private readonly _sectionRepository: Repository<CustomTrackingSectionEntity>,
    private readonly _support: CustomTrackingDefinitionSupportService,
    private readonly _cascade: CustomTrackingCascadeService,
    private readonly _dataSource: DataSource,
  ) {}

  /**
   * Finds one of a user's Sections.
   *
   * Absent and belonging to somebody else are the same answer. Telling the two
   * apart would let anybody discover which identifiers exist by watching which
   * ones are refused differently.
   *
   * @param userId - The user asking.
   * @param sectionId - The Section wanted.
   * @returns The Section.
   * @throws NotFoundException when it is not theirs, or not there.
   */
  async findOwned(
    userId: string,
    sectionId: string,
  ): Promise<CustomTrackingSectionEntity> {
    const section = await this._sectionRepository.findOne({
      where: { id: sectionId, userId, deletedAt: IsNull() },
    });

    if (!section) {
      throw new NotFoundException('That section could not be found.');
    }

    return section;
  }

  /**
   * Lists a user's Sections in one scope, in their configured order.
   *
   * @param userId - The user asking.
   * @param targetScope - Which of their two hierarchies to list.
   * @returns The Sections, in order.
   */
  list(
    userId: string,
    targetScope: CustomTrackingTargetScope,
  ): Promise<CustomTrackingSectionEntity[]> {
    return this._sectionRepository.find({
      where: { userId, targetScope, deletedAt: IsNull() },
      // Ordered by identifier as well as position, so two rows that somehow
      // share an index still render the same way on every request rather than
      // swapping places between them.
      order: { orderIndex: 'ASC', id: 'ASC' },
    });
  }

  /**
   * Creates a Section in one of a user's two hierarchies.
   *
   * @param userId - The owner.
   * @param targetScope - Whether it describes Accounts or Characters.
   * @param input - What the user asked for.
   * @returns The new Section.
   * @throws ConflictException when the scope is full or the name is taken.
   */
  async create(
    userId: string,
    targetScope: CustomTrackingTargetScope,
    input: CustomTrackingSectionInput,
  ): Promise<CustomTrackingSectionEntity> {
    const name = tidyName(input.name);
    const nameNormalized = normaliseName(input.name);

    this._support.assertRoomFor({
      userId,
      used: await this._support.countActive(this._sectionRepository, {
        userId,
        targetScope,
      }),
      limit: 'MAX_SECTIONS_PER_SCOPE',
      message: `You already have ${CUSTOM_TRACKING_LIMITS.MAX_SECTIONS_PER_SCOPE} sections here, which is the most allowed. Delete one to make room.`,
    });

    await this._support.assertNameAvailable(
      this._sectionRepository,
      { userId, targetScope, nameNormalized },
      `You already have a section called "${name}" here.`,
    );

    return this._sectionRepository.save(
      this._sectionRepository.create({
        userId,
        targetScope,
        name,
        nameNormalized,
        description: input.description,
        publiclyVisible: input.publiclyVisible,
        orderIndex: await this._support.nextOrderIndex(
          this._sectionRepository,
          {
            userId,
            targetScope,
          },
        ),
      }),
    );
  }

  /**
   * Changes a Section's wording or visibility.
   *
   * The scope is not among the things that can change, and is not accepted
   * here at all. Every value beneath a Section hangs off an Account or a
   * Character, and the other scope has no row for those values to move to.
   *
   * @param userId - The owner.
   * @param sectionId - The Section to change.
   * @param changes - What to change.
   * @returns The Section as it now stands.
   * @throws NotFoundException when it is not theirs, or not there.
   * @throws ConflictException when the new name is taken.
   */
  async update(
    userId: string,
    sectionId: string,
    changes: CustomTrackingSectionChanges,
  ): Promise<CustomTrackingSectionEntity> {
    const section = await this.findOwned(userId, sectionId);

    if (changes.name !== undefined) {
      const nameNormalized = normaliseName(changes.name);

      // A Section keeping the name it already has is not a clash with itself.
      if (nameNormalized !== section.nameNormalized) {
        await this._support.assertNameAvailable(
          this._sectionRepository,
          {
            userId,
            targetScope: section.targetScope,
            nameNormalized,
          },
          `You already have a section called "${tidyName(changes.name)}" here.`,
        );
      }

      section.name = tidyName(changes.name);
      section.nameNormalized = nameNormalized;
    }

    if (changes.description !== undefined) {
      section.description = changes.description;
    }

    if (changes.publiclyVisible !== undefined) {
      section.publiclyVisible = changes.publiclyVisible;
    }

    return this._sectionRepository.save(section);
  }

  /**
   * Deletes a Section and everything beneath it.
   *
   * Soft, and in one transaction, so a half-deleted branch cannot be left
   * behind if anything fails partway.
   *
   * @param userId - The owner.
   * @param sectionId - The Section to delete.
   * @throws NotFoundException when it is not theirs, or not there.
   */
  async remove(userId: string, sectionId: string): Promise<void> {
    const section = await this.findOwned(userId, sectionId);

    await this._dataSource.transaction(manager =>
      this._cascade.deleteSection(manager, section.id, new Date()),
    );
  }

  /**
   * Counts what deleting a Section would take with it.
   *
   * @param userId - The owner.
   * @param sectionId - The Section being considered.
   * @returns How many Tabs and Fields would go with it.
   * @throws NotFoundException when it is not theirs, or not there.
   */
  async describeDeletion(
    userId: string,
    sectionId: string,
  ): Promise<CustomTrackingDeletionImpact> {
    const section = await this.findOwned(userId, sectionId);

    return this._cascade.describeSectionDeletion(
      this._dataSource.manager,
      section.id,
    );
  }

  /**
   * Puts a user's Sections into the order they asked for.
   *
   * @param userId - The owner.
   * @param targetScope - Which of their two hierarchies is being ordered.
   * @param orderedIds - Every live Section in that scope, in order.
   * @throws BadRequestException when the list is not exactly that collection.
   */
  async reorder(
    userId: string,
    targetScope: CustomTrackingTargetScope,
    orderedIds: string[],
  ): Promise<void> {
    await this._dataSource.transaction(manager =>
      this._support.reorder(
        manager,
        this._sectionRepository,
        { userId, targetScope },
        orderedIds,
      ),
    );
  }
}
