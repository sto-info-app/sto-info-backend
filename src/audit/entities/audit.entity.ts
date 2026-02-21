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

  @Column({ type: 'varchar' })
  @IsString()
  entity: string;

  @Column({ type: 'varchar' })
  @IsString()
  action: string;

  @Column({ type: 'varchar' })
  @IsString()
  @Validate(
    (value: any) => isUUID(value, '4') || !Number.isNaN(Number(value)),
    {
      message: 'entityId must be a valid UUID or a number',
    },
  )
  entityId: string;

  @IsOptional()
  @Column({ type: 'json', nullable: true, default: null })
  oldValue: any;

  @IsOptional()
  @Column({ type: 'json', nullable: true, default: null })
  newValue: any;

  @IsOptional()
  @IsUUID()
  @Column({ type: 'varchar', nullable: true, default: null })
  userId: string | null;

  @IsOptional()
  @IsIP()
  @Column({ type: 'varchar', nullable: true, default: null })
  ipAddress: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
