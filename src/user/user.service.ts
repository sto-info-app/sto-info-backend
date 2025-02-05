import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserEntity } from './entities/user.entity';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<UserEntity> {
    const user = new UserEntity();
    user.email = createUserDto.email;
    user.password = await bcrypt.hash(
      createUserDto.password,
      +process.env.AUTH_SALT_ROUNDS,
    );
    user.emailVerified = false;

    const newUser = await this.userRepository.save(user);

    return newUser;
  }

  async seedUser(user: UserEntity): Promise<UserEntity> {
    return await this.userRepository.save(user);
  }

  async update(id: string, post: UpdateUserDto): Promise<UserEntity> {
    await this.userRepository.update(id, post);
    const updatedUser = await this.userRepository.findOne({
      where: { id: id },
    });
    if (updatedUser) {
      return updatedUser;
    }

    throw new HttpException(
      'Invalid username and password',
      HttpStatus.NOT_FOUND,
    );
  }

  async delete(id: string) {
    const deletedUser = await this.userRepository.softDelete(id);
    if (!deletedUser.affected) {
      throw new HttpException(
        'Invalid username and password',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  async findById(id: string): Promise<UserEntity> {
    return await this.userRepository.findOne({
      where: {
        id: id,
      },
      // relations: [
      //   'accounts',
      //   'accounts.platform',
      //   'accounts.launcher',
      // ],
    });
  }

  async findByEmail(email: string): Promise<UserEntity> {
    return await this.userRepository.findOne({ where: { email: email } });
  }

  async updateUserEmailVerifiedStatus(
    email: string,
    verified: boolean,
  ): Promise<void> {
    const user = await this.userRepository.findOne({ where: { email: email } });
    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    user.emailVerified = verified;
    await this.userRepository.save(user);
  }

  async findByUserRefreshToken(token: string): Promise<UserEntity> {
    const user = await this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.refreshTokens', 'refreshToken')
      .where('refreshToken.tokenId = :token', { token })
      .getOne();

    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    return user;
  }

  async findByPayload(payload: any): Promise<UserEntity | null> {
    return await this.userRepository.findOne({ where: { id: payload.sub } });
  }
}
