import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { FactionEntity } from './faction.entity';

@Entity({ name: 'character_rank' })
export class CharacterRankEntity {
  @PrimaryGeneratedColumn('uuid')
  @IsUUID()
  id: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  @Max(65)
  @Column({ type: 'integer', nullable: false })
  levelFrom: number;

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  @Max(65)
  @Column({ type: 'integer', nullable: false })
  levelTo: number;

  @IsNotEmpty()
  @IsString()
  @Column({ length: 100, nullable: false })
  rankTitle: string;

  @IsOptional()
  @IsString()
  @Column({ type: 'varchar', length: 511, nullable: true })
  iconUrl: string | null;

  @IsNotEmpty()
  @IsUUID()
  @Column({ type: 'uuid', nullable: false })
  factionId: string;

  @ManyToOne('FactionEntity')
  @JoinColumn({ name: 'factionId' })
  faction: FactionEntity;
}
