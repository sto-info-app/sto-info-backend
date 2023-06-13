import { Launcher } from 'src/sto/launcher/entities/launcher.entity';
import { Platform } from 'src/sto/platform/entities/platform.entity';
import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

@Entity()
export class PlatformLauncher {
  @PrimaryColumn()
  platformId: string;

  @PrimaryColumn()
  launcherId: string;

  @ManyToOne(() => Platform, platform => platform.platformLaunchers, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'platformId' })
  platform: Platform;

  @ManyToOne(() => Launcher, launcher => launcher.platformLaunchers, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'launcherId' })
  launcher: Launcher;
}
