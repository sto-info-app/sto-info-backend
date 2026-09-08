/**
 * Who may reach a Story or Arc once it is published.
 *
 * Orthogonal to publication status: an unpublished Story is unreachable
 * whatever its visibility, and a published `PRIVATE` Story is readable only by
 * its owner and collaborators.
 */
export enum StorytimeVisibility {
  /** Listed in discovery and readable by anyone, including anonymously. */
  PUBLIC = 'PUBLIC',
  /** Readable by anyone holding the link, but excluded from discovery. */
  UNLISTED = 'UNLISTED',
  /** Readable only by the owner and accepted collaborators. */
  PRIVATE = 'PRIVATE',
}
