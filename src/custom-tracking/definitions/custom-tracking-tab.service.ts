import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { DataSource, IsNull, Repository } from 'typeorm';

import { CUSTOM_TRACKING_LIMITS } from '../constants/custom-tracking-limits.constants';
import { CustomTrackingSectionEntity } from '../entities/custom-tracking-section.entity';
import { CustomTrackingTabEntity } from '../entities/custom-tracking-tab.entity';
import {
  normaliseName,
  tidyName,
} from '../shared/custom-tracking-name.utility';
import {
  CustomTrackingCascadeService,
  CustomTrackingDeletionImpact,
} from './custom-tracking-cascade.service';
import { CustomTrackingDefinitionSupportService } from './custom-tracking-definition-support.service';
import { CustomTrackingSectionService } from './custom-tracking-section.service';

/** What a caller may set when creating a Tab. */
export interface CustomTrackingTabInput {
  name: string;
  description: string | null;
  publiclyVisible: boolean;
}

/** What a caller may change about an existing Tab. */
export type CustomTrackingTabChanges = Partial<CustomTrackingTabInput>;

/**
 * Tabs: the grouping between a Section and its Fields.
 *
 * A Tab has no scope and no owner of its own. It takes both from its Section,
 * which is why every method here begins by finding that Section as the user
 * asking — ownership is established once, at the top, rather than assumed from
 * an identifier the request supplied.
 *
 * A Section with a single Tab is ordinary and is rendered without a tab strip
 * at all, so the level costs nothing to a user who does not want it.
 */
@Injectable()
export class CustomTrackingTabService {
  /**
   * Creates an instance of CustomTrackingTabService.
   *
   * @param _tabRepository - Repository of Tabs.
   * @param _sections - Establishes ownership through the owning Section.
   * @param _support - The rules every level of the hierarchy shares.
   * @param _cascade - Marks a branch of the hierarchy as deleted.
   * @param _dataSource - Opens the transaction a cascade or reorder needs.
   */
  constructor(
    @InjectRepository(CustomTrackingTabEntity)
    private readonly _tabRepository: Repository<CustomTrackingTabEntity>,
    private readonly _sections: CustomTrackingSectionService,
    private readonly _support: CustomTrackingDefinitionSupportService,
    private readonly _cascade: CustomTrackingCascadeService,
    private readonly _dataSource: DataSource,
  ) {}

  /**
   * Finds one of a user's Tabs.
   *
   * @param userId - The user asking.
   * @param tabId - The Tab wanted.
   * @returns The Tab.
   * @throws NotFoundException when it is not theirs, or not there.
   */
  async findOwned(
    userId: string,
    tabId: string,
  ): Promise<CustomTrackingTabEntity> {
    const tab = await this._tabRepository.findOne({
      where: { id: tabId, deletedAt: IsNull() },
    });

    if (!tab) {
      throw new NotFoundException('That tab could not be found.');
    }

    // Establishes ownership through the Section rather than trusting the Tab,
    // which carries no owner of its own. A Tab found by identifier alone says
    // nothing about who may see it.
    await this._sections.findOwned(userId, tab.sectionId);

    return tab;
  }

  /**
   * Returns the Section a Tab belongs to, as the user asking.
   *
   * A Tab carries no owner and no scope of its own, so anything that needs
   * either has to go through its Section. Offered here rather than left to
   * each caller, so the ownership check cannot be the step somebody skips.
   *
   * @param userId - The user asking.
   * @param tab - The Tab whose Section is wanted.
   * @returns The owning Section.
   * @throws NotFoundException when it is not theirs, or not there.
   */
  sectionOf(
    userId: string,
    tab: CustomTrackingTabEntity,
  ): Promise<CustomTrackingSectionEntity> {
    return this._sections.findOwned(userId, tab.sectionId);
  }

  /**
   * Lists a Section's Tabs, in their configured order.
   *
   * @param userId - The user asking.
   * @param sectionId - The Section whose Tabs are wanted.
   * @returns The Tabs, in order.
   * @throws NotFoundException when the Section is not theirs, or not there.
   */
  async list(
    userId: string,
    sectionId: string,
  ): Promise<CustomTrackingTabEntity[]> {
    const section = await this._sections.findOwned(userId, sectionId);

    return this._tabRepository.find({
      where: { sectionId: section.id, deletedAt: IsNull() },
      order: { orderIndex: 'ASC', id: 'ASC' },
    });
  }

  /**
   * Creates a Tab within one of a user's Sections.
   *
   * @param userId - The owner.
   * @param sectionId - The Section to create it in.
   * @param input - What the user asked for.
   * @returns The new Tab.
   * @throws NotFoundException when the Section is not theirs, or not there.
   * @throws ConflictException when the Section is full or the name is taken.
   */
  async create(
    userId: string,
    sectionId: string,
    input: CustomTrackingTabInput,
  ): Promise<CustomTrackingTabEntity> {
    const section = await this._sections.findOwned(userId, sectionId);
    const name = tidyName(input.name);
    const nameNormalized = normaliseName(input.name);

    this._support.assertRoomFor({
      userId,
      used: await this._support.countActive(this._tabRepository, {
        sectionId: section.id,
      }),
      limit: 'MAX_TABS_PER_SECTION',
      message: `This section already has ${CUSTOM_TRACKING_LIMITS.MAX_TABS_PER_SECTION} tabs, which is the most allowed. Delete one to make room.`,
    });

    await this._support.assertNameAvailable(
      this._tabRepository,
      { sectionId: section.id, nameNormalized },
      `This section already has a tab called "${name}".`,
    );

    return this._tabRepository.save(
      this._tabRepository.create({
        sectionId: section.id,
        name,
        nameNormalized,
        description: input.description,
        publiclyVisible: input.publiclyVisible,
        orderIndex: await this._support.nextOrderIndex(this._tabRepository, {
          sectionId: section.id,
        }),
      }),
    );
  }

  /**
   * Changes a Tab's wording or visibility.
   *
   * The Section a Tab belongs to is not among the things that can change. A
   * Tab moved between Sections could cross into the other target scope, and
   * the values beneath its Fields would have nowhere to follow it to.
   *
   * @param userId - The owner.
   * @param tabId - The Tab to change.
   * @param changes - What to change.
   * @returns The Tab as it now stands.
   * @throws NotFoundException when it is not theirs, or not there.
   * @throws ConflictException when the new name is taken.
   */
  async update(
    userId: string,
    tabId: string,
    changes: CustomTrackingTabChanges,
  ): Promise<CustomTrackingTabEntity> {
    const tab = await this.findOwned(userId, tabId);

    if (changes.name !== undefined) {
      const nameNormalized = normaliseName(changes.name);

      if (nameNormalized !== tab.nameNormalized) {
        await this._support.assertNameAvailable(
          this._tabRepository,
          { sectionId: tab.sectionId, nameNormalized },
          `This section already has a tab called "${tidyName(changes.name)}".`,
        );
      }

      tab.name = tidyName(changes.name);
      tab.nameNormalized = nameNormalized;
    }

    if (changes.description !== undefined) {
      tab.description = changes.description;
    }

    if (changes.publiclyVisible !== undefined) {
      tab.publiclyVisible = changes.publiclyVisible;
    }

    return this._tabRepository.save(tab);
  }

  /**
   * Deletes a Tab and the Fields beneath it.
   *
   * @param userId - The owner.
   * @param tabId - The Tab to delete.
   * @throws NotFoundException when it is not theirs, or not there.
   */
  async remove(userId: string, tabId: string): Promise<void> {
    const tab = await this.findOwned(userId, tabId);

    await this._dataSource.transaction(manager =>
      this._cascade.deleteTabs(manager, [tab.id], new Date()),
    );
  }

  /**
   * Counts what deleting a Tab would take with it.
   *
   * @param userId - The owner.
   * @param tabId - The Tab being considered.
   * @returns How many Fields would go with it.
   * @throws NotFoundException when it is not theirs, or not there.
   */
  async describeDeletion(
    userId: string,
    tabId: string,
  ): Promise<CustomTrackingDeletionImpact> {
    const tab = await this.findOwned(userId, tabId);

    return this._cascade.describeTabDeletion(this._dataSource.manager, tab.id);
  }

  /**
   * Puts a Section's Tabs into the order the user asked for.
   *
   * @param userId - The owner.
   * @param sectionId - The Section being ordered.
   * @param orderedIds - Every live Tab in it, in order.
   * @throws NotFoundException when the Section is not theirs, or not there.
   * @throws BadRequestException when the list is not exactly that collection.
   */
  async reorder(
    userId: string,
    sectionId: string,
    orderedIds: string[],
  ): Promise<void> {
    const section = await this._sections.findOwned(userId, sectionId);

    await this._dataSource.transaction(manager =>
      this._support.reorder(
        manager,
        this._tabRepository,
        { sectionId: section.id },
        orderedIds,
      ),
    );
  }
}
