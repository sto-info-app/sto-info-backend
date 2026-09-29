import { FileAssetKind } from '../enums/file-asset-kind.enum';
import { FileAssetSlot } from '../enums/file-asset-slot.enum';
import { FileAssetSubject } from '../enums/file-asset-subject.enum';

/**
 * One feature column that holds a picture's Cloudflare Images ID, or a
 * legacy R2 key (FC-040).
 *
 * Every SQL fragment reads the feature row as `row`; `joins` may add more.
 */
export interface ImageReferenceColumn {
  readonly table: string;
  readonly column: string;
  /** The row's primary key. */
  readonly rowId: string;
  readonly kind: FileAssetKind;
  readonly subject: FileAssetSubject;
  readonly slot: FileAssetSlot;
  /** The placement's subject ID for the row, as the feature writes it. */
  readonly subjectIdSql: string;
  /** Whose picture it is, for a reference with no registry row. */
  readonly ownerSql: string;
  readonly joins?: string;
}

const S = '"sto_info_app"';

/** The Storytime story a chapter or cast member belongs to. */
const STORY_JOIN = `LEFT JOIN ${S}."storytime_story" story ON story."id" = row."storyId"`;

/** The Community a Fleet or Armada belongs to. */
const COMMUNITY_JOIN = `LEFT JOIN ${S}."fleet_community" community ON community."id" = row."communityId"`;

/** Every column that holds a picture, and what each one's picture is. */
export const IMAGE_REFERENCE_COLUMNS: readonly ImageReferenceColumn[] = [
  {
    table: 'user_profile',
    column: 'profilePictureId',
    rowId: 'userId',
    kind: FileAssetKind.PROFILE_IMAGE,
    subject: FileAssetSubject.USER_PROFILE,
    slot: FileAssetSlot.PICTURE,
    subjectIdSql: 'row."userId"::text',
    ownerSql: 'row."userId"',
  },
  {
    table: 'character',
    column: 'profilePictureId',
    rowId: 'id',
    kind: FileAssetKind.CHARACTER_IMAGE,
    subject: FileAssetSubject.STO_CHARACTER,
    slot: FileAssetSlot.PORTRAIT,
    subjectIdSql: 'row."id"::text',
    ownerSql: 'account."userId"',
    joins: `LEFT JOIN ${S}."account" account ON account."id" = row."accountId"`,
  },
  {
    table: 'storytime_arc',
    column: 'bannerImageId',
    rowId: 'id',
    kind: FileAssetKind.STORYTIME_IMAGE,
    subject: FileAssetSubject.STORYTIME_ARC,
    slot: FileAssetSlot.BANNER,
    subjectIdSql: 'row."id"::text',
    ownerSql: 'row."ownerUserId"',
  },
  {
    table: 'storytime_arc',
    column: 'profileImageId',
    rowId: 'id',
    kind: FileAssetKind.STORYTIME_IMAGE,
    subject: FileAssetSubject.STORYTIME_ARC,
    slot: FileAssetSlot.PROFILE,
    subjectIdSql: 'row."id"::text',
    ownerSql: 'row."ownerUserId"',
  },
  {
    table: 'storytime_story',
    column: 'bannerImageId',
    rowId: 'id',
    kind: FileAssetKind.STORYTIME_IMAGE,
    subject: FileAssetSubject.STORYTIME_STORY,
    slot: FileAssetSlot.BANNER,
    subjectIdSql: 'row."id"::text',
    ownerSql: 'row."ownerUserId"',
  },
  {
    table: 'storytime_story',
    column: 'profileImageId',
    rowId: 'id',
    kind: FileAssetKind.STORYTIME_IMAGE,
    subject: FileAssetSubject.STORYTIME_STORY,
    slot: FileAssetSlot.PROFILE,
    subjectIdSql: 'row."id"::text',
    ownerSql: 'row."ownerUserId"',
  },
  {
    table: 'storytime_chapter',
    column: 'coverImageId',
    rowId: 'id',
    kind: FileAssetKind.STORYTIME_IMAGE,
    subject: FileAssetSubject.STORYTIME_CHAPTER,
    slot: FileAssetSlot.COVER,
    subjectIdSql: 'row."id"::text',
    ownerSql: 'story."ownerUserId"',
    joins: STORY_JOIN,
  },
  {
    table: 'storytime_character',
    column: 'portraitImageId',
    rowId: 'id',
    kind: FileAssetKind.STORYTIME_IMAGE,
    subject: FileAssetSubject.STORYTIME_CAST_MEMBER,
    slot: FileAssetSlot.PORTRAIT,
    subjectIdSql: 'row."id"::text',
    ownerSql: 'story."ownerUserId"',
    joins: STORY_JOIN,
  },
  {
    table: 'storytime_spotlight',
    column: 'overrideImageId',
    rowId: 'id',
    kind: FileAssetKind.STORYTIME_IMAGE,
    subject: FileAssetSubject.STORYTIME_SPOTLIGHT,
    slot: FileAssetSlot.OVERRIDE,
    subjectIdSql: 'row."id"::text',
    ownerSql: 'row."createdByUserId"',
  },
  {
    table: 'custom_tracking_image_value',
    column: 'cloudflareImageId',
    rowId: 'id',
    kind: FileAssetKind.CUSTOM_TRACKING_IMAGE,
    subject: FileAssetSubject.CUSTOM_TRACKING_VALUE,
    slot: FileAssetSlot.PICTURE,
    subjectIdSql: `tracking_value."fieldId"::text || ':' || COALESCE(tracking_value."accountId", tracking_value."characterId")::text`,
    ownerSql: 'COALESCE(value_account."userId", character_account."userId")',
    joins: [
      `LEFT JOIN ${S}."custom_tracking_value" tracking_value ON tracking_value."id" = row."valueId"`,
      `LEFT JOIN ${S}."account" value_account ON value_account."id" = tracking_value."accountId"`,
      `LEFT JOIN ${S}."character" value_character ON value_character."id" = tracking_value."characterId"`,
      `LEFT JOIN ${S}."account" character_account ON character_account."id" = value_character."accountId"`,
    ].join(' '),
  },
  ...(['fleet_community', 'sto_fleet', 'sto_armada'] as const).flatMap(table =>
    (
      [
        ['bannerImageId', FileAssetSlot.BANNER],
        ['emblemImageId', FileAssetSlot.EMBLEM],
      ] as const
    ).map(([column, slot]): ImageReferenceColumn => ({
      table,
      column,
      rowId: 'id',
      kind: FileAssetKind.FLEET_IMAGE,
      subject:
        table === 'fleet_community'
          ? FileAssetSubject.FLEET_COMMUNITY
          : table === 'sto_fleet'
            ? FileAssetSubject.FLEET
            : FileAssetSubject.ARMADA,
      slot,
      subjectIdSql: 'row."id"::text',
      ...(table === 'fleet_community'
        ? { ownerSql: 'row."ownerUserId"' }
        : { ownerSql: 'community."ownerUserId"', joins: COMMUNITY_JOIN }),
    })),
  ),
  {
    table: 'news_post',
    column: 'coverImageId',
    rowId: 'id',
    kind: FileAssetKind.FLEET_IMAGE,
    subject: FileAssetSubject.NEWS_POST,
    slot: FileAssetSlot.COVER,
    subjectIdSql: 'row."id"::text',
    ownerSql: 'row."authorId"',
  },
];

/**
 * Whether a reference is a legacy R2 key rather than a Cloudflare Images ID:
 * only a key has a path in it.
 *
 * @param reference - The value a column holds.
 * @returns True for an R2 key.
 */
export function isR2Key(reference: string): boolean {
  return reference.includes('/');
}

/**
 * Whether a Cloudflare Images ID is one Cloudflare generated, and so one it
 * will make private in place. A custom ID, which every picture before
 * FC-040 has, cannot be private and has to be copied.
 *
 * @param reference - The image ID.
 * @returns True for a generated ID.
 */
export function isGeneratedImageId(reference: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    reference,
  );
}
