import { Account } from 'src/sto/account/entities/account.entity';
import { PlatformLauncher } from 'src/sto/platform-launcher/entities/platform-launcher.entity';
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity()
export class Launcher {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 50, nullable: false, unique: true })
  name: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;

  @OneToMany(() => Account, account => account.launcher)
  accounts: Account[];

  @OneToMany(
    () => PlatformLauncher,
    platformLauncher => platformLauncher.launcher,
  )
  platformLaunchers: PlatformLauncher[];
}
