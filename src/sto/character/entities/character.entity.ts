import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AccountEntity } from '../../account/entities/account.entity';
import { CharacterClassEntity } from './character-class.entity';
import { FactionEntity } from './faction.entity';
import { GeneralFactionEntity } from './general-faction.entity';
import { RecruitTypeEntity } from './recruit-type.entity';
import { SexEntity } from './sex.entity';
import { SpeciesEntity } from './species.entity';

@Entity({ name: 'character' })
@Index(
  'UX_character_account_name_normalized',
  ['accountId', 'nameNormalized'],
  {
    unique: true,
    where: '"deletedAt" IS NULL',
  },
)
export class CharacterEntity {
  @PrimaryGeneratedColumn('uuid')
  @IsUUID()
  id: string;

  @IsNotEmpty()
  @IsUUID()
  @Column({ type: 'uuid', nullable: false })
  accountId: string;

  @ManyToOne('AccountEntity', 'characters', {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'accountId' })
  account: AccountEntity;

  @IsNotEmpty()
  @IsString()
  @Column({ length: 255, nullable: false })
  name: string;

  @IsNotEmpty()
  @IsString()
  @Column({ length: 255, nullable: false })
  nameNormalized: string;

  @IsNotEmpty()
  @IsString()
  @Column({ length: 511, nullable: false })
  handle: string; // Character@Account

  @IsNotEmpty()
  @IsUUID()
  @Column({ type: 'uuid', nullable: false })
  generalFactionId: string;

  @ManyToOne('GeneralFactionEntity')
  @JoinColumn({ name: 'generalFactionId' })
  generalFaction: GeneralFactionEntity;

  @IsNotEmpty()
  @IsUUID()
  @Column({ type: 'uuid', nullable: false })
  factionId: string;

  @ManyToOne('FactionEntity')
  @JoinColumn({ name: 'factionId' })
  faction: FactionEntity;

  @IsNotEmpty()
  @IsUUID()
  @Column({ type: 'uuid', nullable: false })
  sexId: string;

  @ManyToOne('SexEntity')
  @JoinColumn({ name: 'sexId' })
  sex: SexEntity;

  @IsNotEmpty()
  @IsUUID()
  @Column({ type: 'uuid', nullable: false })
  classId: string;

  @ManyToOne('CharacterClassEntity')
  @JoinColumn({ name: 'classId' })
  class: CharacterClassEntity;

  @IsOptional()
  @IsUUID()
  @Column({ type: 'uuid', nullable: true })
  recruitTypeId: string;

  @ManyToOne('RecruitTypeEntity')
  @JoinColumn({ name: 'recruitTypeId' })
  recruitType: RecruitTypeEntity;

  @IsNotEmpty()
  @IsUUID()
  @Column({ type: 'uuid', nullable: false })
  speciesId: string;

  @ManyToOne('SpeciesEntity')
  @JoinColumn({ name: 'speciesId' })
  species: SpeciesEntity;

  @IsOptional()
  @IsDateString()
  @Column({ type: 'timestamp', nullable: true })
  createdDate: Date;

  @IsOptional()
  @IsString()
  @Column({ length: 255, nullable: true })
  firstName: string;

  @IsOptional()
  @IsString()
  @Column({ length: 255, nullable: true })
  middleName: string;

  @IsOptional()
  @IsString()
  @Column({ length: 255, nullable: true })
  lastName: string;

  @IsOptional()
  @IsString()
  @Column({ type: 'text', nullable: true })
  biography: string;

  @IsOptional()
  @IsString()
  @Column({ type: 'text', nullable: true })
  notes: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}
