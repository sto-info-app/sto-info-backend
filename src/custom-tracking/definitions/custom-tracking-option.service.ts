import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { DataSource, IsNull, Not, Repository } from 'typeorm';

import { CUSTOM_TRACKING_FIELD_CATALOGUE } from '../constants/custom-tracking-field-catalogue.constants';
import { CUSTOM_TRACKING_LIMITS } from '../constants/custom-tracking-limits.constants';
import { CustomTrackingFieldEntity } from '../entities/custom-tracking-field.entity';
import { CustomTrackingOptionEntity } from '../entities/custom-tracking-option.entity';
import {
  normaliseName,
  tidyName,
} from '../shared/custom-tracking-name.utility';
import { CustomTrackingDefinitionSupportService } from './custom-tracking-definition-support.service';
import { CustomTrackingFieldService } from './custom-tracking-field.service';

/** What a caller may set when creating an option. */
export interface CustomTrackingOptionInput {
  label: string;
  isDefault: boolean;
}

/** What a caller may change about an existing option. */
export type CustomTrackingOptionChanges = Partial<CustomTrackingOptionInput>;

/**
 * The answers a choice or tags Field offers.
 *
 * Options are referenced by identifier and never by label, which is what lets
 * a label be corrected without rewriting every value that chose it, and what
 * lets a deleted option go on displaying the wording it had.
 *
 * Deletion here is soft and stays soft. A value that already chose an option
 * keeps reading correctly; the option simply stops being offered. The
 * retention job leaves it alone for as long as anything points at it, however
 * long that is, and the foreign key would refuse the deletion regardless.
 */
@Injectable()
export class CustomTrackingOptionService {
  /**
   * Creates an instance of CustomTrackingOptionService.
   *
   * @param _optionRepository - Repository of options.
   * @param _fields - Establishes ownership through the owning Field.
   * @param _support - The rules every level of the hierarchy shares.
   * @param _dataSource - Opens the transaction a reorder needs.
   */
  constructor(
    @InjectRepository(CustomTrackingOptionEntity)
    private readonly _optionRepository: Repository<CustomTrackingOptionEntity>,
    private readonly _fields: CustomTrackingFieldService,
    private readonly _support: CustomTrackingDefinitionSupportService,
    private readonly _dataSource: DataSource,
  ) {}

  /**
   * Finds one of a user's options.
   *
   * @param userId - The user asking.
   * @param optionId - The option wanted.
   * @returns The option, and the Field offering it.
   * @throws NotFoundException when it is not theirs, or not there.
   */
  async findOwned(
    userId: string,
    optionId: string,
  ): Promise<{
    option: CustomTrackingOptionEntity;
    field: CustomTrackingFieldEntity;
  }> {
    const option = await this._optionRepository.findOne({
      where: { id: optionId, deletedAt: IsNull() },
    });

    if (!option) {
      throw new NotFoundException('That option could not be found.');
    }

    return {
      option,
      field: await this._fields.findOwned(userId, option.fieldId),
    };
  }

  /**
   * Lists a Field's live options, in their configured order.
   *
   * @param userId - The user asking.
   * @param fieldId - The Field whose options are wanted.
   * @returns The options, in order.
   * @throws NotFoundException when the Field is not theirs, or not there.
   */
  async list(
    userId: string,
    fieldId: string,
  ): Promise<CustomTrackingOptionEntity[]> {
    const field = await this._fields.findOwned(userId, fieldId);

    return this._optionRepository.find({
      where: { fieldId: field.id, deletedAt: IsNull() },
      order: { orderIndex: 'ASC', id: 'ASC' },
    });
  }

  /**
   * Creates an option on one of a user's Fields.
   *
   * @param userId - The owner.
   * @param fieldId - The Field to add it to.
   * @param input - What the user asked for.
   * @returns The new option.
   * @throws NotFoundException when the Field is not theirs, or not there.
   * @throws BadRequestException when the Field takes no options.
   * @throws ConflictException when the Field is full or the label is taken.
   */
  async create(
    userId: string,
    fieldId: string,
    input: CustomTrackingOptionInput,
  ): Promise<CustomTrackingOptionEntity> {
    const field = await this._fields.findOwned(userId, fieldId);

    this.assertTakesOptions(field);

    const label = tidyName(input.label);
    const labelNormalized = normaliseName(input.label);

    this._support.assertRoomFor({
      userId,
      used: await this._support.countActive(this._optionRepository, {
        fieldId: field.id,
      }),
      limit: 'MAX_OPTIONS_PER_FIELD',
      message: `This field already offers ${CUSTOM_TRACKING_LIMITS.MAX_OPTIONS_PER_FIELD} options, which is the most allowed.`,
    });

    await this._support.assertNameAvailable(
      this._optionRepository,
      { fieldId: field.id, labelNormalized },
      `This field already offers an option called "${label}".`,
    );

    const option = await this._optionRepository.save(
      this._optionRepository.create({
        fieldId: field.id,
        label,
        labelNormalized,
        isDefault: input.isDefault,
        orderIndex: await this._support.nextOrderIndex(this._optionRepository, {
          fieldId: field.id,
        }),
      }),
    );

    if (input.isDefault) {
      await this.clearOtherDefaults(field, option.id);
    }

    return option;
  }

  /**
   * Changes an option's wording or whether it is a default.
   *
   * @param userId - The owner.
   * @param optionId - The option to change.
   * @param changes - What to change.
   * @returns The option as it now stands.
   * @throws NotFoundException when it is not theirs, or not there.
   * @throws ConflictException when the new label is taken.
   */
  async update(
    userId: string,
    optionId: string,
    changes: CustomTrackingOptionChanges,
  ): Promise<CustomTrackingOptionEntity> {
    const { option, field } = await this.findOwned(userId, optionId);

    if (changes.label !== undefined) {
      const labelNormalized = normaliseName(changes.label);

      if (labelNormalized !== option.labelNormalized) {
        await this._support.assertNameAvailable(
          this._optionRepository,
          { fieldId: option.fieldId, labelNormalized },
          `This field already offers an option called "${tidyName(changes.label)}".`,
        );
      }

      option.label = tidyName(changes.label);
      option.labelNormalized = labelNormalized;
    }

    if (changes.isDefault !== undefined) {
      option.isDefault = changes.isDefault;
    }

    const saved = await this._optionRepository.save(option);

    if (changes.isDefault) {
      await this.clearOtherDefaults(field, saved.id);
    }

    return saved;
  }

  /**
   * Withdraws an option.
   *
   * Soft, always. A value that already chose it keeps displaying the wording
   * it had; what changes is that nobody can choose it again, and that a user
   * editing such a value is offered the chance to replace it.
   *
   * @param userId - The owner.
   * @param optionId - The option to withdraw.
   * @throws NotFoundException when it is not theirs, or not there.
   */
  async remove(userId: string, optionId: string): Promise<void> {
    const { option } = await this.findOwned(userId, optionId);

    await this._optionRepository.update(
      { id: option.id },
      { deletedAt: new Date() },
    );
  }

  /**
   * Puts a Field's options into the order the user asked for.
   *
   * @param userId - The owner.
   * @param fieldId - The Field being ordered.
   * @param orderedIds - Every live option on it, in order.
   * @throws NotFoundException when the Field is not theirs, or not there.
   * @throws BadRequestException when the list is not exactly that collection.
   */
  async reorder(
    userId: string,
    fieldId: string,
    orderedIds: string[],
  ): Promise<void> {
    const field = await this._fields.findOwned(userId, fieldId);

    await this._dataSource.transaction(manager =>
      this._support.reorder(
        manager,
        this._optionRepository,
        { fieldId: field.id },
        orderedIds,
      ),
    );
  }

  /**
   * Requires a Field to be the kind that offers options.
   *
   * Read from the catalogue rather than by listing the types here, so a type
   * added with options cannot be forgotten in this one place.
   *
   * @param field - The Field being added to.
   * @throws BadRequestException when the Field takes no options.
   */
  private assertTakesOptions(field: CustomTrackingFieldEntity): void {
    if (!CUSTOM_TRACKING_FIELD_CATALOGUE[field.fieldType].usesOptions) {
      throw new BadRequestException(
        'This kind of field does not choose from a list of options.',
      );
    }
  }

  /**
   * Leaves only one default on a Field that permits only one.
   *
   * A tick-box list may sensibly open with three answers already chosen; a
   * dropdown cannot open on two at once. Rather than refusing the second, the
   * most recent choice wins and the earlier one is cleared, because a user
   * marking a new default has said plainly which one they now want.
   *
   * @param field - The Field the option belongs to.
   * @param keepId - The option that should remain a default.
   */
  private async clearOtherDefaults(
    field: CustomTrackingFieldEntity,
    keepId: string,
  ): Promise<void> {
    if (
      CUSTOM_TRACKING_FIELD_CATALOGUE[field.fieldType].allowsMultipleOptions
    ) {
      return;
    }

    await this._optionRepository.update(
      { fieldId: field.id, id: Not(keepId), isDefault: true },
      { isDefault: false },
    );
  }
}
