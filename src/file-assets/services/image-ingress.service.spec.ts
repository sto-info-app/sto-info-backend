import { BadRequestException } from '@nestjs/common';

import { jest } from '@jest/globals';

import {
  ImageSlotService,
  ImageSlotSpec,
} from 'src/shared/images/image-slot.service';

import { FileAssetAudience } from '../enums/file-asset-audience.enum';
import { FileAssetKind } from '../enums/file-asset-kind.enum';
import { FileAssetSlot } from '../enums/file-asset-slot.enum';
import { FileAssetSubject } from '../enums/file-asset-subject.enum';
import { AssetIngressService } from './asset-ingress.service';
import { ImageIngressService } from './image-ingress.service';

describe('ImageIngressService', () => {
  const spec: ImageSlotSpec = {
    label: 'Story banner',
    aspectRatio: [5, 1],
    minimumWidth: 2400,
    minimumHeight: 480,
    recommendedWidth: 2400,
    recommendedHeight: 480,
    outputFormat: 'jpeg',
    entityTag: 'storytime-story-banner',
  };

  const file = {
    buffer: Buffer.from('a picture'),
    mimetype: 'image/jpg',
    size: 9,
    originalname: 'banner.jpg',
  } as Express.Multer.File;

  let inspect: jest.Mock;
  let accept: jest.Mock<(...args: any[]) => Promise<any>>;
  let service: ImageIngressService;

  const request = () => ({
    spec,
    userId: 'user-1',
    kind: FileAssetKind.STORYTIME_IMAGE,
    audience: FileAssetAudience.PUBLIC,
    subject: FileAssetSubject.STORYTIME_STORY,
    subjectId: 'story-1',
    slot: FileAssetSlot.BANNER,
    entityTag: 'storytime-story-banner',
    entityId: 'story-1',
    maximumBytes: 1_048_576,
    sizeLimitLabel: 'Storytime images',
    file,
    feature: { altText: 'A ship' },
  });

  beforeEach(() => {
    inspect = jest.fn(() => ({
      bytes: Buffer.from('a picture'),
      safeFileName: 'banner.jpg',
      detectedContentType: 'image/jpeg',
    }));
    accept = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue({ assetId: 'asset-1', status: 'SCANNING' });

    service = new ImageIngressService(
      { inspect } as unknown as ImageSlotService,
      { accept } as unknown as AssetIngressService,
    );
  });

  it('checks the picture against its slot before registering anything', async () => {
    await service.accept(request());

    expect(inspect).toHaveBeenCalledWith({
      spec,
      userId: 'user-1',
      maximumBytes: 1_048_576,
      sizeLimitLabel: 'Storytime images',
      file,
    });
  });

  // What the browser claimed is kept as a claim and checked against the
  // bytes by the worker; what the bytes turned out to be is recorded
  // separately — ADR-0020.
  it('records the claim and the evidence separately', async () => {
    await service.accept(request());

    expect(accept).toHaveBeenCalledWith(
      expect.objectContaining({
        declaredContentType: 'image/jpg',
        detectedContentType: 'image/jpeg',
        originalFilename: 'banner.jpg',
      }),
    );
  });

  it('answers with the asset to ask about', async () => {
    await expect(service.accept(request())).resolves.toEqual({
      assetId: 'asset-1',
      status: 'SCANNING',
    });
  });

  it('passes the feature detail through', async () => {
    await service.accept(request());

    expect(accept).toHaveBeenCalledWith(
      expect.objectContaining({ feature: { altText: 'A ship' } }),
    );
  });

  it('passes no detail through for a feature that needs none', async () => {
    await service.accept({ ...request(), feature: undefined });

    expect(accept).toHaveBeenCalledWith(
      expect.objectContaining({ feature: null }),
    );
  });

  // A wrong-shaped crop is a refusal the person reads immediately rather
  // than a state they discover a minute later.
  it('registers nothing when the picture is refused', async () => {
    inspect.mockImplementation(() => {
      throw new BadRequestException('must be cropped to 5:1');
    });

    await expect(service.accept(request())).rejects.toThrow(
      'must be cropped to 5:1',
    );
    expect(accept).not.toHaveBeenCalled();
  });
});
