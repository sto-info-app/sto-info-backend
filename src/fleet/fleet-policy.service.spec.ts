import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { jest } from '@jest/globals';

import {
  CHAT_MEMBER_HISTORY_HOURS,
  CHAT_TRANSCRIPT_HISTORY_DAYS,
  FLEET_CUSTOM_CHANNEL_LIMIT,
  PUBLISHED_CHAT_RETENTION_DAYS,
  PUBLISHED_IMPORT_SOURCE_RETENTION_DAYS,
} from './constants/fleet-policy.constants';
import { FleetPolicyService } from './fleet-policy.service';

describe('FleetPolicyService', () => {
  let service: FleetPolicyService;
  let configService: { get: jest.Mock<(...args: any[]) => any> };

  beforeEach(async () => {
    configService = { get: jest.fn<(...args: any[]) => any>() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FleetPolicyService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(FleetPolicyService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * The three fixed figures ignore configuration entirely, so the assertion is
   * that a hostile environment changes nothing.
   */
  describe('the fixed figures', () => {
    it('reports them whatever configuration says', () => {
      configService.get.mockReturnValue('999');

      expect(service.chatMemberHistoryHours).toBe(CHAT_MEMBER_HISTORY_HOURS);
      expect(service.chatTranscriptHistoryDays).toBe(
        CHAT_TRANSCRIPT_HISTORY_DAYS,
      );
      expect(service.customChannelLimit).toBe(FLEET_CUSTOM_CHANNEL_LIMIT);
    });

    it('does not consult configuration for them at all', () => {
      void service.chatMemberHistoryHours;
      void service.chatTranscriptHistoryDays;
      void service.customChannelLimit;

      expect(configService.get).not.toHaveBeenCalled();
    });
  });

  describe('the configurable figures', () => {
    it('uses the published values when nothing is configured', () => {
      configService.get.mockReturnValue(undefined);

      expect(service.chatRetentionDays).toBe(PUBLISHED_CHAT_RETENTION_DAYS);
      expect(service.importSourceRetentionDays).toBe(
        PUBLISHED_IMPORT_SOURCE_RETENTION_DAYS,
      );
    });

    it('uses the published values when configuration is null', () => {
      configService.get.mockReturnValue(null);

      expect(service.chatRetentionDays).toBe(PUBLISHED_CHAT_RETENTION_DAYS);
    });

    it.each([
      ['30', 30],
      [30, 30],
      ['365', 365],
    ])('reads %s as %s days', (configured, expected) => {
      configService.get.mockReturnValue(configured);

      expect(service.chatRetentionDays).toBe(expected);
    });

    it('reads each figure from its own key', () => {
      configService.get.mockImplementation((key: string) =>
        key === 'CHAT_RETENTION_DAYS' ? '30' : '365',
      );

      expect(service.chatRetentionDays).toBe(30);
      expect(service.importSourceRetentionDays).toBe(365);
    });

    /**
     * A mistyped environment variable must not be able to stop a retention job
     * from running, so an unreadable value falls back to the published figure —
     * but it is logged, because a deployment silently ignoring its own
     * configuration is its own kind of failure.
     */
    it.each(['forever', '', '0', '-5', '45.5', 'NaN'])(
      'falls back and warns on %s',
      configured => {
        const warn = jest
          .spyOn(Logger.prototype, 'warn')
          .mockImplementation(() => undefined);
        configService.get.mockReturnValue(configured);

        expect(service.chatRetentionDays).toBe(PUBLISHED_CHAT_RETENTION_DAYS);
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('CHAT_RETENTION_DAYS'),
        );
      },
    );
  });
});
