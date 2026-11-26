import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

const MIGRATIONS = join(__dirname, '..');

/** Exports that are functions at runtime: classes, functions and arrows. */
const EXPORTED_FUNCTION =
  /^export\s+(?:default\s+)?(?:abstract\s+)?(?:class|(?:async\s+)?function\*?)\s+(\w+)|^export\s+const\s+(\w+)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:\([^)]*\)|\w+)\s*=>/gm;

/**
 * TypeORM loads every exported function in a migration file and calls it
 * with `new` as if it were a migration. A helper exported next to the
 * migration class makes `migration:run` fail at boot (found while
 * rehearsing sc-1517). Constants are fine; only the class may be a
 * function. Put a shared helper in its own module outside this folder.
 */
describe('migration exports', () => {
  const files = readdirSync(MIGRATIONS).filter(
    name => name.endsWith('.ts') && !name.endsWith('.spec.ts'),
  );

  it('finds the migrations', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it.each(files)('%s exports exactly one function, its class', name => {
    const source = readFileSync(join(MIGRATIONS, name), 'utf8');
    const exported = [...source.matchAll(EXPORTED_FUNCTION)].map(
      match => match[1] ?? match[2],
    );

    expect(exported).toHaveLength(1);
    expect(source).toMatch(
      new RegExp(
        String.raw`export\s+class\s+${exported[0]}\s+implements\s+MigrationInterface`,
      ),
    );
  });
});
