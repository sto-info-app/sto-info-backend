import { NewsModule } from './news.module';
import { NewsController } from './news.controller';
import { NewsService } from './news.service';

describe('NewsModule', () => {
  it('declares expected controllers and providers', () => {
    const controllers = Reflect.getMetadata('controllers', NewsModule) as
      | unknown[]
      | undefined;
    const providers = Reflect.getMetadata('providers', NewsModule) as
      | unknown[]
      | undefined;
    const exportsList = Reflect.getMetadata('exports', NewsModule) as
      | unknown[]
      | undefined;

    expect(controllers).toContain(NewsController);
    expect(providers).toContain(NewsService);
    expect(exportsList).toContain(NewsService);
  });
});
