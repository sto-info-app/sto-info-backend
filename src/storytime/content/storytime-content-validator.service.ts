import { BadRequestException, Injectable } from '@nestjs/common';
import {
  ABSOLUTE_URL_PATTERN,
  MARKDOWN_FENCED_CODE_BLOCK_PATTERN,
  MARKDOWN_LINK_PATTERN,
  SAFE_RELATIVE_LINK_PATTERN,
  SCHEME_RELATIVE_URL_PATTERN,
  URL_TRAILING_PUNCTUATION_PATTERN,
} from './constants/storytime-markdown.constants';

/**
 * The outcome of checking Chapter content.
 */
export interface ContentValidationResult {
  /** Whether the content may be stored. */
  isValid: boolean;
  /** Every offending URL found, in the order encountered. */
  offendingUrls: string[];
}

/**
 * Refuses Chapter content that contains external links.
 *
 * External links are not permitted in Chapter bodies. This service is the first
 * of two defences: it rejects the content outright so the creator is told what
 * is wrong and where, rather than having their work silently altered. The
 * renderer then strips anything that reaches it anyway, so a link cannot become
 * clickable even if content were written directly to the database.
 *
 * Only explicit schemes and scheme-relative URLs are treated as links. Guessing
 * at bare domain names would reject ordinary prose — a Story may mention the
 * U.S.S. Voyager without meaning a hyperlink.
 *
 * Content inside fenced code blocks is exempt: a URL shown as an example is
 * text, not a link, and is never rendered as one.
 */
@Injectable()
export class StorytimeContentValidatorService {
  /**
   * Checks Chapter content for external links.
   *
   * @param source - The Markdown source to check.
   * @returns Whether the content is acceptable, and any offending URLs.
   */
  validate(source: string): ContentValidationResult {
    // Code fences are removed first: a URL demonstrated inside one is never
    // rendered as a link, so refusing it would block legitimate writing.
    const withoutCode = source.replace(MARKDOWN_FENCED_CODE_BLOCK_PATTERN, '');

    const offendingUrls = [
      ...this.findExternalLinkTargets(withoutCode),
      ...this.findAbsoluteUrls(withoutCode),
      ...this.findSchemeRelativeUrls(withoutCode),
    ];

    const unique = [...new Set(offendingUrls)];

    return { isValid: unique.length === 0, offendingUrls: unique };
  }

  /**
   * Requires that Chapter content contains no external links.
   *
   * @param source - The Markdown source to check.
   * @throws BadRequestException naming the offending URLs.
   */
  assertValid(source: string): void {
    const result = this.validate(source);

    if (result.isValid) {
      return;
    }

    // The offending URLs are named so the creator can find and remove them,
    // rather than being told only that something, somewhere, is not allowed.
    throw new BadRequestException(
      `External links are not permitted in Chapter content. Remove: ${result.offendingUrls.join(', ')}`,
    );
  }

  /**
   * Finds Markdown links whose target is not a site-relative path.
   *
   * @param source - The Markdown source, with code fences already removed.
   * @returns The offending link targets.
   */
  private findExternalLinkTargets(source: string): string[] {
    const targets: string[] = [];

    for (const match of source.matchAll(MARKDOWN_LINK_PATTERN)) {
      const target = match[2];
      if (!SAFE_RELATIVE_LINK_PATTERN.test(target)) {
        targets.push(target);
      }
    }

    return targets;
  }

  /**
   * Finds bare absolute URLs written directly into the prose.
   *
   * @param source - The Markdown source, with code fences already removed.
   * @returns The offending URLs.
   */
  private findAbsoluteUrls(source: string): string[] {
    return [...source.matchAll(ABSOLUTE_URL_PATTERN)].map(match =>
      this.trimTrailingPunctuation(match[0]),
    );
  }

  /**
   * Finds scheme-relative URLs, which leave the site despite having no scheme.
   *
   * @param source - The Markdown source, with code fences already removed.
   * @returns The offending URLs.
   */
  private findSchemeRelativeUrls(source: string): string[] {
    return [...source.matchAll(SCHEME_RELATIVE_URL_PATTERN)].map(match =>
      this.trimTrailingPunctuation(match[1]),
    );
  }

  /**
   * Removes sentence punctuation clinging to the end of a matched URL.
   *
   * A match runs to the next space, so it picks up the bracket closing a
   * Markdown link or the full stop ending a sentence. Trimming keeps the URL
   * quoted back to the creator identical to the one they actually wrote, and
   * lets the same URL found by two different scans collapse into one report.
   *
   * @param url - The raw matched URL.
   * @returns The URL without trailing punctuation.
   */
  private trimTrailingPunctuation(url: string): string {
    return url.replace(URL_TRAILING_PUNCTUATION_PATTERN, '');
  }
}
