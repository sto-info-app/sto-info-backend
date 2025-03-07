import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLoginAttemptEntity } from 'src/audit/entities/audit-login-attempt.entity';
import { MailModule } from 'src/mail/mail.module';
import { MailService } from 'src/mail/mail.service';
import { SecretsService } from 'src/shared/secrets/secrets.service';
import { SharedModule } from 'src/shared/shared.module';
import { UserRefreshTokenModule } from 'src/user-refresh-token/user-refresh-token.module';
import { UserModule } from '../user/user.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtStrategy } from './jwt.strategy';
import { LocalStrategy } from './local.strategy';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuditLoginAttemptEntity]),
    PassportModule,
    SharedModule,
    JwtModule.registerAsync({
      imports: [ConfigModule, SharedModule, UserRefreshTokenModule],
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
    forwardRef(() => UserModule), // Use forwardRef to handle circular dependency
    MailModule,
    UserRefreshTokenModule,
  ],
  providers: [
    AuthService,
    LocalStrategy,
    JwtStrategy,
    JwtAuthGuard,
    MailService,
    SecretsService,
  ],
  controllers: [AuthController],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
