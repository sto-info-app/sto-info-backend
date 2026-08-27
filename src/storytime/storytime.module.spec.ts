import { AdminStorytimeConfigurationController } from './admin-storytime-configuration.controller';
import { StorytimeContentModule } from './content/storytime-content.module';
import { StorytimeConfigurationController } from './storytime-configuration.controller';
import { StorytimeFeatureService } from './storytime-feature.service';
import { StorytimeModule } from './storytime.module';

describe('StorytimeModule', () => {
  it('declares the configuration controllers', () => {
    const controllers = Reflect.getMetadata('controllers', StorytimeModule) as
      | Array<unknown>
      | undefined;

    expect(controllers).toContain(StorytimeConfigurationController);
    expect(controllers).toContain(AdminStorytimeConfigurationController);
  });

  it('exports the feature service for submodules to check their own switch', () => {
    const exportsList = Reflect.getMetadata('exports', StorytimeModule) as
      | Array<unknown>
      | undefined;

    expect(exportsList).toContain(StorytimeFeatureService);
  });

  it('imports and re-exports the content module', () => {
    const imports = Reflect.getMetadata('imports', StorytimeModule) as
      | Array<unknown>
      | undefined;
    const exportsList = Reflect.getMetadata('exports', StorytimeModule) as
      | Array<unknown>
      | undefined;

    // Re-exported so the Story and Chapter submodules can render and validate
    // content without each having to import the security boundary separately.
    expect(imports).toContain(StorytimeContentModule);
    expect(exportsList).toContain(StorytimeContentModule);
  });
});
