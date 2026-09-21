import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import { jest } from '@jest/globals';
import { Repository } from 'typeorm';

import { CUSTOM_TRACKING_IMAGE_SPECS } from 'src/custom-tracking/constants/custom-tracking-image.constants';
import { CustomTrackingImagePublisher } from 'src/custom-tracking/images/custom-tracking-image.publisher';
import { CustomTrackingImageService } from 'src/custom-tracking/images/custom-tracking-image.service';
import { FileAssetPlacementEntity } from 'src/file-assets/entities/file-asset-placement.entity';
import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { FileAssetAudience } from 'src/file-assets/enums/file-asset-audience.enum';
import { FileAssetKind } from 'src/file-assets/enums/file-asset-kind.enum';
import { FileAssetPlacementState } from 'src/file-assets/enums/file-asset-placement-state.enum';
import { FileAssetSlot } from 'src/file-assets/enums/file-asset-slot.enum';
import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';
import { FileAssetStorage } from 'src/file-assets/enums/file-asset-storage.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import { AssetIngressService } from 'src/file-assets/services/asset-ingress.service';
import { AssetPublicationService } from 'src/file-assets/services/asset-publication.service';
import { AssetPublisherRegistry } from 'src/file-assets/services/asset-publisher.registry';
import { AssetWithdrawalService } from 'src/file-assets/services/asset-withdrawal.service';
import { FileAssetPlacementService } from 'src/file-assets/services/file-asset-placement.service';
import { FileAssetService } from 'src/file-assets/services/file-asset.service';
import { ImageIngressService } from 'src/file-assets/services/image-ingress.service';
import { QuarantineStorageService } from 'src/file-assets/services/quarantine-storage.service';
import { ScanRequestProducerService } from 'src/file-scanning/services/scan-request-producer.service';
import { FLEET_IMAGE_SPECS } from 'src/fleet/constants/fleet-image.constants';
import { FleetCommunityEntity } from 'src/fleet/entities/fleet-community.entity';
import { StoArmadaEntity } from 'src/fleet/entities/sto-armada.entity';
import { StoFleetEntity } from 'src/fleet/entities/sto-fleet.entity';
import {
  FleetCommunityImagePublisher,
  StoArmadaImagePublisher,
  StoFleetImagePublisher,
} from 'src/fleet/images/fleet-scope-image.publishers';
import {
  ImageSlotService,
  ImageSlotSpec,
} from 'src/shared/images/image-slot.service';
import { ImageUploadsService } from 'src/shared/utilities/image-uploads.service';
import { CHARACTER_IMAGE_ENTITY_TAG } from 'src/sto/character/constants/character-image.constants';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';
import { CharacterImagePublisher } from 'src/sto/character/images/character-image.publisher';
import { STORYTIME_IMAGE_SPECS } from 'src/storytime/constants/storytime-image.constants';
import { StorytimeImageSlot } from 'src/storytime/enums/storytime-image-slot.enum';
import { StorytimeArcImagePublisher } from 'src/storytime/images/storytime-arc-image.publisher';
import { StorytimeCastImagePublisher } from 'src/storytime/images/storytime-cast-image.publisher';
import { StorytimeChapterImagePublisher } from 'src/storytime/images/storytime-chapter-image.publisher';
import { StorytimeSpotlightImagePublisher } from 'src/storytime/images/storytime-spotlight-image.publisher';
import { StorytimeStoryImagePublisher } from 'src/storytime/images/storytime-story-image.publisher';
import { PROFILE_IMAGE_ENTITY_TAG } from 'src/user/constants/profile-image.constants';
import { UserProfileImagePublisher } from 'src/user/images/user-profile-image.publisher';

/**
 * Every upload the site accepts, taken from a request to a published
 * picture.
 *
 * The integration matrix FC-012's validation line asks for. Each of the
 * sixteen callers is driven through the one path they now share — check, register,
 * quarantine, scan, publish, withdraw what was there — against in-memory
 * repositories and a scanner faked at the queue boundary, which is the only
 * boundary a fake belongs at: everything on this side of it is the real
 * service.
 *
 * What it is here to catch is a caller that does not go through the path at
 * all. A service spec proves each feature calls the ingress; only this
 * proves that what comes out the far end lands in that feature's own column,
 * with its own description, and takes the previous picture down with it.
 */

/** A row any of the in-memory repositories can hold. */
interface Row {
  id: string;
  [key: string]: unknown;
}

/**
 * The smallest repository the services under test can work against.
 *
 * TypeORM's own `find` accepts far more than this; what is implemented here
 * is what these services actually ask for — equality matching, an array of
 * alternatives, an order and a limit.
 */
class InMemoryRepository<T extends Row> {
  readonly rows = new Map<string, T>();

  private _sequence = 0;

  /**
   * Builds an entity without storing it, as TypeORM does.
   *
   * @param input - The partial row.
   * @returns The entity.
   */
  create(input: Partial<T>): T {
    return { ...input } as T;
  }

  /**
   * Stores an entity, giving it an identifier when it has none.
   *
   * @param entity - The row.
   * @returns The stored row.
   */
  async save(entity: T): Promise<T> {
    const row = entity as Row;

    row.id = row.id ?? randomUUID();
    row.createdAt = row.createdAt ?? new Date(this._sequence++);
    this.rows.set(row.id, row as T);

    return Promise.resolve(row as T);
  }

  /**
   * Finds the first row matching the criteria.
   *
   * @param options - The where clause.
   * @returns The row, or null.
   */
  async findOne(options: { where: unknown }): Promise<T | null> {
    const [first] = this.matching(options.where);

    return Promise.resolve(first ?? null);
  }

  /**
   * Finds every row matching the criteria.
   *
   * @param options - The where clause, an order and a limit.
   * @returns The rows.
   */
  async find(options: {
    where: unknown;
    order?: Record<string, 'ASC' | 'DESC'>;
    take?: number;
  }): Promise<T[]> {
    let found = this.matching(options.where);

    if (options.order) {
      const [key, direction] = Object.entries(options.order)[0];

      found = [...found].sort((left, right) => {
        const a = Number(left[key]);
        const b = Number(right[key]);

        return direction === 'DESC' ? b - a : a - b;
      });
    }

    return Promise.resolve(
      options.take === undefined ? found : found.slice(0, options.take),
    );
  }

  /**
   * Matches rows against one clause or a list of alternatives.
   *
   * @param where - The clause.
   * @returns The matching rows.
   */
  private matching(where: unknown): T[] {
    const clauses = Array.isArray(where) ? where : [where];

    return [...this.rows.values()].filter(row =>
      clauses.some(clause =>
        Object.entries(clause as Record<string, unknown>).every(
          ([key, value]) => row[key] === value,
        ),
      ),
    );
  }
}

/**
 * Builds a PNG whose header claims the given dimensions.
 *
 * @param width - The width to declare.
 * @param height - The height to declare.
 * @returns The bytes.
 */
const buildPng = (width: number, height: number): Buffer => {
  const buffer = Buffer.alloc(24);

  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);

  return buffer;
};

/**
 * Builds a JPEG whose frame header claims the given dimensions.
 *
 * @param width - The width to declare.
 * @param height - The height to declare.
 * @returns The bytes.
 */
const buildJpeg = (width: number, height: number): Buffer => {
  const buffer = Buffer.alloc(13);

  Buffer.from([0xff, 0xd8, 0xff, 0xc0]).copy(buffer);
  buffer.writeUInt16BE(8, 4);
  buffer.writeUInt8(8, 6);
  buffer.writeUInt16BE(height, 7);
  buffer.writeUInt16BE(width, 9);

  return buffer;
};

/**
 * Builds a crop that satisfies a slot, or a plain square where there is no
 * slot specification.
 *
 * @param spec - The slot's rules, when it has any.
 * @returns The uploaded file.
 */
const fileFor = (spec: ImageSlotSpec | null): Express.Multer.File => {
  const bytes =
    spec === null
      ? buildPng(512, 512)
      : spec.outputFormat === 'png'
        ? buildPng(spec.recommendedWidth, spec.recommendedHeight)
        : buildJpeg(spec.recommendedWidth, spec.recommendedHeight);

  return {
    buffer: bytes,
    size: bytes.length,
    mimetype: spec?.outputFormat === 'jpeg' ? 'image/jpeg' : 'image/png',
    originalname: 'upload.img',
  } as Express.Multer.File;
};

describe('every upload caller, end to end', () => {
  const uploaderId = 'ba6b3a9e-0000-4000-8000-000000000001';
  const recordId = 'ba6b3a9e-0000-4000-8000-0000000000aa';

  let assets: InMemoryRepository<Row>;
  let placements: InMemoryRepository<Row>;
  let fileAssets: FileAssetService;
  let placementService: FileAssetPlacementService;
  let registry: AssetPublisherRegistry;
  let ingress: ImageIngressService;
  let publication: AssetPublicationService;
  let quarantined: Map<string, Buffer>;
  let deletedFromCloudflare: string[];
  let owners: Record<string, InMemoryRepository<Row>>;
  let customTrackingImageValues: InMemoryRepository<Row>;
  let published: number;

  /** The features whose rows a publisher writes, and how to read them back. */
  interface Caller {
    readonly name: string;
    readonly kind: FileAssetKind;
    readonly subject: FileAssetSubject;
    readonly slot: FileAssetSlot;
    readonly spec: ImageSlotSpec | null;
    readonly entityTag: string;
    readonly feature?: Record<string, unknown>;
    /** Puts the record, holding an existing picture, into its repository. */
    readonly seed: () => Promise<void>;
    /** Reads back what the record now points at. */
    readonly reference: () => Promise<string | null>;
    /** Reads back the description stored beside it. */
    readonly description?: () => Promise<string | null>;
  }

  /**
   * Builds the repository a publisher writes to, seeded with one record.
   *
   * @param key - Which repository.
   * @param row - The record, already holding a picture.
   */
  const seedOwner = async (key: string, row: Row): Promise<void> => {
    await owners[key].save(row);
  };

  /**
   * Reads one column back off the seeded record.
   *
   * @param key - Which repository.
   * @param column - The column.
   * @returns The value, or null.
   */
  const readOwner = async (
    key: string,
    column: string,
  ): Promise<string | null> => {
    const row = await owners[key].findOne({ where: { id: recordId } });

    return (row?.[column] as string | undefined) ?? null;
  };

  beforeEach(() => {
    assets = new InMemoryRepository<Row>();
    placements = new InMemoryRepository<Row>();
    quarantined = new Map<string, Buffer>();
    deletedFromCloudflare = [];
    published = 0;

    customTrackingImageValues = new InMemoryRepository<Row>();
    owners = {
      profile: new InMemoryRepository<Row>(),
      character: new InMemoryRepository<Row>(),
      arc: new InMemoryRepository<Row>(),
      story: new InMemoryRepository<Row>(),
      chapter: new InMemoryRepository<Row>(),
      cast: new InMemoryRepository<Row>(),
      spotlight: new InMemoryRepository<Row>(),
      fleetCommunity: new InMemoryRepository<Row>(),
      stoFleet: new InMemoryRepository<Row>(),
      stoArmada: new InMemoryRepository<Row>(),
    };

    fileAssets = new FileAssetService(
      assets as unknown as Repository<FileAssetEntity>,
    );
    placementService = new FileAssetPlacementService(
      placements as unknown as Repository<FileAssetPlacementEntity>,
    );
    registry = new AssetPublisherRegistry();

    const images = {
      validateAndSanitiseFile: (
        _userId: string,
        file: Express.Multer.File,
      ) => ({ fileBuffer: file.buffer, safeFileName: file.originalname }),
      publishImageToCloudflareImages: () =>
        Promise.resolve(`cf-image-${++published}`),
      deleteImageFromCloudflareImages: (imageId: string) => {
        deletedFromCloudflare.push(imageId);

        return Promise.resolve(imageId);
      },
    } as unknown as ImageUploadsService;

    const quarantine = {
      buildObjectKey: (assetId: string) => `test/assets/${assetId}`,
      put: (objectKey: string, body: Buffer) => {
        quarantined.set(objectKey, body);

        return Promise.resolve({ objectKey, objectVersion: null });
      },
      getStream: (objectKey: string) => {
        const bytes = quarantined.get(objectKey);

        return bytes === undefined
          ? Promise.reject(new Error('no such key'))
          : Promise.resolve(Readable.from([bytes]));
      },
      remove: (objectKey: string) => {
        quarantined.delete(objectKey);

        return Promise.resolve();
      },
    } as unknown as QuarantineStorageService;

    // The worker, faked at the queue boundary and nowhere else: the message
    // is not sent, and the registry moves exactly as the producer moves it.
    const scanRequests = {
      requestScan: async (asset: FileAssetEntity) => ({
        asset: await fileAssets.markScanning(asset.id),
        traceId: 'trace-1',
      }),
    } as unknown as ScanRequestProducerService;

    const slots = new ImageSlotService(images);

    ingress = new ImageIngressService(
      slots,
      new AssetIngressService(
        fileAssets,
        placementService,
        registry,
        quarantine,
        scanRequests,
      ),
    );

    publication = new AssetPublicationService(
      fileAssets,
      placementService,
      registry,
      quarantine,
      images,
      new AssetWithdrawalService(fileAssets, placementService, images),
    );

    for (const publisher of [
      new UserProfileImagePublisher(
        owners.profile as unknown as Repository<never>,
        registry,
      ),
      new CharacterImagePublisher(
        owners.character as unknown as Repository<CharacterEntity>,
        registry,
      ),
      new StorytimeArcImagePublisher(
        owners.arc as unknown as Repository<never>,
        registry,
      ),
      new StorytimeStoryImagePublisher(
        owners.story as unknown as Repository<never>,
        registry,
      ),
      new StorytimeChapterImagePublisher(
        owners.chapter as unknown as Repository<never>,
        registry,
      ),
      new StorytimeCastImagePublisher(
        owners.cast as unknown as Repository<never>,
        registry,
      ),
      new StorytimeSpotlightImagePublisher(
        owners.spotlight as unknown as Repository<never>,
        registry,
      ),
      new FleetCommunityImagePublisher(
        owners.fleetCommunity as unknown as Repository<FleetCommunityEntity>,
        registry,
      ),
      new StoFleetImagePublisher(
        owners.stoFleet as unknown as Repository<StoFleetEntity>,
        registry,
      ),
      new StoArmadaImagePublisher(
        owners.stoArmada as unknown as Repository<StoArmadaEntity>,
        registry,
      ),
    ]) {
      publisher.onModuleInit();
    }

    registry.register(
      new CustomTrackingImagePublisher(
        customTrackingService(),
        registry as unknown as AssetPublisherRegistry,
      ),
    );
  });

  /**
   * Builds Custom Tracking's own picture writing against in-memory rows.
   *
   * The only publisher that creates a row rather than updating one, so it
   * is the only one that needs its feature's service rather than a
   * repository.
   *
   * @returns The service.
   */
  const customTrackingService = (): CustomTrackingImageService => {
    const values = new InMemoryRepository<Row>();
    const imageValues = customTrackingImageValues;

    const manager = {
      findOne: async (entity: { name: string }, options: { where: unknown }) =>
        (entity.name === 'CustomTrackingValueEntity'
          ? values
          : imageValues
        ).findOne(options),
      create: (_entity: unknown, input: Row) => ({ ...input }),
      save: async (entity: { name: string }, row: Row) =>
        (entity.name === 'CustomTrackingValueEntity'
          ? values
          : imageValues
        ).save(row),
      delete: () => Promise.resolve(undefined),
    };

    return new CustomTrackingImageService(
      imageValues as unknown as Repository<never>,
      {
        findOwned: () =>
          Promise.resolve({
            id: 'field-1',
            fieldType: 'IMAGE',
            targetScope: 'ACCOUNT',
            configuration: { shape: 'SQUARE' },
          }),
      } as never,
      {
        findOwned: () =>
          Promise.resolve({ scope: 'ACCOUNT', id: recordId, label: 'a' }),
        whereFor: () => ({ accountId: recordId }),
      } as never,
      {} as never,
      {} as never,
      { enqueue: jest.fn(), flush: jest.fn() } as never,
      { uploadRefused: jest.fn(), uploadAbandoned: jest.fn() } as never,
      {
        manager,
        transaction: (body: (m: unknown) => Promise<unknown>) => body(manager),
      } as never,
    );
  };

  const callers: Caller[] = [
    {
      name: 'a profile picture',
      kind: FileAssetKind.PROFILE_IMAGE,
      subject: FileAssetSubject.USER_PROFILE,
      slot: FileAssetSlot.PICTURE,
      spec: null,
      entityTag: PROFILE_IMAGE_ENTITY_TAG,
      seed: () =>
        seedOwner('profile', {
          id: recordId,
          userId: recordId,
          profilePictureId: 'old-picture',
        }),
      reference: () => readOwner('profile', 'profilePictureId'),
    },
    {
      name: 'a Character portrait',
      kind: FileAssetKind.CHARACTER_IMAGE,
      subject: FileAssetSubject.STO_CHARACTER,
      slot: FileAssetSlot.PORTRAIT,
      spec: null,
      entityTag: CHARACTER_IMAGE_ENTITY_TAG,
      seed: () =>
        seedOwner('character', {
          id: recordId,
          profilePictureId: 'old-picture',
        }),
      reference: () => readOwner('character', 'profilePictureId'),
    },
    {
      name: 'an Arc banner',
      kind: FileAssetKind.STORYTIME_IMAGE,
      subject: FileAssetSubject.STORYTIME_ARC,
      slot: FileAssetSlot.BANNER,
      spec: STORYTIME_IMAGE_SPECS[StorytimeImageSlot.ARC_BANNER],
      entityTag: STORYTIME_IMAGE_SPECS[StorytimeImageSlot.ARC_BANNER].entityTag,
      feature: { altText: 'A fleet at anchor' },
      seed: () =>
        seedOwner('arc', {
          id: recordId,
          bannerImageId: 'old-picture',
          version: 1,
          updatedByUserId: uploaderId,
        }),
      reference: () => readOwner('arc', 'bannerImageId'),
      description: () => readOwner('arc', 'bannerImageAlt'),
    },
    {
      name: 'an Arc profile image',
      kind: FileAssetKind.STORYTIME_IMAGE,
      subject: FileAssetSubject.STORYTIME_ARC,
      slot: FileAssetSlot.PROFILE,
      spec: STORYTIME_IMAGE_SPECS[StorytimeImageSlot.ARC_PROFILE],
      entityTag:
        STORYTIME_IMAGE_SPECS[StorytimeImageSlot.ARC_PROFILE].entityTag,
      feature: { altText: 'An Arc badge' },
      seed: () =>
        seedOwner('arc', {
          id: recordId,
          profileImageId: 'old-picture',
          version: 1,
          updatedByUserId: uploaderId,
        }),
      reference: () => readOwner('arc', 'profileImageId'),
      description: () => readOwner('arc', 'profileImageAlt'),
    },
    {
      name: 'a Story banner',
      kind: FileAssetKind.STORYTIME_IMAGE,
      subject: FileAssetSubject.STORYTIME_STORY,
      slot: FileAssetSlot.BANNER,
      spec: STORYTIME_IMAGE_SPECS[StorytimeImageSlot.STORY_BANNER],
      entityTag:
        STORYTIME_IMAGE_SPECS[StorytimeImageSlot.STORY_BANNER].entityTag,
      feature: { altText: 'The USS Ares at warp' },
      seed: () =>
        seedOwner('story', {
          id: recordId,
          bannerImageId: 'old-picture',
          version: 1,
          updatedByUserId: uploaderId,
        }),
      reference: () => readOwner('story', 'bannerImageId'),
      description: () => readOwner('story', 'bannerImageAlt'),
    },
    {
      name: 'a Story profile image',
      kind: FileAssetKind.STORYTIME_IMAGE,
      subject: FileAssetSubject.STORYTIME_STORY,
      slot: FileAssetSlot.PROFILE,
      spec: STORYTIME_IMAGE_SPECS[StorytimeImageSlot.STORY_PROFILE],
      entityTag:
        STORYTIME_IMAGE_SPECS[StorytimeImageSlot.STORY_PROFILE].entityTag,
      feature: { altText: 'A crew badge' },
      seed: () =>
        seedOwner('story', {
          id: recordId,
          profileImageId: 'old-picture',
          version: 1,
          updatedByUserId: uploaderId,
        }),
      reference: () => readOwner('story', 'profileImageId'),
      description: () => readOwner('story', 'profileImageAlt'),
    },
    {
      name: 'a Chapter cover',
      kind: FileAssetKind.STORYTIME_IMAGE,
      subject: FileAssetSubject.STORYTIME_CHAPTER,
      slot: FileAssetSlot.COVER,
      spec: STORYTIME_IMAGE_SPECS[StorytimeImageSlot.CHAPTER_COVER],
      entityTag:
        STORYTIME_IMAGE_SPECS[StorytimeImageSlot.CHAPTER_COVER].entityTag,
      feature: { altText: 'A shuttle on approach' },
      seed: () =>
        seedOwner('chapter', {
          id: recordId,
          coverImageId: 'old-picture',
          version: 1,
          updatedByUserId: uploaderId,
        }),
      reference: () => readOwner('chapter', 'coverImageId'),
      description: () => readOwner('chapter', 'coverImageAlt'),
    },
    {
      name: 'a cast portrait',
      kind: FileAssetKind.STORYTIME_IMAGE,
      subject: FileAssetSubject.STORYTIME_CAST_MEMBER,
      slot: FileAssetSlot.PORTRAIT,
      spec: STORYTIME_IMAGE_SPECS[StorytimeImageSlot.CHARACTER_PORTRAIT],
      entityTag:
        STORYTIME_IMAGE_SPECS[StorytimeImageSlot.CHARACTER_PORTRAIT].entityTag,
      feature: { altText: 'An Andorian in uniform' },
      seed: () =>
        seedOwner('cast', {
          id: recordId,
          portraitImageId: 'old-picture',
          version: 1,
          updatedByUserId: uploaderId,
        }),
      reference: () => readOwner('cast', 'portraitImageId'),
      description: () => readOwner('cast', 'portraitImageAlt'),
    },
    {
      name: 'spotlight artwork',
      kind: FileAssetKind.STORYTIME_IMAGE,
      subject: FileAssetSubject.STORYTIME_SPOTLIGHT,
      slot: FileAssetSlot.OVERRIDE,
      spec: STORYTIME_IMAGE_SPECS[StorytimeImageSlot.SPOTLIGHT_OVERRIDE],
      entityTag:
        STORYTIME_IMAGE_SPECS[StorytimeImageSlot.SPOTLIGHT_OVERRIDE].entityTag,
      feature: { altText: 'A fleet at anchor' },
      seed: () =>
        seedOwner('spotlight', {
          id: recordId,
          overrideImageId: 'old-picture',
          updatedByUserId: uploaderId,
        }),
      reference: () => readOwner('spotlight', 'overrideImageId'),
      description: () => readOwner('spotlight', 'overrideImageAlt'),
    },
    {
      name: 'a Community banner',
      kind: FileAssetKind.FLEET_IMAGE,
      subject: FileAssetSubject.FLEET_COMMUNITY,
      slot: FileAssetSlot.BANNER,
      spec: FLEET_IMAGE_SPECS.BANNER,
      entityTag: FLEET_IMAGE_SPECS.BANNER.entityTag,
      feature: { altText: 'A fleet yard at dusk' },
      seed: () =>
        seedOwner('fleetCommunity', {
          id: recordId,
          bannerImageId: 'old-picture',
          bannerImageAlt: 'The old one',
          revision: 1,
        }),
      reference: () => readOwner('fleetCommunity', 'bannerImageId'),
      description: () => readOwner('fleetCommunity', 'bannerImageAlt'),
    },
    {
      name: 'a Community emblem',
      kind: FileAssetKind.FLEET_IMAGE,
      subject: FileAssetSubject.FLEET_COMMUNITY,
      slot: FileAssetSlot.EMBLEM,
      spec: FLEET_IMAGE_SPECS.EMBLEM,
      entityTag: FLEET_IMAGE_SPECS.EMBLEM.entityTag,
      feature: { altText: 'A fleet yard at dusk' },
      seed: () =>
        seedOwner('fleetCommunity', {
          id: recordId,
          emblemImageId: 'old-picture',
          emblemImageAlt: 'The old one',
          revision: 1,
        }),
      reference: () => readOwner('fleetCommunity', 'emblemImageId'),
      description: () => readOwner('fleetCommunity', 'emblemImageAlt'),
    },
    {
      name: 'a Fleet banner',
      kind: FileAssetKind.FLEET_IMAGE,
      subject: FileAssetSubject.FLEET,
      slot: FileAssetSlot.BANNER,
      spec: FLEET_IMAGE_SPECS.BANNER,
      entityTag: FLEET_IMAGE_SPECS.BANNER.entityTag,
      feature: { altText: 'A fleet yard at dusk' },
      seed: () =>
        seedOwner('stoFleet', {
          id: recordId,
          bannerImageId: 'old-picture',
          bannerImageAlt: 'The old one',
          revision: 1,
        }),
      reference: () => readOwner('stoFleet', 'bannerImageId'),
      description: () => readOwner('stoFleet', 'bannerImageAlt'),
    },
    {
      name: 'a Fleet emblem',
      kind: FileAssetKind.FLEET_IMAGE,
      subject: FileAssetSubject.FLEET,
      slot: FileAssetSlot.EMBLEM,
      spec: FLEET_IMAGE_SPECS.EMBLEM,
      entityTag: FLEET_IMAGE_SPECS.EMBLEM.entityTag,
      feature: { altText: 'A fleet yard at dusk' },
      seed: () =>
        seedOwner('stoFleet', {
          id: recordId,
          emblemImageId: 'old-picture',
          emblemImageAlt: 'The old one',
          revision: 1,
        }),
      reference: () => readOwner('stoFleet', 'emblemImageId'),
      description: () => readOwner('stoFleet', 'emblemImageAlt'),
    },
    {
      name: 'an Armada banner',
      kind: FileAssetKind.FLEET_IMAGE,
      subject: FileAssetSubject.ARMADA,
      slot: FileAssetSlot.BANNER,
      spec: FLEET_IMAGE_SPECS.BANNER,
      entityTag: FLEET_IMAGE_SPECS.BANNER.entityTag,
      feature: { altText: 'A fleet yard at dusk' },
      seed: () =>
        seedOwner('stoArmada', {
          id: recordId,
          bannerImageId: 'old-picture',
          bannerImageAlt: 'The old one',
          revision: 1,
        }),
      reference: () => readOwner('stoArmada', 'bannerImageId'),
      description: () => readOwner('stoArmada', 'bannerImageAlt'),
    },
    {
      name: 'an Armada emblem',
      kind: FileAssetKind.FLEET_IMAGE,
      subject: FileAssetSubject.ARMADA,
      slot: FileAssetSlot.EMBLEM,
      spec: FLEET_IMAGE_SPECS.EMBLEM,
      entityTag: FLEET_IMAGE_SPECS.EMBLEM.entityTag,
      feature: { altText: 'A fleet yard at dusk' },
      seed: () =>
        seedOwner('stoArmada', {
          id: recordId,
          emblemImageId: 'old-picture',
          emblemImageAlt: 'The old one',
          revision: 1,
        }),
      reference: () => readOwner('stoArmada', 'emblemImageId'),
      description: () => readOwner('stoArmada', 'emblemImageAlt'),
    },
    {
      name: 'a Custom Tracking picture',
      kind: FileAssetKind.CUSTOM_TRACKING_IMAGE,
      subject: FileAssetSubject.CUSTOM_TRACKING_VALUE,
      slot: FileAssetSlot.PICTURE,
      spec: CUSTOM_TRACKING_IMAGE_SPECS.SQUARE,
      entityTag: CUSTOM_TRACKING_IMAGE_SPECS.SQUARE.entityTag,
      feature: {
        altText: 'The USS Ares at warp',
        shape: 'SQUARE',
        fieldId: 'field-1',
        scope: 'ACCOUNT',
        targetId: recordId,
        userId: uploaderId,
      },
      // The answer row does not exist until the picture is published, so
      // there is nothing to seed: this is the one caller whose record is
      // created by publication rather than updated by it.
      seed: () => Promise.resolve(),
      reference: async () => {
        const [answer] = [...customTrackingImageValues.rows.values()];

        return (answer?.cloudflareImageId as string | undefined) ?? null;
      },
      description: async () => {
        const [answer] = [...customTrackingImageValues.rows.values()];

        return (answer?.altText as string | undefined) ?? null;
      },
    },
  ];

  /**
   * Sends one caller's upload through the shared path.
   *
   * @param caller - The caller.
   * @returns The asset the upload became.
   */
  const upload = async (caller: Caller): Promise<string> => {
    const accepted = await ingress.accept({
      spec: caller.spec,
      userId: uploaderId,
      kind: caller.kind,
      audience: FileAssetAudience.PUBLIC,
      subject: caller.subject,
      subjectId: recordId,
      slot: caller.slot,
      entityTag: caller.entityTag,
      entityId: recordId,
      maximumBytes: 10_485_760,
      sizeLimitLabel: 'Images',
      file: fileFor(caller.spec),
      feature: caller.feature ?? null,
    });

    return accepted.assetId;
  };

  /**
   * Answers a scan as the worker would, cleanly.
   *
   * @param assetId - The asset.
   */
  const clear = async (assetId: string): Promise<void> => {
    await fileAssets.recordCleanVerdict(assetId, {
      engine: 'clamav',
      engineVersion: '1.4.1',
      signatureVersion: '27500',
      policyVersion: 1,
    });
  };

  it.each(callers)(
    '$name is registered, quarantined and scanned before anything sees it',
    async caller => {
      await caller.seed();

      const assetId = await upload(caller);
      const asset = await fileAssets.findById(assetId);

      expect(asset?.state).toBe(FileAssetState.SCANNING);
      expect(asset?.kind).toBe(caller.kind);
      expect(asset?.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(quarantined.get(asset?.objectKey as string)).toBeDefined();

      // The third acceptance criterion: nothing the reader can see has
      // changed yet.
      await expect(caller.reference()).resolves.toBe(
        caller.name === 'a Custom Tracking picture' ? null : 'old-picture',
      );
    },
  );

  it.each(callers)(
    '$name reaches its own column once a scanner clears it',
    async caller => {
      await caller.seed();

      const assetId = await upload(caller);

      await clear(assetId);
      await publication.publish(assetId);

      const asset = await fileAssets.findById(assetId);

      expect(asset?.state).toBe(FileAssetState.AVAILABLE);
      expect(asset?.storage).toBe(FileAssetStorage.PUBLIC_IMAGES);
      await expect(caller.reference()).resolves.toBe(asset?.deliveryReference);

      if (caller.description) {
        await expect(caller.description()).resolves.toBe(
          caller.feature?.altText,
        );
      }
    },
  );

  it.each(callers)(
    'the quarantined copy of $name goes when it is published',
    async caller => {
      await caller.seed();

      const assetId = await upload(caller);
      const asset = await fileAssets.findById(assetId);

      await clear(assetId);
      await publication.publish(assetId);

      expect(quarantined.has(asset?.objectKey as string)).toBe(false);
    },
  );

  it.each(callers)('a refused $name changes nothing at all', async caller => {
    await caller.seed();

    const assetId = await upload(caller);

    await fileAssets.reject(assetId, 'SIGNATURE_MATCH');
    await publication.publish(assetId);

    await expect(caller.reference()).resolves.toBe(
      caller.name === 'a Custom Tracking picture' ? null : 'old-picture',
    );
    expect(deletedFromCloudflare).toEqual([]);
  });

  // MIME spoofing: the encoding is read out of the bytes, so a request that
  // says PNG over something else is refused before a row exists.
  it.each(callers)('$name is refused if it is not an image', async caller => {
    await caller.seed();

    await expect(
      ingress.accept({
        spec: caller.spec,
        userId: uploaderId,
        kind: caller.kind,
        audience: FileAssetAudience.PUBLIC,
        subject: caller.subject,
        subjectId: recordId,
        slot: caller.slot,
        entityTag: caller.entityTag,
        entityId: recordId,
        maximumBytes: 10_485_760,
        sizeLimitLabel: 'Images',
        file: {
          buffer: Buffer.from('MZ this is a program'),
          size: 20,
          mimetype: 'image/png',
          originalname: 'not-really.png',
        } as Express.Multer.File,
        feature: caller.feature ?? null,
      }),
    ).rejects.toThrow('not a readable PNG or JPEG image');

    expect(assets.rows.size).toBe(0);
    expect(quarantined.size).toBe(0);
  });

  describe('replacing a picture that is already published', () => {
    it('withdraws the old one and records the purge', async () => {
      const caller = callers[0];

      await caller.seed();

      const firstId = await upload(caller);

      await clear(firstId);
      await publication.publish(firstId);

      const first = await fileAssets.findById(firstId);
      const secondId = await upload(caller);

      await clear(secondId);
      await publication.publish(secondId);

      const replaced = await fileAssets.findById(first?.id as string);

      expect(replaced?.state).toBe(FileAssetState.REVOKED);
      expect(replaced?.purgedAt).not.toBeNull();
      expect(deletedFromCloudflare).toContain(first?.deliveryReference);
      await expect(caller.reference()).resolves.toBe('cf-image-2');
    });

    // The last thing somebody sent is the thing they get.
    it('gives up on an upload a later one overtook', async () => {
      const caller = callers[0];

      await caller.seed();

      const firstId = await upload(caller);
      const secondId = await upload(caller);

      const overtaken = await fileAssets.findById(firstId);

      expect(overtaken?.state).toBe(FileAssetState.DELETED);
      expect(quarantined.has(overtaken?.objectKey as string)).toBe(false);

      await clear(secondId);
      await publication.publish(secondId);

      await expect(caller.reference()).resolves.toBe('cf-image-1');
    });

    // A verdict for the overtaken upload arrives afterwards and must not
    // put its picture on the record.
    it('publishes nothing for the verdict that follows', async () => {
      const caller = callers[0];

      await caller.seed();

      const firstId = await upload(caller);

      await upload(caller);

      const outcome = await publication.publish(firstId);

      expect(outcome.published).toBe(false);
      await expect(caller.reference()).resolves.toBe('old-picture');
    });
  });

  describe('what the registry records', () => {
    it('places every upload against the slot it was for', async () => {
      const caller = callers[4];

      await caller.seed();

      const assetId = await upload(caller);
      const placement = await placementService.findByAssetId(assetId);

      expect(placement?.subject).toBe(FileAssetSubject.STORYTIME_STORY);
      expect(placement?.slot).toBe(FileAssetSlot.BANNER);
      expect(placement?.state).toBe(FileAssetPlacementState.PENDING);

      await clear(assetId);
      await publication.publish(assetId);

      const settled = await placementService.findByAssetId(assetId);

      expect(settled?.state).toBe(FileAssetPlacementState.ACTIVE);
    });

    it('records the claim and the evidence separately', async () => {
      const caller = callers[4];

      await caller.seed();

      const asset = await fileAssets.findById(await upload(caller));

      expect(asset?.declaredContentType).toBe('image/jpeg');
      expect(asset?.detectedContentType).toBe('image/jpeg');
    });
  });
});
