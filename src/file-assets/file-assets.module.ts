import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { S3Client } from '@aws-sdk/client-s3';

import { FleetModule } from 'src/fleet/fleet.module';
import { QueueModule } from 'src/shared/queue/queue.module';
import { SecretsService } from 'src/shared/secrets/secrets.service';
import { SharedModule } from 'src/shared/shared.module';

import { AssetStatusController } from './asset-status.controller';
import { FILE_ASSET_PUBLICATION_QUEUE } from './constants/file-asset-publication.constants';
import { FileAssetPlacementEntity } from './entities/file-asset-placement.entity';
import { FileAssetEntity } from './entities/file-asset.entity';
import { FileAssetDeliveryController } from './file-asset-delivery.controller';
import { AssetPublicationProcessor } from './processors/asset-publication.processor';
import { AssetPublicationQueueService } from './services/asset-publication-queue.service';
import { AssetPublicationService } from './services/asset-publication.service';
import { AssetPublisherRegistry } from './services/asset-publisher.registry';
import { AssetStatusService } from './services/asset-status.service';
import { AssetWithdrawalService } from './services/asset-withdrawal.service';
import { FileAssetDeliveryService } from './services/file-asset-delivery.service';
import { FileAssetPlacementService } from './services/file-asset-placement.service';
import { FileAssetService } from './services/file-asset.service';
import {
  QUARANTINE_S3_CLIENT,
  QuarantineStorageService,
} from './services/quarantine-storage.service';
import { StaleUploadSweepService } from './services/stale-upload-sweep.service';

/**
 * The asset registry: what is stored, whether it may be served, and to whom.
 *
 * Site-wide rather than part of Fleet Community, and that is a deliberate
 * placement. Fleet is the feature that forced the work, but a roster CSV, a
 * profile picture, a Character portrait, a Storytime cover and a Custom
 * Tracking image are the same problem, and FC-012 moves every one of those
 * callers onto this module. A registry that lived under `src/fleet` would make
 * the profile picture path depend on the Fleet feature, which is the seam that
 * stops being crossable later.
 *
 * It depends on {@link FleetModule} in one direction only, for the audience
 * service, and Fleet does not depend on it. An asset that names a Fleet scope
 * asks that feature's existing policy who may see it rather than carrying a
 * second implementation of the same question.
 *
 * The quarantine bucket gets its own `S3Client` under its own token, built
 * from its own credentials. The site already has an `S3Client` for the public
 * bucket and sharing it would defeat the separation: the point is that the key
 * which publishes cannot read quarantine, and the key which reads quarantine
 * cannot publish.
 */
@Module({
  imports: [
    ConfigModule,
    SharedModule,
    FleetModule,
    TypeOrmModule.forFeature([FileAssetEntity, FileAssetPlacementEntity]),
    QueueModule,
    BullModule.registerQueue({ name: FILE_ASSET_PUBLICATION_QUEUE }),
  ],
  controllers: [FileAssetDeliveryController, AssetStatusController],
  providers: [
    FileAssetService,
    FileAssetDeliveryService,
    FileAssetPlacementService,
    QuarantineStorageService,
    AssetPublisherRegistry,
    AssetPublicationQueueService,
    AssetPublicationService,
    AssetPublicationProcessor,
    AssetWithdrawalService,
    AssetStatusService,
    StaleUploadSweepService,
    {
      provide: QUARANTINE_S3_CLIENT,
      useFactory: async (
        configService: ConfigService,
        secretsService: SecretsService,
      ) => {
        const secretName = configService.get<string>('AWS_SECRET_NAME')!;
        const secretObject = await secretsService.getSecret(secretName);

        return new S3Client({
          region: 'auto',
          // The same account endpoint as the delivery bucket: R2 scopes its S3
          // endpoint to the account, not to a bucket. The separation that
          // matters is the credentials, which are this bucket's alone.
          endpoint: configService.get<string>('CLOUDFLARE_R2_ENDPOINT')!,
          credentials: {
            accessKeyId: secretObject.cloudflareR2QuarantineAccessKey,
            secretAccessKey: secretObject.cloudflareR2QuarantineSecret,
          },
        });
      },
      inject: [ConfigService, SecretsService],
    },
  ],
  exports: [
    FileAssetService,
    FileAssetDeliveryService,
    FileAssetPlacementService,
    QuarantineStorageService,
    AssetPublisherRegistry,
    AssetPublicationQueueService,
    AssetWithdrawalService,
    StaleUploadSweepService,
  ],
})
export class FileAssetsModule {}
