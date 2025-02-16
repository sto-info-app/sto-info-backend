import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { ValidatorsService } from 'src/shared/utilities/validators.service';
import { Repository } from 'typeorm';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserEntity } from './entities/user.entity';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,

    private readonly validatorsService: ValidatorsService,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<UserEntity> {
    if (!this.validateEmailUsername(createUserDto.email)) {
      throw new HttpException('Invalid email', HttpStatus.BAD_REQUEST);
    }

    if (!createUserDto.password) {
      throw new HttpException('Invalid password', HttpStatus.BAD_REQUEST);
    }

    if (
      await this.userRepository.findOne({
        where: { email: createUserDto.email },
      })
    ) {
      throw new HttpException('Email already in use', HttpStatus.BAD_REQUEST);
    }

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

  async update(id: string, post: UpdateUserDto): Promise<UserEntity> {
    if (!id || !this.validatorsService.validateUuid(id)) {
      throw new HttpException(
        'Invalid username and password',
        HttpStatus.NOT_FOUND,
      );
    }

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
    if (!id || !this.validatorsService.validateUuid(id)) {
      throw new HttpException(
        'Invalid username and password',
        HttpStatus.NOT_FOUND,
      );
    }

    const deletedUser = await this.userRepository.softDelete(id);
    if (!deletedUser.affected) {
      throw new HttpException(
        'Invalid username and password',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  async findById(id: string): Promise<UserEntity> {
    if (!id || !this.validatorsService.validateUuid(id)) {
      throw new HttpException(
        'Invalid username and password',
        HttpStatus.NOT_FOUND,
      );
    }

    return await this.userRepository.findOne({
      where: {
        id: id,
      },
      relations: [
        'profile',
        // 'accounts',
        // 'accounts.platform',
        // 'accounts.launcher',
      ],
    });
  }

  async findByEmail(email: string): Promise<UserEntity> {
    return await this.userRepository.findOne({
      where: { email: email },
      relations: ['profile'],
    });
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

  validateEmailUsername(email: string): boolean {
    if (!email) {
      return false;
    }
    return this.validatorsService.validateEmail(email);
  }
}
