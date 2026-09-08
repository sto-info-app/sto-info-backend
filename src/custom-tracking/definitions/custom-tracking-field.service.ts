import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { DataSource, IsNull, Repository } from 'typeorm';

import { CUSTOM_TRACKING_LIMITS } from '../constants/custom-tracking-limits.constants';
import { CUSTOM_TRACKING_RETENTION_DAYS } from '../constants/custom-tracking-retention.constants';
import { CustomTrackingFieldEntity } from '../entities/custom-tracking-field.entity';
import { CustomTrackingEmptyMode } from '../enums/custom-tracking-empty-mode.enum';
import { CustomTrackingFieldType } from '../enums/custom-tracking-field-type.enum';
import {
  normaliseName,
  tidyName,
} from '../shared/custom-tracking-name.utility';
import {
  CustomTrackingCascadeService,
  CustomTrackingDeletionImpact,
} from './custom-tracking-cascade.service';
import { CustomTrackingDefinitionSupportService } from './custom-tracking-definition-support.service';
import { CustomTrackingFieldConfigurationService } from './custom-tracking-field-configuration.service';
import { CustomTrackingTabService } from './custom-tracking-tab.service';

/** What a caller may set when creating a Field. */
export interface CustomTrackingFieldInput {
  fieldType: CustomTrackingFieldType;
  name: string;
  description: string | null;
  publiclyVisible: boolean;
  required: boolean;
  ownerEmptyMode: CustomTrackingEmptyMode;
  publicEmptyMode: CustomTrackingEmptyMode;
  emptyPlaceholder: string | null;
  configuration: unknown;
}

/**
 * What a caller may change about an existing Field.
 *
 * The type is absent, deliberately and permanently. It decides how every value
 * already recorded is stored, validated and rendered, so changing it would
 * reinterpret data the user cannot recover — a stored decimal read as a date,
 * or a set of option references read as free text. Asking a different question
 * means making a new Field and retiring the old one.
 */
export type CustomTrackingFieldChanges = Partial<
  Omit<CustomTrackingFieldInput, 'fieldType'>
>;

/**
 * Fields: the questions a user asks of each of their Accounts or Characters.
 *
 * Two of the four limits in this feature are counted here and nowhere else.
 * Two hundred live Fields per scope bounds what one page has to render; four
 * hundred including deleted ones bounds what the table actually holds, since a
 * deleted definition is kept for its retention period and a user who
 * repeatedly built and deleted would otherwise accumulate rows without ever
 * appearing to exceed the live ceiling.
 */
@Injectable()
export class CustomTrackingFieldService {
  /**
   * Creates an instance of CustomTrackingFieldService.
   *
   * @param _fieldRepository - Repository of Fields.
   * @param _tabs - Establishes ownership through the owning Tab.
   * @param _support - The rules every level of the hierarchy shares.
   * @param _cascade - Marks a branch of the hierarchy as deleted.
   * @param _configuration - Checks the type-specific settings.
   * @param _dataSource - Opens the transaction a cascade or reorder needs.
   */
  constructor(
    @InjectRepository(CustomTrackingFieldEntity)
    private readonly _fieldRepository: Repository<CustomTrackingFieldEntity>,
    private readonly _tabs: CustomTrackingTabService,
    private readonly _support: CustomTrackingDefinitionSupportService,
    private readonly _cascade: CustomTrackingCascadeService,
    private readonly _configuration: CustomTrackingFieldConfigurationService,
    private readonly _dataSource: DataSource,
  ) {}

  /**
   * Finds one of a user's Fields.
   *
   * A Field carries its owner, so this is one indexed read rather than a walk
   * back up through the Tab and the Section.
   *
   * @param userId - The user asking.
   * @param fieldId - The Field wanted.
   * @returns The Field.
   * @throws NotFoundException when it is not theirs, or not there.
   */
  async findOwned(
    userId: string,
    fieldId: string,
  ): Promise<CustomTrackingFieldEntity> {
    const field = await this._fieldRepository.findOne({
      where: { id: fieldId, userId, deletedAt: IsNull() },
    });

    if (!field) {
      throw new NotFoundException('That field could not be found.');
    }

    return field;
  }

  /**
   * Lists a Tab's Fields, in their configured order.
   *
   * @param userId - The user asking.
   * @param tabId - The Tab whose Fields are wanted.
   * @returns The Fields, in order.
   * @throws NotFoundException when the Tab is not theirs, or not there.
   */
  async list(
    userId: string,
    tabId: string,
  ): Promise<CustomTrackingFieldEntity[]> {
    const tab = await this._tabs.findOwned(userId, tabId);

    return this._fieldRepository.find({
      where: { tabId: tab.id, deletedAt: IsNull() },
      order: { orderIndex: 'ASC', id: 'ASC' },
    });
  }

  /**
   * Creates a Field within one of a user's Tabs.
   *
   * @param userId - The owner.
   * @param tabId - The Tab to create it in.
   * @param input - What the user asked for.
   * @returns The new Field.
   * @throws NotFoundException when the Tab is not theirs, or not there.
   * @throws ConflictException when a limit is reached or the name is taken.
   * @throws BadRequestException when the configuration does not describe a
   *   usable Field.
   */
  async create(
    userId: string,
    tabId: string,
    input: CustomTrackingFieldInput,
  ): Promise<CustomTrackingFieldEntity> {
    const tab = await this._tabs.findOwned(userId, tabId);
    const section = await this._tabs.sectionOf(userId, tab);
    const name = tidyName(input.name);
    const nameNormalized = normaliseName(input.name);

    await this.assertRoomForField(userId, section.targetScope, tab.id);

    await this._support.assertNameAvailable(
      this._fieldRepository,
      { tabId: tab.id, nameNormalized },
      `This tab already has a field called "${name}".`,
    );

    this.assertPlaceholderPresent(input);

    return this._fieldRepository.save(
      this._fieldRepository.create({
        tabId: tab.id,
        userId,
        targetScope: section.targetScope,
        fieldType: input.fieldType,
        name,
        nameNormalized,
        description: input.description,
        publiclyVisible: input.publiclyVisible,
        required: input.required,
        ownerEmptyMode: input.ownerEmptyMode,
        publicEmptyMode: input.publicEmptyMode,
        emptyPlaceholder: input.emptyPlaceholder,
        configuration: this._configuration.validate(
          input.fieldType,
          input.configuration,
        ),
        orderIndex: await this._support.nextOrderIndex(this._fieldRepository, {
          tabId: tab.id,
        }),
      }),
    );
  }

  /**
   * Changes a Field's wording, visibility or settings.
   *
   * Its type is not among them. A request naming one is refused rather than
   * ignored, so a user who believed they were changing it finds out that they
   * were not.
   *
   * @param userId - The owner.
   * @param fieldId - The Field to change.
   * @param changes - What to change.
   * @returns The Field as it now stands.
   * @throws NotFoundException when it is not theirs, or not there.
   * @throws ConflictException when the new name is taken.
   */
  async update(
    userId: string,
    fieldId: string,
    changes: CustomTrackingFieldChanges,
  ): Promise<CustomTrackingFieldEntity> {
    const field = await this.findOwned(userId, fieldId);

    if (changes.name !== undefined) {
      const nameNormalized = normaliseName(changes.name);

      if (nameNormalized !== field.nameNormalized) {
        await this._support.assertNameAvailable(
          this._fieldRepository,
          { tabId: field.tabId, nameNormalized },
          `This tab already has a field called "${tidyName(changes.name)}".`,
        );
      }

      field.name = tidyName(changes.name);
      field.nameNormalized = nameNormalized;
    }

    if (changes.description !== undefined) {
      field.description = changes.description;
    }

    if (changes.publiclyVisible !== undefined) {
      field.publiclyVisible = changes.publiclyVisible;
    }

    if (changes.required !== undefined) {
      field.required = changes.required;
    }

    if (changes.ownerEmptyMode !== undefined) {
      field.ownerEmptyMode = changes.ownerEmptyMode;
    }

    if (changes.publicEmptyMode !== undefined) {
      field.publicEmptyMode = changes.publicEmptyMode;
    }

    if (changes.emptyPlaceholder !== undefined) {
      field.emptyPlaceholder = changes.emptyPlaceholder;
    }

    if (changes.configuration !== undefined) {
      // Validated against the Field's stored type, never against one the
      // request supplied. Trusting a type from the request would let a caller
      // have a decimal's settings checked as though they were a date's.
      field.configuration = this._configuration.validate(
        field.fieldType,
        changes.configuration,
      );
    }

    this.assertPlaceholderPresent(field);

    return this._fieldRepository.save(field);
  }

  /**
   * Deletes a Field and its options.
   *
   * @param userId - The owner.
   * @param fieldId - The Field to delete.
   * @throws NotFoundException when it is not theirs, or not there.
   */
  async remove(userId: string, fieldId: string): Promise<void> {
    const field = await this.findOwned(userId, fieldId);

    await this._dataSource.transaction(manager =>
      this._cascade.deleteFields(manager, [field.id], new Date()),
    );
  }

  /**
   * Counts what deleting a Field would take with it.
   *
   * No definitions go with a Field, so the number that matters is how many
   * answers are recorded against it: those are what cannot be typed again from
   * memory.
   *
   * @param userId - The owner.
   * @param fieldId - The Field being considered.
   * @returns How many answers would go with it.
   * @throws NotFoundException when it is not theirs, or not there.
   */
  async describeDeletion(
    userId: string,
    fieldId: string,
  ): Promise<CustomTrackingDeletionImpact> {
    const field = await this.findOwned(userId, fieldId);

    return this._cascade.describeFieldDeletion(
      this._dataSource.manager,
      field.id,
    );
  }

  /**
   * Puts a Tab's Fields into the order the user asked for.
   *
   * @param userId - The owner.
   * @param tabId - The Tab being ordered.
   * @param orderedIds - Every live Field in it, in order.
   * @throws NotFoundException when the Tab is not theirs, or not there.
   * @throws BadRequestException when the list is not exactly that collection.
   */
  async reorder(
    userId: string,
    tabId: string,
    orderedIds: string[],
  ): Promise<void> {
    const tab = await this._tabs.findOwned(userId, tabId);

    await this._dataSource.transaction(manager =>
      this._support.reorder(
        manager,
        this._fieldRepository,
        { tabId: tab.id },
        orderedIds,
      ),
    );
  }

  /**
   * Requires there to be room for another Field, by all three counts.
   *
   * @param userId - The owner.
   * @param targetScope - The scope the Field would belong to.
   * @param tabId - The Tab it would sit in.
   * @throws ConflictException when any of the three ceilings is reached.
   */
  private async assertRoomForField(
    userId: string,
    targetScope: CustomTrackingFieldEntity['targetScope'],
    tabId: string,
  ): Promise<void> {
    this._support.assertRoomFor({
      userId,
      used: await this._support.countActive(this._fieldRepository, { tabId }),
      limit: 'MAX_FIELDS_PER_TAB',
      message: `This tab already has ${CUSTOM_TRACKING_LIMITS.MAX_FIELDS_PER_TAB} fields, which is the most allowed. Add another tab, or delete a field to make room.`,
    });

    this._support.assertRoomFor({
      userId,
      used: await this._support.countActive(this._fieldRepository, {
        userId,
        targetScope,
      }),
      limit: 'MAX_FIELDS_PER_SCOPE',
      message: `You already have ${CUSTOM_TRACKING_LIMITS.MAX_FIELDS_PER_SCOPE} fields here, which is the most allowed. Delete one to make room.`,
    });

    // Counts deleted Fields too. They are kept for their retention period, so
    // without this a user could build and delete indefinitely and never appear
    // to exceed the live ceiling.
    this._support.assertRoomFor({
      userId,
      used: await this._fieldRepository.count({
        where: { userId, targetScope },
        withDeleted: true,
      }),
      limit: 'MAX_FIELDS_PER_SCOPE_INCLUDING_DELETED',
      message: `You have created and deleted a great many fields here recently. Deleted fields are kept for ${CUSTOM_TRACKING_RETENTION_DAYS} days before they are cleared, so please try again once some of them have gone.`,
    });
  }

  /**
   * Requires a placeholder wherever a Field is configured to show one.
   *
   * A Field set to show placeholder text and given none would render a label
   * followed by nothing, which is the presentation the "show the label alone"
   * mode already provides and says so.
   *
   * @param field - The Field's empty-value settings.
   * @throws BadRequestException when a mode asks for text that is absent.
   */
  private assertPlaceholderPresent(field: {
    ownerEmptyMode: CustomTrackingEmptyMode;
    publicEmptyMode: CustomTrackingEmptyMode;
    emptyPlaceholder: string | null;
  }): void {
    const wantsPlaceholder =
      field.ownerEmptyMode === CustomTrackingEmptyMode.SHOW_PLACEHOLDER ||
      field.publicEmptyMode === CustomTrackingEmptyMode.SHOW_PLACEHOLDER;

    if (wantsPlaceholder && !field.emptyPlaceholder) {
      throw new BadRequestException(
        'Showing placeholder text for an empty field needs some text to show.',
      );
    }
  }
}
