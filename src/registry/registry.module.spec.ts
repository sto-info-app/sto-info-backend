import { RegistryController } from './registry.controller';
import { RegistryModule } from './registry.module';
import { RegistryService } from './registry.service';

describe('RegistryModule', () => {
  it('declares expected controllers and providers', () => {
    const controllers = Reflect.getMetadata('controllers', RegistryModule) as
      Array<unknown> | undefined;
    const providers = Reflect.getMetadata('providers', RegistryModule) as
      Array<unknown> | undefined;
    const exportsList = Reflect.getMetadata('exports', RegistryModule) as
      Array<unknown> | undefined;

    expect(controllers).toContain(RegistryController);
    expect(providers).toContain(RegistryService);
    expect(exportsList).toContain(RegistryService);
  });
});
