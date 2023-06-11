import { Account } from 'src/sto/account/entities/account.entity';
import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class Launcher {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 50, nullable: false, unique: true })
  name: string;

  @OneToMany(() => Account, account => account.launcher)
  accounts: Account[];
}
