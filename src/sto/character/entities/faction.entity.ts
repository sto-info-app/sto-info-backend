import { Exclude } from 'class-transformer';
import {
  Column,
  Entity,
  JoinTable,
  ManyToMany,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';

import type { CharacterRankEntity } from './character-rank.entity';
import { CharacterEntity } from './character.entity';
import type { GeneralFactionEntity } from './general-faction.entity';
import type { RecruitTypeEntity } from './recruit-type.entity';
import type { SpeciesEntity } from './species.entity';

@Entity({ name: 'character_faction' })
export class FactionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  name: string; // Federation, Klingon, TOS Starfleet, etc.

  @Column({ type: 'varchar', length: 511, nullable: true })
  iconUrl: string | null;

  @OneToMany('CharacterEntity', 'faction')
  characters: CharacterEntity[];

  @ManyToMany('SpeciesEntity', 'factions')
  @JoinTable({
    name: 'faction_species_mapping',
    joinColumn: { name: 'factionId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'speciesId', referencedColumnName: 'id' },
  })
  species: SpeciesEntity[];

  @ManyToMany('GeneralFactionEntity', 'factions')
  @JoinTable({
    name: 'faction_general_faction_mapping',
    joinColumn: { name: 'factionId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'generalFactionId', referencedColumnName: 'id' },
  })
  generalFactions: GeneralFactionEntity[];

  @ManyToMany('RecruitTypeEntity', 'factions')
  recruitTypes: RecruitTypeEntity[];

  @OneToMany('CharacterRankEntity', 'faction')
  @Exclude()
  ranks: CharacterRankEntity[];
}
