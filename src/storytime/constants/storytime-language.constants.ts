/**
 * A language a Story or Chapter may be written in.
 */
export interface StorytimeLanguage {
  /** BCP 47 language tag, stored on the entity and emitted as `lang`. */
  readonly code: string;
  /** Native display name, used in selectors and filters. */
  readonly name: string;
}

/**
 * The languages creators may choose from.
 *
 * A curated list rather than any valid BCP 47 tag. Language is a discovery
 * filter, and a long tail of one-Story languages would make that filter
 * meaningless while giving readers nothing to find. Adding a language here is
 * a deliberate decision, not a side effect of somebody typing a tag.
 *
 * `tlh` (Klingon) is included because in-universe fan fiction is exactly the
 * context where it is a real choice rather than a curiosity. Names are shown
 * in the language they identify rather than translated into English.
 */
export const STORYTIME_LANGUAGES: readonly StorytimeLanguage[] = [
  { code: 'en-GB', name: 'English (UK)' },
  { code: 'en-US', name: 'English (US)' },
  { code: 'de', name: 'Deutsch' },
  { code: 'fr', name: 'Français' },
  { code: 'tlh', name: 'tlhIngan Hol' },
];

/**
 * Every accepted language code.
 *
 * The single source of truth for the language selector, DTO validation, the
 * rendered `lang` attribute and Crew credit languages, so those four can never
 * disagree about how a language is spelled.
 */
export const STORYTIME_LANGUAGE_CODES: readonly string[] =
  STORYTIME_LANGUAGES.map(language => language.code);

/**
 * The language assumed when a creator expresses no preference.
 */
export const STORYTIME_DEFAULT_LANGUAGE_CODE = 'en-GB';
