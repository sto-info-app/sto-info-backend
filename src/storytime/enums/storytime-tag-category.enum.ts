/**
 * The kinds of thing a tag can classify.
 *
 * A fixed list rather than free text, because a category is how tags are
 * grouped in every filter: one administrator typing "Faction" and another
 * "faction" would split the same shelf in two.
 *
 * Tags themselves are administrator-managed for the same reason. Primary
 * classification only works if everybody uses the same words, and a vocabulary
 * anybody can extend stops being a vocabulary.
 */
export enum StorytimeTagCategory {
  /** Starfleet, Klingon Empire, Romulan Republic, and so on. */
  FACTION = 'FACTION',
  /** When the Story is set. */
  ERA = 'ERA',
  /** Adventure, mystery, romance. */
  GENRE = 'GENRE',
  /** Light, grim, comic. */
  TONE = 'TONE',
  /** What the Story is about beneath its plot. */
  THEME = 'THEME',
  /** The species a Story or Character centres on. */
  SPECIES = 'SPECIES',
  /** What a reader may want warning about before starting. */
  CONTENT_WARNING = 'CONTENT_WARNING',
  /** Novella, one-shot, episodic. */
  FORMAT = 'FORMAT',
  /** Which continuity the Story treats as canon. */
  CONTINUITY = 'CONTINUITY',
}
