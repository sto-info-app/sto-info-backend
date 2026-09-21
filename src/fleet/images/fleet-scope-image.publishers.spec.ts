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

import { FleetCommunityEntity } from '../entities/fleet-community.entity';
import { StoArmadaEntity } from '../entities/sto-armada.entity';
import { StoFleetEntity } from '../entities/sto-fleet.entity';
import {
  FleetCommunityImagePublisher,
  StoArmadaImagePublisher,
  StoFleetImagePublisher,
} from './fleet-scope-image.publishers';

/**
 * Builds the attachment a publisher is handed.
 *
 * @param overrides - Whatever the case is actually about.
 * @returns The attachment.
 */
const attachment = (
  overrides: Partial<AssetAttachment> = {},
): AssetAttachment => ({
  subjectId: 'scope-1',
  slot: FileAssetSlot.BANNER,
  deliveryReference: 'new-image',
  uploadedByUserId: 'user-1',
  detail: { altText: 'A fleet yard at dusk' },
  ...overrides,
});

describe('Fleet scope image publishers', () => {
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
    build: () => AssetPublisher & { onModuleInit: () => void };
  }> = [
    {
      name: 'a Community',
      subject: FileAssetSubject.FLEET_COMMUNITY,
      build: () =>
        new FleetCommunityImagePublisher(
          repository as unknown as Repository<FleetCommunityEntity>,
          registry,
        ),
    },
    {
      name: 'a Fleet',
      subject: FileAssetSubject.FLEET,
      build: () =>
        new StoFleetImagePublisher(
          repository as unknown as Repository<StoFleetEntity>,
          registry,
        ),
    },
    {
      name: 'an Armada',
      subject: FileAssetSubject.ARMADA,
      build: () =>
        new StoArmadaImagePublisher(
          repository as unknown as Repository<StoArmadaEntity>,
          registry,
        ),
    },
  ];

  describe.each(publishers)('$name', ({ subject, build }) => {
    it('registers itself for its own subject', () => {
      const publisher = build();

      publisher.onModuleInit();

      expect(register).toHaveBeenCalledWith(publisher);
      expect(publisher.subject).toBe(subject);
    });

    it.each([
      [FileAssetSlot.BANNER, 'bannerImageId', 'bannerImageAlt'],
      [FileAssetSlot.EMBLEM, 'emblemImageId', 'emblemImageAlt'],
    ])('writes %s to its own pair of columns', async (slot, id, alt) => {
      const scope = { id: 'scope-1', [id]: null, [alt]: null };
      findOne.mockResolvedValue(scope);

      const previous = await build().attach(attachment({ slot }));

      expect(previous).toBeNull();
      expect(scope[id]).toBe('new-image');
      expect(scope[alt]).toBe('A fleet yard at dusk');
      expect(save).toHaveBeenCalledWith(scope);
    });

    it('reports what the slot was showing, so it can be withdrawn', async () => {
      findOne.mockResolvedValue({
        id: 'scope-1',
        bannerImageId: 'old-image',
        bannerImageAlt: 'The old one',
      });

      expect(await build().attach(attachment())).toBe('old-image');
    });

    /**
     * An empty description is the correct markup for a picture nobody
     * described, and refusing to publish over it would strand a perfectly
     * good image whose placement predates the description being kept.
     */
    it('publishes a picture whose description was lost', async () => {
      const scope = {
        id: 'scope-1',
        bannerImageId: null,
        bannerImageAlt: null,
      };
      findOne.mockResolvedValue(scope);

      await build().attach(attachment({ detail: null }));

      expect(scope.bannerImageAlt).toBe('');
    });

    /**
     * The new reference rather than null, which is what has the caller
     * withdraw the picture it just published. There is nothing to show it
     * on, and leaving it published would leave bytes served that nothing
     * points at.
     */
    it('hands back the new picture when the scope has gone', async () => {
      findOne.mockResolvedValue(null);

      expect(await build().attach(attachment())).toBe('new-image');
      expect(save).not.toHaveBeenCalled();
    });

    /**
     * A placement naming a slot no scope has is a misrouted one. Writing to
     * `undefined` would put a column called that on the row.
     */
    it('hands back the new picture for a slot no scope has', async () => {
      findOne.mockResolvedValue({ id: 'scope-1' });

      const previous = await build().attach(
        attachment({ slot: FileAssetSlot.PORTRAIT }),
      );

      expect(previous).toBe('new-image');
      expect(save).not.toHaveBeenCalled();
    });

    /**
     * The revision is what invalidates a cached capability decision.
     * Artwork changes nothing about who may do what, and bumping it would
     * have every banner change throw away the scope's authorisation cache.
     */
    it('leaves the authorisation revision alone', async () => {
      const scope = {
        id: 'scope-1',
        bannerImageId: null,
        bannerImageAlt: null,
        revision: 4,
      };
      findOne.mockResolvedValue(scope);

      await build().attach(attachment());

      expect(scope.revision).toBe(4);
    });
  });
});
