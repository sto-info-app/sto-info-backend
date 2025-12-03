import { S3Client } from '@aws-sdk/client-s3';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { getTypeOrmConfig } from 'config/typeorm.config';
import { ClsModule } from 'nestjs-cls';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ConfigCheckService } from './config-check/config-check.service';
import { CronModule } from './cron/cron.module';
import { DatabaseModule } from './database/database.module';
import { MailModule } from './mail/mail.module';
import { MailService } from './mail/mail.service';
import { SecretsService } from './shared/secrets/secrets.service';
import { SharedModule } from './shared/shared.module';
import { ImageUploadsService } from './shared/utilities/image-uploads.service';
import { ValidatorsService } from './shared/utilities/validators.service';
import { AccountModule } from './sto/account/account.module';
import { LauncherModule } from './sto/launcher/launcher.module';
import { PlatformModule } from './sto/platform/platform.module';
import { PlatformLauncherModule } from './sto/platform-launcher/platform-launcher.module';
import { UserModule } from './user/user.module';
import { UserRefreshTokenModule } from './user-refresh-token/user-refresh-token.module';
import { UserIdMiddleware } from './auth/user-id.middleware';

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
    ClsModule.forRoot({
      global: true,
      middleware: { mount: true },
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
    CronModule,
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
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(UserIdMiddleware).forRoutes('*');
  }
}
