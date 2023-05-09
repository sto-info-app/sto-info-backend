import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { User } from 'src/user/entities/user.entity';
import { Repository } from 'typeorm';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private jwtService: JwtService,
  ) {}

  async register(user: Partial<User>): Promise<User> {
    const hashedPassword = await bcrypt.hash(user.password, 8);
    const newUser = this.userRepository.create({
      email: user.email,
      password: hashedPassword,
    });
    return this.userRepository.save(newUser);
  }

  async validateUser(email: string, password: string): Promise<User | null> {
    const user = await this.userRepository.findOne({ where: { email: email } });
    if (user && (await bcrypt.compare(password, user.password))) {
      return user;
    }
    return null;
  }

  async validateUserFromPayload(payload: any): Promise<User | null> {
    const user = await this.userRepository.findOne(payload.id);
    if (user) {
      return user;
    }
    return null;
  }

  async login(user: User) {
    const payload = { id: user.id };
    return {
      access_token: this.jwtService.sign(payload),
    };
  }
}
