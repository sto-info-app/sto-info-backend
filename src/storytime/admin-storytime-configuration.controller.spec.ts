import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { FeatureSwitch } from '../settings/feature-switches/feature-switch.constants';
import { FeatureSwitchesService } from '../settings/feature-switches/feature-switches.service';
import { AdminStorytimeConfigurationController } from './admin-storytime-configuration.controller';
import { StorytimeFeatureService } from './storytime-feature.service';

describe('AdminStorytimeConfigurationController', () => {
  let controller: AdminStorytimeConfigurationController;
  let featureService: { getState: jest.Mock };
  let switches: { set: jest.Mock };

  const adminId = 'e6d3a1b2-0000-4000-8000-0000000000ad';
  const reason = 'Storytime goes live';

  beforeEach(async () => {
    featureService = {
      getState: jest.fn().mockResolvedValue({ isEnabled: true }),
    };
    switches = { set: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminStorytimeConfigurationController],
      providers: [
        { provide: StorytimeFeatureService, useValue: featureService },
        { provide: FeatureSwitchesService, useValue: switches },
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

  // FC-045: the same path as the Admin page's switches, so the change is
  // logged with its reason whichever way it came.
  it('switches Storytime on through the feature switches, with the administrator and reason', async () => {
    await controller.setEnabled({ isEnabled: true, reason }, adminId);

    expect(switches.set).toHaveBeenCalledWith(
      FeatureSwitch.STORYTIME,
      true,
      adminId,
      reason,
    );
  });

  it('switches Storytime off', async () => {
    await controller.setEnabled({ isEnabled: false, reason }, adminId);

    expect(switches.set).toHaveBeenCalledWith(
      FeatureSwitch.STORYTIME,
      false,
      adminId,
      reason,
    );
  });

  it('returns the resulting state so the caller sees what actually applied', async () => {
    featureService.getState.mockResolvedValue({ isEnabled: false });

    await expect(
      controller.setEnabled({ isEnabled: false, reason }, adminId),
    ).resolves.toEqual({ isEnabled: false });
  });

  it('passes on a refusal when Storytime is already in that position, reading nothing', async () => {
    switches.set.mockRejectedValue(
      new ConflictException('Storytime is already switched on.'),
    );

    await expect(
      controller.setEnabled({ isEnabled: true, reason }, adminId),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(featureService.getState).not.toHaveBeenCalled();
  });
});
