import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { In, IsNull, Repository } from 'typeorm';

import { CustomTrackingFieldEntity } from '../entities/custom-tracking-field.entity';
import { CustomTrackingOptionEntity } from '../entities/custom-tracking-option.entity';
import { CustomTrackingSectionEntity } from '../entities/custom-tracking-section.entity';
import { CustomTrackingTabEntity } from '../entities/custom-tracking-tab.entity';
import { CustomTrackingTargetScope } from '../enums/custom-tracking-target-scope.enum';

/** A Field, with the answers it offers. */
export interface CustomTrackingFieldNode {
  field: CustomTrackingFieldEntity;
  /** Every option, withdrawn ones included. */
  options: CustomTrackingOptionEntity[];
}

/** A Tab, with the Fields inside it. */
export interface CustomTrackingTabNode {
  tab: CustomTrackingTabEntity;
  fields: CustomTrackingFieldNode[];
}

/** A Section, with the Tabs inside it. */
export interface CustomTrackingSectionNode {
  section: CustomTrackingSectionEntity;
  tabs: CustomTrackingTabNode[];
}

/**
 * Loading a user's whole hierarchy for one target scope.
 *
 * Four queries, not four hundred. Every page that renders custom data needs
 * the entire tree at once — the value editor to generate a form, a detail page
 * to lay one out — so it is read level by level and assembled in memory rather
 * than walked with a query per node. At the permitted ceilings that is ten
 * sections, a hundred tabs, two hundred fields and their options, which is a
 * trivial amount of data and an intolerable number of round trips.
 *
 * Withdrawn options are loaded alongside live ones. A value that already chose
 * one has to go on reading correctly, and the editor offering to replace it
 * has to be able to say what it was.
 *
 * Everything is ordered by position and then by identifier. The secondary sort
 * is what stops two rows that somehow share a position swapping places between
 * requests, which would show up as a page that reorders itself when nothing
 * changed.
 */
@Injectable()
export class CustomTrackingDefinitionTreeService {
  /**
   * Creates an instance of CustomTrackingDefinitionTreeService.
   *
   * @param _sectionRepository - Repository of Sections.
   * @param _tabRepository - Repository of Tabs.
   * @param _fieldRepository - Repository of Fields.
   * @param _optionRepository - Repository of options.
   */
  constructor(
    @InjectRepository(CustomTrackingSectionEntity)
    private readonly _sectionRepository: Repository<CustomTrackingSectionEntity>,
    @InjectRepository(CustomTrackingTabEntity)
    private readonly _tabRepository: Repository<CustomTrackingTabEntity>,
    @InjectRepository(CustomTrackingFieldEntity)
    private readonly _fieldRepository: Repository<CustomTrackingFieldEntity>,
    @InjectRepository(CustomTrackingOptionEntity)
    private readonly _optionRepository: Repository<CustomTrackingOptionEntity>,
  ) {}

  /**
   * Loads a user's whole hierarchy for one target scope.
   *
   * @param userId - The owner.
   * @param targetScope - Which of their two hierarchies to load.
   * @returns The Sections, each with its Tabs and their Fields.
   */
  async load(
    userId: string,
    targetScope: CustomTrackingTargetScope,
  ): Promise<CustomTrackingSectionNode[]> {
    const sections = await this._sectionRepository.find({
      where: { userId, targetScope, deletedAt: IsNull() },
      order: { orderIndex: 'ASC', id: 'ASC' },
    });

    if (sections.length === 0) {
      return [];
    }

    const tabs = await this._tabRepository.find({
      where: {
        sectionId: In(sections.map(section => section.id)),
        deletedAt: IsNull(),
      },
      order: { orderIndex: 'ASC', id: 'ASC' },
    });

    const fields =
      tabs.length === 0
        ? []
        : await this._fieldRepository.find({
            where: {
              tabId: In(tabs.map(tab => tab.id)),
              deletedAt: IsNull(),
            },
            order: { orderIndex: 'ASC', id: 'ASC' },
          });

    const options =
      fields.length === 0
        ? []
        : await this._optionRepository.find({
            // Withdrawn options included, deliberately. Anything that renders
            // an existing answer has to be able to name what was chosen.
            where: { fieldId: In(fields.map(field => field.id)) },
            withDeleted: true,
            order: { orderIndex: 'ASC', id: 'ASC' },
          });

    return this.assemble(sections, tabs, fields, options);
  }

  /**
   * Puts the four levels back together.
   *
   * @param sections - The Sections, in order.
   * @param tabs - Every Tab beneath them, in order.
   * @param fields - Every Field beneath those, in order.
   * @param options - Every option beneath those, in order.
   * @returns The assembled tree.
   */
  private assemble(
    sections: CustomTrackingSectionEntity[],
    tabs: CustomTrackingTabEntity[],
    fields: CustomTrackingFieldEntity[],
    options: CustomTrackingOptionEntity[],
  ): CustomTrackingSectionNode[] {
    const optionsByField = this.groupBy(options, option => option.fieldId);
    const fieldsByTab = this.groupBy(fields, field => field.tabId);
    const tabsBySection = this.groupBy(tabs, tab => tab.sectionId);

    return sections.map(section => ({
      section,
      tabs: (tabsBySection.get(section.id) ?? []).map(tab => ({
        tab,
        fields: (fieldsByTab.get(tab.id) ?? []).map(field => ({
          field,
          options: optionsByField.get(field.id) ?? [],
        })),
      })),
    }));
  }

  /**
   * Groups rows by their parent, preserving the order they arrived in.
   *
   * @param rows - The rows to group.
   * @param parentOf - Reads a row's parent identifier.
   * @returns The rows, grouped.
   */
  private groupBy<T>(
    rows: T[],
    parentOf: (row: T) => string,
  ): Map<string, T[]> {
    const grouped = new Map<string, T[]>();

    for (const row of rows) {
      const key = parentOf(row);
      const existing = grouped.get(key);

      if (existing) {
        existing.push(row);
      } else {
        grouped.set(key, [row]);
      }
    }

    return grouped;
  }
}
