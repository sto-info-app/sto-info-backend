import { NotFoundException } from '@nestjs/common';

import { jest } from '@jest/globals';

import { CUSTOM_TRACKING_FEATURE_FLAGS } from '../constants/custom-tracking-feature.constants';
import { CustomTrackingFeatureService } from '../custom-tracking-feature.service';
import { CustomTrackingDefinitionMapper } from '../definitions/custom-tracking-definition.mapper';
import { CustomTrackingTargetScope } from '../enums/custom-tracking-target-scope.enum';
import { CustomTrackingRecordMapper } from './custom-tracking-record.mapper';
import {
  CustomTrackingTarget,
  CustomTrackingTargetService,
} from './custom-tracking-target.service';
import {
  CustomTrackingRecord,
  CustomTrackingValueService,
} from './custom-tracking-value.service';
import { CustomTrackingValuesController } from './custom-tracking-values.controller';

describe('CustomTrackingValuesController', () => {
  const userId = 'user-1';
  const scope = CustomTrackingTargetScope.ACCOUNT;

  const target: CustomTrackingTarget = {
    scope,
    id: 'account-1',
    label: 'ares',
    publiclyVisible: true,
  };

  const record: CustomTrackingRecord = {
    target,
    sections: [],
    answers: [],
  };

  let controller: CustomTrackingValuesController;
  let loadRecord: jest.Mock<() => Promise<CustomTrackingRecord>>;
  let saveRecord: jest.Mock<
    (
      userId: string,
      scope: CustomTrackingTargetScope,
      targetId: string,
      answers: { fieldId: string; value: unknown }[],
    ) => Promise<CustomTrackingRecord>
  >;
  let listOwned: jest.Mock<() => Promise<CustomTrackingTarget[]>>;
  let assertFlagEnabled: jest.Mock<() => Promise<void>>;

  beforeEach(() => {
    loadRecord = jest
      .fn<() => Promise<CustomTrackingRecord>>()
      .mockResolvedValue(record);
    saveRecord = jest
      .fn<
        (
          userId: string,
          scope: CustomTrackingTargetScope,
          targetId: string,
          answers: { fieldId: string; value: unknown }[],
        ) => Promise<CustomTrackingRecord>
      >()
      .mockResolvedValue(record);
    listOwned = jest
      .fn<() => Promise<CustomTrackingTarget[]>>()
      .mockResolvedValue([target]);
    assertFlagEnabled = jest.fn<() => Promise<void>>().mockResolvedValue();

    controller = new CustomTrackingValuesController(
      { loadRecord, saveRecord } as unknown as CustomTrackingValueService,
      { listOwned } as unknown as CustomTrackingTargetService,
      { assertFlagEnabled } as unknown as CustomTrackingFeatureService,
      new CustomTrackingRecordMapper(new CustomTrackingDefinitionMapper()),
    );
  });

  describe('listTargets', () => {
    it('lists the caller’s records for the scope in the path', async () => {
      await expect(controller.listTargets(userId, scope)).resolves.toEqual([
        {
          scope,
          id: 'account-1',
          label: 'ares',
          publiclyVisible: true,
        },
      ]);
      expect(listOwned).toHaveBeenCalledWith(userId, scope);
    });

    it('reports the feature as absent when it is switched off', async () => {
      assertFlagEnabled.mockRejectedValue(new NotFoundException());

      await expect(controller.listTargets(userId, scope)).rejects.toThrow(
        NotFoundException,
      );
      expect(listOwned).not.toHaveBeenCalled();
    });
  });

  describe('loadRecord', () => {
    it('loads the record named by the path', async () => {
      await expect(
        controller.loadRecord(userId, scope, 'account-1'),
      ).resolves.toMatchObject({ target: { id: 'account-1' } });
      expect(loadRecord).toHaveBeenCalledWith(userId, scope, 'account-1');
    });

    // Reading is not gated on the agreement: a user whose acceptance has been
    // superseded keeps full sight of what they have already recorded.
    it('requires only that the feature is readable', async () => {
      await controller.loadRecord(userId, scope, 'account-1');

      expect(assertFlagEnabled).toHaveBeenCalledWith(
        CUSTOM_TRACKING_FEATURE_FLAGS.PUBLIC_READ_ENABLED,
      );
    });
  });

  describe('saveRecord', () => {
    it('passes the whole submission through', async () => {
      await controller.saveRecord(userId, scope, 'account-1', {
        answers: [
          { fieldId: 'field-1', value: { text: 'USS Ares' } },
          { fieldId: 'field-2', value: null },
        ],
      });

      expect(saveRecord).toHaveBeenCalledWith(userId, scope, 'account-1', [
        { fieldId: 'field-1', value: { text: 'USS Ares' } },
        { fieldId: 'field-2', value: null },
      ]);
    });

    it('returns the record as it now stands', async () => {
      await expect(
        controller.saveRecord(userId, scope, 'account-1', { answers: [] }),
      ).resolves.toMatchObject({ target: { id: 'account-1' } });
    });
  });
});
