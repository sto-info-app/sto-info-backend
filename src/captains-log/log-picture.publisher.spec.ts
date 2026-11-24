import { Logger } from '@nestjs/common';

import { jest } from '@jest/globals';
import { Repository } from 'typeorm';

import { FileAssetSlot } from 'src/file-assets/enums/file-asset-slot.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import {
  AssetAttachment,
  AssetPublisherRegistry,
} from 'src/file-assets/services/asset-publisher.registry';

import { LogEntryEntity } from './entities/log-entry.entity';
import { LogPicturePublisher } from './log-picture.publisher';

/**
 * Builds the attachment the publisher is handed.
 *
 * @param overrides - Whatever the case is actually about.
 * @returns The attachment.
 */
const cleared = (
  overrides: Partial<AssetAttachment> = {},
): AssetAttachment => ({
  subjectId: 'entry-1',
  slot: FileAssetSlot.PICTURE,
  deliveryReference: 'cleared-picture',
  uploadedByUserId: 'user-1',
  detail: { altText: 'The bridge at red alert' },
  ...overrides,
});

describe('LogPicturePublisher', () => {
  let findOneBy: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  let save: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  let register: jest.Mock;
  let publisher: LogPicturePublisher;

  beforeEach(() => {
    findOneBy = jest.fn<(...args: unknown[]) => Promise<unknown>>();
    save = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockImplementation(row => Promise.resolve(row));
    register = jest.fn();
    publisher = new LogPicturePublisher(
      { findOneBy, save } as unknown as Repository<LogEntryEntity>,
      { register } as unknown as AssetPublisherRegistry,
    );

    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('registers for Log entries', () => {
    publisher.onModuleInit();

    expect(publisher.subject).toBe(FileAssetSubject.LOG_ENTRY);
    expect(register).toHaveBeenCalledWith(publisher);
  });

  it('writes the picture with its description, and hands back the one it replaced', async () => {
    findOneBy.mockResolvedValue({
      id: 'entry-1',
      pictureId: 'earlier-picture',
      pictureAlt: 'Earlier',
    });

    await expect(publisher.attach(cleared())).resolves.toBe('earlier-picture');

    expect(findOneBy).toHaveBeenCalledWith({ id: 'entry-1' });
    expect(save).toHaveBeenCalledWith({
      id: 'entry-1',
      pictureId: 'cleared-picture',
      pictureAlt: 'The bridge at red alert',
    });
  });

  it('hands back null when the entry had no picture before', async () => {
    findOneBy.mockResolvedValue({
      id: 'entry-1',
      pictureId: null,
      pictureAlt: null,
    });

    await expect(publisher.attach(cleared())).resolves.toBeNull();
  });

  it('hands the picture back to be withdrawn when its entry has gone', async () => {
    findOneBy.mockResolvedValue(null);

    await expect(publisher.attach(cleared())).resolves.toBe('cleared-picture');
    expect(save).not.toHaveBeenCalled();
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining('no such entry'),
    );
  });

  it('reads nothing for a slot an entry does not have', async () => {
    await expect(
      publisher.attach(cleared({ slot: FileAssetSlot.COVER })),
    ).resolves.toBe('cleared-picture');
    expect(findOneBy).not.toHaveBeenCalled();
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining('not a picture'),
    );
  });
});
