import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Request,
  Res,
  SerializeOptions,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';
import { CreateUserDto } from 'src/user/dto/create-user.dto';
import { AuthService } from './auth.service';

@SerializeOptions({ excludePrefixes: ['_'] })
@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  @UsePipes(new ValidationPipe())
  async register(@Body() createUserDto: CreateUserDto) {
    return this.authService.register(createUserDto);
  }

  @UseGuards(AuthGuard('local'))
  @Post('login')
  async login(@Request() req) {
    return this.authService.login(req.user);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Request() req, @Res() res) {
    req.logout(() => {
      res.clearCookie('jwt'); // Clear the JWT cookie in token storage
      return res.status(HttpStatus.OK).json({ message: 'OK' });
    });
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body('token') token: string) {
    return this.authService.verifyEmail(token);
  }

  @Post('resend-verification-email')
  @HttpCode(HttpStatus.OK)
  async resendVerificationEmail(@Body('token') token: string) {
    return this.authService.resendVerificationEmail(token);
  }

  @Post('request-password-reset')
  @HttpCode(HttpStatus.OK)
  async requestPasswordReset(@Body('email') email: string): Promise<void> {
    return this.authService.requestPasswordReset(email);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body('token') token: string,
    @Body('password') password: string,
  ): Promise<void> {
    return this.authService.resetPassword(token, password);
  }

  @Post('refresh')
  async refresh(@Body('refresh_token') refreshToken: string) {
    return this.authService.refresh(refreshToken);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('revoke')
  async revoke(@Req() req): Promise<void> {
    const userId = req.user.userId;
    const tokenId = req.user.tokenId;
    await this.authService.revokeToken(userId, tokenId);
  }
}
