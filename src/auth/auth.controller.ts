import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Request,
  SerializeOptions,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';
import { UserRefreshTokenDto } from 'src/user-refresh-token/dto/user-refresh-token.dto';
import { UserRefreshTokenService } from 'src/user-refresh-token/user-refresh-token.service';
import { CreateUserDto } from 'src/user/dto/create-user.dto';
import { RequestPasswordResetDto } from 'src/user/dto/request-password-reset.dto';
import { ResendVerificationEmailDto } from 'src/user/dto/resend-verification-email.dto';
import { ResetPasswordDto } from 'src/user/dto/reset-password.dto';
import { VerifyEmailDto } from 'src/user/dto/verify-email.dto';
import { AuthService } from './auth.service';

@SerializeOptions({ excludePrefixes: ['_'] })
@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private refreshTokenService: UserRefreshTokenService,
  ) {}

  @Post('register')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  @HttpCode(HttpStatus.OK)
  async register(@Body() createUserDto: CreateUserDto) {
    return this.authService.register(createUserDto);
  }

  @UseGuards(AuthGuard('local'))
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Request() req) {
    return this.authService.login(req.user);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Body() body: { tokenId: string }): Promise<void> {
    await this.refreshTokenService.deleteUserRefreshToken(body.tokenId);
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
