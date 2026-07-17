import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CharacterReputationProgressEntity } from './character-reputation-progress.entity';

/** The maximum reputation tier a character can attain. */
export const REPUTATION_MAX_TIER = 6;

@Entity({ name: 'character_reputation' })
@Index('UX_character_reputation_name', ['name'], { unique: true })
export class CharacterReputationEntity {
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

  @IsOptional()
  @IsString()
  @Column({ type: 'varchar', length: 255, nullable: true })
  releasedWith: string | null;

  @IsInt()
  @Min(0)
  @Column({ type: 'int', default: 0, nullable: false })
  sortOrder: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(
    'CharacterReputationProgressEntity',
    (progress: CharacterReputationProgressEntity) => progress.reputation,
  )
  characterProgress: CharacterReputationProgressEntity[];
}
