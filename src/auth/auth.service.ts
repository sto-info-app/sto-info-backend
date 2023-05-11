import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { User } from 'src/user/entities/user.entity';
import { UserService } from 'src/user/user.service';
import { Repository } from 'typeorm';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private jwtService: JwtService,
    private userService: UserService,
  ) {}

  async register(user: Partial<User>): Promise<User> {
    const hashedPassword = await bcrypt.hash(user.password, 8);
    const newUser = this.userRepository.create({
      email: user.email,
      password: hashedPassword,
    });
    return this.userRepository.save(newUser);
  }

  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.userService.findByEmail(email);
    if (user && (await user.comparePassword(password))) {
      // Update last login time
      user.lastLogin = new Date();
      await this.userService.update(user.id, user);

      // Remove password from user object before returning it
      const { password, ...result } = user;
      return result;
    }
    return null;
  }

  async validateUserFromPayload(payload: any): Promise<User | null> {
    const user = await this.userRepository.findOne({
      where: { id: payload.sub },
    });
    if (user) {
      return user;
    }
    return null;
  }

  async login(user: User): Promise<{ access_token: string }> {
    const payload = { email: user.email, sub: user.id };
    return {
      access_token: this.jwtService.sign(payload),
    };
  }
}
