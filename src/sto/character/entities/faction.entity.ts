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
import type { RecruitTypeEntity } from './recruit-type.entity';
import type { SpeciesEntity } from './species.entity';

@Entity({ name: 'character_faction' })
export class FactionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100, unique: true })
  name: string; // Federation, Klingon, TOS Starfleet, etc.

  @Column({ length: 511, nullable: true })
  iconUrl: string;

  @OneToMany('CharacterEntity', 'faction')
  characters: CharacterEntity[];

  @ManyToMany('SpeciesEntity', 'factions')
  @JoinTable({
    name: 'faction_species_mapping',
    joinColumn: { name: 'factionId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'speciesId', referencedColumnName: 'id' },
  })
  species: SpeciesEntity[];

  @ManyToMany('RecruitTypeEntity', 'factions')
  recruitTypes: RecruitTypeEntity[];

  @OneToMany('CharacterRankEntity', 'faction')
  @Exclude()
  ranks: CharacterRankEntity[];
}
