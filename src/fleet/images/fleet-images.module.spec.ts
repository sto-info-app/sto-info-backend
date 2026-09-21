import { getRepositoryToken } from '@nestjs/typeorm';

import { AssetIngressModule } from 'src/file-assets/asset-ingress.module';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';

import { FleetCommunityEntity } from '../entities/fleet-community.entity';
import { StoArmadaEntity } from '../entities/sto-armada.entity';
import { StoFleetEntity } from '../entities/sto-fleet.entity';
import { FleetModule } from '../fleet.module';
import { FleetImageService } from './fleet-image.service';
import { FleetImagesController } from './fleet-images.controller';
import { FleetImagesModule } from './fleet-images.module';
import {
  FleetCommunityImagePublisher,
  StoArmadaImagePublisher,
  StoFleetImagePublisher,
} from './fleet-scope-image.publishers';

interface FeatureModule {
  providers?: Array<{ provide?: unknown }>;
}

describe('FleetImagesModule', () => {
  const metadata = (key: string): unknown[] =>
    (Reflect.getMetadata(key, FleetImagesModule) as unknown[]) ?? [];

  /**
   * A subject with no publisher is an upload that reaches CLEAN and then
   * stops: the registry refuses it at ingress, so the failure shows up as a
   * refused upload rather than as a stuck asset — but only if somebody is
   * looking. All three are asserted here so adding a fourth kind of scope
   * cannot leave its pictures unpublishable.
   */
  it('provides a publisher for each of the three subjects', () => {
    const providers = metadata('providers');

    expect(providers).toContain(FleetCommunityImagePublisher);
    expect(providers).toContain(StoFleetImagePublisher);
    expect(providers).toContain(StoArmadaImagePublisher);
    expect(
      [
        new FleetCommunityImagePublisher(undefined!, undefined!).subject,
        new StoFleetImagePublisher(undefined!, undefined!).subject,
        new StoArmadaImagePublisher(undefined!, undefined!).subject,
      ].sort(),
    ).toEqual(
      [
        FileAssetSubject.FLEET_COMMUNITY,
        FileAssetSubject.FLEET,
        FileAssetSubject.ARMADA,
      ].sort(),
    );
  });

  it('exposes the artwork routes and the service behind them', () => {
    expect(metadata('controllers')).toContain(FleetImagesController);
    expect(metadata('providers')).toContain(FleetImageService);
    expect(metadata('exports')).toContain(FleetImageService);
  });

  /**
   * `FileAssetsModule` already imports `FleetModule` for the audience
   * service, so artwork registered inside `FleetModule` and needing the
   * asset registry would close a loop Nest resolves by refusing to start.
   * This module sits below both, which is the whole reason it exists.
   */
  it('depends on Fleet and on the ingress, in that one direction', () => {
    const imports = metadata('imports');

    expect(imports).toContain(FleetModule);
    expect(imports).toContain(AssetIngressModule);
    expect(Reflect.getMetadata('imports', FleetModule) ?? []).not.toContain(
      FleetImagesModule,
    );
  });

  it('registers a repository for each of the three scopes', () => {
    const tokens = (metadata('imports') as FeatureModule[]).flatMap(
      imported => imported.providers?.map(provider => provider.provide) ?? [],
    );

    for (const entity of [
      FleetCommunityEntity,
      StoFleetEntity,
      StoArmadaEntity,
    ]) {
      expect(tokens).toContain(getRepositoryToken(entity));
    }
  });
});
