import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { MailModule } from 'src/mail/mail.module';
import { MailService } from 'src/mail/mail.service';
import { SecretsModule } from 'src/shared/secrets/secrets.module';
import { SecretsService } from 'src/shared/secrets/secrets.service';
import { UserRefreshTokenModule } from 'src/user-refresh-token/user-refresh-token.module';
import { UserModule } from '../user/user.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtStrategy } from './jwt.strategy';
import { LocalStrategy } from './local.strategy';

@Module({
  imports: [
    UserModule,
    PassportModule,
    SecretsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule, SecretsModule, UserRefreshTokenModule],
      inject: [ConfigService, SecretsService],
      useFactory: async (
        configService: ConfigService,
        secretsService: SecretsService,
      ) => {
        const secretObject = await secretsService.getSecret(
          configService.get('AWS_SECRET_NAME'),
        );
        return {
          secret: secretObject.jwtSecret,
          signOptions: { expiresIn: '1h' },
        };
      },
    }),
    MailModule,
    UserRefreshTokenModule,
  ],
  providers: [
    AuthService,
    LocalStrategy,
    JwtStrategy,
    JwtAuthGuard,
    MailService,
  ],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
