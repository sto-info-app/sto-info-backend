import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { beforeAll, jest } from '@jest/globals';
import sharp from 'sharp';
import { FindOperator, Repository } from 'typeorm';

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
import { AssetDenyLedgerService } from 'src/file-assets/ledger/asset-deny-ledger.service';
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
import { SCOPE_NEWS_COVER_SPEC } from 'src/fleet/news/constants/scope-news.constants';
import { ScopeNewsCoverPublisher } from 'src/fleet/news/services/scope-news-cover.publisher';
import { NewsPostEntity } from 'src/news/entities/news-post.entity';
import { ImageReencodeService } from 'src/shared/images/image-reencode.service';
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
 * seventeen callers is driven through the one path they now share — check, register,
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

/**
 * Compares one column with one criterion: a value, or the two TypeORM
 * operators a publisher here uses, `IsNull()` and `Not(...)`.
 *
 * @param actual - The column's value.
 * @param expected - The criterion.
 * @returns Whether the column satisfies it.
 */
const matches = (actual: unknown, expected: unknown): boolean => {
  if (expected instanceof FindOperator) {
    return expected.type === 'not'
      ? !matches(actual, expected.value)
      : actual === null || actual === undefined;
  }

  return actual === expected;
};

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
          ([key, value]) => matches(row[key], value),
        ),
      ),
    );
  }
}

/** Real pictures, drawn once each: they are decoded and re-encoded (FC-043). */
const pictures = new Map<string, Buffer>();

/**
 * Names the picture a slot needs.
 *
 * @param spec - The slot's rules, when it has any.
 * @returns The key it is drawn under.
 */
const pictureKey = (spec: ImageSlotSpec | null): string =>
  spec === null
    ? 'png:512x512'
    : `${spec.outputFormat}:${spec.recommendedWidth}x${spec.recommendedHeight}`;

/**
 * Draws a crop that satisfies a slot, or a plain square where there is no
 * slot specification, unless it has been drawn already.
 *
 * @param spec - The slot's rules, when it has any.
 */
const drawPicture = async (spec: ImageSlotSpec | null): Promise<void> => {
  const key = pictureKey(spec);

  if (pictures.has(key)) {
    return;
  }

  const image = sharp({
    create: {
      width: spec?.recommendedWidth ?? 512,
      height: spec?.recommendedHeight ?? 512,
      channels: 3,
      background: { r: 20, g: 60, b: 160 },
    },
  });

  pictures.set(
    key,
    await (
      spec?.outputFormat === 'jpeg' ? image.jpeg() : image.png()
    ).toBuffer(),
  );
};

/**
 * Builds the upload of a slot's picture.
 *
 * @param spec - The slot's rules, when it has any.
 * @param tail - Bytes appended after the picture, as a polyglot carries them.
 * @returns The uploaded file.
 */
const fileFor = (
  spec: ImageSlotSpec | null,
  tail: Buffer = Buffer.alloc(0),
): Express.Multer.File => {
  const bytes = Buffer.concat([pictures.get(pictureKey(spec))!, tail]);

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
      newsPost: new InMemoryRepository<Row>(),
    };

    fileAssets = new FileAssetService(
      assets as unknown as Repository<FileAssetEntity>,
      // Each deny is in the ledger first (FC-042); nothing here reads it.
      {
        record: jest.fn(async () => undefined),
      } as unknown as AssetDenyLedgerService,
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
      new ImageReencodeService(),
    );

    publication = new AssetPublicationService(
      fileAssets,
      placementService,
      registry,
      quarantine,
      images,
      new AssetWithdrawalService(
        fileAssets,
        placementService,
        images,
        // No picture here has been copied to private delivery (FC-040).
        { retireFor: () => Promise.resolve() } as never,
      ),
      // Pictures are never activated in a transaction; only a restricted
      // placement is, and there is none here.
      {} as never,
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
      new ScopeNewsCoverPublisher(
        owners.newsPost as unknown as Repository<NewsPostEntity>,
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
      // FC-027: the Community, Fleet and Armada news controllers all set a
      // cover through ScopeNewsService.setCover, onto one publisher.
      name: 'a scoped news cover',
      kind: FileAssetKind.FLEET_IMAGE,
      subject: FileAssetSubject.NEWS_POST,
      slot: FileAssetSlot.COVER,
      spec: SCOPE_NEWS_COVER_SPEC,
      entityTag: SCOPE_NEWS_COVER_SPEC.entityTag,
      feature: { altText: 'A briefing room' },
      seed: () =>
        seedOwner('newsPost', {
          id: recordId,
          communityId: 'ba6b3a9e-0000-4000-8000-0000000000cc',
          coverImageId: 'old-picture',
          coverImageAlt: 'The old one',
        }),
      reference: () => readOwner('newsPost', 'coverImageId'),
      description: () => readOwner('newsPost', 'coverImageAlt'),
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

  beforeAll(async () => {
    for (const caller of callers) {
      await drawPicture(caller.spec);
    }
  });

  /**
   * Sends one caller's upload through the shared path.
   *
   * @param caller - The caller.
   * @returns The asset the upload became.
   */
  const upload = async (caller: Caller, tail?: Buffer): Promise<string> => {
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
      file: fileFor(caller.spec, tail),
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

  // FC-043: clamd cannot see everything a picture can carry — an archive
  // member inflated past its MaxFileSize is read only so far — so every
  // caller quarantines pixels only. Whatever rode along after the picture,
  // an archive included, is gone before the bytes are hashed or stored.
  it.each(callers)('$name quarantines only pixels', async caller => {
    await caller.seed();

    const hidden = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from('FC043-HIDDEN-PAYLOAD', 'latin1'),
    ]);
    const asset = await fileAssets.findById(await upload(caller, hidden));
    const stored = quarantined.get(asset?.objectKey as string) as Buffer;

    expect(stored.includes(hidden)).toBe(false);
    expect(stored.includes(Buffer.from('FC043', 'latin1'))).toBe(false);
    expect(asset?.sha256).toBe(
      createHash('sha256').update(stored).digest('hex'),
    );
  });

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

/**
 * The matrix is the list of callers, so a publisher added later that it does
 * not drive must fail here rather than pass unnoticed (FC-043): every
 * concrete `…Publisher` class in `src` is either driven above or named below
 * with where its own evidence is.
 */
describe('the matrix covers every publisher', () => {
  /** The publishers the matrix drives. */
  const DRIVEN: readonly string[] = [
    UserProfileImagePublisher,
    CharacterImagePublisher,
    StorytimeArcImagePublisher,
    StorytimeStoryImagePublisher,
    StorytimeChapterImagePublisher,
    StorytimeCastImagePublisher,
    StorytimeSpotlightImagePublisher,
    FleetCommunityImagePublisher,
    StoFleetImagePublisher,
    StoArmadaImagePublisher,
    ScopeNewsCoverPublisher,
    CustomTrackingImagePublisher,
  ].map(publisher => publisher.name);

  /** Publishers that are not pictures, and where they are proved instead. */
  const ELSEWHERE: Readonly<Record<string, string>> = {
    // A roster export is a restricted asset with its own front door, which
    // rewrites it as sanitised text before it is stored.
    RosterImportPublisher:
      'roster-import-ingress.service.spec.ts, roster-import.publisher.spec.ts ' +
      'and the operations rehearsal',
  };

  /**
   * Lists every TypeScript source file under a directory.
   *
   * @param directory - Where to start.
   * @returns The files.
   */
  const sources = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) {
        return sources(path);
      }

      return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
        ? [path]
        : [];
    });

  it('finds no publisher it does not drive or account for', () => {
    const declared = sources(join(__dirname, '..', 'src')).flatMap(file =>
      [
        ...readFileSync(file, 'utf8').matchAll(
          /export class (\w+Publisher)[\s<]/g,
        ),
      ].map(match => match[1]),
    );

    expect(declared.length).toBeGreaterThanOrEqual(DRIVEN.length);
    expect(
      declared.filter(name => !DRIVEN.includes(name) && !(name in ELSEWHERE)),
    ).toEqual([]);
  });
});
