import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  STORYTIME_DEFAULT_LANGUAGE_CODE,
  STORYTIME_LANGUAGES,
} from './constants/storytime-language.constants';
import { StorytimeConfigurationDto } from './dto/storytime-configuration.dto';
import { ContentRating } from './enums/content-rating.enum';
import { StorytimeFeatureService } from './storytime-feature.service';

/**
 * What the client needs to render Storytime consistently with the server.
 *
 * Unauthenticated on purpose: the feature switches decide whether anonymous
 * readers see Storytime at all, so the client has to be able to ask before it
 * knows who is looking.
 *
 * This endpoint stays reachable when Storytime is switched off — it is how the
 * client learns that, and refusing to answer would leave it unable to hide the
 * feature.
 */
@ApiTags('Storytime')
@Controller('storytime/configuration')
export class StorytimeConfigurationController {
  /**
   * Creates an instance of StorytimeConfigurationController.
   *
   * @param _featureService - Reports which parts of Storytime are switched on.
   */
  constructor(private readonly _featureService: StorytimeFeatureService) {}

  /**
   * Reports the feature switches, languages and content ratings.
   *
   * @returns The Storytime client configuration.
   */
  @Get()
  @ApiOperation({ summary: 'Get the Storytime client configuration' })
  @ApiOkResponse({ type: StorytimeConfigurationDto })
  async getConfiguration(): Promise<StorytimeConfigurationDto> {
    return {
      features: await this._featureService.getState(),
      languages: STORYTIME_LANGUAGES.map(language => ({ ...language })),
      defaultLanguageCode: STORYTIME_DEFAULT_LANGUAGE_CODE,
      contentRatings: Object.values(ContentRating),
    };
  }
}
