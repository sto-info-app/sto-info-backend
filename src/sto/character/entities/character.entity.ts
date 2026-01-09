import { Expose } from 'class-transformer';
import {
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { CLOUDFLARE_R2_CDN_ROOT_URL } from 'src/shared/constants/image.constants';
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AccountEntity } from '../../account/entities/account.entity';
import { CharacterClassEntity } from './character-class.entity';
import { FactionEntity } from './faction.entity';
import { GeneralFactionEntity } from './general-faction.entity';
import { RecruitTypeEntity } from './recruit-type.entity';
import { SexEntity } from './sex.entity';
import { SpeciesEntity } from './species.entity';

@Entity({ name: 'character' })
@Index(
  'UX_character_account_handle_normalized',
  ['accountId', 'fullHandleNormalized'],
  {
    unique: true,
    where: '"deletedAt" IS NULL',
  },
)
@Index('UX_character_full_handle_slug', ['fullHandleSlug'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
export class CharacterEntity {
  @PrimaryGeneratedColumn('uuid')
  @IsUUID()
  id: string;

  @IsNotEmpty()
  @IsUUID()
  @Column({ type: 'uuid', nullable: false })
  accountId: string;

  @ManyToOne('AccountEntity', 'characters', {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'accountId' })
  account: AccountEntity;

  @IsNotEmpty()
  @IsString()
  @Column({ length: 255, nullable: false })
  handle: string;

  @IsOptional()
  @IsString()
  @Column({ name: 'profilePictureId', length: 255, nullable: true })
  profilePictureId: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Column({ type: 'integer', nullable: true })
  level: number;

  @IsNotEmpty()
  @IsString()
  @Column({ name: 'fullHandleNormalized', length: 511, nullable: false })
  fullHandleNormalized: string;

  @IsNotEmpty()
  @IsString()
  @Column({ length: 511, nullable: false })
  fullHandleSlug: string;

  @IsNotEmpty()
  @IsString()
  @Column({ length: 511, nullable: false })
  fullHandle: string; // Character@Account

  @IsNotEmpty()
  @IsUUID()
  @Column({ type: 'uuid', nullable: false })
  generalFactionId: string;

  @ManyToOne('GeneralFactionEntity')
  @JoinColumn({ name: 'generalFactionId' })
  generalFaction: GeneralFactionEntity;

  @IsNotEmpty()
  @IsUUID()
  @Column({ type: 'uuid', nullable: false })
  factionId: string;

  @ManyToOne('FactionEntity')
  @JoinColumn({ name: 'factionId' })
  faction: FactionEntity;

  @IsNotEmpty()
  @IsUUID()
  @Column({ type: 'uuid', nullable: false })
  sexId: string;

  @ManyToOne('SexEntity')
  @JoinColumn({ name: 'sexId' })
  sex: SexEntity;

  @IsNotEmpty()
  @IsUUID()
  @Column({ type: 'uuid', nullable: false })
  classId: string;

  @ManyToOne('CharacterClassEntity')
  @JoinColumn({ name: 'classId' })
  class: CharacterClassEntity;

  @IsOptional()
  @IsUUID()
  @Column({ type: 'uuid', nullable: true })
  recruitTypeId: string;

  @ManyToOne('RecruitTypeEntity')
  @JoinColumn({ name: 'recruitTypeId' })
  recruitType: RecruitTypeEntity;

  @IsNotEmpty()
  @IsUUID()
  @Column({ type: 'uuid', nullable: false })
  speciesId: string;

  @ManyToOne('SpeciesEntity')
  @JoinColumn({ name: 'speciesId' })
  species: SpeciesEntity;

  @IsOptional()
  @IsDateString()
  @Column({ type: 'timestamp', nullable: true })
  createdDate: Date;

  @IsOptional()
  @IsString()
  @Column({ length: 255, nullable: true })
  firstName: string;

  @IsOptional()
  @IsString()
  @Column({ length: 255, nullable: true })
  middleName: string;

  @IsOptional()
  @IsString()
  @Column({ length: 255, nullable: true })
  lastName: string;

  @IsOptional()
  @IsString()
  @Column({ type: 'text', nullable: true })
  biography: string;

  @IsOptional()
  @IsString()
  @Column({ type: 'text', nullable: true })
  notes: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;

  // Set base URL for the profile image
  // Supports both Cloudflare Images (new) and R2 (legacy)
  get profilePictureUrl(): string | null {
    if (!this.profilePictureId) {
      return null;
    }

    // Check if it's a Cloudflare Images ID (new format: env-userId-entityType-entityId-timestamp)
    // or an old R2 path (contains slashes)
    if (this.profilePictureId.includes('/')) {
      // Legacy R2 format
      if (!CLOUDFLARE_R2_CDN_ROOT_URL) {
        return null;
      }
      return `${CLOUDFLARE_R2_CDN_ROOT_URL}/${this.profilePictureId}`;
    }

    // New Cloudflare Images format
    const cfImagesHash = process.env.CLOUDFLARE_IMAGES_HASH;
    if (!cfImagesHash) {
      return null;
    }
    return `https://imagedelivery.net/${cfImagesHash}/${this.profilePictureId}/public`;
  }

  @Expose()
  get profilePicture(): string | null {
    return this.profilePictureUrl;
  }

  @Expose()
  get profilePicture300(): string | null {
    if (!this.profilePictureId) {
      return null;
    }

    // Check if it's a Cloudflare Images ID or old R2 path
    if (this.profilePictureId.includes('/')) {
      // Legacy R2 format - use Cloudflare Image Resizing
      if (!CLOUDFLARE_R2_CDN_ROOT_URL) {
        return null;
      }
      return `${CLOUDFLARE_R2_CDN_ROOT_URL}/cdn-cgi/image/width=300,height=300,fit=cover,format=auto/${this.profilePictureId}`;
    }

    // New Cloudflare Images format - use square300 variant
    const cfImagesHash = process.env.CLOUDFLARE_IMAGES_HASH;
    if (!cfImagesHash) {
      return null;
    }
    return `https://imagedelivery.net/${cfImagesHash}/${this.profilePictureId}/square300`;
  }

  @Expose()
  get profilePicture100(): string | null {
    if (!this.profilePictureId) {
      return null;
    }

    // Check if it's a Cloudflare Images ID or old R2 path
    if (this.profilePictureId.includes('/')) {
      // Legacy R2 format - use Cloudflare Image Resizing
      if (!CLOUDFLARE_R2_CDN_ROOT_URL) {
        return null;
      }
      return `${CLOUDFLARE_R2_CDN_ROOT_URL}/cdn-cgi/image/width=100,height=100,fit=cover,format=auto/${this.profilePictureId}`;
    }

    // New Cloudflare Images format - use square100 variant
    const cfImagesHash = process.env.CLOUDFLARE_IMAGES_HASH;
    if (!cfImagesHash) {
      return null;
    }
    return `https://imagedelivery.net/${cfImagesHash}/${this.profilePictureId}/square100`;
  }

  @Expose()
  get rank(): { title: string; iconUrl: string | null } | null {
    if (
      !this.faction?.ranks ||
      this.level === null ||
      this.level === undefined
    ) {
      return null;
    }

    const rankEntry = this.faction.ranks.find(
      r => this.level >= r.levelFrom && this.level <= r.levelTo,
    );

    return rankEntry
      ? { title: rankEntry.rankTitle, iconUrl: rankEntry.iconUrl }
      : null;
  }
}
