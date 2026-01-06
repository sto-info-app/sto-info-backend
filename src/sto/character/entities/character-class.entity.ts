import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { CharacterEntity } from './character.entity';

@Entity({ name: 'character_class' })
export class CharacterClassEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 50, unique: true })
  name: string; // Tactical, Engineering, Science

  @OneToMany('CharacterEntity', 'class')
  characters: CharacterEntity[];
}
