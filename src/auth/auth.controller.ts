import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  SerializeOptions,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { UserRefreshTokenDto } from 'src/user-refresh-token/dto/user-refresh-token.dto';
import { UserRefreshTokenService } from 'src/user-refresh-token/user-refresh-token.service';
import { CreateUserDto } from 'src/user/dto/create-user.dto';
import { RequestPasswordResetDto } from 'src/user/dto/request-password-reset.dto';
import { ResendVerificationEmailDto } from 'src/user/dto/resend-verification-email.dto';
import { ResetPasswordDto } from 'src/user/dto/reset-password.dto';
import { UserLoginDto } from 'src/user/dto/user-login.dto';
import { VerifyEmailDto } from 'src/user/dto/verify-email.dto';
import { AuthService } from './auth.service';
import {
  AuthLoginResultDto,
  AuthRefreshResultDto,
} from './dto/auth-results.dto';
import { UserId } from './user-id.decorator';

@SerializeOptions({ excludePrefixes: ['_'] })
@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly refreshTokenService: UserRefreshTokenService,
  ) {}

  @Post('register')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Register a new user account',
    description:
      'Creates a new user account and sends an email verification link/token. The account must be verified before login will succeed.',
  })
  @ApiOkResponse({
    description:
      'User registered. A verification email has been sent to the provided address.',
  })
  @ApiBadRequestResponse({
    description:
      'Validation failed, passwords do not match, or the request is missing required fields.',
  })
  @ApiConflictResponse({
    description: 'Email address or username is already in use.',
  })
  @ApiTooManyRequestsResponse({
    description:
      'Rate limit exceeded for authentication endpoints (brute-force protection).',
  })
  async register(@Body() createUserDto: CreateUserDto) {
    return this.authService.register(createUserDto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Exchange credentials for tokens',
    description:
      'Validates email/password and returns a short-lived access token plus a long-lived refresh token. Login is blocked until the email address has been verified.',
  })
  @ApiOkResponse({
    description:
      'Login successful. Returns access and refresh tokens and the access token expiry (seconds).',
    type: AuthLoginResultDto,
  })
  @ApiBadRequestResponse({
    description: 'Request body validation failed.',
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid credentials or email address not yet verified.',
  })
  @ApiForbiddenResponse({
    description: 'Account is disabled or has been deleted.',
  })
  @ApiTooManyRequestsResponse({
    description:
      'Rate limit exceeded for authentication endpoints (brute-force protection).',
  })
  async login(@Body() userLoginDto: UserLoginDto) {
    return this.authService.login(userLoginDto);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Log out the current session',
    description:
      'Revokes the supplied refresh token, preventing further access-token refresh for that session. This endpoint works even if the access token has expired, as long as a valid tokenId is provided.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['tokenId'],
      properties: {
        tokenId: {
          type: 'string',
          description:
            'The raw refresh token string to revoke (as previously returned by the login/refresh endpoints).',
          example:
            'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2N2Y4Y2U5YS0yODNjLTRhYWEtOGU0Ny1lN2I4YjJjMGQyMTciLCJlbWFpbCI6ImNhcHRhaW4ucGljYXJkQHN0YXJmbGVldC5leGFtcGxlIiwianRpIjoiMmYxZTU0YjQ5NDRlNGZhZWEzNzg1MmZiZTNlOGViMjMiLCJpYXQiOjE3MDQ4MDAwMDAsImV4cCI6MTcwNDg4NjQwMH0.9q3bR7u2kQxw0KfVq1Qe0w5c1rK6pR6o0YxS5Zy7v1s',
        },
      },
    },
  })
  @ApiOkResponse({
    description: 'Logout successful. The refresh token is revoked.',
  })
  @ApiUnauthorizedResponse({
    description:
      'Missing or invalid access token (Optional for logout if tokenId is provided).',
  })
  async logout(@Body() body: { tokenId: string }): Promise<void> {
    await this.refreshTokenService.revokeUserRefreshToken(body.tokenId);
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify an email address',
    description:
      'Marks the user account as email-verified using the verification token previously emailed during registration.',
  })
  @ApiOkResponse({
    description: 'Email verified successfully.',
  })
  @ApiBadRequestResponse({
    description: 'Token is missing or has expired.',
  })
  @ApiNotFoundResponse({
    description: 'Verification token is invalid.',
  })
  @ApiTooManyRequestsResponse({
    description:
      'Rate limit exceeded for authentication endpoints (brute-force protection).',
  })
  async verifyEmail(@Body() verifyEmailDto: VerifyEmailDto) {
    return this.authService.verifyEmail(verifyEmailDto.token);
  }

  @Post('resend-verification-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resend a verification email',
    description:
      'Generates a new verification token for an unverified account and re-sends the verification email.',
  })
  @ApiOkResponse({
    description: 'Verification email re-sent (if applicable).',
  })
  @ApiBadRequestResponse({
    description: 'Email address is already verified.',
  })
  @ApiNotFoundResponse({
    description: 'Verification token is not associated with any user.',
  })
  @ApiTooManyRequestsResponse({
    description:
      'Rate limit exceeded for authentication endpoints (brute-force protection).',
  })
  async resendVerificationEmail(
    @Body() resendVerificationEmailDto: ResendVerificationEmailDto,
  ) {
    return this.authService.resendVerificationEmail(
      resendVerificationEmailDto.token,
    );
  }

  @Post('request-password-reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request a password reset email',
    description:
      'Sends a password reset email when the request is valid. For security, invalid requests use a generic error to avoid disclosing whether an email exists.',
  })
  @ApiOkResponse({
    description: 'Password reset email requested.',
  })
  @ApiBadRequestResponse({
    description:
      'Invalid request, or a reset has already been requested and has not yet expired.',
  })
  @ApiTooManyRequestsResponse({
    description:
      'Rate limit exceeded for authentication endpoints (brute-force protection).',
  })
  async requestPasswordReset(
    @Body() requestPasswordResetDto: RequestPasswordResetDto,
  ): Promise<void> {
    return this.authService.requestPasswordReset(requestPasswordResetDto.email);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reset a password using a reset token',
    description:
      'Sets a new password using a password-reset token previously emailed to the user. As part of the reset, existing refresh tokens are revoked.',
  })
  @ApiOkResponse({
    description: 'Password updated successfully.',
  })
  @ApiBadRequestResponse({
    description:
      'Token is missing, token has expired, or the request is invalid.',
  })
  @ApiNotFoundResponse({
    description: 'Reset token is invalid.',
  })
  @ApiTooManyRequestsResponse({
    description:
      'Rate limit exceeded for authentication endpoints (brute-force protection).',
  })
  async resetPassword(
    @Body() resetPasswordDto: ResetPasswordDto,
  ): Promise<void> {
    return this.authService.resetPassword(
      resetPasswordDto.token,
      resetPasswordDto.password,
    );
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Refresh tokens',
    description:
      'Exchanges a valid refresh token for a new access token and a new refresh token. The supplied refresh token is revoked as part of the process.',
  })
  @ApiOkResponse({
    description:
      'Tokens refreshed successfully. Returns a new access token, a new refresh token, and the access token expiry (seconds).',
    type: AuthRefreshResultDto,
  })
  @ApiBadRequestResponse({
    description: 'Request body validation failed.',
  })
  @ApiUnauthorizedResponse({
    description:
      'Refresh token is invalid, expired, revoked, or does not match the current user.',
  })
  @ApiTooManyRequestsResponse({
    description:
      'Rate limit exceeded for authentication endpoints (brute-force protection).',
  })
  async refresh(@Body() refreshTokenDto: UserRefreshTokenDto) {
    return this.authService.refreshToken(refreshTokenDto.refresh_token);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('revoke')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Revoke the current refresh token',
    description:
      'Revokes the refresh token associated with the current authenticated context, forcing re-authentication before further refresh operations.',
  })
  @ApiOkResponse({
    description: 'Token revoked successfully.',
  })
  @ApiUnauthorizedResponse({
    description:
      'Missing or invalid access token, or the refresh token cannot be revoked.',
  })
  async revoke(@UserId() userId: string, @Req() req: Request): Promise<void> {
    const tokenId = (req as any).user?.tokenId as string;
    await this.authService.revokeToken(userId, tokenId);
  }
}
