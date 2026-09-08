import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { IsNull, Repository } from 'typeorm';

import { AccountEntity } from 'src/sto/account/entities/account.entity';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';
import { UserProfileEntity } from 'src/user/entities/user-profile.entity';

import { CUSTOM_TRACKING_FEATURE_FLAGS } from '../constants/custom-tracking-feature.constants';
import { CustomTrackingFeatureService } from '../custom-tracking-feature.service';
import {
  CustomTrackingDefinitionTreeService,
  CustomTrackingFieldNode,
  CustomTrackingSectionNode,
} from '../definitions/custom-tracking-definition-tree.service';
import { CustomTrackingFieldEntity } from '../entities/custom-tracking-field.entity';
import { CustomTrackingOptionEntity } from '../entities/custom-tracking-option.entity';
import { CustomTrackingSectionEntity } from '../entities/custom-tracking-section.entity';
import { CustomTrackingTabEntity } from '../entities/custom-tracking-tab.entity';
import { CustomTrackingEmptyMode } from '../enums/custom-tracking-empty-mode.enum';
import { CustomTrackingFieldType } from '../enums/custom-tracking-field-type.enum';
import { CustomTrackingTargetScope } from '../enums/custom-tracking-target-scope.enum';
import {
  CustomTrackingStoredAnswer,
  CustomTrackingValueService,
} from '../values/custom-tracking-value.service';

/** A publicly visible Field, with what is recorded against it. */
export interface CustomTrackingPublicField {
  /** The Field. */
  field: CustomTrackingFieldEntity;
  /** The options this value chose, in the order they were chosen. */
  chosen: CustomTrackingOptionEntity[];
  /** What is recorded, or null where nothing is. */
  answer: CustomTrackingStoredAnswer | null;
}

/** A publicly visible Tab, with the Fields left in it. */
export interface CustomTrackingPublicTab {
  /** The Tab. */
  tab: CustomTrackingTabEntity;
  /** The Fields a visitor may see. */
  fields: CustomTrackingPublicField[];
}

/** A publicly visible Section, with the Tabs left in it. */
export interface CustomTrackingPublicSection {
  /** The Section. */
  section: CustomTrackingSectionEntity;
  /** The Tabs a visitor may see. */
  tabs: CustomTrackingPublicTab[];
}

/**
 * What an anonymous visitor may read of somebody's custom tracking.
 *
 * The whole visibility chain is enforced here rather than by whoever calls
 * this. A projection that trusted its caller to have checked would be correct
 * only for as long as every caller remembered, and the cost of one forgetting
 * is somebody's private information on a page a search engine will index.
 *
 * The chain is: the owning member is public and in good standing, the STO
 * Account is public, the Character is public where one is being read, and then
 * Section, Tab and Field are each public in their own right. Every gate is
 * asked of the database here even where the caller has already asked the same
 * question — the extra query costs a few milliseconds on a page that is
 * heavily cached, and it is the difference between a leak being impossible and
 * a leak being one refactor away.
 *
 * An administrator's suppression is a further gate on top of the user's own
 * flags. A suppressed Section, Tab or Field disappears from public view
 * without touching what its owner configured, so lifting the suppression
 * restores exactly what was there.
 *
 * Nothing here throws. A visitor who is entitled to none of it is given an
 * empty list, which is the same answer as an owner who has configured nothing
 * — deliberately, because a distinguishable refusal would let anybody test
 * whether hidden data exists.
 */
@Injectable()
export class CustomTrackingPublicService {
  /**
   * Creates an instance of CustomTrackingPublicService.
   *
   * @param _accountRepository - Repository of STO Accounts.
   * @param _characterRepository - Repository of STO Characters.
   * @param _profileRepository - Repository of user profiles.
   * @param _features - Whether public reading is switched on.
   * @param _tree - Loads the owner's hierarchy.
   * @param _values - Reads what is recorded against the target.
   */
  constructor(
    @InjectRepository(AccountEntity)
    private readonly _accountRepository: Repository<AccountEntity>,
    @InjectRepository(CharacterEntity)
    private readonly _characterRepository: Repository<CharacterEntity>,
    @InjectRepository(UserProfileEntity)
    private readonly _profileRepository: Repository<UserProfileEntity>,
    private readonly _features: CustomTrackingFeatureService,
    private readonly _tree: CustomTrackingDefinitionTreeService,
    private readonly _values: CustomTrackingValueService,
  ) {}

  /**
   * Projects what a visitor may see of one Account or Character.
   *
   * @param scope - Whether an Account or a Character is being read.
   * @param targetId - The record being read.
   * @returns The permitted Sections, or an empty list.
   */
  async project(
    scope: CustomTrackingTargetScope,
    targetId: string,
  ): Promise<CustomTrackingPublicSection[]> {
    if (
      !(await this._features.isFlagEnabled(
        CUSTOM_TRACKING_FEATURE_FLAGS.PUBLIC_READ_ENABLED,
      ))
    ) {
      return [];
    }

    const ownerUserId = await this.resolveOwner(scope, targetId);

    if (ownerUserId === null) {
      return [];
    }

    const disabled = await this.disabledTypes();
    const visible = this.filter(
      await this._tree.load(ownerUserId, scope),
      disabled,
    );

    if (visible.length === 0) {
      return [];
    }

    return this.attach(
      visible,
      await this._values.readAnswers({
        scope,
        id: targetId,
        label: '',
        publiclyVisible: true,
      }),
    );
  }

  /**
   * Finds who owns a target, if a visitor is entitled to see it at all.
   *
   * @param scope - Whether an Account or a Character is being read.
   * @param targetId - The record being read.
   * @returns The owner's user identifier, or null.
   */
  private async resolveOwner(
    scope: CustomTrackingTargetScope,
    targetId: string,
  ): Promise<string | null> {
    const account =
      scope === CustomTrackingTargetScope.ACCOUNT
        ? await this.findPublicAccount(targetId)
        : await this.findPublicCharacterAccount(targetId);

    if (!account) {
      return null;
    }

    return (await this.isMemberPublic(account.userId)) ? account.userId : null;
  }

  /**
   * Finds a publicly visible STO Account.
   *
   * @param accountId - The Account being read.
   * @returns The Account, or null.
   */
  private findPublicAccount(accountId: string): Promise<AccountEntity | null> {
    return this._accountRepository.findOne({
      where: { id: accountId, publiclyVisible: true, deletedAt: IsNull() },
    });
  }

  /**
   * Finds the publicly visible Account a publicly visible Character sits on.
   *
   * Both gates, because a Character marked public on an Account that is not is
   * not reachable — and its custom data must not be either.
   *
   * @param characterId - The Character being read.
   * @returns The owning Account, or null.
   */
  private async findPublicCharacterAccount(
    characterId: string,
  ): Promise<AccountEntity | null> {
    const character = await this._characterRepository.findOne({
      where: { id: characterId, publiclyVisible: true, deletedAt: IsNull() },
    });

    return character ? this.findPublicAccount(character.accountId) : null;
  }

  /**
   * Determines whether the owning member is publicly listed at all.
   *
   * A closed or disabled account takes its custom content with it without
   * anybody having to edit the content itself, which is what makes a ban
   * effective the moment it is applied.
   *
   * @param userId - The owner.
   * @returns True when the member is public and in good standing.
   */
  private async isMemberPublic(userId: string): Promise<boolean> {
    const profile = await this._profileRepository.findOne({
      where: { userId, publiclyVisible: true, deletedAt: IsNull() },
      relations: { user: true },
    });

    return (
      !!profile?.user &&
      profile.user.deletedAt === null &&
      !profile.user.isAccountDisabled
    );
  }

  /**
   * Reads which Field types are currently switched off.
   *
   * @returns The types no visitor may be shown.
   */
  private async disabledTypes(): Promise<Set<CustomTrackingFieldType>> {
    const disabled = new Set<CustomTrackingFieldType>();

    if (
      !(await this._features.isFlagEnabled(
        CUSTOM_TRACKING_FEATURE_FLAGS.IMAGES_ENABLED,
      ))
    ) {
      disabled.add(CustomTrackingFieldType.IMAGE);
    }

    if (
      !(await this._features.isFlagEnabled(
        CUSTOM_TRACKING_FEATURE_FLAGS.YOUTUBE_ENABLED,
      ))
    ) {
      disabled.add(CustomTrackingFieldType.YOUTUBE);
    }

    return disabled;
  }

  /**
   * Keeps only what a visitor is entitled to see.
   *
   * A Field whose type is switched off is left out of the page entirely rather
   * than rendered as an empty Field. An empty Field says its owner has not
   * answered it, which would be a statement about their data made to cover a
   * decision of ours.
   *
   * @param sections - The owner's whole hierarchy.
   * @param disabled - The Field types currently switched off.
   * @returns The permitted Sections, Tabs and Fields.
   */
  private filter(
    sections: CustomTrackingSectionNode[],
    disabled: Set<CustomTrackingFieldType>,
  ): CustomTrackingSectionNode[] {
    return sections
      .filter(node => this.isPublic(node.section))
      .map(node => ({
        section: node.section,
        tabs: node.tabs
          .filter(tab => this.isPublic(tab.tab))
          .map(tab => ({
            tab: tab.tab,
            fields: tab.fields.filter(
              field =>
                this.isPublic(field.field) &&
                !disabled.has(field.field.fieldType),
            ),
          }))
          .filter(tab => tab.fields.length > 0),
      }))
      .filter(node => node.tabs.length > 0);
  }

  /**
   * Determines whether one level of the hierarchy is publicly visible.
   *
   * @param node - A Section, Tab or Field.
   * @param node.publiclyVisible - Whether its owner published it.
   * @param node.suppressedAt - When an administrator withdrew it, if they did.
   * @returns True when a visitor may see it.
   */
  private isPublic(node: {
    publiclyVisible: boolean;
    suppressedAt: Date | null;
  }): boolean {
    return node.publiclyVisible && node.suppressedAt === null;
  }

  /**
   * Puts the answers against the Fields they answer.
   *
   * A Field with no answer survives only where its owner asked for it to. The
   * decision is taken here rather than in the browser, because a Field that
   * reached the page at all would still be in the response somebody can read.
   *
   * @param sections - The permitted hierarchy.
   * @param answers - Everything recorded against the target.
   * @returns The Sections a visitor may see, with their answers.
   */
  private attach(
    sections: CustomTrackingSectionNode[],
    answers: CustomTrackingStoredAnswer[],
  ): CustomTrackingPublicSection[] {
    const byField = new Map(
      answers.map(answer => [answer.fieldId, answer] as const),
    );

    return sections
      .map(node => ({
        section: node.section,
        tabs: node.tabs
          .map(tab => ({
            tab: tab.tab,
            fields: tab.fields
              .map(field => this.toPublicField(field, byField))
              .filter(
                (field): field is CustomTrackingPublicField => field !== null,
              ),
          }))
          .filter(tab => tab.fields.length > 0),
      }))
      .filter(node => node.tabs.length > 0);
  }

  /**
   * Decides whether one Field reaches the page, and with what.
   *
   * @param node - The Field and the options it offers.
   * @param byField - Everything recorded, by Field.
   * @returns The Field with its answer, or null where it is to be left out.
   */
  private toPublicField(
    node: CustomTrackingFieldNode,
    byField: Map<string, CustomTrackingStoredAnswer>,
  ): CustomTrackingPublicField | null {
    const answer = byField.get(node.field.id) ?? null;

    if (answer === null) {
      return node.field.publicEmptyMode === CustomTrackingEmptyMode.HIDE
        ? null
        : { field: node.field, chosen: [], answer: null };
    }

    return {
      field: node.field,
      chosen: this.chosenOptions(node.options, answer.optionIds),
      answer,
    };
  }

  /**
   * Resolves the options an answer chose, in the order it chose them.
   *
   * @param options - Every option the Field offers.
   * @param optionIds - The identifiers the answer holds.
   * @returns The chosen options.
   */
  private chosenOptions(
    options: CustomTrackingOptionEntity[],
    optionIds: string[],
  ): CustomTrackingOptionEntity[] {
    const byId = new Map(options.map(option => [option.id, option] as const));

    return optionIds
      .map(optionId => byId.get(optionId))
      .filter((option): option is CustomTrackingOptionEntity => !!option);
  }
}
