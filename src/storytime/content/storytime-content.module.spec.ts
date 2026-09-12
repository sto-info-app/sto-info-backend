import { StorytimeContentPreviewController } from './storytime-content-preview.controller';
import { StorytimeContentModule } from './storytime-content.module';
import { StorytimeMarkdownService } from './storytime-markdown.service';
import { YouTubeUrlService } from './youtube-url.service';

describe('StorytimeContentModule', () => {
  it('declares the preview controller', () => {
    const controllers = Reflect.getMetadata(
      'controllers',
      StorytimeContentModule,
    ) as Array<unknown> | undefined;

    expect(controllers).toContain(StorytimeContentPreviewController);
  });

  // The renderer and the URL parser are the boundary every other submodule
  // reaches through; the preview controller is transport and stays here.
  it('exports the renderer and the URL parser but not the controller', () => {
    const exportsList = Reflect.getMetadata(
      'exports',
      StorytimeContentModule,
    ) as Array<unknown> | undefined;

    expect(exportsList).toContain(StorytimeMarkdownService);
    expect(exportsList).toContain(YouTubeUrlService);
    expect(exportsList).not.toContain(StorytimeContentPreviewController);
  });
});
