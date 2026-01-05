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

@Entity({ name: 'platform' })
export class PlatformEntity {
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

  @OneToMany('AccountEntity', 'platform')
  accounts: AccountEntity[];

  @OneToMany('PlatformLauncherEntity', 'platform')
  platformLaunchers: PlatformLauncherEntity[];
}
