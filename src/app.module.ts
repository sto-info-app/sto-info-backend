import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ConfigCheckService } from './config-check/config-check.service';
import { DatabaseModule } from './database/database.module';
import { MailModule } from './mail/mail.module';
import { MailService } from './mail/mail.service';
import { SecretsModule } from './shared/secrets/secrets.module';
import { SecretsService } from './shared/secrets/secrets.service';
import { AccountModule } from './sto/account/account.module';
import { LauncherModule } from './sto/launcher/launcher.module';
import { PlatformLauncherModule } from './sto/platform-launcher/platform-launcher.module';
import { PlatformModule } from './sto/platform/platform.module';
import { UserRefreshTokenModule } from './user-refresh-token/user-refresh-token.module';
import { UserModule } from './user/user.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: `config/environments/${process.env.NODE_ENV || ''}.env`,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule, SecretsModule],
      inject: [ConfigService, SecretsService],
      useFactory: async (
        configService: ConfigService,
        secretsService: SecretsService,
      ) => {
        const secretObject = await secretsService.getSecret(
          configService.get('AWS_SECRET_NAME'),
        );
        return {
          type: configService.get('DB_TYPE') as any,
          host: configService.get('DB_HOST'),
          port: parseInt(configService.get('DB_PORT'), 10),
          username: configService.get('DB_USERNAME'),
          password: secretObject.dbPassword, // Use the dbPassword from AWS Secrets Manager
          database: configService.get('DB_NAME') as string,
          schema: configService.get('DB_SCHEMA'),
          synchronize: configService.get('TYPEORM_SYNCHRONIZE') === 'true',
          logging: configService.get('TYPEORM_LOGGING') === 'true',
          entities: [join(__dirname, '**/*.entity.{ts,js}')],
          migrations: [
            join(__dirname, configService.get('TYPEORM_MIGRATIONS')),
          ],
        };
      },
    }),
    UserModule,
    AuthModule,
    MailModule,
    SecretsModule,
    UserRefreshTokenModule,
    AccountModule,
    PlatformModule,
    LauncherModule,
    PlatformLauncherModule,
    DatabaseModule,
  ],
  controllers: [AppController],
  providers: [AppService, MailService, SecretsService, ConfigCheckService],
})
export class AppModule {}
