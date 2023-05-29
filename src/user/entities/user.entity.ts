import * as bcrypt from 'bcrypt';
import { Exclude } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';
import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  OneToMany,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { v4 as uuid } from 'uuid';
import { UserRefreshToken } from '../../user-refresh-token/entities/user-refresh-token.entity';

@Entity()
@Unique(['email', 'username'])
export class User {
  @PrimaryColumn('uuid')
  @IsNotEmpty()
  @IsString()
  id: string;

  @IsString()
  @Column({ length: 255, nullable: false, unique: true })
  email: string;

  @IsString()
  @Column({ length: 255, nullable: true, unique: true })
  username: string;

  @IsString()
  @Column({ length: 255, nullable: true })
  firstName: string;

  @IsString()
  @Column({ length: 255, nullable: true })
  lastName: string;

  @IsString()
  @Column({ length: 255, default: 'user' }) //TODO: adjust length and default as necessary - roles as table?
  role: string;

  @Column({ nullable: true })
  profilePicture: string;

  @Exclude()
  @IsString()
  @Column({ length: 255, nullable: false })
  password: string;

  @Column({ default: false })
  emailVerified: boolean;

  @Column({ nullable: true })
  emailVerificationToken: string;

  @Column({ nullable: true })
  emailVerificationTokenExpiry: Date;

  @Column({ nullable: true })
  lastLogin: Date;

  @Column({ nullable: true })
  lastPasswordReset: Date;

  @Column({ nullable: true })
  passwordResetToken: string;

  @Column({ nullable: true })
  passwordResetTokenExpiry: Date;

  @Column({ default: false })
  isAccountDisabled: boolean;

  @Column({ nullable: true })
  provider: string;

  @Column({ nullable: true })
  providerId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;

  @BeforeInsert()
  generateUuid() {
    this.id = uuid();
  }

  @OneToMany(() => UserRefreshToken, refreshToken => refreshToken.user)
  refreshTokens: UserRefreshToken[];

  async comparePassword(password: string): Promise<boolean> {
    return bcrypt.compare(password, this.password);
  }
}
