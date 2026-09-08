import { Injectable } from '@nestjs/common';

import { EntityManager, In, IsNull } from 'typeorm';

import { CustomTrackingFieldEntity } from '../entities/custom-tracking-field.entity';
import { CustomTrackingOptionEntity } from '../entities/custom-tracking-option.entity';
import { CustomTrackingSectionEntity } from '../entities/custom-tracking-section.entity';
import { CustomTrackingTabEntity } from '../entities/custom-tracking-tab.entity';
import { CustomTrackingValueEntity } from '../entities/custom-tracking-value.entity';

/**
 * What a deletion would take with it.
 */
export interface CustomTrackingDeletionImpact {
  /** Live Tabs beneath the thing being deleted. */
  tabs: number;
  /** Live Fields beneath it. */
  fields: number;
  /**
   * Answers recorded against those Fields, across every record.
   *
   * The number that matters most in a confirmation. Definitions can be typed
   * again; the answers somebody recorded against forty characters cannot.
   */
  values: number;
}

/**
 * Marking a branch of the definition hierarchy as deleted.
 *
 * Descendants are marked in their own right rather than left to be filtered
 * out through a deleted parent. The retention job has to find every row that
 * became unreachable and when, and a Tab whose only evidence of deletion is
 * its Section's would be invisible to it — it would sit in the table forever,
 * unreachable and uncollected.
 *
 * One implementation for all three levels. Deleting a Section is deleting its
 * Tabs, which is deleting their Fields, which is deleting their options, and
 * writing that chain out once per level is how the option step comes to be
 * forgotten in one of them.
 */
@Injectable()
export class CustomTrackingCascadeService {
  /**
   * Marks a Section and everything beneath it as deleted.
   *
   * @param manager - The transaction to write in.
   * @param sectionId - The Section being deleted.
   * @param deletedAt - The moment to record against every row.
   */
  async deleteSection(
    manager: EntityManager,
    sectionId: string,
    deletedAt: Date,
  ): Promise<void> {
    const tabIds = await this.liveTabIdsOf(manager, sectionId);

    await this.deleteTabs(manager, tabIds, deletedAt);

    await manager.update(
      CustomTrackingSectionEntity,
      { id: sectionId },
      { deletedAt },
    );
  }

  /**
   * Marks Tabs and everything beneath them as deleted.
   *
   * @param manager - The transaction to write in.
   * @param tabIds - The Tabs being deleted.
   * @param deletedAt - The moment to record against every row.
   */
  async deleteTabs(
    manager: EntityManager,
    tabIds: string[],
    deletedAt: Date,
  ): Promise<void> {
    if (tabIds.length === 0) {
      return;
    }

    await this.deleteFields(
      manager,
      await this.liveFieldIdsOf(manager, tabIds),
      deletedAt,
    );

    await manager.update(
      CustomTrackingTabEntity,
      { id: In(tabIds) },
      { deletedAt },
    );
  }

  /**
   * Marks Fields and their options as deleted.
   *
   * @param manager - The transaction to write in.
   * @param fieldIds - The Fields being deleted.
   * @param deletedAt - The moment to record against every row.
   */
  async deleteFields(
    manager: EntityManager,
    fieldIds: string[],
    deletedAt: Date,
  ): Promise<void> {
    if (fieldIds.length === 0) {
      return;
    }

    await manager.update(
      CustomTrackingOptionEntity,
      { fieldId: In(fieldIds), deletedAt: IsNull() },
      { deletedAt },
    );

    await manager.update(
      CustomTrackingFieldEntity,
      { id: In(fieldIds) },
      { deletedAt },
    );
  }

  /**
   * Counts what deleting a Section would take with it.
   *
   * Shown in the confirmation, because "delete this section" and "delete this
   * section, four tabs and nineteen fields" are different decisions, and only
   * one of them is the one being made.
   *
   * @param manager - The transaction or manager to read through.
   * @param sectionId - The Section being considered.
   * @returns How many Tabs and Fields would go with it.
   */
  async describeSectionDeletion(
    manager: EntityManager,
    sectionId: string,
  ): Promise<CustomTrackingDeletionImpact> {
    const tabIds = await this.liveTabIdsOf(manager, sectionId);
    const fieldIds = await this.liveFieldIdsOf(manager, tabIds);

    return {
      tabs: tabIds.length,
      fields: fieldIds.length,
      values: await this.countValuesOf(manager, fieldIds),
    };
  }

  /**
   * Counts what deleting a Tab would take with it.
   *
   * @param manager - The transaction or manager to read through.
   * @param tabId - The Tab being considered.
   * @returns How many Fields would go with it.
   */
  async describeTabDeletion(
    manager: EntityManager,
    tabId: string,
  ): Promise<CustomTrackingDeletionImpact> {
    const fieldIds = await this.liveFieldIdsOf(manager, [tabId]);

    return {
      tabs: 0,
      fields: fieldIds.length,
      values: await this.countValuesOf(manager, fieldIds),
    };
  }

  /**
   * Counts what deleting one Field would take with it.
   *
   * No definitions go with a Field, so only the answers recorded against it
   * are counted — which is the number that matters, because those are what
   * cannot be typed again from memory.
   *
   * @param manager - The manager to read through.
   * @param fieldId - The Field being considered.
   * @returns How many answers would go with it.
   */
  async describeFieldDeletion(
    manager: EntityManager,
    fieldId: string,
  ): Promise<CustomTrackingDeletionImpact> {
    return {
      tabs: 0,
      fields: 0,
      values: await this.countValuesOf(manager, [fieldId]),
    };
  }

  /**
   * Counts the answers recorded against a set of Fields.
   *
   * Counted across every Account or Character the owner has, because that is
   * what a deletion takes with it: one Field can hold an answer per record.
   *
   * @param manager - The manager to read through.
   * @param fieldIds - The Fields being considered.
   * @returns How many answers there are.
   */
  private async countValuesOf(
    manager: EntityManager,
    fieldIds: string[],
  ): Promise<number> {
    if (fieldIds.length === 0) {
      return 0;
    }

    return manager.count(CustomTrackingValueEntity, {
      where: { fieldId: In(fieldIds) },
    });
  }

  /**
   * Lists the live Tabs of a Section.
   *
   * @param manager - The transaction or manager to read through.
   * @param sectionId - The Section.
   * @returns Their identifiers.
   */
  private async liveTabIdsOf(
    manager: EntityManager,
    sectionId: string,
  ): Promise<string[]> {
    const tabs = await manager.find(CustomTrackingTabEntity, {
      where: { sectionId, deletedAt: IsNull() },
      select: { id: true },
    });

    return tabs.map(tab => tab.id);
  }

  /**
   * Lists the live Fields of some Tabs.
   *
   * @param manager - The transaction or manager to read through.
   * @param tabIds - The Tabs.
   * @returns Their Fields' identifiers.
   */
  private async liveFieldIdsOf(
    manager: EntityManager,
    tabIds: string[],
  ): Promise<string[]> {
    if (tabIds.length === 0) {
      return [];
    }

    const fields = await manager.find(CustomTrackingFieldEntity, {
      where: { tabId: In(tabIds), deletedAt: IsNull() },
      select: { id: true },
    });

    return fields.map(field => field.id);
  }
}
