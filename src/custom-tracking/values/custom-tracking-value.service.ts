import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { DataSource, EntityManager, In, Repository } from 'typeorm';

import { CustomTrackingValue } from '../constants/custom-tracking-value.interface';
import {
  CustomTrackingDefinitionTreeService,
  CustomTrackingFieldNode,
  CustomTrackingSectionNode,
} from '../definitions/custom-tracking-definition-tree.service';
import { CustomTrackingImageValueEntity } from '../entities/custom-tracking-image-value.entity';
import { CustomTrackingValueOptionEntity } from '../entities/custom-tracking-value-option.entity';
import { CustomTrackingValueEntity } from '../entities/custom-tracking-value.entity';
import { CustomTrackingTargetScope } from '../enums/custom-tracking-target-scope.enum';
import { CustomTrackingObservabilityService } from '../observability/custom-tracking-observability.service';
import {
  CustomTrackingTarget,
  CustomTrackingTargetService,
} from './custom-tracking-target.service';
import { CustomTrackingValueValidationService } from './custom-tracking-value-validation.service';

/** One Field's answer, as it stands. */
export interface CustomTrackingStoredAnswer {
  /** The Field answered. */
  fieldId: string;
  /** The typed fragment, for the types that store one. */
  fragment: CustomTrackingValue | null;
  /** The options chosen, for the types that draw from a list. */
  optionIds: string[];
  /** The picture, for an image Field that has one. */
  image: CustomTrackingImageValueEntity | null;
}

/** Everything needed to render or edit one record. */
export interface CustomTrackingRecord {
  /** The Account or Character being described. */
  target: CustomTrackingTarget;
  /** The definitions applying to it. */
  sections: CustomTrackingSectionNode[];
  /** What has been recorded so far. */
  answers: CustomTrackingStoredAnswer[];
}

/** One Field's answer, as a caller is submitting it. */
export interface CustomTrackingSubmittedAnswer {
  /** The Field being answered. */
  fieldId: string;
  /**
   * What the user entered, or null to clear the answer.
   *
   * Its shape depends on the Field's type and is checked against it.
   */
  value: unknown;
}

/**
 * Reading and writing what a user recorded against one Account or Character.
 *
 * A save is a whole record at a time and runs in one transaction. Saving field
 * by field would let a record come to rest half-written — some required
 * answers present, others not — which is exactly the state the required-field
 * rule exists to prevent. It also means a validation failure anywhere leaves
 * everything as it was, rather than leaving the user to work out which of
 * their changes survived.
 *
 * Required blocks only the record being saved. A Field marked required is a
 * statement about what a complete record looks like, not an instruction to go
 * and fill in every other Account the user owns.
 */
@Injectable()
export class CustomTrackingValueService {
  /**
   * Creates an instance of CustomTrackingValueService.
   *
   * @param _valueRepository - Repository of values.
   * @param _valueOptionRepository - Repository of option selections.
   * @param _imageValueRepository - Repository of picture answers.
   * @param _targets - Resolves the Account or Character being described.
   * @param _tree - Loads the definitions applying to it.
   * @param _validation - Checks each answer against its Field.
   * @param _observability - Records answers validation refused.
   * @param _dataSource - Opens the transaction a whole-record save needs.
   */
  constructor(
    @InjectRepository(CustomTrackingValueEntity)
    private readonly _valueRepository: Repository<CustomTrackingValueEntity>,
    @InjectRepository(CustomTrackingValueOptionEntity)
    private readonly _valueOptionRepository: Repository<CustomTrackingValueOptionEntity>,
    @InjectRepository(CustomTrackingImageValueEntity)
    private readonly _imageValueRepository: Repository<CustomTrackingImageValueEntity>,
    private readonly _targets: CustomTrackingTargetService,
    private readonly _tree: CustomTrackingDefinitionTreeService,
    private readonly _validation: CustomTrackingValueValidationService,
    private readonly _observability: CustomTrackingObservabilityService,
    private readonly _dataSource: DataSource,
  ) {}

  /**
   * Loads one record: its definitions and everything answered against it.
   *
   * @param userId - The owner.
   * @param scope - Whether an Account or a Character is wanted.
   * @param targetId - The record wanted.
   * @returns The record.
   * @throws NotFoundException when it is not theirs, or not there.
   */
  async loadRecord(
    userId: string,
    scope: CustomTrackingTargetScope,
    targetId: string,
  ): Promise<CustomTrackingRecord> {
    const target = await this._targets.findOwned(userId, scope, targetId);
    const sections = await this._tree.load(userId, scope);

    return {
      target,
      sections,
      answers: await this.readAnswers(target),
    };
  }

  /**
   * Saves a whole record.
   *
   * Every answer is checked before anything is written, and the required-field
   * rule is applied to the record as it will stand afterwards rather than to
   * the submission alone — a user clearing an answer to a required Field has
   * to be stopped just as surely as one who never gave it.
   *
   * @param userId - The owner.
   * @param scope - Whether an Account or a Character is being saved.
   * @param targetId - The record being saved.
   * @param submitted - The answers being recorded.
   * @returns The record as it now stands.
   * @throws NotFoundException when the record is not theirs, or not there.
   * @throws BadRequestException when an answer or the record as a whole is
   *   unacceptable.
   */
  async saveRecord(
    userId: string,
    scope: CustomTrackingTargetScope,
    targetId: string,
    submitted: CustomTrackingSubmittedAnswer[],
  ): Promise<CustomTrackingRecord> {
    const target = await this._targets.findOwned(userId, scope, targetId);
    const sections = await this._tree.load(userId, scope);
    const fieldsById = this.fieldsOf(sections);
    const existing = await this.readAnswers(target);

    this.assertFieldsBelongHere(submitted, fieldsById);

    const checked = this.check(userId, submitted, fieldsById, existing);
    const resulting = this.project(existing, checked);

    this.assertRequiredAnswered(fieldsById, resulting);

    await this._dataSource.transaction(manager =>
      this.write(manager, target, checked),
    );

    return {
      target,
      sections,
      answers: await this.readAnswers(target),
    };
  }

  /**
   * Reads everything answered against one record.
   *
   * Public because the public projection reads the same rows through the same
   * three queries. A second implementation over there would be a second place
   * for the option ordering and the picture join to be got right, and the one
   * that mattered would be whichever was edited last.
   *
   * This reads answers alone and enforces nothing about who may see them. The
   * visibility chain belongs to the projection that calls it.
   *
   * @param target - The record.
   * @returns Its answers.
   */
  async readAnswers(
    target: CustomTrackingTarget,
  ): Promise<CustomTrackingStoredAnswer[]> {
    const values = await this._valueRepository.find({
      where: this._targets.whereFor(target),
    });

    if (values.length === 0) {
      return [];
    }

    const valueIds = values.map(value => value.id);

    const selections = await this._valueOptionRepository.find({
      where: { valueId: In(valueIds) },
      order: { orderIndex: 'ASC', id: 'ASC' },
    });

    const images = await this._imageValueRepository.find({
      where: { valueId: In(valueIds) },
    });

    return values.map(value => ({
      fieldId: value.fieldId,
      fragment: value.value,
      optionIds: selections
        .filter(selection => selection.valueId === value.id)
        .map(selection => selection.optionId),
      image: images.find(image => image.valueId === value.id) ?? null,
    }));
  }

  /**
   * Checks every submitted answer against the Field it answers.
   *
   * @param userId - The owner, for the record of what was refused.
   * @param submitted - The answers being recorded.
   * @param fieldsById - The Fields applying to this record.
   * @param existing - What is already recorded.
   * @returns Each answer, checked and ready to store.
   */
  private check(
    userId: string,
    submitted: CustomTrackingSubmittedAnswer[],
    fieldsById: Map<string, CustomTrackingFieldNode>,
    existing: CustomTrackingStoredAnswer[],
  ): Map<string, CustomTrackingStoredAnswer | null> {
    const checked = new Map<string, CustomTrackingStoredAnswer | null>();

    for (const answer of submitted) {
      const node = fieldsById.get(answer.fieldId) as CustomTrackingFieldNode;
      const previous = existing.find(
        stored => stored.fieldId === answer.fieldId,
      );

      const validated = this.validated(userId, node, previous, answer);

      checked.set(
        answer.fieldId,
        validated === null || this.isEmpty(validated)
          ? null
          : {
              fieldId: answer.fieldId,
              fragment: validated.fragment,
              optionIds: validated.optionIds,
              image: previous?.image ?? null,
            },
      );
    }

    return checked;
  }

  /**
   * Checks one answer, noting the type of Field when it is refused.
   *
   * The refusal itself is the validator's to explain; what is recorded here is
   * only its shape. One type failing for everybody is a bug in our own rules,
   * and many types failing for one member is somebody probing — and neither is
   * visible from a log of individual bad requests.
   *
   * @param userId - The owner.
   * @param node - The Field and its options.
   * @param previous - What was recorded against it before.
   * @param answer - What was submitted.
   * @returns The checked answer.
   */
  private validated(
    userId: string,
    node: CustomTrackingFieldNode,
    previous: CustomTrackingStoredAnswer | undefined,
    answer: CustomTrackingSubmittedAnswer,
  ): ReturnType<CustomTrackingValueValidationService['validate']> {
    try {
      return this._validation.validate({
        field: node.field,
        options: node.options,
        previouslyChosenOptionIds: previous?.optionIds ?? [],
        submitted: answer.value,
      });
    } catch (error: unknown) {
      this._observability.valueRefused(
        userId,
        node.field.id,
        node.field.fieldType,
      );

      throw error;
    }
  }

  /**
   * Determines whether a checked answer amounts to no answer at all.
   *
   * The validator reports a cleared answer as an empty fragment and no
   * options, which is the one shape that must become an absent row rather than
   * a stored one.
   *
   * @param validated - The checked answer.
   * @returns True when nothing was actually answered.
   */
  private isEmpty(validated: {
    fragment: CustomTrackingValue | null;
    optionIds: string[];
  }): boolean {
    return validated.fragment === null && validated.optionIds.length === 0;
  }

  /**
   * Works out what the record will look like once the save lands.
   *
   * @param existing - What is already recorded.
   * @param checked - The answers being written.
   * @returns The answers the record will have.
   */
  private project(
    existing: CustomTrackingStoredAnswer[],
    checked: Map<string, CustomTrackingStoredAnswer | null>,
  ): Map<string, CustomTrackingStoredAnswer> {
    const resulting = new Map(
      existing.map(answer => [answer.fieldId, answer] as const),
    );

    for (const [fieldId, answer] of checked) {
      if (answer === null) {
        resulting.delete(fieldId);
      } else {
        resulting.set(fieldId, answer);
      }
    }

    return resulting;
  }

  /**
   * Requires every submitted Field to be one applying to this record.
   *
   * A Field from the other scope, from another user, or one since deleted, is
   * refused rather than ignored. Ignoring it would let a save silently discard
   * something the user believed they had entered.
   *
   * @param submitted - The answers being recorded.
   * @param fieldsById - The Fields applying to this record.
   * @throws BadRequestException when a Field does not belong here.
   */
  private assertFieldsBelongHere(
    submitted: CustomTrackingSubmittedAnswer[],
    fieldsById: Map<string, CustomTrackingFieldNode>,
  ): void {
    const seen = new Set<string>();

    for (const answer of submitted) {
      if (!fieldsById.has(answer.fieldId)) {
        throw new BadRequestException(
          'That record has no such field. Reload the page and try again.',
        );
      }

      if (seen.has(answer.fieldId)) {
        throw new BadRequestException(
          'The same field was answered twice in one save.',
        );
      }

      seen.add(answer.fieldId);
    }
  }

  /**
   * Requires every required Field to have an answer once the save lands.
   *
   * Only this record is checked. A required Field says what a complete record
   * looks like; it is not an instruction to go and fill in every other Account
   * the user owns.
   *
   * @param fieldsById - The Fields applying to this record.
   * @param resulting - The answers the record will have.
   * @throws BadRequestException naming what is still missing.
   */
  private assertRequiredAnswered(
    fieldsById: Map<string, CustomTrackingFieldNode>,
    resulting: Map<string, CustomTrackingStoredAnswer>,
  ): void {
    const missing = [...fieldsById.values()]
      .filter(node => node.field.required && !resulting.has(node.field.id))
      .map(node => node.field.name);

    if (missing.length > 0) {
      throw new BadRequestException(
        `These fields still need an answer before this record can be saved: ${missing.join(', ')}.`,
      );
    }
  }

  /**
   * Writes the checked answers.
   *
   * @param manager - The transaction to write in.
   * @param target - The record being saved.
   * @param checked - The answers being written.
   */
  private async write(
    manager: EntityManager,
    target: CustomTrackingTarget,
    checked: Map<string, CustomTrackingStoredAnswer | null>,
  ): Promise<void> {
    for (const [fieldId, answer] of checked) {
      const existing = await manager.findOne(CustomTrackingValueEntity, {
        where: { ...this._targets.whereFor(target), fieldId },
      });

      if (answer === null) {
        await this.clear(manager, existing);

        continue;
      }

      await this.store(manager, target, fieldId, answer, existing);
    }
  }

  /**
   * Removes an answer.
   *
   * Hard-deleted rather than soft, because a cleared answer is not a deletion
   * anybody needs to recover: the row said nothing worth retaining, and
   * keeping it would leave the unique index believing the Field is still
   * answered.
   *
   * @param manager - The transaction to write in.
   * @param existing - The row to remove, if there is one.
   */
  private async clear(
    manager: EntityManager,
    existing: CustomTrackingValueEntity | null,
  ): Promise<void> {
    if (!existing) {
      return;
    }

    await manager.delete(CustomTrackingValueOptionEntity, {
      valueId: existing.id,
    });
    await manager.delete(CustomTrackingValueEntity, { id: existing.id });
  }

  /**
   * Writes one answer, replacing whatever was there.
   *
   * Option selections are rewritten wholesale rather than reconciled. The set
   * is small, the write is inside a transaction, and comparing two sets to
   * work out the difference is more code for no benefit anybody can see.
   *
   * @param manager - The transaction to write in.
   * @param target - The record being saved.
   * @param fieldId - The Field being answered.
   * @param answer - The checked answer.
   * @param existing - The row already there, if any.
   */
  private async store(
    manager: EntityManager,
    target: CustomTrackingTarget,
    fieldId: string,
    answer: CustomTrackingStoredAnswer,
    existing: CustomTrackingValueEntity | null,
  ): Promise<void> {
    const value =
      existing ??
      manager.create(CustomTrackingValueEntity, {
        fieldId,
        targetScope: target.scope,
        accountId:
          target.scope === CustomTrackingTargetScope.ACCOUNT ? target.id : null,
        characterId:
          target.scope === CustomTrackingTargetScope.CHARACTER
            ? target.id
            : null,
      });

    value.value = answer.fragment;

    const saved = await manager.save(CustomTrackingValueEntity, value);

    await manager.delete(CustomTrackingValueOptionEntity, {
      valueId: saved.id,
    });

    if (answer.optionIds.length === 0) {
      return;
    }

    await manager.save(
      CustomTrackingValueOptionEntity,
      answer.optionIds.map((optionId, position) =>
        manager.create(CustomTrackingValueOptionEntity, {
          valueId: saved.id,
          optionId,
          orderIndex: position,
        }),
      ),
    );
  }

  /**
   * Indexes every Field in a hierarchy by its identifier.
   *
   * @param sections - The hierarchy.
   * @returns The Fields, by identifier.
   */
  private fieldsOf(
    sections: CustomTrackingSectionNode[],
  ): Map<string, CustomTrackingFieldNode> {
    const fields = new Map<string, CustomTrackingFieldNode>();

    for (const section of sections) {
      for (const tab of section.tabs) {
        for (const node of tab.fields) {
          fields.set(node.field.id, node);
        }
      }
    }

    return fields;
  }
}
