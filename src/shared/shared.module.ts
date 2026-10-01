import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { S3Client } from '@aws-sdk/client-s3';

import { ImageSigningService } from 'src/file-assets/delivery/image-signing.service';

import { ImageSlotService } from './images/image-slot.service';
import { SecretsService } from './secrets/secrets.service';
import { ImageUploadsService } from './utilities/image-uploads.service';

@Module({
  imports: [ConfigModule],
  providers: [
    SecretsService,
    ImageSigningService,
    ImageUploadsService,
    ImageSlotService,
    {
      provide: S3Client,
      useFactory: async (
        configService: ConfigService,
        secretsService: SecretsService,
      ) => {
        const secretName = configService.get<string>('AWS_SECRET_NAME')!;
        const secretObject = await secretsService.getSecret(secretName);

        // FC-042's names only; ImageUploadsService refuses to start without
        // them, and an old build reading the old names finds nothing usable.
        return new S3Client({
          region: 'auto',
          endpoint: configService.get<string>('CLOUDFLARE_R2_ENDPOINT')!,
          credentials: {
            accessKeyId: secretObject.cloudflareR2GatedAccessKey,
            secretAccessKey: secretObject.cloudflareR2GatedSecret,
          },
        });
      },
      inject: [ConfigService, SecretsService],
    },
  ],
  exports: [
    SecretsService,
    ImageSigningService,
    ImageUploadsService,
    ImageSlotService,
  ],
})
export class SharedModule {}
