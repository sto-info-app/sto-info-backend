import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { CharacterEntity } from './character.entity';

@Entity({ name: 'character_general_faction' })
export class GeneralFactionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  name: string; // Federation, Klingon, Undecided

  @OneToMany('CharacterEntity', 'generalFaction')
  characters: CharacterEntity[];
}
