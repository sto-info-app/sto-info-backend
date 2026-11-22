import { Test, TestingModule } from '@nestjs/testing';

import { jest } from '@jest/globals';

import { FleetConfigurationController } from './fleet-configuration.controller';
import { FleetFeatureService } from './fleet-feature.service';
import { FleetPolicyService } from './fleet-policy.service';

describe('FleetConfigurationController', () => {
  let controller: FleetConfigurationController;
  let featureService: { getState: jest.Mock<(...args: any[]) => Promise<any>> };

  const DISABLED = {
    isEnabled: false,
    registrationEnabled: false,
    importsEnabled: false,
    chatEnabled: false,
  };

  beforeEach(async () => {
    featureService = {
      getState: jest
        .fn<(...args: any[]) => Promise<any>>()
        .mockResolvedValue(DISABLED),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FleetConfigurationController],
      providers: [
        { provide: FleetFeatureService, useValue: featureService },
        {
          provide: FleetPolicyService,
          useValue: {
            chatMemberHistoryHours: 4,
            chatTranscriptHistoryDays: 7,
            customChannelLimit: 3,
            chatRetentionDays: 45,
            importSourceRetentionDays: 180,
          },
        },
      ],
    }).compile();

    controller = module.get(FleetConfigurationController);
  });

  /**
   * The endpoint has to answer while the feature is off, because this is how
   * the client learns that it is off. Refusing would leave the client unable to
   * hide the feature, which is the opposite of what a kill switch is for.
   */
  it('answers while Fleet Community is switched off', async () => {
    await expect(controller.getConfiguration()).resolves.toEqual({
      features: DISABLED,
      policy: {
        chatMemberHistoryHours: 4,
        chatTranscriptHistoryDays: 7,
        customChannelLimit: 3,
        chatRetentionDays: 45,
        importSourceRetentionDays: 180,
      },
    });
  });

  it('reports the switches as the feature service reads them', async () => {
    featureService.getState.mockResolvedValue({
      isEnabled: true,
      registrationEnabled: true,
      importsEnabled: false,
      chatEnabled: true,
    });

    const configuration = await controller.getConfiguration();

    expect(configuration.features.importsEnabled).toBe(false);
    expect(configuration.features.chatEnabled).toBe(true);
  });

  /**
   * The figures are served rather than repeated in client code, so that the
   * numbers a user reads are the ones the server enforces. A client that had
   * its own copy would go on saying "the last four hours" after the server
   * stopped meaning it.
   */
  it('serves the published figures rather than leaving them to the client', async () => {
    const { policy } = await controller.getConfiguration();

    expect(Object.values(policy)).toEqual([4, 7, 3, 45, 180]);
  });
});
