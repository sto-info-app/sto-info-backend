import { AssetIngressModule } from 'src/file-assets/asset-ingress.module';
import { NotificationModule } from 'src/notification/notification.module';
import { RegistryModule } from 'src/registry/registry.module';

import { CaptainsLogAdminController } from './captains-log-admin.controller';
import { CaptainsLogController } from './captains-log.controller';
import { CaptainsLogModule } from './captains-log.module';
import { CaptainsLogService } from './captains-log.service';
import { LogPicturePublisher } from './log-picture.publisher';
import { PublicCaptainsLogController } from './public-captains-log.controller';

/**
 * Reads one list a module declares.
 *
 * @param key - Which.
 * @returns It.
 */
const declared = (key: string): unknown[] =>
  (Reflect.getMetadata(key, CaptainsLogModule) as unknown[] | undefined) ?? [];

describe('CaptainsLogModule', () => {
  it('serves the author, the profile and the site admins', () => {
    expect(declared('controllers')).toEqual([
      CaptainsLogController,
      PublicCaptainsLogController,
      CaptainsLogAdminController,
    ]);
    expect(declared('providers')).toContain(CaptainsLogService);
    expect(declared('exports')).toContain(CaptainsLogService);
  });

  it('publishes entry pictures through the asset ingress, and asks the registry about profiles', () => {
    expect(declared('imports')).toEqual(
      expect.arrayContaining([
        AssetIngressModule,
        NotificationModule,
        RegistryModule,
      ]),
    );
    expect(declared('providers')).toContain(LogPicturePublisher);
  });
});
