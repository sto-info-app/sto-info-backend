import { IsOptional, IsString, IsUUID } from 'class-validator';
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { LauncherEntity } from 'src/sto/launcher/entities/launcher.entity';
import { PlatformEntity } from 'src/sto/platform/entities/platform.entity';

@Entity({ name: 'platform_launcher' })
export class PlatformLauncherEntity {
  @PrimaryGeneratedColumn('uuid')
  @IsUUID()
  id: string;

  @IsOptional()
  @IsUUID()
  @Column({ type: 'uuid', nullable: true })
  platformId: string | null;

  @IsOptional()
  @IsUUID()
  @Column({ type: 'uuid', nullable: true })
  launcherId: string | null;

  @IsOptional()
  @IsString()
  @Column({ type: 'varchar', length: 511, nullable: true })
  backgroundImageUrl: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;

  @ManyToOne('PlatformEntity', 'platformLaunchers', {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'platformId' })
  platform: PlatformEntity;

  @ManyToOne('LauncherEntity', 'platformLaunchers', {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'launcherId' })
  launcher: LauncherEntity;
}
