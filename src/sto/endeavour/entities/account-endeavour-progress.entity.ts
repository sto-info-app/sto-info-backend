import { Expose } from 'class-transformer';
import { IsInt, IsUUID, Max, Min } from 'class-validator';
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

import { AccountEntity } from 'src/sto/account/entities/account.entity';

import { EndeavourPerkEntity } from './endeavour-perk.entity';

@Entity({ name: 'account_endeavour_progress' })
@Index(
  'UX_account_endeavour_progress_account_perk',
  ['accountId', 'endeavourPerkId'],
  {
    unique: true,
  },
)
export class AccountEndeavourProgressEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @IsUUID()
  @Column({ type: 'uuid', nullable: false })
  accountId: string;

  @IsUUID()
  @Column({ type: 'uuid', nullable: false })
  endeavourPerkId: string;

  @IsInt()
  @Min(0)
  @Max(25)
  @Column({ type: 'int', default: 0, nullable: false })
  currentNodes: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne('AccountEntity', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'accountId' })
  account: AccountEntity;

  @ManyToOne('EndeavourPerkEntity', { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'endeavourPerkId' })
  endeavourPerk: EndeavourPerkEntity;

  @Expose()
  /**
   * Gets the progress status.
   *
   * @returns The result of the operation.
   */
  get status(): 'not_started' | 'in_progress' | 'complete' {
    if (!this.endeavourPerk) return 'not_started';
    if (this.currentNodes === 0) return 'not_started';
    if (this.currentNodes >= this.endeavourPerk.maxNodes) return 'complete';
    return 'in_progress';
  }

  @Expose()
  /**
   * Gets the completion percentage.
   *
   * @returns The result of the operation.
   */
  get completionPercentage(): number {
    if (!this.endeavourPerk || this.endeavourPerk.maxNodes === 0) return 0;
    return Math.round((this.currentNodes / this.endeavourPerk.maxNodes) * 100);
  }

  @Expose()
  /**
   * Gets the total boost earned.
   *
   * @returns The result of the operation.
   */
  get totalBoostEarned(): number {
    if (!this.endeavourPerk) return 0;
    return (
      Math.round(
        Number(this.endeavourPerk.boostPerRank) * this.currentNodes * 100,
      ) / 100
    );
  }
}
