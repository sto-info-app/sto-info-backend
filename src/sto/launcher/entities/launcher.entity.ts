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

  @Column({ length: 50, nullable: false, unique: true })
  name: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;

  @OneToMany(() => AccountEntity, account => account.launcher)
  accounts: AccountEntity[];

  @OneToMany(
    () => PlatformLauncherEntity,
    PlatformLauncherEntity => PlatformLauncherEntity.launcher,
  )
  platformLaunchers: PlatformLauncherEntity[];
}
