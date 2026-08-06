import {
  ClassSerializerInterceptor,
  MiddlewareConsumer,
  Module,
  NestModule,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { MulterModule } from '@nestjs/platform-express';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SentryModule } from '@sentry/nestjs/setup';

import { getTypeOrmConfig } from 'config/typeorm.config';
import { ClsModule } from 'nestjs-cls';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UserIdMiddleware } from './auth/user-id.middleware';
import { RequestIdMiddleware } from './common/http/request-id.middleware';
import { ConfigCheckService } from './config-check/config-check.service';
import { ContactModule } from './contact/contact.module';
import { CronModule } from './cron/cron.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { MailModule } from './mail/mail.module';
import { MailService } from './mail/mail.service';
import { NewsModule } from './news/news.module';
import { NotificationModule } from './notification/notification.module';
import { RegistryModule } from './registry/registry.module';
import { DEFAULT_MULTER_LIMITS } from './shared/constants/file-upload.constants';
import { TypeOrmExceptionFilter } from './shared/filters/typeorm-exception.filter';
import { SharedModule } from './shared/shared.module';
import { ValidatorsService } from './shared/utilities/validators.service';
import { AccountModule } from './sto/account/account.module';
import { CharacterModule } from './sto/character/character.module';
import { EndeavourModule } from './sto/endeavour/endeavour.module';
import { LauncherModule } from './sto/launcher/launcher.module';
import { CharacterReputationModule } from './sto/character-reputation/character-reputation.module';
import { CharacterRdModule } from './sto/character-rd/character-rd.module';
import { CharacterSpecializationModule } from './sto/character-specialization/character-specialization.module';
import { StatsModule } from './sto/stats/stats.module';
import { PlatformLauncherModule } from './sto/platform-launcher/platform-launcher.module';
import { PlatformModule } from './sto/platform/platform.module';
import { UserRefreshTokenModule } from './user-refresh-token/user-refresh-token.module';
import { UserModule } from './user/user.module';
import { SesWebhookModule } from './webhooks/ses/ses-webhook.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: `config/environments/${process.env.NODE_ENV || ''}.env`,
    }),
    SentryModule.forRoot(),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async () => {
        const typeOrmConfig = await getTypeOrmConfig();
        return typeOrmConfig;
      },
      inject: [ConfigService],
    }),
    MulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const maxImageBytes = Number(
          config.get<string>('MAX_IMAGE_SIZE_IN_BYTES') ?? '10485760',
        );

        return {
          limits: {
            fileSize: maxImageBytes,
            fieldSize: maxImageBytes,
            files: DEFAULT_MULTER_LIMITS.files,
            fields: DEFAULT_MULTER_LIMITS.fields,
            parts: DEFAULT_MULTER_LIMITS.parts,
            headerPairs: DEFAULT_MULTER_LIMITS.headerPairs,
          },
        };
      },
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
    ContactModule,
    AccountModule,
    CharacterModule,
    EndeavourModule,
    CharacterReputationModule,
    CharacterRdModule,
    CharacterSpecializationModule,
    StatsModule,
    PlatformModule,
    LauncherModule,
    PlatformLauncherModule,
    DatabaseModule,
    CronModule,
    HealthModule,
    SesWebhookModule,
    NewsModule,
    NotificationModule,
    RegistryModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    MailService,
    ConfigCheckService,
    ValidatorsService,
    {
      provide: APP_FILTER,
      useClass: TypeOrmExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ClassSerializerInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  /**
   * Configures the application middleware.
   *
   * @param consumer - The consumer.
   * @returns The result of the operation.
   */
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware, UserIdMiddleware).forRoutes('*');
  }
}
