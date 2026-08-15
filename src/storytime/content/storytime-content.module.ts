import { Module } from '@nestjs/common';
import { StorytimeMarkdownService } from './storytime-markdown.service';
import { YouTubeUrlService } from './youtube-url.service';

/**
 * Parsing and rendering of creator-supplied Chapter content.
 *
 * Kept as its own module because it is the feature's security boundary. Every
 * piece of untrusted text a member writes passes through here, so the rules
 * live in one place that can be reasoned about, fuzzed and reviewed on its own
 * rather than being spread across the services that happen to save content.
 */
@Module({
  providers: [StorytimeMarkdownService, YouTubeUrlService],
  exports: [StorytimeMarkdownService, YouTubeUrlService],
})
export class StorytimeContentModule {}
