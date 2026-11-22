import { Logger } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { Job } from 'bullmq';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ROLES_KEY } from 'src/auth/roles.decorator';
import { UserRole } from 'src/user/enums/user-role.enum';

import { FileRescanCampaignEntity } from './file-rescan-campaign.entity';
import { RescanCampaignController } from './rescan-campaign.controller';
import {
  RescanCampaignProcessor,
  RescanScheduler,
} from './rescan-campaign.processor';
import { RescanCampaignService } from './rescan-campaign.service';
import {
  declaredTypeOf,
  UNKNOWN_CONTENT_TYPE,
} from './rescan-content-type.utility';
import { RescanVerdictService } from './rescan-verdict.service';
import { DecideRescanFindingDto, StartRescanCampaignDto } from './rescan.dto';
import {
  RescanCampaignKind,
  RescanCampaignState,
  RescanDecision,
} from './rescan.enums';

type Fn = jest.Mock<(...args: any[]) => any>;

const CAMPAIGN = {
  id: 'campaign-1',
  kind: RescanCampaignKind.MANUAL,
  state: RescanCampaignState.RUNNING,
  startedByUserId: 'admin-1',
  selection: { kinds: ['PROFILE_IMAGE'] },
  cursor: 'asset-9',
  counts: { requested: 3 },
  lastError: null,
  createdAt: new Date('2026-09-29T10:00:00.000Z'),
  updatedAt: new Date('2026-09-29T10:01:00.000Z'),
  finishedAt: null,
} as FileRescanCampaignEntity;

const CAMPAIGN_DTO = {
  id: 'campaign-1',
  kind: RescanCampaignKind.MANUAL,
  state: RescanCampaignState.RUNNING,
  selection: { kinds: ['PROFILE_IMAGE'] },
  counts: { requested: 3 },
  lastError: null,
  createdAt: CAMPAIGN.createdAt,
  finishedAt: null,
};

describe('Rescan campaign routes, jobs and helpers (FC-041)', () => {
  let campaigns: Record<string, Fn>;
  let verdicts: Record<string, Fn>;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    campaigns = {
      overview: jest.fn(() =>
        Promise.resolve({
          campaigns: [CAMPAIGN],
          waiting: 2,
          unverified: 5,
          findings: [],
        }),
      ),
      start: jest.fn(() => Promise.resolve(CAMPAIGN)),
      pause: jest.fn(() => Promise.resolve(CAMPAIGN)),
      resume: jest.fn(() => Promise.resolve(CAMPAIGN)),
      cancel: jest.fn(() => Promise.resolve(CAMPAIGN)),
      processBatch: jest.fn(() => Promise.resolve()),
      startLegacyOnce: jest.fn(() => Promise.resolve(null)),
      sweepStale: jest.fn(() => Promise.resolve(0)),
    };
    verdicts = { decide: jest.fn(() => Promise.resolve()) };
  });

  describe('RescanCampaignController', () => {
    const controller = () =>
      new RescanCampaignController(
        campaigns as unknown as RescanCampaignService,
        verdicts as unknown as RescanVerdictService,
      );

    it('passes a decision on a policy refusal on with the admin and reason', async () => {
      await controller().decide('rescan-1', 'admin-1', {
        decision: RescanDecision.TAKEN_DOWN,
        reason: 'Breaks the rules',
      } as DecideRescanFindingDto);

      expect(verdicts.decide).toHaveBeenCalledWith(
        'rescan-1',
        'admin-1',
        RescanDecision.TAKEN_DOWN,
        'Breaks the rules',
      );
    });

    it('is for administrators only, at admin/rescan-campaigns', () => {
      expect(Reflect.getMetadata(ROLES_KEY, RescanCampaignController)).toEqual([
        UserRole.ADMIN,
      ]);
      expect(Reflect.getMetadata(PATH_METADATA, RescanCampaignController)).toBe(
        'admin/rescan-campaigns',
      );
    });

    it('reads the overview, and passes each action on with the admin and reason', async () => {
      await expect(controller().overview()).resolves.toEqual({
        campaigns: [CAMPAIGN_DTO],
        waiting: 2,
        unverified: 5,
        findings: [],
      });

      await expect(
        controller().start('admin-1', {
          selection: { kinds: [] },
          reason: 'New signatures',
        } as unknown as StartRescanCampaignDto),
      ).resolves.toEqual(CAMPAIGN_DTO);
      expect(campaigns.start).toHaveBeenCalledWith(
        { kinds: [] },
        'admin-1',
        'New signatures',
      );

      await controller().pause('campaign-1', 'admin-1', { reason: 'Busy' });
      await controller().resume('campaign-1', 'admin-1', { reason: 'Quiet' });
      await controller().cancel('campaign-1', 'admin-1', { reason: 'Wrong' });
      expect(campaigns.pause).toHaveBeenCalledWith(
        'campaign-1',
        'admin-1',
        'Busy',
      );
      expect(campaigns.resume).toHaveBeenCalledWith(
        'campaign-1',
        'admin-1',
        'Quiet',
      );
      expect(campaigns.cancel).toHaveBeenCalledWith(
        'campaign-1',
        'admin-1',
        'Wrong',
      );
    });
  });

  describe('StartRescanCampaignDto', () => {
    /**
     * The properties a body fails on.
     *
     * @param body - The body.
     * @returns Each failing property, with its children.
     */
    const failures = async (body: object) =>
      (await validate(plainToInstance(StartRescanCampaignDto, body))).map(
        error =>
          error.children?.length
            ? error.children.map(child => child.property)
            : error.property,
      );

    it('takes a selection and a reason', async () => {
      await expect(
        failures({
          reason: 'New signatures',
          selection: {
            kinds: ['PROFILE_IMAGE'],
            uploadedFrom: '2026-01-01T00:00:00.000Z',
            notScannedForDays: '90',
            unverifiedOnly: false,
            priority: 'HIGH',
          },
        }),
      ).resolves.toEqual([]);
    });

    it('refuses a roster file, a bad date, a bad priority and no reason', async () => {
      await expect(
        failures({
          selection: {
            kinds: ['ROSTER_IMPORT_SOURCE'],
            uploadedBefore: 'yesterday',
            priority: 'URGENT',
          },
        }),
      ).resolves.toEqual(
        expect.arrayContaining([
          'reason',
          ['kinds', 'uploadedBefore', 'priority'],
        ]),
      );
    });
  });

  describe('RescanCampaignProcessor and RescanScheduler', () => {
    it('runs a batch, and drops anything else', async () => {
      const processor = new RescanCampaignProcessor(
        campaigns as unknown as RescanCampaignService,
      );
      const error = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await processor.process({
        id: 'job-1',
        name: 'campaign-batch',
        data: { campaignId: 'campaign-1' },
      } as Job<unknown>);
      await processor.process({
        id: 'job-2',
        name: 'campaign-batch',
        data: null,
      } as Job<unknown>);
      await processor.process({
        id: 'job-3',
        name: 'other',
        data: { campaignId: 'campaign-1' },
      } as Job<unknown>);

      expect(campaigns.processBatch).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledTimes(2);
    });

    it('starts the legacy campaign and sweeps, and survives a failure', async () => {
      const scheduler = new RescanScheduler(
        campaigns as unknown as RescanCampaignService,
      );
      const error = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await scheduler.run();
      expect(campaigns.startLegacyOnce).toHaveBeenCalled();
      expect(campaigns.sweepStale).toHaveBeenCalled();

      campaigns.startLegacyOnce.mockRejectedValue(new Error('down'));
      await scheduler.run();
      campaigns.startLegacyOnce.mockRejectedValue('down');
      await scheduler.run();

      expect(
        error.mock.calls.filter(([message]) =>
          String(message).startsWith('[run]'),
        ),
      ).toHaveLength(2);
    });
  });

  describe('declaredTypeOf', () => {
    it.each([
      [[0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0], 'image/png'],
      [[0xff, 0xd8, 0xff, 0xe0], 'image/jpeg'],
      [[0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 'image/gif'],
      [
        [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
        'image/webp',
      ],
      [[0x42, 0x4d, 0, 0], 'image/bmp'],
      [[0x70, 0x6c, 0x61, 0x69, 0x6e], UNKNOWN_CONTENT_TYPE],
      [[], UNKNOWN_CONTENT_TYPE],
    ])('reads %j as %s', (bytes, type) => {
      expect(declaredTypeOf(Buffer.from(bytes))).toBe(type);
    });
  });
});
