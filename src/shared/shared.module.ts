import { S3Client } from '@aws-sdk/client-s3';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SecretsService } from './secrets/secrets.service';
import { ImageUploadsService } from './utilities/image-uploads.service';

@Module({
  imports: [ConfigModule],
  providers: [
    SecretsService,
    ImageUploadsService,
    {
      provide: S3Client,
      useFactory: (configService: ConfigService) => {
        return new S3Client({
          region: 'auto',
          endpoint: configService.get<string>('R2_ENDPOINT'),
          credentials: {
            accessKeyId: configService.get<string>('CLOUDFLARE_R2_ACCESS_KEY'),
            secretAccessKey: configService.get<string>(
              'CLOUDFLARE_R2_SECRET_KEY',
            ),
          },
        });
      },
      inject: [ConfigService],
    },
  ],
  exports: [SecretsService, ImageUploadsService],
})
export class SharedModule {}
