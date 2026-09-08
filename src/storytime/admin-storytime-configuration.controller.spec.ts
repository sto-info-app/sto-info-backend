import { Test, TestingModule } from '@nestjs/testing';

import { SettingsService } from '../settings/settings.service';
import { AdminStorytimeConfigurationController } from './admin-storytime-configuration.controller';
import { StorytimeFeatureService } from './storytime-feature.service';

describe('AdminStorytimeConfigurationController', () => {
  let controller: AdminStorytimeConfigurationController;
  let featureService: { getState: jest.Mock };
  let settingsService: { setValue: jest.Mock };

  const adminId = 'e6d3a1b2-0000-4000-8000-0000000000ad';

  beforeEach(async () => {
    featureService = {
      getState: jest.fn().mockResolvedValue({ isEnabled: true }),
    };
    settingsService = { setValue: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminStorytimeConfigurationController],
      providers: [
        { provide: StorytimeFeatureService, useValue: featureService },
        { provide: SettingsService, useValue: settingsService },
      ],
    }).compile();

    controller = module.get<AdminStorytimeConfigurationController>(
      AdminStorytimeConfigurationController,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('reports the current feature state', async () => {
    await expect(controller.getFeatureState()).resolves.toEqual({
      isEnabled: true,
    });
  });

  it('switches Storytime on, recording the administrator', async () => {
    await controller.setEnabled({ isEnabled: true }, adminId);

    expect(settingsService.setValue).toHaveBeenCalledWith(
      'STORYTIME_ENABLED',
      'true',
      adminId,
    );
  });

  it('switches Storytime off', async () => {
    await controller.setEnabled({ isEnabled: false }, adminId);

    expect(settingsService.setValue).toHaveBeenCalledWith(
      'STORYTIME_ENABLED',
      'false',
      adminId,
    );
  });

  it('returns the resulting state so the caller sees what actually applied', async () => {
    featureService.getState.mockResolvedValue({ isEnabled: false });

    await expect(
      controller.setEnabled({ isEnabled: false }, adminId),
    ).resolves.toEqual({ isEnabled: false });
  });
});
