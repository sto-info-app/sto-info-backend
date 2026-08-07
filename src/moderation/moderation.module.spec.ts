import { ModerationAdminController } from './moderation-admin.controller';
import { ModerationController } from './moderation.controller';
import { ModerationModule } from './moderation.module';
import { ReportService } from './report.service';
import { UserModerationService } from './user-moderation.service';

describe('ModerationModule', () => {
  it('declares expected controllers and providers', () => {
    const controllers = Reflect.getMetadata('controllers', ModerationModule) as
      Array<unknown> | undefined;
    const providers = Reflect.getMetadata('providers', ModerationModule) as
      Array<unknown> | undefined;
    const exportsList = Reflect.getMetadata('exports', ModerationModule) as
      Array<unknown> | undefined;

    expect(controllers).toContain(ModerationController);
    expect(controllers).toContain(ModerationAdminController);
    expect(providers).toContain(ReportService);
    expect(providers).toContain(UserModerationService);
    expect(exportsList).toContain(ReportService);
    expect(exportsList).toContain(UserModerationService);
  });
});
