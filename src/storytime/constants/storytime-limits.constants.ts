/**
 * A configurable ceiling on how much Storytime content a user may create.
 */
export interface StorytimeLimit {
  /** Configuration key, and the key an administrator grants an exemption against. */
  readonly key: string;
  /** Value used when configuration sets nothing usable. */
  readonly defaultValue: number;
}

/**
 * The limits Storytime enforces.
 *
 * Every one of these is resolved through `LimitService`, never read from
 * configuration directly, so an administrator's per-user exemption applies
 * wherever the limit is checked rather than only where somebody remembered to
 * look for one.
 *
 * The defaults are set to be generous for a real creator while still capping
 * automated abuse — the point is that hitting one should be a conversation,
 * not a wall.
 */
export const STORYTIME_LIMITS = {
  /** How many Stories one user may own. */
  MAX_STORIES_PER_USER: {
    key: 'STORYTIME_MAX_STORIES_PER_USER',
    defaultValue: 50,
  },
  /** How many Chapters one Story may contain. */
  MAX_CHAPTERS_PER_STORY: {
    key: 'STORYTIME_MAX_CHAPTERS_PER_STORY',
    defaultValue: 200,
  },
  /** How many Characters one Story may define. */
  MAX_CHARACTERS_PER_STORY: {
    key: 'STORYTIME_MAX_CHARACTERS_PER_STORY',
    defaultValue: 100,
  },
  /** How many characters of source text one Chapter body may hold. */
  MAX_CONTENT_LENGTH: {
    key: 'STORYTIME_MAX_CONTENT_LENGTH',
    defaultValue: 100_000,
  },
} as const satisfies Record<string, StorytimeLimit>;
