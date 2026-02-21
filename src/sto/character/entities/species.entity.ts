import {
  Column,
  Entity,
  ManyToMany,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CharacterEntity } from './character.entity';
import type { FactionEntity } from './faction.entity';
import type { RecruitTypeEntity } from './recruit-type.entity';

@Entity({ name: 'character_species' })
export class SpeciesEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  name: string;

  @OneToMany('CharacterEntity', 'species')
  characters: CharacterEntity[];

  @ManyToMany('FactionEntity', 'species')
  factions: FactionEntity[];

  @ManyToMany('RecruitTypeEntity', 'species')
  recruitTypes: RecruitTypeEntity[];
}
