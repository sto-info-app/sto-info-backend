import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { UserEntity } from 'src/user/entities/user.entity';

import { FleetNameAliasEntity } from '../../entities/fleet-name-alias.entity';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { RosterSourceHeaderShape } from '../enums/roster-source-header-shape.enum';
import { RosterRowProblem } from '../services/roster-typed-parser.service';

/**
 * What is known about one accepted roster upload, other than its bytes.
 *
 * ADR-0001 requires a specific set of things to survive an import: the
 * original filename, the hash of what was received, the hash of what was
 * kept, and the version of the parser that turned one into the other. The
 * asset registry holds the filename and the sanitised hash because those
 * describe the stored object, and this table holds the rest — the things that
 * are true of a *roster import* rather than of a file.
 *
 * It is separate from `file_asset` deliberately. That table is site-wide and
 * describes a profile picture as readily as a CSV (ADR-0015); putting a source
 * hash and a parser version on it would put CSV vocabulary on every row the
 * site stores, and FC-016's export timezone and export instant would follow
 * them there.
 *
 * ## Why the source hash is kept when the source is not
 *
 * The hash is the only evidence that connects an import to the file somebody
 * actually uploaded. It settles "is this the same export I sent you" and "has
 * this already been imported" without retaining a byte of it, and a SHA-256 of
 * a roster CSV reveals nothing about its contents to anyone who does not
 * already hold the file. It is computed in memory and the buffer it was
 * computed from is discarded in the same call.
 *
 * ## Write-once
 *
 * The provenance columns are immutable once written, enforced by a trigger
 * rather than by convention. A row here is the answer to "what was actually
 * uploaded", and an answer that can be edited afterwards is not evidence.
 */
@Entity({ name: 'fleet_roster_import_source' })
@Index('IDX_roster_import_source_fleet_uploaded', ['fleetId', 'uploadedAt'])
@Index('IDX_roster_import_source_fleet_hash', ['fleetId', 'sourceSha256'])
@Index('IDX_roster_import_source_fleet_exported', ['fleetId', 'exportedAt'])
export class RosterImportSourceEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    description: 'The registry entry for the stored sanitised CSV.',
  })
  @Column({ type: 'uuid', nullable: false, unique: true })
  assetId: string;

  @ApiProperty({ description: 'The Fleet the export was uploaded against.' })
  @Column({ type: 'uuid', nullable: false })
  fleetId: string;

  @ApiProperty({
    description: 'Who uploaded it, or null once that account is gone.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  uploadedByUserId: string | null;

  @ApiProperty({
    description:
      'The filename exactly as uploaded. Recorded as evidence, never trusted ' +
      'and never used to build a storage key.',
  })
  @Column({ type: 'varchar', length: 512, nullable: false })
  originalFilename: string;

  @ApiProperty({
    description:
      'The Content-Type the upload arrived with, exactly as sent. Evidence ' +
      'of what was claimed and nothing more: a browser reports whatever the ' +
      'operating system associates with the extension, so the same export ' +
      'arrives as text/csv, application/vnd.ms-excel or ' +
      'application/octet-stream depending on the machine. Null for rows ' +
      'written before the column existed.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 255, nullable: true, default: null })
  declaredContentType: string | null;

  @ApiProperty({
    description:
      'SHA-256 of the received bytes, computed transiently. The bytes ' +
      'themselves are never stored — ADR-0001.',
  })
  @Column({ type: 'char', length: 64, nullable: false })
  sourceSha256: string;

  @ApiProperty({ description: 'SHA-256 of the retained sanitised CSV.' })
  @Column({ type: 'char', length: 64, nullable: false })
  sanitisedSha256: string;

  @ApiProperty({ description: 'How many bytes were received.' })
  @Column({ type: 'bigint', nullable: false })
  sourceByteSize: string;

  @ApiProperty({ description: 'How many bytes were retained.' })
  @Column({ type: 'bigint', nullable: false })
  sanitisedByteSize: string;

  @ApiProperty({
    description: 'Which of the two export headers the upload carried.',
    enum: RosterSourceHeaderShape,
  })
  @Column({
    type: 'enum',
    enum: RosterSourceHeaderShape,
    enumName: 'roster_source_header_shape_enum',
    nullable: false,
  })
  sourceHeaderShape: RosterSourceHeaderShape;

  @ApiProperty({ description: 'How many data rows the export held.' })
  @Column({ type: 'integer', nullable: false })
  rowCount: number;

  @ApiProperty({
    description:
      'How many of those rows carried an officer tail that was discarded. A ' +
      'count, never a value: it is what tells an administrator how much of ' +
      'the estate is officer-visible without reading a single note.',
  })
  @Column({ type: 'integer', nullable: false })
  officerTailRowCount: number;

  @ApiProperty({
    description: 'The parser version that produced the sanitised bytes.',
  })
  @Column({ type: 'integer', nullable: false })
  parserVersion: number;

  @ApiProperty({
    description:
      'The IANA zone the export\u2019s wall-clock times were written in, as ' +
      'the uploader stated it. Kept apart from every display and event ' +
      'timezone in the estate: a Community\u2019s preferred timezone says ' +
      'when its events happen and nothing about where somebody was sitting ' +
      'when they exported a CSV.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  exportTimezone: string | null;

  @ApiProperty({
    description:
      'The Fleet label the filename carried, exactly as written. Evidence ' +
      'of what was uploaded rather than of which Fleet it is: that is ' +
      'fleetId, decided by comparing this against the registered name.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 255, nullable: true, default: null })
  filenameFleetLabel: string | null;

  @ApiProperty({
    description:
      'When the filename says the export was taken, as a local wall-clock ' +
      'time. The observation, kept beside the instant it was read as, ' +
      'because a zone supplied wrongly is correctable only while the text ' +
      'it was applied to still exists.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 19, nullable: true, default: null })
  exportLocalStamp: string | null;

  @ApiProperty({
    description:
      'When the export was taken, resolved through the stated timezone ' +
      'against the rules in force on that date.',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  exportedAt: Date | null;

  @ApiProperty({
    description:
      'Whether the instant above was chosen between two. True only for a ' +
      'stamp the clock went back over, where the uploader had to say which ' +
      'of two moments an hour apart they meant \u2014 a fact somebody ' +
      'settled is a different kind of fact from one the file determined.',
  })
  @Column({ type: 'boolean', nullable: false, default: false })
  exportedAtAmbiguous: boolean;

  @ApiProperty({
    description:
      'The recorded former name the filename matched, or null when it ' +
      'matched the Fleet\u2019s current one. An import named for a name the ' +
      'Fleet no longer uses is worth being able to find later.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  matchedAliasId: string | null;

  @ApiProperty({
    description:
      'Why a clean import was not put into force, when it was not: each ' +
      'problem a line, a column name and a code, exactly as the typed ' +
      'reader reported it. Null for every import that was published and ' +
      'every one still waiting. The upload refuses a file whose rows do not ' +
      'read, so this is set only when the reader changed between the upload ' +
      'and publication.',
    nullable: true,
  })
  @Column({ type: 'jsonb', nullable: true, default: null })
  publicationProblems: RosterRowProblem[] | null;

  @ApiProperty({ description: 'When the upload was accepted.' })
  @Column({ type: 'timestamptz', nullable: false, default: () => 'now()' })
  uploadedAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => FileAssetEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'assetId' })
  asset: FileAssetEntity;

  @ManyToOne(() => StoFleetEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fleetId' })
  fleet: StoFleetEntity;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'uploadedByUserId' })
  uploadedBy: UserEntity | null;

  @ManyToOne(() => FleetNameAliasEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'matchedAliasId' })
  matchedAlias: FleetNameAliasEntity | null;
}
