import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

/**
 * Migrations that already ran in production and made ids from a hash. They
 * cannot change, so they are named here; a newer migration fixes what they
 * left behind.
 *
 * - `SeedStorytimeTags`: re-keyed by `RekeySeededStorytimeTags` (sc-1517).
 * - `RekeySeededStorytimeTags`: matches the seed's ids so it can re-key them.
 */
const KNOWN_HASHED_ID_MIGRATIONS = new Set([
  '1790000600000-SeedStorytimeTags.ts',
  '1799200000000-RekeySeededStorytimeTags.ts',
]);

/**
 * Ways of making a UUID that do not give a version 4 one. Every id the API
 * takes back is checked with `@IsUUID('4')` or `ParseUUIDPipe`, so a row
 * keyed any of these ways can be read but never sent back.
 */
const NON_VERSION_FOUR_SOURCES: Array<[string, RegExp]> = [
  ['a hash cast to uuid', /md5\s*\([^;]*?\)\s*::\s*uuid/i],
  ['uuid-ossp v1, v3 or v5', /uuid_generate_v[135]/i],
  ['a version 7 UUID', /uuidv7\s*\(/i],
  ['a hash cast to uuid', /CAST\s*\(\s*md5/i],
];

const MIGRATIONS = join(__dirname, '..');

/**
 * Guards against the sc-1517 bug coming back: the Storytime tag seed keyed
 * its rows with `md5(...)::uuid`, which no UUID validator accepts, so no
 * creator could save a seeded tag. A new migration that makes ids the same
 * way fails here instead of in production.
 */
describe('migration id sources', () => {
  const files = readdirSync(MIGRATIONS).filter(
    name => name.endsWith('.ts') && !name.endsWith('.spec.ts'),
  );

  it('finds the migrations', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it.each(files.filter(name => !KNOWN_HASHED_ID_MIGRATIONS.has(name)))(
    '%s makes every id it writes a version 4 UUID',
    name => {
      const source = readFileSync(join(MIGRATIONS, name), 'utf8');
      const found = NON_VERSION_FOUR_SOURCES.filter(([, pattern]) =>
        pattern.test(source),
      ).map(([description]) => description);

      expect(found).toEqual([]);
    },
  );
});
