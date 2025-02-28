import { IsNotEmpty, IsOptional, IsUUID } from 'class-validator';
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from './user.entity';

@Entity({ name: 'user_profile' })
@Unique(['username'])
export class UserProfileEntity {
  @PrimaryColumn('uuid')
  @IsNotEmpty()
  @IsUUID()
  userId: string;

  @IsNotEmpty()
  @Column({ length: 50, nullable: false, unique: true })
  username: string;

  @IsOptional()
  @Column({ length: 255, nullable: true, default: null })
  firstName: string;

  @IsOptional()
  @Column({ length: 255, nullable: true, default: null })
  lastName: string;

  @IsOptional()
  @Column({ nullable: true, default: null })
  profilePicture: string;

  @IsOptional()
  @Column({ nullable: true, default: null })
  profilePictureId: string;

  @Column({ default: false })
  publiclyVisible: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;

  @OneToOne(() => UserEntity, user => user.profile)
  @JoinColumn({ name: 'userId' })
  user: UserEntity;
}
