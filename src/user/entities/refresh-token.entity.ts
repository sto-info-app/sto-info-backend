import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from './user.entity';

@Entity()
export class RefreshToken {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  tokenId: string;

  @Column()
  expiresAt: Date;

  @ManyToOne(() => User, user => user.refreshTokens)
  user: User;
}
