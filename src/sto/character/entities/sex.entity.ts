import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { CharacterEntity } from './character.entity';

@Entity({ name: 'character_sex' })
export class SexEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 20, unique: true })
  name: string; // Male, Female

  @OneToMany('CharacterEntity', 'sex')
  characters: CharacterEntity[];
}
