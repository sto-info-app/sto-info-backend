import { Logger, NotFoundException } from '@nestjs/common';

import { jest } from '@jest/globals';

import { FileAssetSlot } from 'src/file-assets/enums/file-asset-slot.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import {
  AssetAttachment,
  AssetPublisherRegistry,
} from 'src/file-assets/services/asset-publisher.registry';

import { CustomTrackingImageShape } from '../enums/custom-tracking-image-shape.enum';
import { CustomTrackingTargetScope } from '../enums/custom-tracking-target-scope.enum';
import { CustomTrackingImagePublisher } from './custom-tracking-image.publisher';
import { CustomTrackingImageService } from './custom-tracking-image.service';

/**
 * Builds the attachment a Custom Tracking picture arrives as.
 *
 * @param detail - What the upload asked to be kept.
 * @returns The attachment.
 */
const attachment = (
  detail: Record<string, unknown> | null,
): AssetAttachment => ({
  subjectId: 'field-1:account-1',
  slot: FileAssetSlot.PICTURE,
  deliveryReference: 'new-image',
  uploadedByUserId: 'user-1',
  detail,
});

/** What a well-formed upload kept for its publisher. */
const detail = {
  userId: 'user-1',
  fieldId: 'field-1',
  scope: CustomTrackingTargetScope.ACCOUNT,
  targetId: 'account-1',
  altText: 'The USS Ares at warp',
  shape: CustomTrackingImageShape.LANDSCAPE,
};

describe('CustomTrackingImagePublisher', () => {
  let publish: jest.Mock<(...args: any[]) => Promise<any>>;
  let register: jest.Mock;
  let publisher: CustomTrackingImagePublisher;

  beforeEach(() => {
    publish = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue('old-image');
    register = jest.fn();

    publisher = new CustomTrackingImagePublisher(
      { publish } as unknown as CustomTrackingImageService,
      { register } as unknown as AssetPublisherRegistry,
    );

    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('publishes for Custom Tracking answers', () => {
    expect(publisher.subject).toBe(FileAssetSubject.CUSTOM_TRACKING_VALUE);
  });

  it('registers itself', () => {
    publisher.onModuleInit();

    expect(register).toHaveBeenCalledWith(publisher);
  });

  it('writes the picture as the answer and reports what it replaced', async () => {
    await expect(publisher.attach(attachment(detail))).resolves.toBe(
      'old-image',
    );

    expect(publish).toHaveBeenCalledWith({
      userId: 'user-1',
      fieldId: 'field-1',
      scope: CustomTrackingTargetScope.ACCOUNT,
      targetId: 'account-1',
      cloudflareImageId: 'new-image',
      altText: 'The USS Ares at warp',
      shape: CustomTrackingImageShape.LANDSCAPE,
    });
  });

  // A Field or record deleted while the picture was being scanned makes
  // the ownership lookup throw, and nothing will ever display it.
  it('reports the picture as unattachable when the Field has gone', async () => {
    publish.mockRejectedValue(new NotFoundException());

    await expect(publisher.attach(attachment(detail))).resolves.toBe(
      'new-image',
    );
  });

  it('reports the picture as unattachable on an unrecognisable failure', async () => {
    publish.mockRejectedValue('something that is not an error');

    await expect(publisher.attach(attachment(detail))).resolves.toBe(
      'new-image',
    );
  });

  // A publisher that guessed at a missing Field would write the picture
  // as the answer to the wrong question.
  it.each([
    ['nothing at all', null],
    ['no user', { ...detail, userId: 42 }],
    ['no field', { ...detail, fieldId: null }],
    ['no record', { ...detail, targetId: undefined }],
    ['no description', { ...detail, altText: 7 }],
    ['a scope that is not one', { ...detail, scope: 'SQUADRON' }],
    ['a shape that is not one', { ...detail, shape: 'TRIANGLE' }],
  ])('refuses detail carrying %s', async (_name, broken) => {
    await expect(
      publisher.attach(attachment(broken as Record<string, unknown> | null)),
    ).resolves.toBe('new-image');

    expect(publish).not.toHaveBeenCalled();
  });
});
