import {
  Column,
  Entity,
  ManyToMany,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { CharacterEntity } from './character.entity';
import type { FactionEntity } from './faction.entity';

@Entity({ name: 'character_general_faction' })
export class GeneralFactionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  name: string; // Federation, Klingon, Undecided

  @Column({ type: 'varchar', length: 511, nullable: true })
  iconUrl: string | null;

  @OneToMany('CharacterEntity', 'generalFaction')
  characters: CharacterEntity[];

  @ManyToMany('FactionEntity', 'generalFactions')
  factions: FactionEntity[];
}
