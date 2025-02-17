import { IsUUID } from 'class-validator';
import { LauncherEntity } from 'src/sto/launcher/entities/launcher.entity';
import { PlatformEntity } from 'src/sto/platform/entities/platform.entity';
import {
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'platform_launcher' })
export class PlatformLauncherEntity {
  @PrimaryColumn()
  @IsUUID()
  platformId: string;

  @PrimaryColumn()
  @IsUUID()
  launcherId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;

  @ManyToOne(() => PlatformEntity, platform => platform.platformLaunchers, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'platformId' })
  platform: PlatformEntity;

  @ManyToOne(() => LauncherEntity, launcher => launcher.platformLaunchers, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'launcherId' })
  launcher: LauncherEntity;
}
