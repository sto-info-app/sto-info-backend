/**
 * The external services a Chapter may embed media from.
 *
 * Deliberately a closed list. Media is stored as a provider plus an identifier
 * and rendered by the application, never as creator-supplied embed markup.
 */
export enum MediaProvider {
  /** YouTube, rendered through the privacy-enhanced no-cookie host. */
  YOUTUBE = 'YOUTUBE',
}
