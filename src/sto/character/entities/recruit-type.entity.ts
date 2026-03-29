import {
  Column,
  Entity,
  JoinTable,
  ManyToMany,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CharacterEntity } from './character.entity';
import type { FactionEntity } from './faction.entity';
import type { SpeciesEntity } from './species.entity';

@Entity({ name: 'character_recruit_type' })
export class RecruitTypeEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  name: string; // Standard, Delta, Temporal, Gamma, Klingon

  @Column({ type: 'varchar', length: 511, nullable: true })
  iconUrl: string | null;

  @OneToMany('CharacterEntity', 'recruitType')
  characters: CharacterEntity[];

  @ManyToMany('FactionEntity', 'recruitTypes')
  @JoinTable({
    name: 'recruit_type_faction_mapping',
    joinColumn: { name: 'recruitTypeId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'factionId', referencedColumnName: 'id' },
  })
  factions: FactionEntity[];

  @ManyToMany('SpeciesEntity', 'recruitTypes')
  @JoinTable({
    name: 'recruit_type_species_mapping',
    joinColumn: { name: 'recruitTypeId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'speciesId', referencedColumnName: 'id' },
  })
  species: SpeciesEntity[];
}
