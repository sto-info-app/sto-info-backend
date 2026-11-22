import { Readable } from 'stream';

import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { jest } from '@jest/globals';
import { Response } from 'express';

import { FileAssetDeliveryController } from './file-asset-delivery.controller';
import { FileAssetDeliveryService } from './services/file-asset-delivery.service';

/**
 * The delivery route.
 *
 * The decision itself is the service's and is tested there; what this covers
 * is the headers, which are the part that goes wrong silently. A private file
 * served without `no-store` is a private file a shared cache will hand to the
 * next person who asks, and nothing in the response looks wrong when it
 * happens.
 */
describe('FileAssetDeliveryController', () => {
  let controller: FileAssetDeliveryController;
  let deliveryService: { openForReader: jest.Mock<(...args: any[]) => any> };
  let response: { setHeader: jest.Mock<(...args: any[]) => any> };

  /**
   * Collects the headers set on the response.
   *
   * @returns The headers, keyed by name.
   */
  const headers = (): Record<string, string> =>
    Object.fromEntries(
      response.setHeader.mock.calls.map(call => [
        call[0] as string,
        call[1] as string,
      ]),
    );

  beforeEach(async () => {
    deliveryService = {
      openForReader: jest.fn<(...args: any[]) => any>().mockResolvedValue({
        stream: Readable.from(['bytes']),
        contentType: 'text/csv',
        byteSize: 128,
        filename: 'roster.csv',
      }),
    };
    response = { setHeader: jest.fn<(...args: any[]) => any>() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FileAssetDeliveryController],
      providers: [
        { provide: FileAssetDeliveryService, useValue: deliveryService },
      ],
    }).compile();

    controller = module.get(FileAssetDeliveryController);
  });

  it('passes the caller through to the delivery decision', async () => {
    await controller.serve(
      'asset-1',
      'user-1',
      response as unknown as Response,
    );

    expect(deliveryService.openForReader).toHaveBeenCalledWith(
      'asset-1',
      'user-1',
    );
  });

  it('passes a signed-out caller through as such', async () => {
    await controller.serve('asset-1', null, response as unknown as Response);

    expect(deliveryService.openForReader).toHaveBeenCalledWith('asset-1', null);
  });

  it('returns the bytes', async () => {
    const file = await controller.serve(
      'asset-1',
      null,
      response as unknown as Response,
    );

    expect(file.getStream()).toBeInstanceOf(Readable);
  });

  /**
   * The third acceptance criterion depends on the next request asking again.
   * A cached copy is a copy whose withdrawal the next reader never hears
   * about, so the header is set here rather than trusted to a proxy whose
   * configuration is not in this repository.
   */
  it('forbids every cache from keeping a copy', async () => {
    await controller.serve('asset-1', null, response as unknown as Response);

    expect(headers()['Cache-Control']).toBe('no-store, private');
  });

  it('declares the content type the registry recorded', async () => {
    await controller.serve('asset-1', null, response as unknown as Response);

    expect(headers()['Content-Type']).toBe('text/csv');
  });

  /**
   * An upload rendered inline would execute in the site's own origin, which is
   * a cross-site scripting hole wearing an image's content type. Both headers
   * are needed: one stops the browser rendering it, the other stops the
   * browser deciding it knows better than the declared type.
   */
  it('never renders a stored file in the site origin', async () => {
    await controller.serve('asset-1', null, response as unknown as Response);

    expect(headers()['Content-Disposition']).toBe('attachment');
    expect(headers()['X-Content-Type-Options']).toBe('nosniff');
  });

  it('declares the length when the registry knows it', async () => {
    await controller.serve('asset-1', null, response as unknown as Response);

    expect(headers()['Content-Length']).toBe('128');
  });

  it('omits the length when it is unknown', async () => {
    deliveryService.openForReader.mockResolvedValue({
      stream: Readable.from(['bytes']),
      contentType: 'application/octet-stream',
      byteSize: null,
      filename: null,
    });

    await controller.serve('asset-1', null, response as unknown as Response);

    expect(headers()['Content-Length']).toBeUndefined();
  });

  it('sets no header at all when the asset is refused', async () => {
    deliveryService.openForReader.mockRejectedValue(
      new NotFoundException('Not found'),
    );

    await expect(
      controller.serve('asset-1', null, response as unknown as Response),
    ).rejects.toThrow(NotFoundException);
    expect(response.setHeader).not.toHaveBeenCalled();
  });
});
