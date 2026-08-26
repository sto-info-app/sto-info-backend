/**
 * The Markdown subset Storytime accepts, and the rules for rendering it.
 *
 * Deliberately a small, closed set. The application already renders a safe
 * Markdown subset for News on the client; Storytime renders server-side
 * instead, because Chapter content is written by any member rather than by an
 * administrator, and because the rendered HTML is cached and must be
 * trustworthy wherever it is served from.
 *
 * Storytime's rules are stricter than the News subset in one respect: no link
 * ever leaves the site. External targets are not refused — content containing
 * one is accepted and simply rendered as inert text — but nothing outside the
 * site is ever turned into an anchor.
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
export const MARKDOWN_CODE_PLACEHOLDER_PATTERN = /\uE000CODE([0-9]+)\uE000/g;

/** A block consisting solely of a code placeholder. */
export const MARKDOWN_CODE_PLACEHOLDER_BLOCK_PATTERN =
  /^\uE000CODE([0-9]+)\uE000$/;

/** Any use of the sentinel in author-supplied source, which must be stripped. */
export const CODE_PLACEHOLDER_SENTINEL_PATTERN = /\uE000/g;

/** Leading newline left behind when a fence is extracted. */
export const MARKDOWN_LEADING_NEWLINE_PATTERN = /^\n/;

/**
 * An ATX heading's marker, capturing its level.
 *
 * Deliberately does not also capture the heading text: `\s+(.*)$` pairs two
 * adjacent quantifiers whose character classes both match a space, which is
 * the shape static analysis (and real ReDoS) flags as polynomial regardless
 * of how the match is anchored. Matching only the marker and a single
 * whitespace character removes the ambiguity; the caller slices and trims
 * the remainder itself.
 */
export const MARKDOWN_HEADING_PATTERN = /^(#{1,6})\s/;

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

/**
 * A Markdown link, capturing its label and target.
 *
 * The label and target are length-bounded rather than left open-ended.
 * Unbounded negated-character-class repetition here is polynomial: an author
 * can paste thousands of unmatched `[` or `(` characters, and an unbounded
 * quantifier makes each one restart a scan across the rest of the content.
 * The bounds are generous enough that no real label or site-relative path
 * would ever hit them; content that does simply fails to match and renders
 * as plain text, which is the same fallback already used for any other
 * malformed link.
 */
export const MARKDOWN_LINK_PATTERN = /\[([^\]]{0,500})\]\(([^)\s]{1,1000})\)/g;

/**
 * A link target that may be rendered as an anchor.
 *
 * Only site-relative paths and in-page fragments. A Chapter can point at
 * another Story, but any other target is rendered as text rather than as a
 * link, so no Chapter can send a reader off the site.
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
