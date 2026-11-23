import { AssetIngressModule } from 'src/file-assets/asset-ingress.module';

import { NewsCoverPublisher } from './news-cover.publisher';
import { NewsController } from './news.controller';
import { NewsModule } from './news.module';
import { NewsService } from './news.service';

describe('NewsModule', () => {
  it('declares expected controllers and providers', () => {
    const controllers = Reflect.getMetadata('controllers', NewsModule) as
      unknown[] | undefined;
    const providers = Reflect.getMetadata('providers', NewsModule) as
      unknown[] | undefined;
    const exportsList = Reflect.getMetadata('exports', NewsModule) as
      unknown[] | undefined;

    expect(controllers).toContain(NewsController);
    expect(providers).toContain(NewsService);
    expect(exportsList).toContain(NewsService);
  });

  it('publishes the site’s own covers, through the asset ingress', () => {
    const imports = Reflect.getMetadata('imports', NewsModule) as
      unknown[] | undefined;
    const providers = Reflect.getMetadata('providers', NewsModule) as
      unknown[] | undefined;

    expect(imports).toContain(AssetIngressModule);
    expect(providers).toContain(NewsCoverPublisher);
  });
});
