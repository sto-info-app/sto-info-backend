import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { FleetAudience } from 'src/fleet/enums/fleet-audience.enum';

import { FileAssetAudience } from '../enums/file-asset-audience.enum';
import { FileAssetKind } from '../enums/file-asset-kind.enum';
import { FileAssetState } from '../enums/file-asset-state.enum';
import { FileAssetStorage } from '../enums/file-asset-storage.enum';

/**
 * The authoritative record of one set of uploaded bytes.
 *
 * Every file the site holds on a person's behalf has one of these, and nothing
 * is served without consulting it. That is the whole point: before this table
 * the answer to "is this object safe" was a scanner call that happened once,
 * returned nothing durable, and was made against a buffer in memory rather
 * than against the object that ended up being stored.
 *
 * **This row, and not the worker's, decides publication.** The worker owns
 * `upload_files` and migrates it itself — ADR-0006 — and that table records
 * what a scanner did. What a scanner did is an input to publication and not
 * publication itself: a clean verdict for bytes whose audience has since
 * changed, or whose parent record has since been deleted, must not put them
 * back on the site. The two tables are joined by this row's identifier.
 *
 * **Object identity is write-once.** `objectKey`, `objectVersion` and `sha256`
 * may be filled in once and never changed afterwards. A database trigger
 * refuses the change rather than a service check, because the acceptance
 * criterion is about the property holding, not about every future caller
 * remembering. New bytes are a new asset with a new verdict, which is what
 * makes replacing a file invalidate the old verdict instead of inheriting it.
 */
@Entity({ name: 'file_asset' })
@Index('UX_file_asset_object', ['storage', 'objectKey'], {
  unique: true,
  where: `"deletedAt" IS NULL AND "objectKey" IS NOT NULL`,
})
@Index('IDX_file_asset_state_kind', ['state', 'kind'])
@Index('IDX_file_asset_owner', ['ownerUserId'])
@Index('IDX_file_asset_community', ['communityId'])
export class FileAssetEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ enum: FileAssetKind, description: 'What the asset is.' })
  @Column({
    type: 'enum',
    enum: FileAssetKind,
    enumName: 'file_asset_kind_enum',
    nullable: false,
  })
  kind: FileAssetKind;

  @ApiProperty({
    enum: FileAssetState,
    description: 'Where the asset has got to. Only AVAILABLE is served.',
  })
  @Column({
    type: 'enum',
    enum: FileAssetState,
    enumName: 'file_asset_state_enum',
    nullable: false,
  })
  state: FileAssetState;

  @ApiProperty({
    enum: FileAssetAudience,
    description: 'Who the asset may be handed to.',
  })
  @Column({
    type: 'enum',
    enum: FileAssetAudience,
    enumName: 'file_asset_audience_enum',
    nullable: false,
  })
  audience: FileAssetAudience;

  @ApiProperty({
    enum: FileAssetStorage,
    description: 'Where the bytes are, and therefore how to withdraw them.',
  })
  @Column({
    type: 'enum',
    enum: FileAssetStorage,
    enumName: 'file_asset_storage_enum',
    nullable: false,
  })
  storage: FileAssetStorage;

  /**
   * The person the asset was uploaded by and is held on behalf of.
   *
   * Nullable only for the backfill: a legacy Cloudflare image whose custom
   * identifier no longer parses has no recoverable uploader, and inventing one
   * would be worse than recording that it is unknown.
   */
  @ApiProperty({ description: 'The uploading user.', nullable: true })
  @Column({ type: 'uuid', nullable: true, default: null })
  ownerUserId: string | null;

  /**
   * The Fleet scope the asset belongs to, when its audience is `SCOPE`.
   *
   * Exactly one of the three is set, and the paired {@link scopeAudience} says
   * which of that scope's four audiences applies. A check constraint keeps the
   * four columns consistent with each other and with the audience, so an asset
   * cannot be scoped to nothing or scoped to two things at once.
   */
  @ApiProperty({
    description: 'Owning Community, when scoped.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  communityId: string | null;

  @ApiProperty({ description: 'Owning Fleet, when scoped.', nullable: true })
  @Column({ type: 'uuid', nullable: true, default: null })
  fleetId: string | null;

  @ApiProperty({ description: 'Owning Armada, when scoped.', nullable: true })
  @Column({ type: 'uuid', nullable: true, default: null })
  armadaId: string | null;

  @ApiProperty({
    enum: FleetAudience,
    description: 'Which of the scope audiences applies, when scoped.',
    nullable: true,
  })
  @Column({
    type: 'enum',
    enum: FleetAudience,
    enumName: 'fleet_audience_enum',
    nullable: true,
    default: null,
  })
  scopeAudience: FleetAudience | null;

  /**
   * How the object is addressed where it lives.
   *
   * A key in the quarantine bucket, a Cloudflare Images identifier, or a
   * legacy R2 key. Write-once.
   */
  @ApiProperty({ description: 'The object key or image identifier.' })
  @Column({ type: 'varchar', length: 1024, nullable: true, default: null })
  objectKey: string | null;

  /**
   * The storage provider's version of the object, when it has one.
   *
   * Write-once. **R2 has no bucket versioning**, so this is null for every
   * quarantine object and will stay null unless Cloudflare implements it —
   * ADR-0017. What binds a verdict to a particular set of bytes is therefore
   * {@link objectKey} never being reused, since a quarantine key is derived
   * from the asset's own identifier and every upload is a new asset, together
   * with {@link sha256}. Both are write-once at the database level.
   *
   * The column stays because the registry is not R2-specific: a store that
   * does version objects would fill it in, and the delivery path already
   * passes it through when it is set.
   */
  @ApiProperty({ description: 'Immutable object version.', nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true, default: null })
  objectVersion: string | null;

  /** The SHA-256 of the stored bytes, lowercase hexadecimal. Write-once. */
  @ApiProperty({ description: 'SHA-256 of the stored bytes.', nullable: true })
  @Column({ type: 'char', length: 64, nullable: true, default: null })
  sha256: string | null;

  @ApiProperty({ description: 'Size in bytes.', nullable: true })
  @Column({ type: 'bigint', nullable: true, default: null })
  byteSize: string | null;

  /** What the uploader's browser claimed the file was. Never trusted. */
  @ApiProperty({ description: 'Content type as declared.', nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true, default: null })
  declaredContentType: string | null;

  /** What inspecting the bytes actually found. */
  @ApiProperty({ description: 'Content type as detected.', nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true, default: null })
  detectedContentType: string | null;

  /**
   * The filename as uploaded, kept only where a feature needs to show it back.
   *
   * A filename is user-supplied text and is treated as such everywhere it is
   * rendered. The roster import wizard compares it against the target Fleet's
   * name, which is the reason it is retained at all.
   */
  @ApiProperty({ description: 'Filename as uploaded.', nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true, default: null })
  originalFilename: string | null;

  /**
   * The scan policy in force when the current verdict was reached.
   *
   * Bumping it is how a change in what counts as acceptable invalidates every
   * existing verdict without editing a single row.
   */
  @ApiProperty({ description: 'Scan policy version behind the verdict.' })
  @Column({ type: 'int', nullable: false, default: 1 })
  policyVersion: number;

  @ApiProperty({
    description: 'Scanner that produced the verdict.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  scanEngine: string | null;

  @ApiProperty({ description: 'Scanner version.', nullable: true })
  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  scanEngineVersion: string | null;

  /**
   * The signature database behind the verdict.
   *
   * Recorded honestly. A provider that does not expose one is recorded as
   * unknown rather than back-filled with a plausible value — ADR-0005.
   */
  @ApiProperty({ description: 'Signature version.', nullable: true })
  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  scanSignatureVersion: string | null;

  /**
   * Why the asset was refused, as a code rather than a sentence.
   *
   * Administrator-only, and never a signature name. R24 requires the uploader
   * to be told the file was not accepted and nothing more: naming what matched
   * tells somebody probing the scanner precisely what gets through.
   */
  @ApiProperty({
    description: 'Administrator-only rejection code.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  rejectionCode: string | null;

  /** Why an available asset was withdrawn. Administrator-only. */
  @ApiProperty({
    description: 'Administrator-only revocation reason.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  revocationReason: string | null;

  /**
   * When a withdrawal still needs a cache purge, and when it got one.
   *
   * Only an asset that was published on a public route has anything to purge,
   * and the gap between the two is the window in which the third acceptance
   * criterion is not yet true of it. Recording the gap means it can be alerted
   * on rather than assumed to be brief.
   */
  @ApiProperty({
    description: 'When a purge became necessary.',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  purgeRequiredAt: Date | null;

  @ApiProperty({ description: 'When the purge was confirmed.', nullable: true })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  purgedAt: Date | null;

  /**
   * When the asset may be destroyed by the retention cron.
   *
   * R27. Set for the kinds that have a policy of their own — a roster import
   * source is 180 days from upload — and null for the kinds whose lifetime is
   * their parent record's.
   */
  @ApiProperty({ description: 'When retention expires.', nullable: true })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  retainUntil: Date | null;

  @ApiProperty({
    description: 'When a verdict was last recorded.',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  lastVerdictAt: Date | null;

  @ApiProperty({
    description: 'When the asset became available.',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  availableAt: Date | null;

  @ApiProperty({
    description: 'When the asset stopped being served.',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  withdrawnAt: Date | null;

  @ApiProperty({ description: 'When the record was created.' })
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({ description: 'When the record was last changed.' })
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @ApiProperty({
    description: 'When the record was soft-deleted.',
    nullable: true,
  })
  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
