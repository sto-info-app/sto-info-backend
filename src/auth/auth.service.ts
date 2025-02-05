import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import * as ejs from 'ejs';
import { convert as htmlToText } from 'html-to-text';
import * as path from 'path';
import { MailService } from 'src/mail/mail.service';
import { UserRefreshTokenService } from 'src/user-refresh-token/user-refresh-token.service';
import { UserLoginDto } from 'src/user/dto/user-login.dto';
import { UserEntity } from 'src/user/entities/user.entity';
import { UserService } from 'src/user/user.service';
import { Repository } from 'typeorm';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly jwtService: JwtService,
    private readonly userService: UserService,
    private readonly mailService: MailService,
    private readonly refreshTokenService: UserRefreshTokenService,
  ) {}

  async register(user: Partial<UserEntity>): Promise<UserEntity> {
    if (await this.doesEmailExist(user.email)) {
      throw new ConflictException('Email already in use');
    }

    if (await this.doesUsernameExist(user.username)) {
      throw new ConflictException('Username already in use');
    }

    const hashedPassword = await this.getHashedPassword(user.password);
    const newUser = this.userRepository.create({
      email: user.email,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      password: hashedPassword,
    });

    const verificationToken = this.generateToken();
    newUser.emailVerificationToken = verificationToken;
    newUser.emailVerificationTokenExpiry = this.generateTokenExpiryDate();

    const savedUser = await this.userRepository.save(newUser);

    if (savedUser) {
      const verificationToken = this.generateToken();
      savedUser.emailVerificationToken = verificationToken;
      await this.userRepository.save(savedUser);

      this.mailService.sendVerificationEmail(
        savedUser.email,
        verificationToken,
      );

      return savedUser;
    } else {
      throw new Error('User could not be saved');
    }
  }

  async verifyEmail(token: string): Promise<UserEntity> {
    if (!token) {
      throw new BadRequestException('Token missing');
    }

    const user = await this.userRepository.findOne({
      where: { emailVerificationToken: token },
    });

    if (!user) {
      throw new NotFoundException('Invalid token');
    }

    if (new Date() > user.emailVerificationTokenExpiry) {
      throw new BadRequestException('Token expired');
    }

    user.emailVerified = true;
    user.emailVerificationToken = null;
    user.emailVerificationTokenExpiry = null;

    const updatedUser = await this.userRepository.save(user);

    // Send welcome email
    const emailSubject = `Welcome to the ${process.env.APP_TITLE}`;
    const emailHtmlContent = await ejs.renderFile(
      path.join(
        __dirname,
        '../..',
        'email-templates',
        'registration-welcome-email.ejs',
      ),
      {
        user,
        appTitle: process.env.APP_TITLE,
        loginUrl: process.env.APP_FRONTEND_URL + '/login',
        termsOfUseUrl: process.env.APP_FRONTEND_URL + '/terms-of-use',
      },
    );
    const emailTextContent = htmlToText(emailHtmlContent, {
      wordwrap: 130,
    });

    await this.mailService.sendEmailToUser(
      user.email,
      emailSubject,
      emailTextContent,
      emailHtmlContent,
    );

    return updatedUser;
  }

  async resendVerificationEmail(token: string): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { emailVerificationToken: token },
    });

    if (!user) {
      throw new NotFoundException('User token not found');
    }

    if (user.emailVerified) {
      throw new BadRequestException('Email is already verified');
    }

    const verificationToken = this.generateToken();
    user.emailVerificationToken = verificationToken;
    user.emailVerificationTokenExpiry = this.generateTokenExpiryDate();

    await this.userRepository.save(user);

    await this.mailService.sendVerificationEmail(user.email, verificationToken);
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

  async validateUserFromPayload(payload: any): Promise<UserEntity | null> {
    const user = await this.userRepository.findOne({
      where: { id: payload.sub },
    });
    if (user) {
      return user;
    }
    return null;
  }

  async login(userLogin: UserLoginDto): Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
  }> {
    const user = await this.userService.findByEmail(userLogin.email);

    if (!user || !(await user.comparePassword(userLogin.password))) {
      throw new HttpException(
        'Invalid username and password',
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (user.isAccountDisabled) {
      throw new HttpException('Account disabled', HttpStatus.FORBIDDEN);
    }

    if (user.deletedAt) {
      throw new HttpException('Account deleted', HttpStatus.FORBIDDEN);
    }

    if (!user.emailVerified) {
      throw new HttpException('Email not verified', HttpStatus.UNAUTHORIZED);
    }

    const payload = {
      email: user.email,
      sub: user.id,
    };

    const expiryHours = this.getRefreshTokenExpiryHours();

    const jwtId = this.generateToken();
    const newUserRefreshToken = this.jwtService.sign(payload, {
      expiresIn: `${expiryHours}h`,
      jwtid: jwtId,
    });

    await this.refreshTokenService.create({
      user,
      tokenId: newUserRefreshToken,
      jwtId: jwtId,
      isRevoked: false,
      expiresAt: this.calculateExpiryTime(expiryHours),
    });

    return {
      access_token: this.jwtService.sign(payload),
      refresh_token: newUserRefreshToken,
      expires_in: +process.env.AUTH_TOKEN_EXPIRES_IN,
    };
  }

  async doesUsernameExist(username: string): Promise<boolean> {
    const count = await this.userRepository.count({ where: { username } });
    return count > 0;
  }

  async doesEmailExist(email: string): Promise<boolean> {
    const count = await this.userRepository.count({ where: { email } });
    return count > 0;
  }

  generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  generateTokenExpiryDate(): Date {
    return new Date(Date.now() + 3600000); // Token expires in 1 hour
  }

  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.userService.findByEmail(email);
    if (!user) {
      throw new NotFoundException('Invalid email');
    }

    const passwordResetToken = this.generateToken();
    user.passwordResetToken = passwordResetToken;
    user.passwordResetTokenExpiry = this.generateTokenExpiryDate();

    await this.userRepository.save(user);

    await this.mailService.sendPasswordResetEmail(
      user.email,
      passwordResetToken,
      user.firstName,
    );
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    if (!token) {
      throw new BadRequestException('Token missing');
    }

    if (!newPassword) {
      throw new BadRequestException('Password missing from request');
    }

    const user = await this.userRepository.findOne({
      where: { passwordResetToken: token },
    });

    if (!user) {
      throw new NotFoundException('Invalid token');
    }

    if (new Date() > user.passwordResetTokenExpiry) {
      throw new BadRequestException('Token expired');
    }

    const hashedPassword = await this.getHashedPassword(newPassword);
    user.password = hashedPassword;
    user.passwordResetToken = null;
    user.passwordResetTokenExpiry = null;
    user.lastPasswordReset = new Date();

    await this.userRepository.save(user);

    await this.mailService.sendPasswordChangedEmail(user.email, user.firstName);
  }

  async refreshToken(refreshToken: string): Promise<{
    access_token: string;
    expires_in: number;
    refresh_token: string;
  }> {
    try {
      const payload = this.jwtService.verify(refreshToken);
      const user = await this.userService.findByUserRefreshToken(refreshToken);

      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      // Check if the refresh token exists in the user's tokens
      const tokenExists = user.refreshTokens.some(
        token => token.jwtId === payload.jti,
      );

      if (!tokenExists) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const expiryHours = this.getRefreshTokenExpiryHours();

      const jwtId = this.generateToken();
      const newPayload = { email: user.email, sub: user.id };
      const newUserRefreshToken = this.jwtService.sign(newPayload, {
        expiresIn: `${expiryHours}h`,
        jwtid: jwtId,
      });

      // Save the new refresh token
      await this.refreshTokenService.create({
        user,
        tokenId: newUserRefreshToken,
        jwtId: jwtId,
        isRevoked: false,
        expiresAt: this.calculateExpiryTime(expiryHours),
      });

      // Revoke the old refresh token
      await this.refreshTokenService.revokeToken(user.id, refreshToken);

      return {
        access_token: this.jwtService.sign(newPayload),
        refresh_token: newUserRefreshToken,
        expires_in: +process.env.AUTH_TOKEN_EXPIRES_IN,
      };
    } catch (e) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async revokeToken(id: string, tokenId: string): Promise<void> {
    const user = await this.userRepository.findOne({ where: { id: id } });
    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    user.refreshTokens = user.refreshTokens.filter(
      token => token.tokenId !== tokenId,
    );

    await this.userRepository.save(user);
  }

  calculateExpiryTime(hours: number): Date {
    const expiry = new Date();
    expiry.setHours(expiry.getHours() + hours);
    return expiry;
  }

  getRefreshTokenExpiryHours(): number {
    return +process.env.AUTH_TOKEN_EXPIRES_IN / 60 / 60;
  }

  async getHashedPassword(password: string): Promise<string> {
    return await bcrypt.hash(password, +process.env.AUTH_SALT_ROUNDS);
  }
}
