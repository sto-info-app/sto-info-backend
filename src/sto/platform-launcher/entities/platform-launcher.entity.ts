import { Launcher } from 'src/sto/launcher/entities/launcher.entity';
import { Platform } from 'src/sto/platform/entities/platform.entity';
import { Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class PlatformLauncher {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Platform, platform => platform.platformLaunchers)
  platform: Platform;

  @ManyToOne(() => Launcher, launcher => launcher.platformLaunchers)
  launcher: Launcher;
}
