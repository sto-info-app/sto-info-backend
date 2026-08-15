import { Injectable } from '@nestjs/common';
import {
  CODE_PLACEHOLDER_SENTINEL,
  CODE_PLACEHOLDER_SENTINEL_PATTERN,
  CONTENT_BLOCK_ID_PREFIX,
  CONTENT_SCHEMA_VERSION,
  MARKDOWN_BLOCKQUOTE_LINE_PATTERN,
  MARKDOWN_BLOCK_SPLIT_PATTERN,
  MARKDOWN_BOLD_ASTERISK_PATTERN,
  MARKDOWN_BOLD_UNDERSCORE_PATTERN,
  MARKDOWN_CODE_PLACEHOLDER_BLOCK_PATTERN,
  MARKDOWN_CODE_PLACEHOLDER_PATTERN,
  MARKDOWN_FENCED_CODE_BLOCK_PATTERN,
  MARKDOWN_HEADING_PATTERN,
  MARKDOWN_HORIZONTAL_RULE_PATTERN,
  MARKDOWN_INLINE_CODE_PATTERN,
  MARKDOWN_ITALIC_ASTERISK_PATTERN,
  MARKDOWN_ITALIC_UNDERSCORE_PATTERN,
  MARKDOWN_LEADING_NEWLINE_PATTERN,
  MARKDOWN_LINK_PATTERN,
  MARKDOWN_ORDERED_LIST_ITEM_PATTERN,
  MARKDOWN_SYNTAX_PATTERN,
  MARKDOWN_UNORDERED_LIST_ITEM_PATTERN,
  READING_WORDS_PER_MINUTE,
  SAFE_RELATIVE_LINK_PATTERN,
  WORD_SPLIT_PATTERN,
} from './constants/storytime-markdown.constants';

/**
 * Rendered Chapter content and the figures derived from it.
 */
export interface RenderedContent {
  /** Sanitised HTML, safe to serve. */
  html: string;
  /** Words in the source, used for reading estimates and listings. */
  wordCount: number;
  /** Estimated reading time in whole minutes, never less than one. */
  estimatedReadingMinutes: number;
  /** How many anchored blocks the content produced. */
  blockCount: number;
  /** The renderer version that produced this HTML. */
  schemaVersion: number;
}

/**
 * Turns Chapter Markdown into sanitised HTML.
 *
 * The security boundary for the whole feature. Chapter content is written by any
 * member, so the renderer assumes every input is hostile and works by
 * construction rather than by filtering: the source is HTML-escaped first, and
 * only then are a fixed set of recognised constructs turned into markup this
 * class itself emits. Nothing an author writes can become an element, an
 * attribute or a URL that is not on that list.
 *
 * That ordering is the whole design. A renderer that produced markup first and
 * sanitised afterwards would be one missed case away from injection; this one
 * has no path by which author text reaches the output unescaped.
 *
 * Unlike the News renderer, this one never turns a URL into a link or an embed.
 * External links are refused outright, and media reaches readers only through
 * the Chapter's structured media references.
 *
 * Every block carries a stable anchor so reading progress can be recorded
 * against a position in the text rather than a pixel offset.
 */
@Injectable()
export class StorytimeMarkdownService {
  /**
   * Renders Chapter Markdown to sanitised HTML.
   *
   * @param source - The Markdown source. Treated as hostile.
   * @returns The rendered HTML and the figures derived from the source.
   */
  render(source: string | null | undefined): RenderedContent {
    // The sentinel is stripped from the incoming source first, so an author
    // cannot forge a code placeholder and have it replaced with somebody
    // else's extracted code.
    const safeSource = (source ?? '').replace(
      CODE_PLACEHOLDER_SENTINEL_PATTERN,
      '',
    );
    const codeBlocks: string[] = [];

    // Fenced code is lifted out before anything else so its contents are never
    // reinterpreted as Markdown. It is escaped on the way out, so a fence
    // cannot be used to smuggle markup through.
    const withoutFences = safeSource.replace(
      MARKDOWN_FENCED_CODE_BLOCK_PATTERN,
      (_match, code: string) => {
        const placeholder = `${CODE_PLACEHOLDER_SENTINEL}CODE${codeBlocks.length}${CODE_PLACEHOLDER_SENTINEL}`;
        codeBlocks.push(
          this.escape(code.replace(MARKDOWN_LEADING_NEWLINE_PATTERN, '')),
        );
        return placeholder;
      },
    );

    const escaped = this.escape(withoutFences);
    const blocks = escaped
      .split(MARKDOWN_BLOCK_SPLIT_PATTERN)
      .map(block => block.trim())
      .filter(Boolean);

    const rendered = blocks.map((block, index) =>
      this.renderBlock(block, index + 1, codeBlocks),
    );

    const wordCount = this.countWords(safeSource);

    return {
      // A fence written mid-paragraph leaves its placeholder inside a rendered
      // block rather than standing alone, so any that survive block rendering
      // are restored here as inline code. Without this they would reach the
      // reader as a stray sentinel.
      html: this.restoreInlineCode(rendered.join('\n'), codeBlocks),
      wordCount,
      estimatedReadingMinutes: this.estimateReadingMinutes(wordCount),
      blockCount: blocks.length,
      schemaVersion: CONTENT_SCHEMA_VERSION,
    };
  }

  /**
   * Restores any code placeholders left inside rendered blocks as inline code.
   *
   * @param html - The rendered HTML.
   * @param codeBlocks - The extracted, already-escaped code contents.
   * @returns The HTML with every remaining placeholder resolved.
   */
  private restoreInlineCode(html: string, codeBlocks: string[]): string {
    return html.replace(
      MARKDOWN_CODE_PLACEHOLDER_PATTERN,
      // The index always exists: a placeholder is only ever emitted alongside
      // the entry it refers to, and a forged sentinel is stripped from the
      // source before extraction begins.
      (_match, index: string) => `<code>${codeBlocks[Number(index)]}</code>`,
    );
  }

  /**
   * Builds the anchor for a block at a given position.
   *
   * Anchors are ordinal, so inserting a block shifts the anchors of everything
   * after it. That is accepted: a reader's stored position then resolves to a
   * nearby point in the same Chapter rather than an exact one, which is a far
   * smaller cost than the alternative of hashing content and having two
   * identical paragraphs collide.
   *
   * @param position - The block's one-based position.
   * @returns The anchor identifier.
   */
  buildBlockId(position: number): string {
    return `${CONTENT_BLOCK_ID_PREFIX}${position}`;
  }

  /**
   * Renders a single block, giving it a stable anchor.
   *
   * @param block - The escaped block text.
   * @param position - The block's one-based position.
   * @param codeBlocks - Previously extracted, escaped code block contents.
   * @returns The rendered HTML for the block.
   */
  private renderBlock(
    block: string,
    position: number,
    codeBlocks: string[],
  ): string {
    const id = this.buildBlockId(position);

    const codePlaceholder = MARKDOWN_CODE_PLACEHOLDER_BLOCK_PATTERN.exec(block);
    if (codePlaceholder) {
      const index = Number(codePlaceholder[1]);
      return `<pre id="${id}" class="storytime-code"><code>${codeBlocks[index]}</code></pre>`;
    }

    if (MARKDOWN_HORIZONTAL_RULE_PATTERN.test(block)) {
      return `<hr id="${id}" />`;
    }

    const heading = MARKDOWN_HEADING_PATTERN.exec(block);
    if (heading) {
      // Chapter headings start at h2: the Chapter title is the page's h1, and
      // an author-supplied h1 would break the document outline screen readers
      // rely on.
      const level = Math.min(heading[1].length + 1, 6);
      return `<h${level} id="${id}">${this.renderInline(heading[2])}</h${level}>`;
    }

    const lines = block.split('\n');

    if (lines.every(line => MARKDOWN_UNORDERED_LIST_ITEM_PATTERN.test(line))) {
      return `<ul id="${id}">${this.renderListItems(lines, MARKDOWN_UNORDERED_LIST_ITEM_PATTERN)}</ul>`;
    }

    if (lines.every(line => MARKDOWN_ORDERED_LIST_ITEM_PATTERN.test(line))) {
      return `<ol id="${id}">${this.renderListItems(lines, MARKDOWN_ORDERED_LIST_ITEM_PATTERN)}</ol>`;
    }

    if (lines.every(line => MARKDOWN_BLOCKQUOTE_LINE_PATTERN.test(line))) {
      const quote = lines
        .map(line => line.replace(MARKDOWN_BLOCKQUOTE_LINE_PATTERN, ''))
        .join(' ');
      return `<blockquote id="${id}">${this.renderInline(quote)}</blockquote>`;
    }

    return `<p id="${id}">${this.renderInline(lines.join('<br />'))}</p>`;
  }

  /**
   * Renders the items of a list block.
   *
   * @param lines - The block's lines.
   * @param marker - The list marker pattern to strip.
   * @returns The rendered list items.
   */
  private renderListItems(lines: string[], marker: RegExp): string {
    return lines
      .map(line => line.replace(marker, ''))
      .map(item => `<li>${this.renderInline(item)}</li>`)
      .join('');
  }

  /**
   * Renders inline Markdown within an already-escaped block.
   *
   * @param text - The escaped inline text.
   * @returns The rendered inline HTML.
   */
  private renderInline(text: string): string {
    return text
      .replace(MARKDOWN_INLINE_CODE_PATTERN, '<code>$1</code>')
      .replace(MARKDOWN_BOLD_ASTERISK_PATTERN, '<strong>$1</strong>')
      .replace(MARKDOWN_BOLD_UNDERSCORE_PATTERN, '<strong>$1</strong>')
      .replace(MARKDOWN_ITALIC_ASTERISK_PATTERN, '<em>$1</em>')
      .replace(MARKDOWN_ITALIC_UNDERSCORE_PATTERN, '<em>$1</em>')
      .replace(MARKDOWN_LINK_PATTERN, (_match, label: string, url: string) =>
        this.renderLink(label, url),
      );
  }

  /**
   * Renders a Markdown link, or discards it if it leaves the site.
   *
   * Validation should already have refused external links, so reaching this
   * with one means content arrived by some other route. The link is reduced to
   * its label rather than dropped entirely, so the sentence still reads.
   *
   * @param label - The already-escaped link label.
   * @param url - The link target.
   * @returns The rendered anchor, or the bare label.
   */
  private renderLink(label: string, url: string): string {
    if (!SAFE_RELATIVE_LINK_PATTERN.test(url)) {
      return label;
    }

    return `<a href="${url}">${label}</a>`;
  }

  /**
   * Counts the words in Markdown source.
   *
   * Syntax characters are stripped first so formatting does not inflate the
   * figure a reader is shown.
   *
   * @param source - The Markdown source.
   * @returns The number of words.
   */
  private countWords(source: string): number {
    const plain = source.replace(MARKDOWN_SYNTAX_PATTERN, ' ').trim();

    if (!plain) {
      return 0;
    }

    return plain.split(WORD_SPLIT_PATTERN).filter(Boolean).length;
  }

  /**
   * Estimates reading time from a word count.
   *
   * @param wordCount - The number of words.
   * @returns Whole minutes, never less than one for non-empty content.
   */
  private estimateReadingMinutes(wordCount: number): number {
    if (wordCount === 0) {
      return 0;
    }

    return Math.max(1, Math.ceil(wordCount / READING_WORDS_PER_MINUTE));
  }

  /**
   * Escapes every HTML-significant character.
   *
   * Runs before any markup is produced, which is what makes the renderer safe
   * by construction: after this point no author-supplied character can be
   * interpreted as markup.
   *
   * @param value - The raw value.
   * @returns The escaped value.
   */
  private escape(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
