/**
 * The hostnames a YouTube link may use.
 *
 * An exact allowlist, compared against the parsed URL's hostname rather than
 * matched anywhere in the string. That distinction is the whole defence: a
 * pattern searching for "youtu.be" inside a URL happily accepts
 * `https://youtu.be.attacker.net/xyz`, whereas an exact hostname comparison
 * cannot.
 *
 * Kept here as one list so accepting a new YouTube domain is a single edit
 * rather than a change to parser logic.
 */
export const YOUTUBE_HOSTNAMES: readonly string[] = [
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'youtu.be',
  'www.youtu.be',
];

/**
 * Path prefixes that carry the video ID as the following path segment.
 */
export const YOUTUBE_ID_PATH_PREFIXES: readonly string[] = [
  'embed',
  'shorts',
  'live',
  'v',
];

/**
 * A valid YouTube video ID.
 *
 * Exactly eleven characters from YouTube's alphabet. Validated so only an
 * identifier this application produced the shape of can ever be interpolated
 * into an embed URL.
 */
export const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/**
 * A valid YouTube playlist ID.
 */
export const YOUTUBE_PLAYLIST_ID_PATTERN = /^[A-Za-z0-9_-]{12,64}$/;

/**
 * A start offset expressed as a plain number of seconds.
 */
export const YOUTUBE_SECONDS_PATTERN = /^\d+$/;

/**
 * A start offset expressed in YouTube's `1h2m3s` shorthand.
 */
export const YOUTUBE_DURATION_PATTERN = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/;

/**
 * The host every embed is rendered through.
 *
 * The privacy-enhanced domain, which does not set tracking cookies until the
 * viewer plays the video.
 */
export const YOUTUBE_EMBED_HOST = 'https://www.youtube-nocookie.com';

/** The largest start or end offset accepted, guarding against absurd values. */
export const YOUTUBE_MAX_OFFSET_SECONDS = 86_400;
