/**
 * The Markdown subset Storytime accepts, and the rules for rendering it.
 *
 * Deliberately a small, closed set. The application already renders a safe
 * Markdown subset for News on the client; Storytime renders server-side
 * instead, because Chapter content is written by any member rather than by an
 * administrator, and because the rendered HTML is cached and must be
 * trustworthy wherever it is served from.
 *
 * Storytime's rules are stricter than the News subset in one respect: external
 * links are not permitted at all.
 */

/** Splits the source into block-level chunks on blank lines. */
export const MARKDOWN_BLOCK_SPLIT_PATTERN = /\n{2,}/;

/** A fenced code block, captured so its contents are never reinterpreted. */
export const MARKDOWN_FENCED_CODE_BLOCK_PATTERN = /```([\s\S]*?)```/g;

/**
 * Sentinel wrapping the placeholder left behind by an extracted code block.
 *
 * A private-use character (U+E000) rather than plain text, because a
 * placeholder made of ordinary letters could be typed by an author. Writing
 * `CODE0` in a Story would then be mistaken for an extracted fence and replaced
 * with somebody else's code, or with nothing at all.
 *
 * Any occurrence of this character in the incoming source is stripped before
 * extraction, so an author cannot forge a placeholder either.
 */
export const CODE_PLACEHOLDER_SENTINEL = String.fromCharCode(0xe000);

/** Placeholder standing in for an extracted fenced code block. */
export const MARKDOWN_CODE_PLACEHOLDER_PATTERN = new RegExp(
  `${CODE_PLACEHOLDER_SENTINEL}CODE([0-9]+)${CODE_PLACEHOLDER_SENTINEL}`,
  'g',
);

/** A block consisting solely of a code placeholder. */
export const MARKDOWN_CODE_PLACEHOLDER_BLOCK_PATTERN = new RegExp(
  `^${CODE_PLACEHOLDER_SENTINEL}CODE([0-9]+)${CODE_PLACEHOLDER_SENTINEL}$`,
);

/** Any use of the sentinel in author-supplied source, which must be stripped. */
export const CODE_PLACEHOLDER_SENTINEL_PATTERN = new RegExp(
  CODE_PLACEHOLDER_SENTINEL,
  'g',
);

/** Leading newline left behind when a fence is extracted. */
export const MARKDOWN_LEADING_NEWLINE_PATTERN = /^\n/;

/** An ATX heading, capturing its level and text. */
export const MARKDOWN_HEADING_PATTERN = /^(#{1,6})\s+(.*)$/;

/** A horizontal rule. */
export const MARKDOWN_HORIZONTAL_RULE_PATTERN = /^(?:---+|\*\*\*+|___+)$/;

/** An unordered list item marker. */
export const MARKDOWN_UNORDERED_LIST_ITEM_PATTERN = /^\s*[-*+]\s+/;

/** An ordered list item marker. */
export const MARKDOWN_ORDERED_LIST_ITEM_PATTERN = /^\s*\d+\.\s+/;

/**
 * A blockquote line.
 *
 * Matches the escaped entity because escaping happens before block parsing, so
 * by this point a `>` is already `&gt;`.
 */
export const MARKDOWN_BLOCKQUOTE_LINE_PATTERN = /^\s*&gt;\s?/;

/** Inline code span. */
export const MARKDOWN_INLINE_CODE_PATTERN = /`([^`]+)`/g;

/** Bold, asterisk form. */
export const MARKDOWN_BOLD_ASTERISK_PATTERN = /\*\*([^*]+)\*\*/g;

/** Bold, underscore form. */
export const MARKDOWN_BOLD_UNDERSCORE_PATTERN = /__([^_]+)__/g;

/** Italic, asterisk form. */
export const MARKDOWN_ITALIC_ASTERISK_PATTERN = /\*([^*]+)\*/g;

/** Italic, underscore form. */
export const MARKDOWN_ITALIC_UNDERSCORE_PATTERN = /_([^_]+)_/g;

/** A Markdown link, capturing its label and target. */
export const MARKDOWN_LINK_PATTERN = /\[([^\]]*)\]\(([^)\s]+)\)/g;

/**
 * Any absolute URL, in any scheme.
 *
 * Used by validation to refuse external links before they are ever stored,
 * rather than only stripping them at render. Matching the scheme rather than
 * guessing at bare domain names keeps false positives away from ordinary prose:
 * a Story may well mention the U.S.S. Voyager without meaning a hyperlink.
 */
export const ABSOLUTE_URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;

/**
 * Sentence punctuation clinging to the end of a matched URL.
 *
 * A URL match runs to the next space, so it swallows the bracket closing a
 * Markdown link and any full stop ending the sentence. Trimming these matters
 * for more than tidiness: the offending URL is quoted back to the creator so
 * they can find and remove it, and quoting `https://example.com)` sends them
 * looking for text that is not there.
 */
export const URL_TRAILING_PUNCTUATION_PATTERN = /[).,;:!?'"]+$/;

/**
 * A scheme-relative URL such as `//example.com`.
 *
 * Matched separately because it has no scheme but still leaves the site, and
 * would otherwise slip past both the absolute-URL check and the relative-link
 * allowance.
 */
export const SCHEME_RELATIVE_URL_PATTERN = /(?:^|[\s(])(\/\/\S+)/g;

/**
 * A link target that is safe to render.
 *
 * Only site-relative paths and in-page fragments. Anything else is refused, so
 * a Chapter can point at another Story but never off the site.
 */
export const SAFE_RELATIVE_LINK_PATTERN = /^(?:\/(?!\/)\S*|#\S*)$/;

/** Words per minute used to estimate reading time. */
export const READING_WORDS_PER_MINUTE = 200;

/** Prefix given to every generated block anchor. */
export const CONTENT_BLOCK_ID_PREFIX = 'b';

/** The schema version stamped on newly rendered content. */
export const CONTENT_SCHEMA_VERSION = 1;

/** Splits plain text into words for counting. */
export const WORD_SPLIT_PATTERN = /\s+/;

/** Strips Markdown syntax characters when counting words. */
export const MARKDOWN_SYNTAX_PATTERN = /[#*_`>[\]()]/g;
