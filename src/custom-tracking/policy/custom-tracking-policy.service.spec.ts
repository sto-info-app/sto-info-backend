import { ConflictException, ForbiddenException } from '@nestjs/common';

import { jest } from '@jest/globals';
import { Repository } from 'typeorm';

import { CUSTOM_TRACKING_AGREEMENT } from '../constants/custom-tracking-agreement.constants';
import {
  CUSTOM_TRACKING_POLICY_EFFECTIVE_DATE,
  CUSTOM_TRACKING_POLICY_UPDATED_DATE,
  CUSTOM_TRACKING_POLICY_VERSION,
} from '../constants/custom-tracking-policy.constants';
import { CustomTrackingPolicyAcceptanceEntity } from '../entities/custom-tracking-policy-acceptance.entity';
import { CustomTrackingPolicyService } from './custom-tracking-policy.service';

describe('CustomTrackingPolicyService', () => {
  const userId = '11111111-1111-4111-8111-111111111111';

  let service: CustomTrackingPolicyService;
  let findOne: jest.Mock<
    () => Promise<CustomTrackingPolicyAcceptanceEntity | null>
  >;
  let save: jest.Mock<
    (entity: CustomTrackingPolicyAcceptanceEntity) => Promise<unknown>
  >;
  let create: jest.Mock<
    (partial: Partial<CustomTrackingPolicyAcceptanceEntity>) => unknown
  >;

  beforeEach(() => {
    findOne =
      jest.fn<() => Promise<CustomTrackingPolicyAcceptanceEntity | null>>();
    save =
      jest.fn<
        (entity: CustomTrackingPolicyAcceptanceEntity) => Promise<unknown>
      >();
    create = jest.fn(
      (partial: Partial<CustomTrackingPolicyAcceptanceEntity>) => ({
        ...partial,
      }),
    );

    save.mockResolvedValue(undefined);

    service = new CustomTrackingPolicyService({
      findOne,
      save,
      create,
    } as unknown as Repository<CustomTrackingPolicyAcceptanceEntity>);
  });

  const accepted = (version: string): CustomTrackingPolicyAcceptanceEntity =>
    ({
      userId,
      policyVersion: version,
      acceptedAt: new Date('2026-09-04T10:00:00Z'),
    }) as CustomTrackingPolicyAcceptanceEntity;

  describe('getAgreement', () => {
    it('returns the wording the version constant publishes', () => {
      const agreement = service.getAgreement();

      expect(agreement).toBe(CUSTOM_TRACKING_AGREEMENT);
      expect(agreement.version).toBe(CUSTOM_TRACKING_POLICY_VERSION);
    });
  });

  describe('getStatus', () => {
    it('reports a user who has never accepted', async () => {
      findOne.mockResolvedValue(null);

      await expect(service.getStatus(userId)).resolves.toEqual({
        currentVersion: CUSTOM_TRACKING_POLICY_VERSION,
        effectiveDate: CUSTOM_TRACKING_POLICY_EFFECTIVE_DATE,
        updatedDate: CUSTOM_TRACKING_POLICY_UPDATED_DATE,
        acceptedVersion: null,
        acceptedAt: null,
        acceptanceRequired: true,
      });
    });

    it('reports a user who has accepted the current version', async () => {
      findOne.mockResolvedValue(accepted(CUSTOM_TRACKING_POLICY_VERSION));

      await expect(service.getStatus(userId)).resolves.toMatchObject({
        acceptedVersion: CUSTOM_TRACKING_POLICY_VERSION,
        acceptanceRequired: false,
      });
    });

    // A user held to terms they never read is the thing versioning exists to
    // prevent, so a superseded acceptance is not an acceptance.
    it('reports a superseded acceptance as still needing one', async () => {
      findOne.mockResolvedValue(accepted('0.9'));

      await expect(service.getStatus(userId)).resolves.toMatchObject({
        acceptedVersion: '0.9',
        acceptanceRequired: true,
      });
    });
  });

  describe('accept', () => {
    it('records an acceptance for a user who has never given one', async () => {
      findOne.mockResolvedValueOnce(null);
      findOne.mockResolvedValueOnce(accepted(CUSTOM_TRACKING_POLICY_VERSION));

      await service.accept(userId, CUSTOM_TRACKING_POLICY_VERSION);

      expect(create).toHaveBeenCalledWith({ userId });
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          policyVersion: CUSTOM_TRACKING_POLICY_VERSION,
          policyEffectiveDate: CUSTOM_TRACKING_POLICY_EFFECTIVE_DATE,
          policyUpdatedDate: CUSTOM_TRACKING_POLICY_UPDATED_DATE,
        }),
      );
    });

    // One row per user. The audit trail already records every change to it, so
    // a second table would grow for anybody who reads each new version.
    it('updates the existing record rather than adding another', async () => {
      const existing = accepted('0.9');

      findOne.mockResolvedValueOnce(existing);
      findOne.mockResolvedValueOnce(accepted(CUSTOM_TRACKING_POLICY_VERSION));

      await service.accept(userId, CUSTOM_TRACKING_POLICY_VERSION);

      expect(create).not.toHaveBeenCalled();
      expect(save).toHaveBeenCalledWith(existing);
      expect(existing.policyVersion).toBe(CUSTOM_TRACKING_POLICY_VERSION);
    });

    it('records when the acceptance was given', async () => {
      findOne.mockResolvedValue(null);

      const before = Date.now();
      await service.accept(userId, CUSTOM_TRACKING_POLICY_VERSION);
      const after = Date.now();

      const saved = save.mock
        .calls[0][0] as CustomTrackingPolicyAcceptanceEntity;

      expect(saved.acceptedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(saved.acceptedAt.getTime()).toBeLessThanOrEqual(after);
    });

    it('returns the status the acceptance produced', async () => {
      findOne.mockResolvedValueOnce(null);
      findOne.mockResolvedValueOnce(accepted(CUSTOM_TRACKING_POLICY_VERSION));

      await expect(
        service.accept(userId, CUSTOM_TRACKING_POLICY_VERSION),
      ).resolves.toMatchObject({ acceptanceRequired: false });
    });

    // A page left open across a wording change would otherwise record
    // agreement to terms the user never saw, which is the one thing an
    // acceptance record exists to rule out.
    it('refuses an acceptance of a version that is no longer published', async () => {
      await expect(service.accept(userId, '0.9')).rejects.toThrow(
        ConflictException,
      );
      expect(save).not.toHaveBeenCalled();
    });
  });

  describe('assertAccepted', () => {
    it('allows a user who has accepted the current version', async () => {
      findOne.mockResolvedValue(accepted(CUSTOM_TRACKING_POLICY_VERSION));

      await expect(service.assertAccepted(userId)).resolves.toBeUndefined();
    });

    it('stops a user who has never accepted', async () => {
      findOne.mockResolvedValue(null);

      await expect(service.assertAccepted(userId)).rejects.toThrow(
        'Accept the Custom Tracking content agreement before setting anything up.',
      );
    });

    // Reading is deliberately not gated, and the message says so: locking
    // somebody out of their own data to make a point about terms would be a
    // punishment rather than a safeguard.
    it('tells a user with a superseded acceptance that their data is still there', async () => {
      findOne.mockResolvedValue(accepted('0.9'));

      await expect(service.assertAccepted(userId)).rejects.toThrow(
        /still here/,
      );
      await expect(service.assertAccepted(userId)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
