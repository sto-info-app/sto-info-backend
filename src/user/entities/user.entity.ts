import { ApiProperty } from '@nestjs/swagger';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
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
import { AccountEntity } from '../../sto/account/entities/account.entity';
import { UserRefreshTokenEntity } from '../../user-refresh-token/entities/user-refresh-token.entity';
import { UserRole } from '../enums/user-role.enum';
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
  @Column({ type: 'varchar', length: 255, nullable: false, unique: true })
  email: string;

  @Exclude()
  @IsString()
  @IsNotEmpty()
  @Column({ type: 'varchar', length: 255, nullable: false })
  password: string;

  @Column({ type: 'boolean', default: false })
  emailVerified: boolean;

  @Exclude()
  @Column({ type: 'varchar', nullable: true })
  emailVerificationToken: string | null;

  @Exclude()
  @Column({ type: 'timestamp', nullable: true })
  emailVerificationTokenExpiry: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  lastLoginAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  lastPasswordReset: Date | null;

  @Exclude()
  @Column({ type: 'varchar', nullable: true })
  passwordResetToken: string | null;

  @Exclude()
  @Column({ type: 'timestamp', nullable: true })
  passwordResetTokenExpiry: Date | null;

  @Column({ type: 'boolean', default: false })
  isAccountDisabled: boolean;

  @ApiProperty({
    description: 'When an administrator disabled the account.',
    nullable: true,
  })
  @Column({ type: 'timestamp', nullable: true })
  disabledAt: Date | null;

  @ApiProperty({
    description:
      'Why an administrator disabled the account. Internal to the admin ' +
      'section — never shown to the user.',
    nullable: true,
  })
  @Exclude()
  @Column({ type: 'varchar', length: 500, nullable: true })
  disabledReason: string | null;

  @ApiProperty({
    description: 'The administrator who disabled the account.',
    nullable: true,
  })
  @Exclude()
  @Column({ type: 'uuid', nullable: true })
  disabledById: string | null;

  @ApiProperty({
    description: 'Authorisation role for the user.',
    enum: UserRole,
    example: UserRole.USER,
  })
  @Column({
    type: 'enum',
    enum: UserRole,
    enumName: 'user_role_enum',
    default: UserRole.USER,
  })
  role: UserRole;

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
  /**
   * Generates a UUID for the entity.
   *
   * @returns The result of the operation.
   */
  generateUuid() {
    this.id = randomUUID();
  }

  @OneToMany(() => UserRefreshTokenEntity, refreshToken => refreshToken.user)
  refreshTokens: UserRefreshTokenEntity[];

  @OneToMany(() => AccountEntity, account => account.user)
  accounts: AccountEntity[];

  @OneToOne(() => UserProfileEntity, profile => profile.user, { cascade: true })
  profile: UserProfileEntity;

  /**
   * Compares a password against the stored hash.
   *
   * @param password - The password.
   * @returns A promise that resolves when the operation completes.
   */
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
