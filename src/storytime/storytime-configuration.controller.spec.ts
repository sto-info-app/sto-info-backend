import { Test, TestingModule } from '@nestjs/testing';

import { ContentRating } from './enums/content-rating.enum';
import { StorytimeConfigurationController } from './storytime-configuration.controller';
import { StorytimeFeatureService } from './storytime-feature.service';

describe('StorytimeConfigurationController', () => {
  let controller: StorytimeConfigurationController;
  let featureService: { getState: jest.Mock };

  const enabledState = {
    isEnabled: true,
    publicReadEnabled: true,
    creationEnabled: true,
    youTubeEnabled: true,
    spotlightEnabled: true,
  };

  beforeEach(async () => {
    featureService = { getState: jest.fn().mockResolvedValue(enabledState) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StorytimeConfigurationController],
      providers: [
        { provide: StorytimeFeatureService, useValue: featureService },
      ],
    }).compile();

    controller = module.get<StorytimeConfigurationController>(
      StorytimeConfigurationController,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('reports the current feature state', async () => {
    const configuration = await controller.getConfiguration();

    expect(configuration.features).toEqual(enabledState);
  });

  it('offers the curated language list including Klingon', async () => {
    const configuration = await controller.getConfiguration();
    const codes = configuration.languages.map(language => language.code);

    expect(codes).toEqual(['en-GB', 'en-US', 'de', 'fr', 'tlh']);
    expect(codes).toContain('tlh');
    expect(configuration.defaultLanguageCode).toBe('en-GB');
  });

  it('names every language it offers', async () => {
    const configuration = await controller.getConfiguration();

    expect(
      configuration.languages.every(language => language.name.length > 0),
    ).toBe(true);
  });

  it('offers every content rating', async () => {
    const configuration = await controller.getConfiguration();

    expect(configuration.contentRatings).toEqual([
      ContentRating.GENERAL,
      ContentRating.MATURE,
      ContentRating.ADULTS_ONLY,
    ]);
  });

  // The client learns Storytime is off from this endpoint, so it has to keep
  // answering when the feature is disabled.
  it('still answers when Storytime is switched off', async () => {
    featureService.getState.mockResolvedValue({
      isEnabled: false,
      publicReadEnabled: false,
      creationEnabled: false,
      youTubeEnabled: false,
      spotlightEnabled: false,
    });

    const configuration = await controller.getConfiguration();

    expect(configuration.features.isEnabled).toBe(false);
    expect(configuration.languages.length).toBeGreaterThan(0);
  });
});
