/**
 * A Crew role as seeded into the lookup table.
 */
export interface StorytimeCrewRoleSeed {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly displayOrder: number;
}

/**
 * The Crew roles the site ships with.
 *
 * A lookup table rather than an enum, because these are a taxonomy an
 * administrator may extend — a community that starts producing audio drama
 * will want roles nobody thought of here. The seeded ones are marked
 * `isSystem` so they cannot be deleted out from under existing credits.
 *
 * Ordered as a credits roll reads: the people who wrote it, then the people
 * who directed and performed it, then the people who made it look and sound
 * like something, then everybody else.
 */
export const STORYTIME_CREW_ROLES: readonly StorytimeCrewRoleSeed[] = [
  {
    code: 'AUTHOR',
    name: 'Author',
    description: 'Wrote the Story.',
    displayOrder: 1000,
  },
  {
    code: 'CO_AUTHOR',
    name: 'Co-author',
    description: 'Wrote the Story alongside the author.',
    displayOrder: 2000,
  },
  {
    code: 'WRITER',
    name: 'Writer',
    description: 'Wrote part of the Story, such as a single Chapter.',
    displayOrder: 3000,
  },
  {
    code: 'EDITOR',
    name: 'Editor',
    description: 'Edited the writing.',
    displayOrder: 4000,
  },
  {
    code: 'DIRECTOR',
    name: 'Director',
    description: 'Directed the production.',
    displayOrder: 5000,
  },
  {
    code: 'PRODUCER',
    name: 'Producer',
    description: 'Produced the Story.',
    displayOrder: 6000,
  },
  {
    code: 'NARRATOR',
    name: 'Narrator',
    description: 'Narrated the Story.',
    displayOrder: 7000,
  },
  {
    code: 'VOICE_ACTOR',
    name: 'Voice actor',
    description: 'Voiced a Character.',
    displayOrder: 8000,
  },
  {
    code: 'PERFORMER',
    name: 'Performer',
    description: 'Performed on screen or in capture.',
    displayOrder: 9000,
  },
  {
    code: 'LIKENESS',
    name: 'Likeness',
    description: 'Their captain or character provided a Character’s likeness.',
    displayOrder: 10000,
  },
  {
    code: 'ARTIST',
    name: 'Artist',
    description: 'Created artwork.',
    displayOrder: 11000,
  },
  {
    code: 'VIDEO_EDITOR',
    name: 'Video editor',
    description: 'Edited video.',
    displayOrder: 12000,
  },
  {
    code: 'GAMEPLAY_CAPTURE',
    name: 'Gameplay capture',
    description: 'Captured gameplay footage.',
    displayOrder: 13000,
  },
  {
    code: 'COMPOSER',
    name: 'Composer',
    description: 'Composed music.',
    displayOrder: 14000,
  },
  {
    code: 'SOUND_EDITOR',
    name: 'Sound editor',
    description: 'Edited or mixed sound.',
    displayOrder: 15000,
  },
  {
    code: 'CONSULTANT',
    name: 'Consultant',
    description: 'Advised on the Story.',
    displayOrder: 16000,
  },
  {
    code: 'OTHER',
    name: 'Other',
    description: 'A contribution the other roles do not cover.',
    displayOrder: 17000,
  },
] as const;
