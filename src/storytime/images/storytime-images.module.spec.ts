import { SharedModule } from 'src/shared/shared.module';
import { StorytimeImageService } from './storytime-image.service';
import { StorytimeImagesModule } from './storytime-images.module';

describe('StorytimeImagesModule', () => {
  it('imports the site-wide upload pipeline rather than a second one', () => {
    const imports = Reflect.getMetadata('imports', StorytimeImagesModule) as
      | Array<unknown>
      | undefined;

    expect(imports).toContain(SharedModule);
  });

  it('exports the image service for every area that carries artwork', () => {
    const exportsList = Reflect.getMetadata(
      'exports',
      StorytimeImagesModule,
    ) as Array<unknown> | undefined;

    expect(exportsList).toContain(StorytimeImageService);
  });
});
