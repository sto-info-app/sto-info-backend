import { Logger } from '@nestjs/common';

import { jest } from '@jest/globals';
import { Repository } from 'typeorm';

import { FileAssetSlot } from 'src/file-assets/enums/file-asset-slot.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import {
  AssetAttachment,
  AssetPublisher,
  AssetPublisherRegistry,
} from 'src/file-assets/services/asset-publisher.registry';

import { StorytimeArcEntity } from '../arcs/entities/storytime-arc.entity';
import { StorytimeChapterEntity } from '../chapters/entities/storytime-chapter.entity';
import { StorytimeCharacterEntity } from '../characters/entities/storytime-character.entity';
import { StorytimeSpotlightEntity } from '../spotlight/entities/storytime-spotlight.entity';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeArcImagePublisher } from './storytime-arc-image.publisher';
import { StorytimeCastImagePublisher } from './storytime-cast-image.publisher';
import { StorytimeChapterImagePublisher } from './storytime-chapter-image.publisher';
import { StorytimeSpotlightImagePublisher } from './storytime-spotlight-image.publisher';
import { StorytimeStoryImagePublisher } from './storytime-story-image.publisher';

/**
 * Builds the attachment a publisher is handed.
 *
 * @param overrides - Whatever the case is actually about.
 * @returns The attachment.
 */
const attachment = (
  overrides: Partial<AssetAttachment> = {},
): AssetAttachment => ({
  subjectId: 'record-1',
  slot: FileAssetSlot.BANNER,
  deliveryReference: 'new-image',
  uploadedByUserId: 'user-1',
  detail: { altText: 'A ship at warp' },
  ...overrides,
});

describe('Storytime image publishers', () => {
  let findOne: jest.Mock<(...args: any[]) => Promise<any>>;
  let save: jest.Mock<(...args: any[]) => Promise<any>>;
  let register: jest.Mock;
  let repository: Repository<never>;
  let registry: AssetPublisherRegistry;

  beforeEach(() => {
    findOne = jest.fn<(...args: any[]) => Promise<any>>();
    save = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockImplementation((row: unknown) => Promise.resolve(row));
    register = jest.fn();

    repository = { findOne, save } as unknown as Repository<never>;
    registry = { register } as unknown as AssetPublisherRegistry;

    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const publishers: Array<{
    name: string;
    subject: FileAssetSubject;
    slot: FileAssetSlot;
    idColumn: string;
    altColumn: string;
    versioned: boolean;
    build: () => AssetPublisher & { onModuleInit: () => void };
  }> = [
    {
      name: 'an Arc banner',
      subject: FileAssetSubject.STORYTIME_ARC,
      slot: FileAssetSlot.BANNER,
      idColumn: 'bannerImageId',
      altColumn: 'bannerImageAlt',
      versioned: true,
      build: () =>
        new StorytimeArcImagePublisher(
          repository as unknown as Repository<StorytimeArcEntity>,
          registry,
        ),
    },
    {
      name: 'an Arc profile image',
      subject: FileAssetSubject.STORYTIME_ARC,
      slot: FileAssetSlot.PROFILE,
      idColumn: 'profileImageId',
      altColumn: 'profileImageAlt',
      versioned: true,
      build: () =>
        new StorytimeArcImagePublisher(
          repository as unknown as Repository<StorytimeArcEntity>,
          registry,
        ),
    },
    {
      name: 'a Story banner',
      subject: FileAssetSubject.STORYTIME_STORY,
      slot: FileAssetSlot.BANNER,
      idColumn: 'bannerImageId',
      altColumn: 'bannerImageAlt',
      versioned: true,
      build: () =>
        new StorytimeStoryImagePublisher(
          repository as unknown as Repository<StorytimeStoryEntity>,
          registry,
        ),
    },
    {
      name: 'a Story profile image',
      subject: FileAssetSubject.STORYTIME_STORY,
      slot: FileAssetSlot.PROFILE,
      idColumn: 'profileImageId',
      altColumn: 'profileImageAlt',
      versioned: true,
      build: () =>
        new StorytimeStoryImagePublisher(
          repository as unknown as Repository<StorytimeStoryEntity>,
          registry,
        ),
    },
    {
      name: 'a Chapter cover',
      subject: FileAssetSubject.STORYTIME_CHAPTER,
      slot: FileAssetSlot.COVER,
      idColumn: 'coverImageId',
      altColumn: 'coverImageAlt',
      versioned: true,
      build: () =>
        new StorytimeChapterImagePublisher(
          repository as unknown as Repository<StorytimeChapterEntity>,
          registry,
        ),
    },
    {
      name: 'a cast portrait',
      subject: FileAssetSubject.STORYTIME_CAST_MEMBER,
      slot: FileAssetSlot.PORTRAIT,
      idColumn: 'portraitImageId',
      altColumn: 'portraitImageAlt',
      versioned: true,
      build: () =>
        new StorytimeCastImagePublisher(
          repository as unknown as Repository<StorytimeCharacterEntity>,
          registry,
        ),
    },
    {
      name: 'spotlight artwork',
      subject: FileAssetSubject.STORYTIME_SPOTLIGHT,
      slot: FileAssetSlot.OVERRIDE,
      idColumn: 'overrideImageId',
      altColumn: 'overrideImageAlt',
      versioned: false,
      build: () =>
        new StorytimeSpotlightImagePublisher(
          repository as unknown as Repository<StorytimeSpotlightEntity>,
          registry,
        ),
    },
  ];

  it.each(publishers)(
    'publishes $name with its description',
    async ({ subject, slot, idColumn, altColumn, versioned, build }) => {
      const record: Record<string, unknown> = {
        id: 'record-1',
        [idColumn]: 'old-image',
        [altColumn]: 'Something else',
        updatedByUserId: 'somebody-else',
        version: 1,
      };

      findOne.mockResolvedValue(record);

      const publisher = build();

      expect(publisher.subject).toBe(subject);

      await expect(publisher.attach(attachment({ slot }))).resolves.toBe(
        'old-image',
      );

      expect(record[idColumn]).toBe('new-image');
      expect(record[altColumn]).toBe('A ship at warp');
      expect(record.updatedByUserId).toBe('user-1');
      expect(record.version).toBe(versioned ? 2 : 1);
      expect(save).toHaveBeenCalled();
    },
  );

  it.each(publishers)('registers itself for $name', ({ build }) => {
    const publisher = build();

    publisher.onModuleInit();

    expect(register).toHaveBeenCalledWith(publisher);
  });

  // A record deleted while its picture was being scanned leaves nothing to
  // attach to, and the new picture is reported as the one to take down.
  it.each(publishers)(
    'reports the new picture as unattachable for $name',
    async ({ slot, build }) => {
      findOne.mockResolvedValue(null);

      await expect(build().attach(attachment({ slot }))).resolves.toBe(
        'new-image',
      );
      expect(save).not.toHaveBeenCalled();
    },
  );

  it.each(publishers)(
    'reports no previous picture for an empty $name slot',
    async ({ idColumn, slot, build }) => {
      findOne.mockResolvedValue({
        id: 'record-1',
        [idColumn]: null,
        version: 1,
      });

      await expect(build().attach(attachment({ slot }))).resolves.toBeNull();
    },
  );

  // An empty alt is the correct markup for a picture with no description,
  // and refusing to publish over it would strand a perfectly good image.
  it.each(publishers)(
    'publishes $name with an empty description when none survived',
    async ({ altColumn, slot, build }) => {
      const record: Record<string, unknown> = {
        id: 'record-1',
        version: 1,
      };

      findOne.mockResolvedValue(record);

      await build().attach(attachment({ slot, detail: null }));

      expect(record[altColumn]).toBe('');
    },
  );

  it.each(publishers)(
    'publishes $name with an empty description when the detail is nonsense',
    async ({ altColumn, slot, build }) => {
      const record: Record<string, unknown> = {
        id: 'record-1',
        version: 1,
      };

      findOne.mockResolvedValue(record);

      await build().attach(attachment({ slot, detail: { altText: 42 } }));

      expect(record[altColumn]).toBe('');
    },
  );

  // An asset whose owner was removed leaves the audit column as it was
  // rather than nulling a field that cannot be null.
  it.each(publishers)(
    'keeps the last editor of $name when the uploader has gone',
    async ({ slot, build }) => {
      const record: Record<string, unknown> = {
        id: 'record-1',
        updatedByUserId: 'somebody-else',
        version: 1,
      };

      findOne.mockResolvedValue(record);

      await build().attach(attachment({ slot, uploadedByUserId: null }));

      expect(record.updatedByUserId).toBe('somebody-else');
    },
  );

  // A Story has a banner and a profile image, so one publisher serves two
  // columns and has to be told which. A slot it does not serve is a
  // wiring mistake rather than a reason to write the wrong column.
  it.each([
    [
      'the Arc publisher',
      () =>
        new StorytimeArcImagePublisher(
          repository as unknown as Repository<StorytimeArcEntity>,
          registry,
        ),
    ],
    [
      'the Story publisher',
      () =>
        new StorytimeStoryImagePublisher(
          repository as unknown as Repository<StorytimeStoryEntity>,
          registry,
        ),
    ],
  ])('refuses a slot %s does not serve', async (_name, build) => {
    findOne.mockResolvedValue({ id: 'record-1', version: 1 });

    await expect(
      build().attach(attachment({ slot: FileAssetSlot.EMBLEM })),
    ).resolves.toBe('new-image');
    expect(save).not.toHaveBeenCalled();
  });
});
