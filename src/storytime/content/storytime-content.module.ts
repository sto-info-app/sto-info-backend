import { Module } from '@nestjs/common';

import { StorytimeFeatureService } from '../storytime-feature.service';
import { StorytimeContentPreviewController } from './storytime-content-preview.controller';
import { StorytimeMarkdownService } from './storytime-markdown.service';
import { YouTubeUrlService } from './youtube-url.service';

/**
 * Parsing and rendering of creator-supplied Chapter content.
 *
 * Kept as its own module because it is the feature's security boundary. Every
 * piece of untrusted text a member writes passes through here, so the rules
 * live in one place that can be reasoned about, fuzzed and reviewed on its own
 * rather than being spread across the services that happen to save content.
 *
 * The preview route is the one piece of transport the module owns, and it
 * belongs here rather than with any one editor's controller: all four fields
 * that take Markdown render through the same service, so a preview that lived
 * with Chapters would have to be reached by Stories, Arcs and Characters too.
 */
@Module({
  controllers: [StorytimeContentPreviewController],
  providers: [
    StorytimeMarkdownService,
    YouTubeUrlService,
    StorytimeFeatureService,
  ],
  exports: [StorytimeMarkdownService, YouTubeUrlService],
})
export class StorytimeContentModule {}
