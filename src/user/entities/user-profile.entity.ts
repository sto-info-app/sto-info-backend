import { Expose } from 'class-transformer';
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

  // Set base URL for the profile image stored on Cloudflare Images
  get profilePictureUrl(): string | null {
    if (!this.profilePictureId) {
      return null;
    }

    const cfImagesHash = process.env.CLOUDFLARE_IMAGES_HASH;
    if (!cfImagesHash) {
      return null;
    }
    return `https://imagedelivery.net/${cfImagesHash}/${this.profilePictureId}/public`;
  }

  @Expose()
  get profilePicture(): string | null {
    return this.profilePictureUrl;
  }

  @Expose()
  get profilePicture300(): string | null {
    if (!this.profilePictureId) {
      return null;
    }

    const cfImagesHash = process.env.CLOUDFLARE_IMAGES_HASH;
    if (!cfImagesHash) {
      return null;
    }
    return `https://imagedelivery.net/${cfImagesHash}/${this.profilePictureId}/square300`;
  }

  @Expose()
  get profilePicture100(): string | null {
    if (!this.profilePictureId) {
      return null;
    }

    const cfImagesHash = process.env.CLOUDFLARE_IMAGES_HASH;
    if (!cfImagesHash) {
      return null;
    }
    return `https://imagedelivery.net/${cfImagesHash}/${this.profilePictureId}/square100`;
  }
}
