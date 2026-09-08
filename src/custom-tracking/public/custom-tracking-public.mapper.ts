import { Injectable } from '@nestjs/common';

import {
  CustomTrackingPublicChoiceDto,
  CustomTrackingPublicFieldDto,
  CustomTrackingPublicSectionDto,
  CustomTrackingPublicTabDto,
} from '../dto/custom-tracking-public.dto';
import { CustomTrackingFieldType } from '../enums/custom-tracking-field-type.enum';
import {
  CustomTrackingPublicField,
  CustomTrackingPublicSection,
  CustomTrackingPublicTab,
} from './custom-tracking-public.service';

/**
 * Turning a permitted projection into what an anonymous visitor is sent.
 *
 * Written out property by property rather than spread from the entity. Every
 * one of these objects is destined for a page a search engine may index, and a
 * spread would publish whatever somebody adds to the entity next — the
 * administrator who suppressed something, the moment a value was last edited,
 * the identifier of an option nobody chose.
 *
 * The empty mode arrives already resolved to the public one, so nothing
 * downstream has to remember which of the two a visitor is subject to.
 */
@Injectable()
export class CustomTrackingPublicMapper {
  /**
   * Maps a permitted Section and everything beneath it.
   *
   * @param section - The permitted Section.
   * @returns What a visitor is sent.
   */
  toSection(
    section: CustomTrackingPublicSection,
  ): CustomTrackingPublicSectionDto {
    return {
      id: section.section.id,
      name: section.section.name,
      description: section.section.description,
      tabs: section.tabs.map(tab => this.toTab(tab)),
    };
  }

  /**
   * Maps a permitted Tab and the Fields left in it.
   *
   * @param tab - The permitted Tab.
   * @returns What a visitor is sent.
   */
  private toTab(tab: CustomTrackingPublicTab): CustomTrackingPublicTabDto {
    return {
      id: tab.tab.id,
      name: tab.tab.name,
      description: tab.tab.description,
      fields: tab.fields.map(field => this.toField(field)),
    };
  }

  /**
   * Maps a permitted Field and what is recorded against it.
   *
   * @param node - The permitted Field.
   * @returns What a visitor is sent.
   */
  private toField(
    node: CustomTrackingPublicField,
  ): CustomTrackingPublicFieldDto {
    return {
      id: node.field.id,
      fieldType: node.field.fieldType,
      name: node.field.name,
      description: node.field.description,
      configuration: node.field.configuration as unknown as Record<
        string,
        unknown
      >,
      emptyMode: node.field.publicEmptyMode,
      emptyPlaceholder: node.field.emptyPlaceholder,
      value: (node.answer?.fragment ?? null) as Record<string, unknown> | null,
      chosen: node.chosen.map(option => this.toChoice(option)),
      image: this.toImage(node),
    };
  }

  /**
   * Maps one chosen option.
   *
   * A withdrawn option is mapped like any other and is not marked as
   * withdrawn. Whether its owner has since stopped offering a label is a fact
   * about their vocabulary, not about the value: the answer said this, and
   * that is what a visitor is shown.
   *
   * @param option - The option chosen.
   * @param option.id - Its identifier.
   * @param option.label - What it is called.
   * @returns What a visitor is sent.
   */
  private toChoice(option: {
    id: string;
    label: string;
  }): CustomTrackingPublicChoiceDto {
    return { id: option.id, label: option.label };
  }

  /**
   * Maps the picture answering an image Field.
   *
   * The Cloudflare identifier is published only here, at the end of the whole
   * visibility chain. A picture answering any other kind of Field would be a
   * stored inconsistency rather than something to render, so the type is
   * checked rather than assumed from the presence of a row.
   *
   * @param node - The permitted Field.
   * @returns The picture, or null.
   */
  private toImage(
    node: CustomTrackingPublicField,
  ): CustomTrackingPublicFieldDto['image'] {
    const image = node.answer?.image;

    if (!image || node.field.fieldType !== CustomTrackingFieldType.IMAGE) {
      return null;
    }

    return {
      imageId: image.cloudflareImageId,
      altText: image.altText,
      shape: image.shape,
    };
  }
}
