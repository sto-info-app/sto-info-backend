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
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';
import { UserRefreshTokenDto } from 'src/user-refresh-token/dto/user-refresh-token.dto';
import { UserRefreshTokenService } from 'src/user-refresh-token/user-refresh-token.service';
import { CreateUserDto } from 'src/user/dto/create-user.dto';
import { RequestPasswordResetDto } from 'src/user/dto/request-password-reset.dto';
import { ResendVerificationEmailDto } from 'src/user/dto/resend-verification-email.dto';
import { ResetPasswordDto } from 'src/user/dto/reset-password.dto';
import { UserLoginDto } from 'src/user/dto/user-login.dto';
import { VerifyEmailDto } from 'src/user/dto/verify-email.dto';
import { AuthService } from './auth.service';

@SerializeOptions({ excludePrefixes: ['_'] })
@ApiTags('Authentication')
@ApiBearerAuth()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly refreshTokenService: UserRefreshTokenService,
  ) {}

  @Post('register')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  @HttpCode(HttpStatus.OK)
  async register(@Body() createUserDto: CreateUserDto) {
    return this.authService.register(createUserDto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiTags('Login')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { email: { type: 'string' }, password: { type: 'string' } },
    },
  })
  /**
   * Handles user login.
   *
   * @param UserLoginDto - The login credentials containing email and password.
   * @returns A promise that resolves with the authentication result.
   */
  async login(@Body() userLoginDto: UserLoginDto) {
    return this.authService.login(userLoginDto);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Body() body: { tokenId: string }): Promise<void> {
    await this.refreshTokenService.revokeUserRefreshToken(body.tokenId);
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() verifyEmailDto: VerifyEmailDto) {
    return this.authService.verifyEmail(verifyEmailDto.token);
  }

  @Post('resend-verification-email')
  @HttpCode(HttpStatus.OK)
  async resendVerificationEmail(
    @Body() resendVerificationEmailDto: ResendVerificationEmailDto,
  ) {
    return this.authService.resendVerificationEmail(
      resendVerificationEmailDto.token,
    );
  }

  @Post('request-password-reset')
  @HttpCode(HttpStatus.OK)
  async requestPasswordReset(
    @Body() requestPasswordResetDto: RequestPasswordResetDto,
  ): Promise<void> {
    return this.authService.requestPasswordReset(requestPasswordResetDto.email);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
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
  async refresh(@Body() refreshTokenDto: UserRefreshTokenDto) {
    return this.authService.refreshToken(refreshTokenDto.refresh_token);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('revoke')
  @HttpCode(HttpStatus.OK)
  async revoke(@Req() req): Promise<void> {
    const userId = req.user.userId;
    const tokenId = req.user.tokenId;
    await this.authService.revokeToken(userId, tokenId);
  }
}
