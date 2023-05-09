import * as bcrypt from 'bcrypt';
import { Exclude } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';
import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { v4 as uuid } from 'uuid';

@Entity()
@Unique(['email'])
export class User {
  @PrimaryColumn('uuid')
  @IsNotEmpty()
  @IsString()
  id: string;

  @IsString()
  @Column({ length: 255, nullable: false, unique: true })
  email: string;

  @Exclude()
  @IsString()
  @Column({ length: 255, nullable: false })
  password: string;

  @Column({ default: false })
  emailVerified: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;

  @BeforeInsert()
  generateUuid() {
    this.id = uuid();
  }

  async comparePassword(password: string): Promise<boolean> {
    return bcrypt.compare(password, this.password);
  }
}
