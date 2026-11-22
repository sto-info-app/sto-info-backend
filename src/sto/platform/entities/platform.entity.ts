import { IsUUID } from 'class-validator';
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { AccountEntity } from 'src/sto/account/entities/account.entity';
import { PlatformLauncherEntity } from 'src/sto/platform-launcher/entities/platform-launcher.entity';

@Entity({ name: 'platform' })
export class PlatformEntity {
  @PrimaryGeneratedColumn('uuid')
  @IsUUID()
  id: string;

  @Column({ type: 'varchar', length: 50, nullable: false, unique: true })
  name: string;

  /**
   * Whether the game provides a fleet roster export on this platform.
   *
   * A fact about Star Trek Online rather than about this site: the export
   * exists on Windows and on neither console, so a Fleet recorded on a
   * console has no way to produce the CSV every roster feature here reads.
   * It is held on the catalogue because it is the game's answer and the game
   * may change it — a console gaining the facility should be a row somebody
   * updates rather than a release.
   *
   * Defaults to false, so a platform added later cannot import until
   * somebody has said it can.
   */
  @Column({ type: 'boolean', nullable: false, default: false })
  providesRosterExport: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;

  @OneToMany('AccountEntity', 'platform')
  accounts: AccountEntity[];

  @OneToMany('PlatformLauncherEntity', 'platform')
  platformLaunchers: PlatformLauncherEntity[];
}
