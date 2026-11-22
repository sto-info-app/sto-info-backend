import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AssetIngressModule } from 'src/file-assets/asset-ingress.module';

import { FleetCommunityEntity } from '../entities/fleet-community.entity';
import { StoArmadaEntity } from '../entities/sto-armada.entity';
import { StoFleetEntity } from '../entities/sto-fleet.entity';
import { FleetModule } from '../fleet.module';
import { FleetImageService } from './fleet-image.service';
import { FleetImagesController } from './fleet-images.controller';
import {
  FleetCommunityImagePublisher,
  StoArmadaImagePublisher,
  StoFleetImagePublisher,
} from './fleet-scope-image.publishers';

/**
 * A Fleet scope's banner and emblem: the routes, the ingress and the three
 * publishers that write the columns.
 *
 * Its own module rather than part of {@link FleetModule}, for the reason
 * {@link FleetRosterImportsModule} is: `FileAssetsModule` already imports
 * `FleetModule` for the audience service (ADR-0015), so anything inside
 * `FleetModule` that needed the asset registry would close the loop. This
 * sits below both — images → file-assets → fleet, in one direction — and is
 * wired into `AppModule` directly.
 *
 * `AssetIngressModule` rather than `FileAssetsModule`, because uploading is
 * what this does: it re-exports the registry alongside the ingress, so one
 * import covers accepting a picture and withdrawing the one it replaces.
 */
@Module({
  imports: [
    FleetModule,
    AssetIngressModule,
    TypeOrmModule.forFeature([
      FleetCommunityEntity,
      StoFleetEntity,
      StoArmadaEntity,
    ]),
  ],
  controllers: [FleetImagesController],
  providers: [
    FleetImageService,
    FleetCommunityImagePublisher,
    StoFleetImagePublisher,
    StoArmadaImagePublisher,
  ],
  exports: [FleetImageService],
})
export class FleetImagesModule {}
