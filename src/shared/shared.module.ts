import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { S3Client } from '@aws-sdk/client-s3';

import { SecretsService } from './secrets/secrets.service';
import { ImageUploadsService } from './utilities/image-uploads.service';

@Module({
  imports: [ConfigModule],
  providers: [
    SecretsService,
    ImageUploadsService,
    {
      provide: S3Client,
      useFactory: async (
        configService: ConfigService,
        secretsService: SecretsService,
      ) => {
        const secretName = configService.get<string>('AWS_SECRET_NAME')!;
        const secretObject = await secretsService.getSecret(secretName);

        return new S3Client({
          region: 'auto',
          endpoint: configService.get<string>('CLOUDFLARE_R2_ENDPOINT')!,
          credentials: {
            accessKeyId: secretObject.cloudflareR2AccessKey,
            secretAccessKey: secretObject.cloudflareR2Secret,
          },
        });
      },
      inject: [ConfigService, SecretsService],
    },
  ],
  exports: [SecretsService, ImageUploadsService],
})
export class SharedModule {}
