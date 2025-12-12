import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { LauncherEntity } from 'src/sto/launcher/entities/launcher.entity';
import { PlatformEntity } from 'src/sto/platform/entities/platform.entity';
import { UserEntity } from 'src/user/entities/user.entity';
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

@Entity({ name: 'account' })
export class AccountEntity {
  @PrimaryGeneratedColumn('uuid')
  @IsUUID()
  id: string;

  @IsNotEmpty()
  @IsString()
  @Column({ length: 255, nullable: false })
  handle: string;

  @IsOptional()
  @IsString()
  @Column({ length: 255, nullable: true })
  username: string;

  @IsOptional()
  @IsEmail()
  @Column({ length: 255, nullable: true })
  email: string;

  @ManyToOne(() => PlatformEntity)
  @JoinColumn({ name: 'platformId' })
  platform: PlatformEntity;

  @ManyToOne(() => LauncherEntity)
  @JoinColumn({ name: 'launcherId' })
  launcher: LauncherEntity;

  @IsOptional()
  @IsString()
  @Column({ type: 'text', nullable: true })
  notes: string;

  @IsOptional()
  @IsDateString()
  @Column()
  accountCreatedDate: Date;

  @IsBoolean()
  @Column({ default: true })
  publiclyVisible: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;

  @ManyToOne(() => UserEntity, user => user.accounts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;
}
