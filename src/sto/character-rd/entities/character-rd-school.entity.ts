import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CharacterRdProgressEntity } from './character-rd-progress.entity';

/** The maximum level a character can attain in an R&D school. */
export const RD_MAX_LEVEL = 20;

@Entity({ name: 'character_rd_school' })
@Index('UX_character_rd_school_name', ['name'], { unique: true })
export class CharacterRdSchoolEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @IsNotEmpty()
  @IsString()
  @Column({ type: 'varchar', length: 255, nullable: false })
  name: string;

  @IsOptional()
  @IsString()
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @IsOptional()
  @IsString()
  @Column({ type: 'varchar', length: 512, nullable: true })
  iconUrl: string | null;

  @IsOptional()
  @IsString()
  @Column({ type: 'varchar', length: 9, nullable: true })
  accentColor: string | null;

  @IsInt()
  @Min(0)
  @Column({ type: 'int', default: 0, nullable: false })
  sortOrder: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(
    'CharacterRdProgressEntity',
    (progress: CharacterRdProgressEntity) => progress.school,
  )
  characterProgress: CharacterRdProgressEntity[];
}
