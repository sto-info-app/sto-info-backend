import { IsEmail, IsIP, IsNotEmpty, IsOptional } from 'class-validator';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: '_audit_login_attempts' })
export class AuditLoginAttemptEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @IsNotEmpty()
  @IsEmail()
  @Column({ length: 255, nullable: true, default: null })
  email: string;

  @IsOptional()
  @IsIP()
  @Column({ nullable: true, default: null })
  ipAddress: string;

  @Column()
  success: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
