import { Injectable } from '@nestjs/common';
import { ChapterAppearanceDto } from './dto/appearance.dto';
import { CharacterDto, ManagedCharacterDto } from './dto/character.dto';
import { StorytimeChapterCharacterEntity } from './entities/storytime-chapter-character.entity';
import { StorytimeCharacterEntity } from './entities/storytime-character.entity';

/**
 * Turns Character entities into the shapes the API returns.
 *
 * Two shapes, built separately rather than one shape with fields stripped
 * afterwards. Removing fields from a full object is easy to forget when a
 * column is added later; building the public shape explicitly means a new
 * column stays private until somebody decides otherwise.
 */
@Injectable()
export class StorytimeCharacterMapper {
  /**
   * Maps a Character to their reader-facing shape.
   *
   * @param character - The Character entity.
   * @returns The reader-facing Character.
   */
  toPublic(character: StorytimeCharacterEntity): CharacterDto {
    return {
      id: character.id,
      storyId: character.storyId,
      slug: character.slug,
      name: character.name,
      shortBio: character.shortBio,
      biographyHtml: character.biographyHtml,
      portraitImageUrl: character.portraitImageUrl,
      portraitImageThumbnailUrl: character.portraitImageThumbnailUrl,
      portraitImageAlt: character.portraitImageAlt,
      species: character.species,
      faction: character.faction,
      rank: character.rank,
      occupation: character.occupation,
      affiliation: character.affiliation,
      shipAssignment: character.shipAssignment,
      traits: character.traits,
      isPrimary: character.isPrimary,
      displayOrder: character.displayOrder,
    };
  }

  /**
   * Maps a Character to the shape their creator manages them through.
   *
   * @param character - The Character entity.
   * @returns The creator-facing Character.
   */
  toManaged(character: StorytimeCharacterEntity): ManagedCharacterDto {
    return {
      ...this.toPublic(character),
      biographySource: character.biographySource,
      portraitImageId: character.portraitImageId,
      version: character.version,
      moderationStatus: character.moderationStatus,
      moderationMessage: character.moderationMessage,
    };
  }

  /**
   * Maps several Characters to their reader-facing shape.
   *
   * @param characters - The Character entities.
   * @returns The reader-facing Characters.
   */
  toPublicList(characters: StorytimeCharacterEntity[]): CharacterDto[] {
    return characters.map(character => this.toPublic(character));
  }

  /**
   * Maps several Characters to their creator-facing shape.
   *
   * @param characters - The Character entities.
   * @returns The creator-facing Characters.
   */
  toManagedList(characters: StorytimeCharacterEntity[]): ManagedCharacterDto[] {
    return characters.map(character => this.toManaged(character));
  }

  /**
   * Maps appearances, pairing each with its Character.
   *
   * An appearance whose Character has been deleted maps to a null Character
   * rather than being dropped, so a caller counting appearances and a caller
   * listing them never disagree.
   *
   * @param appearances - The appearance rows.
   * @param characters - The Characters they refer to.
   * @returns The reader-facing appearances.
   */
  toAppearanceList(
    appearances: StorytimeChapterCharacterEntity[],
    characters: StorytimeCharacterEntity[],
  ): ChapterAppearanceDto[] {
    const byId = new Map(
      characters.map(character => [character.id, this.toPublic(character)]),
    );

    return appearances.map(appearance => ({
      chapterId: appearance.chapterId,
      appearanceOrder: appearance.appearanceOrder,
      isPrimary: appearance.isPrimary,
      appearanceNotes: appearance.appearanceNotes,
      character: byId.get(appearance.characterId) ?? null,
    }));
  }
}
