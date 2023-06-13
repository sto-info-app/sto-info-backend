import { Account } from 'src/sto/account/entities/account.entity';
import { PlatformLauncher } from 'src/sto/platform-launcher/entities/platform-launcher.entity';
import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class Platform {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 50, nullable: false, unique: true })
  name: string;

  @OneToMany(() => Account, account => account.platform)
  accounts: Account[];

  @OneToMany(
    () => PlatformLauncher,
    platformLauncher => platformLauncher.platform,
  )
  platformLaunchers: PlatformLauncher[];
}
