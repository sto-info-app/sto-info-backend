import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SEEDED_TAG_ID_NAMESPACE } from '../../../database/migrations/1799200000000-RekeySeededStorytimeTags';

/**
 * The ids of the seeded Storytime tags, for specs. Not for runtime use: it
 * reads the seed migration's source.
 *
 * This lives outside the migrations folder on purpose. TypeORM loads every
 * exported function in a migration file as a migration, so a helper exported
 * from one breaks `migration:run`.
 */

/** One seeded tag's ids, before and after `RekeySeededStorytimeTags`. */
export interface SeededTagIds {
  slug: string;
  /** What `SeedStorytimeTags1790000600000` wrote: `md5(...)::uuid`. */
  seededId: string;
  /** What `RekeySeededStorytimeTags1799200000000` changes it to. */
  liveId: string;
}

/**
 * Turns a UUID into a version 4 UUID the way the re-key migration's SQL does:
 * version digit 4, and the top two bits of the variant digit set to 10.
 *
 * @param uuid - A UUID in canonical text form.
 * @returns The version 4 UUID.
 */
export function toVersionFourId(uuid: string): string {
  const text = uuid.toLowerCase();
  const variant = '89ab'[Number.parseInt(text[19], 16) & 3];

  return `${text.slice(0, 14)}4${text.slice(15, 19)}${variant}${text.slice(20)}`;
}

/**
 * The id the seed gave a tag, as PostgreSQL's `md5(...)::uuid` writes it.
 *
 * @param slug - The tag's slug.
 * @returns The id in canonical text form.
 */
export function seededTagId(slug: string): string {
  const hex = createHash('md5')
    .update(SEEDED_TAG_ID_NAMESPACE + slug)
    .digest('hex');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

/**
 * Every tag the seed inserts, read from its source so a tag added to the seed
 * cannot escape the specs.
 *
 * @returns Each seeded tag's slug and ids.
 */
export function seededTags(): SeededTagIds[] {
  const source = readFileSync(
    join(
      __dirname,
      '../../../database/migrations/1790000600000-SeedStorytimeTags.ts',
    ),
    'utf8',
  );

  return [...source.matchAll(/slug: '([^']+)'/g)].map(([, slug]) => {
    const seededId = seededTagId(slug);

    return { slug, seededId, liveId: toVersionFourId(seededId) };
  });
}
