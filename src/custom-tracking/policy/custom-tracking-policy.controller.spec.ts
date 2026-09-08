import { jest } from '@jest/globals';

import {
  CUSTOM_TRACKING_AGREEMENT,
  CustomTrackingAgreement,
} from '../constants/custom-tracking-agreement.constants';
import { CUSTOM_TRACKING_POLICY_VERSION } from '../constants/custom-tracking-policy.constants';
import { CustomTrackingPolicyController } from './custom-tracking-policy.controller';
import {
  CustomTrackingPolicyService,
  CustomTrackingPolicyStatus,
} from './custom-tracking-policy.service';

describe('CustomTrackingPolicyController', () => {
  const userId = 'user-1';

  const status: CustomTrackingPolicyStatus = {
    currentVersion: CUSTOM_TRACKING_POLICY_VERSION,
    effectiveDate: '2026-09-04',
    updatedDate: '2026-09-04',
    acceptedVersion: null,
    acceptedAt: null,
    acceptanceRequired: true,
  };

  let controller: CustomTrackingPolicyController;
  let getAgreement: jest.Mock<() => CustomTrackingAgreement>;
  let getStatus: jest.Mock<() => Promise<CustomTrackingPolicyStatus>>;
  let accept: jest.Mock<
    (userId: string, version: string) => Promise<CustomTrackingPolicyStatus>
  >;

  beforeEach(() => {
    getAgreement = jest
      .fn<() => CustomTrackingAgreement>()
      .mockReturnValue(CUSTOM_TRACKING_AGREEMENT);
    getStatus = jest
      .fn<() => Promise<CustomTrackingPolicyStatus>>()
      .mockResolvedValue(status);
    accept = jest
      .fn<
        (userId: string, version: string) => Promise<CustomTrackingPolicyStatus>
      >()
      .mockResolvedValue({ ...status, acceptanceRequired: false });

    controller = new CustomTrackingPolicyController({
      getAgreement,
      getStatus,
      accept,
    } as unknown as CustomTrackingPolicyService);
  });

  describe('getAgreement', () => {
    it('publishes the wording with its version and dates', () => {
      const agreement = controller.getAgreement();

      expect(agreement.version).toBe(CUSTOM_TRACKING_POLICY_VERSION);
      expect(agreement.title).toBe('Custom Tracking Content Agreement');
      expect(agreement.sections.length).toBeGreaterThan(0);
    });

    // Structured rather than markup, so a screen reader meets a heading and a
    // list rather than a paragraph containing bullet characters.
    it('keeps the headings, paragraphs and bullets apart', () => {
      const prohibitions = controller
        .getAgreement()
        .sections.find(section => section.bullets.length > 0);

      expect(prohibitions?.heading).toBe('What you must not store or publish');
      expect(prohibitions?.paragraphs.length).toBeGreaterThan(0);
      expect(prohibitions?.bullets.length).toBeGreaterThan(0);
    });

    // The constant is shared and frozen in spirit; handing its own arrays out
    // would let a caller mutate what every later request reads.
    it('copies the arrays rather than handing out the constant’s own', () => {
      const first = controller.getAgreement();

      first.sections[0].paragraphs.push('injected');

      expect(controller.getAgreement().sections[0].paragraphs).not.toContain(
        'injected',
      );
    });
  });

  describe('getStatus', () => {
    it('reports where the caller stands', async () => {
      await expect(controller.getStatus(userId)).resolves.toEqual(status);
      expect(getStatus).toHaveBeenCalledWith(userId);
    });
  });

  describe('accept', () => {
    // The version the interface displayed travels with the acceptance, so a
    // page left open across a wording change cannot record agreement to terms
    // the user never saw.
    it('passes on the version the interface displayed', async () => {
      await expect(
        controller.accept(userId, { acceptedVersion: '1.0' }),
      ).resolves.toMatchObject({ acceptanceRequired: false });

      expect(accept).toHaveBeenCalledWith(userId, '1.0');
    });
  });
});
