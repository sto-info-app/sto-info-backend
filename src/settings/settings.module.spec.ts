import { SettingsModule } from './settings.module';
import { SettingsService } from './settings.service';

describe('SettingsModule', () => {
  it('declares and exports the settings service', () => {
    const providers = Reflect.getMetadata('providers', SettingsModule) as
      Array<unknown> | undefined;
    const exportsList = Reflect.getMetadata('exports', SettingsModule) as
      Array<unknown> | undefined;

    expect(providers).toContain(SettingsService);
    expect(exportsList).toContain(SettingsService);
  });

  it('is global, so any feature can consult a runtime switch', () => {
    const isGlobal = Reflect.getMetadata(
      '__module:global__',
      SettingsModule,
    ) as boolean | undefined;

    expect(isGlobal).toBe(true);
  });
});
