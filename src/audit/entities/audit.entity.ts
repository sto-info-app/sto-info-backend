import {
  IsIP,
  IsOptional,
  IsString,
  isUUID,
  IsUUID,
  Validate,
} from 'class-validator';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: '_audit' })
export class AuditEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  @IsString()
  entity: string;

  @Column()
  @IsString()
  action: string;

  @Column()
  @IsString()
  @Validate((value: any) => isUUID(value, '4') || !isNaN(Number(value)), {
    message: 'entityId must be a valid UUID or a number',
  })
  entityId: string;

  @IsOptional()
  @Column({ type: 'json', nullable: true, default: null })
  oldValue: any;

  @IsOptional()
  @Column({ type: 'json', nullable: true, default: null })
  newValue: any;

  @IsOptional()
  @IsUUID()
  @Column({ nullable: true, default: null })
  userId: string;

  @IsOptional()
  @IsIP()
  @Column({ nullable: true, default: null })
  ipAddress: string;

  @CreateDateColumn()
  createdAt: Date;
}
