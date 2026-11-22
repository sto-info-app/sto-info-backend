import { AppStateController } from './app-state.controller';
import { NotificationController } from './notification.controller';
import { NotificationModule } from './notification.module';
import { NotificationService } from './notification.service';
import { NotificationOutboxRegistry } from './outbox/notification-outbox.registry';
import { NotificationOutboxService } from './outbox/notification-outbox.service';

describe('NotificationModule', () => {
  it('declares expected controllers and providers', () => {
    const controllers = Reflect.getMetadata(
      'controllers',
      NotificationModule,
    ) as unknown[] | undefined;
    const providers = Reflect.getMetadata('providers', NotificationModule) as
      unknown[] | undefined;
    const exportsList = Reflect.getMetadata('exports', NotificationModule) as
      unknown[] | undefined;

    expect(controllers).toContain(NotificationController);
    expect(controllers).toContain(AppStateController);
    expect(providers).toContain(NotificationService);
    expect(exportsList).toContain(NotificationService);
  });

  it('runs the outbox, and lets features register their notices with it', () => {
    const providers = Reflect.getMetadata('providers', NotificationModule) as
      unknown[] | undefined;
    const exportsList = Reflect.getMetadata('exports', NotificationModule) as
      unknown[] | undefined;

    expect(providers).toEqual(
      expect.arrayContaining([
        NotificationOutboxRegistry,
        NotificationOutboxService,
      ]),
    );
    expect(exportsList).toContain(NotificationOutboxRegistry);
  });
});
