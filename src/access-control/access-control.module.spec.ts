import { AccessControlAdminController } from './access-control-admin.controller';
import { AccessControlAdminService } from './access-control-admin.service';
import { AccessControlModule } from './access-control.module';
import { AccessControlService } from './access-control.service';
import { LimitService } from './limit.service';
import { PermissionsGuard } from './permissions.guard';

describe('AccessControlModule', () => {
  it('declares expected providers', () => {
    const providers = Reflect.getMetadata('providers', AccessControlModule) as
      Array<unknown> | undefined;

    expect(providers).toEqual(
      expect.arrayContaining([
        AccessControlService,
        LimitService,
        PermissionsGuard,
      ]),
    );
  });

  it('exports everything feature modules need to authorise a caller', () => {
    const exportsList = Reflect.getMetadata('exports', AccessControlModule) as
      Array<unknown> | undefined;

    expect(exportsList).toEqual(
      expect.arrayContaining([
        AccessControlService,
        LimitService,
        PermissionsGuard,
      ]),
    );
  });

  it('is global, because authorisation is needed by every feature module', () => {
    // Nest records global modules via this metadata key; without it every
    // feature module would have to import access control explicitly.
    const isGlobal = Reflect.getMetadata(
      '__module:global__',
      AccessControlModule,
    ) as boolean | undefined;

    expect(isGlobal).toBe(true);
  });

  it('declares the administration controller', () => {
    const controllers = Reflect.getMetadata(
      'controllers',
      AccessControlModule,
    ) as Array<unknown> | undefined;

    expect(controllers).toContain(AccessControlAdminController);
  });

  it('keeps the administration service internal', () => {
    const exportsList = Reflect.getMetadata('exports', AccessControlModule) as
      Array<unknown> | undefined;

    // Only this module's own controller writes overrides; feature modules read
    // permissions and must not be able to grant themselves more.
    expect(exportsList).not.toContain(AccessControlAdminService);
  });
});
