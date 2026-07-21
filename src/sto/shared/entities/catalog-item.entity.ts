import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import {
  Column,
  CreateDateColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Shared columns for STO catalog entities (R&D schools, reputations, …):
 * a uniquely named, sortable item with an optional description, icon and
 * accent colour. Subclasses supply the `@Entity` / `@Index` metadata plus any
 * extra columns and relations of their own.
 */
export abstract class CatalogItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @IsNotEmpty()
  @IsString()
  @Column({ type: 'varchar', length: 255, nullable: false })
  name: string;

  @IsOptional()
  @IsString()
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @IsOptional()
  @IsString()
  @Column({ type: 'varchar', length: 512, nullable: true })
  iconUrl: string | null;

  @IsOptional()
  @IsString()
  @Column({ type: 'varchar', length: 9, nullable: true })
  accentColor: string | null;

  @IsInt()
  @Min(0)
  @Column({ type: 'int', default: 0, nullable: false })
  sortOrder: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
