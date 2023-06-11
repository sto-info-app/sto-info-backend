import { User } from 'src/user/entities/user.entity';
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
// import { Platform } from '../platform/entities/platform.entity';
// import { Launcher } from '../launcher/entities/launcher.entity';

@Entity()
export class Account {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 255, nullable: false, unique: true })
  handle: string;

  @Column({ length: 255, nullable: false, unique: true })
  username: string;

  @Column({ length: 255, nullable: false, unique: true })
  email: string;

  // @ManyToOne(() => Platform)
  // @JoinColumn({ name: 'platformId' })
  // platform: Platform;

  // @ManyToOne(() => Launcher)
  // @JoinColumn({ name: 'launcherId' })
  // launcher: Launcher;

  @Column({ length: 500, nullable: true })
  notes: string;

  @Column()
  accountCreatedDate: Date;

  @Column({ default: true })
  publiclyVisible: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;

  @ManyToOne(() => User, user => user.accounts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;
}
