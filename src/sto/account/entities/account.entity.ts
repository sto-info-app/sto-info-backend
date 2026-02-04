import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { LauncherEntity } from 'src/sto/launcher/entities/launcher.entity';
import { PlatformEntity } from 'src/sto/platform/entities/platform.entity';
import { UserEntity } from 'src/user/entities/user.entity';
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VirtualColumn,
} from 'typeorm';
import { CharacterEntity } from '../../character/entities/character.entity';

@Entity({ name: 'account' })
@Index('UX_account_user_handle_normalized', ['userId', 'handleNormalized'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
@Index('UX_account_handle_slug', ['handleSlug'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
export class AccountEntity {
  @PrimaryGeneratedColumn('uuid')
  @IsUUID()
  id: string;

  @IsNotEmpty()
  @IsUUID()
  @Column({ type: 'uuid', nullable: false })
  userId: string;

  @IsNotEmpty()
  @IsString()
  @Column({ length: 255, nullable: false })
  handle: string;

  @IsNotEmpty()
  @IsString()
  @Column({ length: 255, nullable: false })
  handleNormalized: string;

  @IsNotEmpty()
  @IsString()
  @Column({ length: 255, nullable: false })
  handleSlug: string;

  @IsOptional()
  @IsString()
  @Column({ length: 255, nullable: true })
  username: string;

  @IsOptional()
  @IsEmail()
  @Column({ length: 255, nullable: true })
  email: string;

  @IsOptional()
  @IsUUID()
  @Column({ type: 'uuid', nullable: true })
  platformId: string;

  @ManyToOne('PlatformEntity')
  @JoinColumn({ name: 'platformId' })
  platform: PlatformEntity;

  @IsOptional()
  @IsUUID()
  @Column({ type: 'uuid', nullable: true })
  launcherId: string;

  @ManyToOne('LauncherEntity')
  @JoinColumn({ name: 'launcherId' })
  launcher: LauncherEntity;

  @IsOptional()
  @IsString()
  @Column({ type: 'text', nullable: true })
  notes: string;

  @IsOptional()
  @IsDateString()
  @Column({ type: 'timestamp', nullable: true })
  accountCreatedDate: Date;

  @IsBoolean()
  @Column({ default: true })
  publiclyVisible: boolean;

  @IsBoolean()
  @Column({ default: false })
  lifetimeSubscription: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;

  @ManyToOne('UserEntity', 'accounts', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;

  @OneToMany('CharacterEntity', 'account')
  characters: CharacterEntity[];

  /**
   * The number of non-deleted characters associated with this specific account.
   */
  @ApiProperty({
    description:
      'The number of non-deleted characters associated with this specific account.',
    example: 5,
  })
  @VirtualColumn({
    query: alias =>
      `SELECT count(*) FROM "sto_info_app"."character" WHERE "accountId" = ${alias}.id AND "deletedAt" IS NULL`,
  })
  characterCount: number;

  /**
   * The number of non-deleted characters associated with the user across all their accounts.
   */
  @ApiProperty({
    description:
      'The number of non-deleted characters associated with the user across all their accounts.',
    example: 12,
  })
  @VirtualColumn({
    query: alias =>
      `SELECT count(*) FROM "sto_info_app"."character" c JOIN "sto_info_app"."account" a ON c."accountId" = a.id WHERE a."userId" = ${alias}."userId" AND c."deletedAt" IS NULL`,
  })
  userCharacterCount: number;
}
