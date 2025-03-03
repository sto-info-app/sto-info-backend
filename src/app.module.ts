import { S3Client } from '@aws-sdk/client-s3';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { getTypeOrmConfig } from 'config/typeorm.config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ConfigCheckService } from './config-check/config-check.service';
import { DatabaseModule } from './database/database.module';
import { MailModule } from './mail/mail.module';
import { MailService } from './mail/mail.service';
import { SecretsService } from './shared/secrets/secrets.service';
import { SharedModule } from './shared/shared.module';
import { ImageUploadsService } from './shared/utilities/image-uploads.service';
import { ValidatorsService } from './shared/utilities/validators.service';
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
      imports: [ConfigModule],
      useFactory: async () => {
        const typeOrmConfig = await getTypeOrmConfig();
        return typeOrmConfig;
      },
      inject: [ConfigService],
    }),
    UserModule,
    AuthModule,
    MailModule,
    SharedModule,
    UserRefreshTokenModule,
    AccountModule,
    PlatformModule,
    LauncherModule,
    PlatformLauncherModule,
    DatabaseModule,
  ],
  controllers: [AppController],
  providers: [
    S3Client,
    AppService,
    MailService,
    SecretsService,
    ConfigCheckService,
    ValidatorsService,
    ImageUploadsService,
  ],
})
export class AppModule {}
