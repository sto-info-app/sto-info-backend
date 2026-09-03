import { ApiProperty } from '@nestjs/swagger';

import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { AccountEndeavourProgressEntity } from './account-endeavour-progress.entity';

@Entity({ name: 'endeavour_perk' })
@Index('UX_endeavour_perk_name_category', ['name', 'category'], {
  unique: true,
})
export class EndeavourPerkEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @IsNotEmpty()
  @IsString()
  @Column({ type: 'varchar', length: 255, nullable: false })
  name: string;

  @IsNotEmpty()
  @IsIn(['Space', 'Ground'])
  @Column({ type: 'varchar', length: 10, nullable: false })
  category: 'Space' | 'Ground';

  @IsOptional()
  @IsString()
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @IsNumber()
  @Min(0)
  @Column({ type: 'decimal', precision: 8, scale: 4, nullable: false })
  boostPerRank: number;

  @IsNumber()
  @Min(0)
  @Column({ type: 'decimal', precision: 8, scale: 4, nullable: false })
  boostMax: number;

  @IsNotEmpty()
  @IsIn(['percent', 'flat'])
  @Column({ type: 'varchar', length: 10, nullable: false })
  boostUnit: 'percent' | 'flat';

  @IsInt()
  @Min(1)
  @Max(25)
  @Column({ type: 'int', default: 25, nullable: false })
  maxNodes: number;

  @IsInt()
  @Min(0)
  @Column({ type: 'int', default: 0, nullable: false })
  sortOrder: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(
    'AccountEndeavourProgressEntity',
    (progress: AccountEndeavourProgressEntity) => progress.endeavourPerk,
  )
  accountProgress: AccountEndeavourProgressEntity[];

  @ApiProperty({
    description: 'Display-formatted boost per rank',
    example: '+0.50%',
  })
  /**
   * Gets the boost per rank display value.
   *
   * @returns The result of the operation.
   */
  get boostPerRankDisplay(): string {
    return this.boostUnit === 'percent'
      ? `+${this.boostPerRank}%`
      : `+${this.boostPerRank}`;
  }

  @ApiProperty({
    description: 'Display-formatted maximum boost',
    example: '+12.50%',
  })
  /**
   * Gets the maximum boost display value.
   *
   * @returns The result of the operation.
   */
  get boostMaxDisplay(): string {
    return this.boostUnit === 'percent'
      ? `+${this.boostMax}%`
      : `+${this.boostMax}`;
  }
}
