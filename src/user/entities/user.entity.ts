import { ApiProperty } from '@nestjs/swagger';
import * as bcrypt from 'bcrypt';
import { Exclude } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, IsUUID } from 'class-validator';
import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  OneToMany,
  OneToOne,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
  VirtualColumn,
} from 'typeorm';
import { v4 as uuid } from 'uuid';
import { AccountEntity } from '../../sto/account/entities/account.entity';
import { UserRefreshTokenEntity } from '../../user-refresh-token/entities/user-refresh-token.entity';
import { UserProfileEntity } from './user-profile.entity';

@Entity({ name: 'user' })
@Unique(['email'])
export class UserEntity {
  @PrimaryColumn('uuid')
  @IsNotEmpty()
  @IsUUID()
  id: string;

  @IsEmail()
  @IsNotEmpty()
  @Column({ length: 255, nullable: false, unique: true })
  email: string;

  @Exclude()
  @IsString()
  @IsNotEmpty()
  @Column({ length: 255, nullable: false })
  password: string;

  @Column({ default: false })
  emailVerified: boolean;

  @Exclude()
  @Column({ type: 'varchar', nullable: true })
  emailVerificationToken: string | null;

  @Exclude()
  @Column({ nullable: true })
  emailVerificationTokenExpiry: Date | null;

  @Column({ nullable: true })
  lastLoginAt: Date | null;

  @Column({ nullable: true })
  lastPasswordReset: Date | null;

  @Exclude()
  @Column({ type: 'varchar', nullable: true })
  passwordResetToken: string | null;

  @Exclude()
  @Column({ nullable: true })
  passwordResetTokenExpiry: Date | null;

  @Column({ default: false })
  isAccountDisabled: boolean;

  @Exclude()
  @Column({ type: 'varchar', nullable: true })
  provider: string | null;

  @Exclude()
  @Column({ type: 'varchar', nullable: true })
  providerId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date | null;

  @BeforeInsert()
  generateUuid() {
    this.id = uuid();
  }

  @OneToMany(() => UserRefreshTokenEntity, refreshToken => refreshToken.user)
  refreshTokens: UserRefreshTokenEntity[];

  @OneToMany(() => AccountEntity, account => account.user)
  accounts: AccountEntity[];

  @OneToOne(() => UserProfileEntity, profile => profile.user, { cascade: true })
  profile: UserProfileEntity;

  async comparePassword(password: string): Promise<boolean> {
    return bcrypt.compare(password, this.password);
  }

  /**
   * The total number of non-deleted characters associated with this user across all their accounts.
   */
  @ApiProperty({
    description:
      'The total number of non-deleted characters associated with this user across all their accounts.',
    example: 12,
  })
  @VirtualColumn({
    query: alias =>
      `SELECT count(*) FROM "sto_info_app"."character" c JOIN "sto_info_app"."account" a ON c."accountId" = a.id WHERE a."userId" = ${alias}.id AND c."deletedAt" IS NULL`,
  })
  characterCount: number;
}
