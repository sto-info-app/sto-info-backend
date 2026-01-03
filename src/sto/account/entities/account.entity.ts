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
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'account' })
@Index('UX_account_user_handle_normalized', ['userId', 'handleNormalized'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
export class AccountEntity {
  @PrimaryGeneratedColumn('uuid')
  @IsUUID()
  id: string;

  @IsNotEmpty()
  @IsUUID()
  @Column({ type: 'uuid', nullable: false })
  userId: string;

  @IsNotEmpty()
  @IsString()
  @Column({ length: 255, nullable: false })
  handle: string;

  @IsNotEmpty()
  @IsString()
  @Column({ length: 255, nullable: false })
  handleNormalized: string;

  @IsOptional()
  @IsString()
  @Column({ length: 255, nullable: true })
  username: string;

  @IsOptional()
  @IsEmail()
  @Column({ length: 255, nullable: true })
  email: string;

  @IsOptional()
  @IsUUID()
  @Column({ type: 'uuid', nullable: true })
  platformId: string;

  @ManyToOne(() => PlatformEntity)
  @JoinColumn({ name: 'platformId' })
  platform: PlatformEntity;

  @IsOptional()
  @IsUUID()
  @Column({ type: 'uuid', nullable: true })
  launcherId: string;

  @ManyToOne(() => LauncherEntity)
  @JoinColumn({ name: 'launcherId' })
  launcher: LauncherEntity;

  @IsOptional()
  @IsString()
  @Column({ type: 'text', nullable: true })
  notes: string;

  @IsOptional()
  @IsDateString()
  @Column({ type: 'timestamp', nullable: true })
  accountCreatedDate: Date;

  @IsBoolean()
  @Column({ default: true })
  publiclyVisible: boolean;

  @IsBoolean()
  @Column({ default: false })
  lifetimeSubscription: boolean;

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
