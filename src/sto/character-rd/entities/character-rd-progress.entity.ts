import { Expose } from 'class-transformer';
import { IsInt, IsUUID, Max, Min } from 'class-validator';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  CharacterRdSchoolEntity,
  RD_MAX_LEVEL,
} from './character-rd-school.entity';

@Entity({ name: 'character_rd_progress' })
@Index(
  'UX_character_rd_progress_character_school',
  ['characterId', 'schoolId'],
  {
    unique: true,
  },
)
export class CharacterRdProgressEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @IsUUID()
  @Column({ type: 'uuid', nullable: false })
  characterId: string;

  @IsUUID()
  @Column({ type: 'uuid', nullable: false })
  schoolId: string;

  @IsInt()
  @Min(0)
  @Max(RD_MAX_LEVEL)
  @Column({ type: 'int', default: 0, nullable: false })
  currentLevel: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne('CharacterEntity', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'characterId' })
  character: CharacterEntity;

  @ManyToOne('CharacterRdSchoolEntity', { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'schoolId' })
  school: CharacterRdSchoolEntity;

  @Expose()
  /**
   * Gets the progress status.
   *
   * @returns The result of the operation.
   */
  get status(): 'not_started' | 'in_progress' | 'complete' {
    if (this.currentLevel === 0) return 'not_started';
    if (this.currentLevel >= RD_MAX_LEVEL) return 'complete';
    return 'in_progress';
  }

  @Expose()
  /**
   * Gets the completion percentage.
   *
   * @returns The result of the operation.
   */
  get completionPercentage(): number {
    return Math.round((this.currentLevel / RD_MAX_LEVEL) * 100);
  }
}
