import { Injectable } from '@nestjs/common';

import { CustomTrackingFieldDto } from '../dto/custom-tracking-field.dto';
import { CustomTrackingOptionDto } from '../dto/custom-tracking-option.dto';
import { CustomTrackingSectionDto } from '../dto/custom-tracking-section.dto';
import { CustomTrackingTabDto } from '../dto/custom-tracking-tab.dto';
import { CustomTrackingSectionTreeDto } from '../dto/custom-tracking-tree.dto';
import { CustomTrackingFieldEntity } from '../entities/custom-tracking-field.entity';
import { CustomTrackingOptionEntity } from '../entities/custom-tracking-option.entity';
import { CustomTrackingSectionEntity } from '../entities/custom-tracking-section.entity';
import { CustomTrackingTabEntity } from '../entities/custom-tracking-tab.entity';
import { CustomTrackingSectionNode } from './custom-tracking-definition-tree.service';

/**
 * Turning stored definitions into what their owner is sent.
 *
 * A mapper rather than returning entities directly, because the two differ in
 * ways that matter. Suppression is reported as a plain fact rather than as the
 * administrator's identity and the moment they acted, neither of which is any
 * of the user's business; a withdrawn option is reported as withdrawn rather
 * than by exposing the deletion timestamp the retention job works from.
 *
 * This is the owner's view. The public projection is a separate mapper with
 * the whole visibility chain behind it, kept apart on purpose so that adding a
 * property here cannot quietly publish it.
 */
@Injectable()
export class CustomTrackingDefinitionMapper {
  /**
   * Maps a Section.
   *
   * @param section - The stored Section.
   * @returns What its owner is sent.
   */
  toSection(section: CustomTrackingSectionEntity): CustomTrackingSectionDto {
    return {
      id: section.id,
      targetScope: section.targetScope,
      name: section.name,
      description: section.description,
      orderIndex: section.orderIndex,
      publiclyVisible: section.publiclyVisible,
      suppressed: section.suppressedAt !== null,
    };
  }

  /**
   * Maps a Tab.
   *
   * @param tab - The stored Tab.
   * @returns What its owner is sent.
   */
  toTab(tab: CustomTrackingTabEntity): CustomTrackingTabDto {
    return {
      id: tab.id,
      sectionId: tab.sectionId,
      name: tab.name,
      description: tab.description,
      orderIndex: tab.orderIndex,
      publiclyVisible: tab.publiclyVisible,
      suppressed: tab.suppressedAt !== null,
    };
  }

  /**
   * Maps a Field and the options it offers.
   *
   * @param field - The stored Field.
   * @param options - Its options, live and withdrawn.
   * @returns What its owner is sent.
   */
  toField(
    field: CustomTrackingFieldEntity,
    options: CustomTrackingOptionEntity[] = [],
  ): CustomTrackingFieldDto {
    return {
      id: field.id,
      tabId: field.tabId,
      fieldType: field.fieldType,
      name: field.name,
      description: field.description,
      orderIndex: field.orderIndex,
      publiclyVisible: field.publiclyVisible,
      required: field.required,
      ownerEmptyMode: field.ownerEmptyMode,
      publicEmptyMode: field.publicEmptyMode,
      emptyPlaceholder: field.emptyPlaceholder,
      configuration: field.configuration as unknown as Record<string, unknown>,
      suppressed: field.suppressedAt !== null,
      options: options.map(option => this.toOption(option)),
    };
  }

  /**
   * Maps an option.
   *
   * Withdrawn options are mapped like any other. A value that already chose
   * one has to go on reading correctly, and the editor offering to replace it
   * has to be able to say what it was.
   *
   * @param option - The stored option.
   * @returns What its owner is sent.
   */
  toOption(option: CustomTrackingOptionEntity): CustomTrackingOptionDto {
    return {
      id: option.id,
      fieldId: option.fieldId,
      label: option.label,
      orderIndex: option.orderIndex,
      isDefault: option.isDefault,
      withdrawn: option.deletedAt !== null,
    };
  }

  /**
   * Maps a whole Section, with the Tabs and Fields beneath it.
   *
   * Both the builder and the value editor need the same nested shape, so it is
   * assembled once here. Two assemblies would be two statements of which
   * properties reach the client, and the one that mattered would be whichever
   * was edited last.
   *
   * @param node - The Section and everything under it, as loaded.
   * @returns What its owner is sent.
   */
  toSectionTree(node: CustomTrackingSectionNode): CustomTrackingSectionTreeDto {
    return {
      ...this.toSection(node.section),
      tabs: node.tabs.map(tab => ({
        ...this.toTab(tab.tab),
        fields: tab.fields.map(field =>
          this.toField(field.field, field.options),
        ),
      })),
    };
  }
}
