import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'contact_request' })
export class ContactRequestEntity {
  @PrimaryGeneratedColumn('uuid')
  @IsUUID()
  id: string;

  @IsNotEmpty()
  @IsString()
  @Column({ length: 100, nullable: false })
  name: string;

  @IsOptional()
  @IsEmail()
  @Column({ type: 'varchar', length: 320, nullable: true, default: null })
  emailMasked: string | null;

  @IsNotEmpty()
  @IsString()
  @Column({ length: 50, nullable: false })
  topic: string;

  @IsNotEmpty()
  @IsString()
  @Column({ type: 'text', nullable: false })
  message: string;

  @CreateDateColumn()
  createdAt: Date;
}
