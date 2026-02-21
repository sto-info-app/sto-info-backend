import { IsUUID } from 'class-validator';
import { AccountEntity } from 'src/sto/account/entities/account.entity';
import { PlatformLauncherEntity } from 'src/sto/platform-launcher/entities/platform-launcher.entity';
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'launcher' })
export class LauncherEntity {
  @PrimaryGeneratedColumn('uuid')
  @IsUUID()
  id: string;

  @Column({ type: 'varchar', length: 50, nullable: false, unique: true })
  name: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;

  @OneToMany('AccountEntity', 'launcher')
  accounts: AccountEntity[];

  @OneToMany('PlatformLauncherEntity', 'launcher')
  platformLaunchers: PlatformLauncherEntity[];
}
