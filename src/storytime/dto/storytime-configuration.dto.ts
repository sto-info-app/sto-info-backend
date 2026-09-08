import { ApiProperty } from '@nestjs/swagger';

import { ContentRating } from '../enums/content-rating.enum';

/**
 * A language creators may choose for a Story or Chapter.
 */
export class StorytimeLanguageDto {
  @ApiProperty({ description: 'BCP 47 language tag.', example: 'de' })
  readonly code: string;

  @ApiProperty({ description: 'English name of the language.' })
  readonly name: string;
}

/**
 * Which parts of Storytime are currently switched on.
 */
export class StorytimeFeatureStateDto {
  @ApiProperty({ description: 'Whether Storytime is available at all.' })
  readonly isEnabled: boolean;

  @ApiProperty({ description: 'Whether Storytime content may be read.' })
  readonly publicReadEnabled: boolean;

  @ApiProperty({ description: 'Whether Stories may be created and edited.' })
  readonly creationEnabled: boolean;

  @ApiProperty({ description: 'Whether YouTube media may be attached.' })
  readonly youTubeEnabled: boolean;

  @ApiProperty({ description: 'Whether the Spotlight is surfaced.' })
  readonly spotlightEnabled: boolean;
}

/**
 * Everything the client needs to render Storytime consistently with the server.
 *
 * Served rather than duplicated in the frontend so that the language list, the
 * content ratings and the feature switches cannot drift between the two — a
 * client offering a language the server rejects is a bug nobody notices until
 * a creator hits it.
 */
export class StorytimeConfigurationDto {
  @ApiProperty({
    description: 'Which parts of Storytime are switched on.',
    type: StorytimeFeatureStateDto,
  })
  readonly features: StorytimeFeatureStateDto;

  @ApiProperty({
    description: 'Languages a creator may choose from.',
    type: [StorytimeLanguageDto],
  })
  readonly languages: StorytimeLanguageDto[];

  @ApiProperty({
    description: 'The language assumed when a creator expresses no preference.',
    example: 'en',
  })
  readonly defaultLanguageCode: string;

  @ApiProperty({
    description: 'Content ratings a Story may carry.',
    enum: ContentRating,
    isArray: true,
  })
  readonly contentRatings: ContentRating[];
}
