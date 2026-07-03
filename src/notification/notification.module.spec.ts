import { NotificationModule } from './notification.module';
import { AppStateController } from './app-state.controller';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

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
});
