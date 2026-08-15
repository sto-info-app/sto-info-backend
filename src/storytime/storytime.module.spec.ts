import { AdminStorytimeConfigurationController } from './admin-storytime-configuration.controller';
import { StorytimeConfigurationController } from './storytime-configuration.controller';
import { StorytimeFeatureService } from './storytime-feature.service';
import { StorytimeModule } from './storytime.module';

describe('StorytimeModule', () => {
  it('declares the configuration controllers', () => {
    const controllers = Reflect.getMetadata('controllers', StorytimeModule) as
      Array<unknown> | undefined;

    expect(controllers).toContain(StorytimeConfigurationController);
    expect(controllers).toContain(AdminStorytimeConfigurationController);
  });

  it('exports the feature service for submodules to check their own switch', () => {
    const exportsList = Reflect.getMetadata('exports', StorytimeModule) as
      Array<unknown> | undefined;

    expect(exportsList).toContain(StorytimeFeatureService);
  });
});
