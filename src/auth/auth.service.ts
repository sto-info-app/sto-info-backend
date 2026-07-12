import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { instanceToPlain } from 'class-transformer';
import { validateOrReject } from 'class-validator';
import * as ejs from 'ejs';
import { convert as htmlToText } from 'html-to-text';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { AuditLoginAttemptEntity } from 'src/audit/entities/audit-login-attempt.entity';
import { MailService } from 'src/mail/mail.service';
import { EMAIL_PATTERN } from 'src/shared/constants/regex-patterns.constants';
import { stringifyError } from 'src/shared/utilities/error.utility';

import { CurrentContextHelper } from 'src/shared/context/current-context.helper';
import { UserRefreshTokenService } from 'src/user-refresh-token/user-refresh-token.service';
import { CreateUserDto } from 'src/user/dto/create-user.dto';
import { UserLoginDto } from 'src/user/dto/user-login.dto';
import { UserProfileEntity } from 'src/user/entities/user-profile.entity';
import { UserEntity } from 'src/user/entities/user.entity';
import { UserService } from 'src/user/user.service';
import { QueryFailedError, Repository } from 'typeorm';

import { JwtPayloadInterface } from './entities/jwt-payload.entity';

/**
 * AuthService provides methods for user authentication and management.
 */
@Injectable()
export class AuthService {
  /**
   * Creates an instance of AuthService.
   *
   * @param _userRepository - The user repository.
   * @param _userProfileRepository - The user profile repository.
   * @param _loginAttemptRepository - The login attempt repository.
   * @param _jwtService - The jwt service.
   * @param _userService - The user service.
   * @param _mailService - The mail service.
   * @param _refreshTokenService - The refresh token service.
   */
  constructor(
    @InjectRepository(UserEntity)
    private readonly _userRepository: Repository<UserEntity>,

    @InjectRepository(UserProfileEntity)
    private readonly _userProfileRepository: Repository<UserProfileEntity>,

    @InjectRepository(AuditLoginAttemptEntity)
    private readonly _loginAttemptRepository: Repository<AuditLoginAttemptEntity>,

    private readonly _jwtService: JwtService,
    private readonly _userService: UserService,
    private readonly _mailService: MailService,
    private readonly _refreshTokenService: UserRefreshTokenService,
  ) {}

  /**
   * Registers a new user and sends a verification email.
   * @param userRegistration - The user details required for registration.
   * @returns The newly created UserEntity.
   * @throws ConflictException if the email or username is already in use.
   * @throws BadRequestException if the password is missing or if passwords do not match.
   * @throws Error if the user could not be saved.
   * @throws ConflictException if the user is already registered.
   * @throws InternalServerErrorException if an unexpected error occurs.
   */
  async register(userRegistration: CreateUserDto): Promise<UserEntity> {
    if (await this._userService.doesEmailExist(userRegistration.email)) {
      throw new ConflictException('Email already in use');
    }

    if (await this._userService.doesUsernameExist(userRegistration.username)) {
      throw new ConflictException('Username already in use');
    }

    if (!userRegistration.password) {
      throw new BadRequestException('Password is required');
    }

    if (userRegistration.password !== userRegistration.confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    const hashedPassword = await this.getHashedPassword(
      userRegistration.password,
    );
    const verificationToken = this.generateToken();
    const newUser = this._userRepository.create({
      email: userRegistration.email,
      password: hashedPassword,
      emailVerificationToken: verificationToken,
      emailVerificationTokenExpiry: this.generateTokenExpiryDate(),
    });

    const newUserProfile = this._userProfileRepository.create({
      userId: newUser.id,
      username: userRegistration.username,
      firstName: userRegistration.firstName,
      lastName: userRegistration.lastName,
    });

    newUser.profile = newUserProfile;

    try {
      const savedUser = await this._userRepository.save(newUser);

      if (!savedUser) {
        throw new Error('User could not be saved');
      }

      await this._mailService.sendVerificationEmail(
        savedUser.email,
        verificationToken,
      );

      return savedUser;
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        error.message.includes('duplicate key value')
      ) {
        throw new ConflictException('User is already registered');
      } else {
        throw new InternalServerErrorException('An unexpected error occurred');
      }
    }
  }

  /**
   * Verifies the user's email using the provided token.
   * @param token - The token used for verification.
   * @returns The updated UserEntity after verification.
   * @throws BadRequestException if the token is missing.
   * @throws NotFoundException if the user is not found.
   * @throws BadRequestException if the token has expired.
   */
  async verifyEmail(token: string): Promise<UserEntity> {
    if (!token) {
      throw new BadRequestException('Token missing');
    }

    const user = await this._userRepository.findOne({
      where: { emailVerificationToken: token },
    });

    if (!user) {
      throw new NotFoundException('Invalid token');
    }

    this.assertTokenNotExpired(user.emailVerificationTokenExpiry);

    user.emailVerified = true;
    user.emailVerificationToken = null;
    user.emailVerificationTokenExpiry = null;

    const updatedUser = await this._userRepository.save(user);

    // Send welcome email
    const emailSubject = `Welcome to the ${process.env.APP_TITLE}`;
    const emailHtmlContent = await ejs.renderFile(
      path.join(
        __dirname,
        '..',
        'views',
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

    await this._mailService.sendEmailToUser(
      user.email,
      emailSubject,
      emailTextContent,
      emailHtmlContent,
    );

    return updatedUser;
  }

  /**
   * Resends a verification email for the given token.
   * @param token - The token used to find the user.
   * @returns A promise that resolves when the email has been sent.
   * @throws NotFoundException if the user is not found.
   * @throws BadRequestException if the email is already verified.
   */
  async resendVerificationEmail(token: string): Promise<void> {
    const user = await this._userRepository.findOne({
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

    await this._userRepository.save(user);

    await this._mailService.sendVerificationEmail(
      user.email,
      verificationToken,
    );
  }

  /**
   * Validates a user's email and password.
   * @param email - The user's email.
   * @param password - The user's password.
   * @returns The user object if the email and password are valid, otherwise null.
   */
  async validateUser(email: string, password: string): Promise<any> {
    const user = await this._userService.findByEmail(email);
    if (user && (await user.comparePassword(password))) {
      if (!CurrentContextHelper.userUuid) {
        // Store the user ID for audit logging
        CurrentContextHelper.userUuid = user.id;
      }
      return instanceToPlain(user);
    }
    return null;
  }

  /**
   * Validates a user's email and password from a JWT payload.
   * @param payload - The JWT payload containing the user's email.
   * @returns The user object if the email is valid, otherwise null.
   */
  async validateUserFromPayload(
    payload: JwtPayloadInterface,
  ): Promise<UserEntity | null> {
    const user = await this._userRepository.findOne({
      where: {
        id: payload.sub,
        email: payload.email,
      },
    });
    if (user) {
      if (!CurrentContextHelper.userUuid) {
        // Store the user ID for audit logging
        CurrentContextHelper.userUuid = user.id;
      }

      return user;
    }

    return null;
  }

  /**
   * Logs in a user with the given credentials.
   * @param userLogin - The user's login credentials.
   * @returns An object containing the access token, refresh token, expiry time and user ID.
   * @throws HttpException if the username or password is invalid.
   * @throws HttpException if the account is disabled.
   * @throws HttpException if the account is deleted.
   * @throws HttpException if the email is not verified.
   */
  async login(userLogin: UserLoginDto): Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    user_id: string;
  }> {
    const userIpAddress: string | null = CurrentContextHelper.ip;

    if (!userLogin.email || !userLogin.password) {
      throw new HttpException(
        'Invalid username and password',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const user = await this.validateUser(userLogin.email, userLogin.password);

    if (!user) {
      await this.logAndThrowLoginFailure(
        userLogin.email,
        userIpAddress,
        'Invalid login credentials',
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (user.isAccountDisabled) {
      await this.logAndThrowLoginFailure(
        userLogin.email,
        userIpAddress,
        'Account disabled',
        HttpStatus.FORBIDDEN,
      );
    }

    if (user.deletedAt) {
      await this.logAndThrowLoginFailure(
        userLogin.email,
        userIpAddress,
        'Account deleted',
        HttpStatus.FORBIDDEN,
      );
    }

    if (!user.emailVerified) {
      await this.logAndThrowLoginFailure(
        userLogin.email,
        userIpAddress,
        'Email not verified',
        HttpStatus.UNAUTHORIZED,
      );
    }

    await this.logLoginAttempt(userLogin.email, userIpAddress, true);

    const payload = {
      email: user.email,
      sub: user.id,
      role: user.role,
    };
    const newUserRefreshToken = await this.issueRefreshToken(user);

    // Update last login time
    user.lastLoginAt = new Date();
    await this._userRepository.save(user);

    // Send user logged in notification
    await this._mailService.sendUserLoggedInNotification(
      user.email,
      user.profile?.firstName || 'Captain!',
    );

    return {
      access_token: this._jwtService.sign(payload),
      refresh_token: newUserRefreshToken,
      expires_in: +process.env.AUTH_TOKEN_EXPIRES_IN!,
      user_id: user.id,
    };
  }

  /**
   * Generates a unique token.
   * @returns A string token.
   */
  generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Generates a token expiry date.
   * @returns A date object representing the token expiry date.
   */
  generateTokenExpiryDate(): Date {
    return new Date(Date.now() + 3600000); // Token expires in 1 hour
  }

  /**
   * Requests a password reset for the user with the provided email.
   * @param email - The user's email.
   * @returns A promise that resolves when the password reset email has been sent.
   * @throws BadRequestException if the email is invalid or is not found.
   * @throws BadRequestException if a password reset has already been requested.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const emailPattern = EMAIL_PATTERN;
    if (!emailPattern.test(email)) {
      throw new BadRequestException('Invalid request');
    }

    const user = await this._userService.findByEmail(email);
    if (!user) {
      throw new BadRequestException('Invalid request'); //NOTE: Changed from NotFoundException to not show if email exists
    }

    if (
      user.passwordResetToken &&
      user.passwordResetTokenExpiry &&
      new Date() < user.passwordResetTokenExpiry
    ) {
      throw new BadRequestException('Password reset already requested');
    }

    const passwordResetToken = this.generateToken();
    user.passwordResetToken = passwordResetToken;
    user.passwordResetTokenExpiry = this.generateTokenExpiryDate();

    await this._userRepository.save(user);

    await this._mailService.sendPasswordResetEmail(
      user.email,
      passwordResetToken,
      user.profile?.firstName || 'Captain!',
    );
  }

  /**
   * Resets the user's password with the provided token and new password.
   * @param token - The password reset token.
   * @param newPassword - The new password.
   * @returns A promise that resolves when the password has been reset.
   * @throws BadRequestException if the token or password is missing.
   * @throws NotFoundException if the token is invalid.
   * @throws BadRequestException if the token has expired.
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    if (!token) {
      throw new BadRequestException('Token missing');
    }

    if (!newPassword) {
      throw new BadRequestException('Password missing from request');
    }

    const user = await this._userRepository.findOne({
      where: { passwordResetToken: token },
      relations: { profile: true },
    });

    if (!user) {
      throw new NotFoundException('Invalid token');
    }

    this.assertTokenNotExpired(user.passwordResetTokenExpiry);

    const hashedPassword = await this.getHashedPassword(newPassword);
    user.password = hashedPassword;
    user.passwordResetToken = null;
    user.passwordResetTokenExpiry = null;
    user.lastPasswordReset = new Date();

    await this._userRepository.save(user);

    await this._mailService.sendPasswordChangedEmail(
      user.email,
      user.profile?.firstName || 'Captain!',
    );

    await this._refreshTokenService.revokeAllTokensForUser(user.id);
  }

  /**
   * Refreshes the user's access token using the provided refresh token.
   * @param refreshToken - The user's refresh token.
   * @returns An object containing the new access token, refresh token, and expiry time.
   * @throws UnauthorizedException if the refresh token is invalid.
   * @throws UnauthorizedException if the refresh token is not found.
   * @throws UnauthorizedException if the refresh token is revoked.
   */
  async refreshToken(refreshToken: string): Promise<{
    access_token: string;
    expires_in: number;
    refresh_token: string;
  }> {
    try {
      const payload = this._jwtService.verify(refreshToken);

      // Load the user with their refresh tokens using the user ID
      const user = await this._userRepository.findOne({
        where: { id: payload.sub },
        relations: { refreshTokens: true },
      });

      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      if (
        !(await this.hasMatchingRefreshToken(
          refreshToken,
          payload.jti,
          user.refreshTokens,
        ))
      ) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const newPayload = { email: user.email, sub: user.id, role: user.role };
      const newUserRefreshToken = await this.issueRefreshToken(user);

      // Revoke the old refresh token
      await this._refreshTokenService.revokeToken(user.id, refreshToken);

      return {
        access_token: this._jwtService.sign(newPayload),
        refresh_token: newUserRefreshToken,
        expires_in: +process.env.AUTH_TOKEN_EXPIRES_IN!,
      };
    } catch (error: unknown) {
      // Log the error for debugging purposes
      const message = stringifyError(error);

      console.error('Refresh token validation failed:', message);
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  /**
   * Revokes a user's refresh token.
   * @param id - The user's ID.
   * @param tokenId - The refresh token ID.
   * @returns A promise that resolves when the token has been revoked.
   * @throws HttpException if the user is not found.
   */
  async revokeToken(id: string, tokenId: string): Promise<void> {
    const user = await this._userRepository.findOne({ where: { id: id } });
    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    // Revoke the matching refresh token for this user
    await this._refreshTokenService.revokeToken(id, tokenId);
  }

  /**
   * Calculates the expiry time for a token.
   * @param hours - The number of hours until the token expires.
   * @returns A date object representing the token expiry time.
   */
  calculateExpiryTime(hours: number): Date {
    const expiry = new Date();
    expiry.setHours(expiry.getHours() + hours);
    return expiry;
  }

  /**
   * Retrieves the expiration duration in hours for the refresh token.
   * @returns The number of hours until the refresh token expires.
   */
  getRefreshTokenExpiryHours(): number {
    const refreshSeconds =
      Number(process.env.AUTH_REFRESH_TOKEN_EXPIRES_IN) || 14400; // Default to 4 hours if not specified
    return refreshSeconds / 60 / 60;
  }

  /**
   * Generates a hashed password.
   * @param password - The password to hash.
   * @returns A promise that resolves with the hashed password.
   */
  async getHashedPassword(password: string): Promise<string> {
    return await bcrypt.hash(password, +process.env.AUTH_SALT_ROUNDS!);
  }

  /**
   * Validates that a token expiry value exists and is still valid.
   *
   * @param expiry Token expiry timestamp.
   * @throws BadRequestException if missing or expired.
   */
  private assertTokenNotExpired(expiry: Date | null | undefined): void {
    if (!expiry || new Date() > expiry) {
      throw new BadRequestException('Token expired');
    }
  }

  /**
   * Generates, signs and persists a refresh token for a user.
   */
  private async issueRefreshToken(
    user: Pick<UserEntity, 'id' | 'email'>,
  ): Promise<string> {
    const expiryHours = this.getRefreshTokenExpiryHours();
    const jwtId = this.generateToken();

    const token = this._jwtService.sign(
      { email: user.email, sub: user.id },
      {
        expiresIn: `${expiryHours}h`,
        jwtid: jwtId,
      },
    );

    await this._refreshTokenService.create({
      user: user as UserEntity,
      tokenId: token,
      jwtId,
      isRevoked: false,
      expiresAt: this.calculateExpiryTime(expiryHours),
    });

    return token;
  }

  /**
   * Checks whether any stored refresh token matches the given raw token and JWT ID.
   */
  private async hasMatchingRefreshToken(
    rawToken: string,
    jwtId: string | undefined,
    refreshTokens: Array<{
      isRevoked: boolean;
      jwtId: string | null;
      tokenId: string | null;
    }>,
  ): Promise<boolean> {
    for (const token of refreshTokens) {
      if (token.isRevoked || token.jwtId !== jwtId || !token.tokenId) {
        continue;
      }

      const matches = await bcrypt.compare(rawToken, token.tokenId);
      if (matches) {
        return true;
      }
    }

    return false;
  }

  /**
   * Logs a login attempt.
   * @param email - The user's email.
   * @param ipAddress - The user's IP address.
   * @param success - Whether the login attempt was successful.
   * @returns A promise that resolves when the login attempt has been logged.
   */
  async logLoginAttempt(
    email: string,
    ipAddress: string | null,
    success: boolean,
  ): Promise<void> {
    const loginAttemptRecord = new AuditLoginAttemptEntity();
    loginAttemptRecord.email = email;
    loginAttemptRecord.ipAddress = ipAddress;
    loginAttemptRecord.success = success;

    await validateOrReject(loginAttemptRecord);
    await this._loginAttemptRepository.save(loginAttemptRecord);
  }

  /**
   * Records a failed login attempt and throws an HTTP exception.
   */
  private async logAndThrowLoginFailure(
    email: string,
    ipAddress: string | null,
    message: string,
    status: HttpStatus,
  ): Promise<never> {
    await this.logLoginAttempt(email, ipAddress, false);
    throw new HttpException(message, status);
  }
}
