import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from '@jest/globals';

/**
 * Keeps the officer canary inside the places that are allowed to know it
 * (FC-009).
 *
 * `officer-canary-sinks.spec.ts` proves that today's ingress leaks nothing.
 * This proves that nobody has since written the token anywhere it does not
 * belong — a debug log left in, an error message quoting a row, a fixture
 * copied into a snapshot, a value pasted into documentation while working out
 * why something failed.
 *
 * It is a blunt instrument and that is the point. The token is synthetic and
 * it appears in exactly six files, all of which exist to generate, describe or
 * hunt for it. Anywhere else, it is a leak, and in production the thing in
 * that position would be a real note an officer wrote about a named player.
 *
 * Adding a path to the allowlist is a decision, not a fix. If a new file needs
 * to name the token, the question to answer first is why.
 */

/** Assembled so this file does not match its own search. */
const CANARY = ['OFFICER', 'CANARY'].join('-');

/** The repository root, four levels up from `src/fleet/imports/__tests__`. */
const ROOT = join(__dirname, '..', '..', '..', '..');

/** Where the sweep looks: everything that ships or describes what ships. */
const SEARCHED = ['src', 'scripts', 'docs', 'config', 'test'];

/** Directories never worth walking. */
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'coverage',
  'reports',
  '.git',
  '.stryker-tmp',
]);

/**
 * The only files allowed to hold the token, and why.
 *
 * Paths are repository-relative and use forward slashes. A directory entry
 * covers everything beneath it.
 */
const ALLOWED = [
  // The fixtures themselves. This is where the token lives.
  'test/fixtures/fleet-community/',
  // FC-001's inventory check, which asserts the fixtures still carry it.
  'test/fleet-community-fixtures.spec.ts',
  // The generator that writes the fixtures.
  'scripts/fleet-corpus/fixture-definitions.ts',
  'scripts/generate-fleet-corpus-fixtures.ts',
  // FC-009's two sweeps: the one that drives the ingress, and this one.
  'src/fleet/imports/__tests__/officer-canary-sinks.spec.ts',
  'src/fleet/imports/__tests__/officer-canary-containment.spec.ts',
];

/**
 * Lists every file beneath a directory.
 *
 * @param directory - Where to start.
 * @returns Absolute paths of every file found.
 */
function filesUnder(directory: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(directory)) {
    if (SKIPPED_DIRECTORIES.has(entry)) {
      continue;
    }

    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      found.push(...filesUnder(path));
      continue;
    }

    found.push(path);
  }

  return found;
}

/**
 * Reports whether a file is one of the few allowed to name the token.
 *
 * @param repositoryPath - The file's repository-relative path, with forward
 *   slashes.
 * @returns True when the file is on the allowlist.
 */
function isAllowed(repositoryPath: string): boolean {
  return ALLOWED.some(allowed =>
    allowed.endsWith('/')
      ? repositoryPath.startsWith(allowed)
      : repositoryPath === allowed,
  );
}

describe('Officer canary containment', () => {
  const offenders: string[] = [];
  const allowedHits: string[] = [];

  for (const directory of SEARCHED) {
    for (const path of filesUnder(join(ROOT, directory))) {
      const repositoryPath = relative(ROOT, path).split(sep).join('/');

      let contents: string;

      try {
        contents = readFileSync(path, 'utf8');
      } catch {
        // A file that cannot be read as text cannot hold the token either.
        continue;
      }

      if (!contents.includes(CANARY)) {
        continue;
      }

      if (isAllowed(repositoryPath)) {
        allowedHits.push(repositoryPath);
        continue;
      }

      offenders.push(repositoryPath);
    }
  }

  it('finds the token nowhere outside the files that are meant to hold it', () => {
    expect(offenders).toEqual([]);
  });

  it('still finds it in the fixtures, so the sweep is working', () => {
    // Without this, deleting every fixture would make the check above pass.
    expect(allowedHits.length).toBeGreaterThanOrEqual(4);
  });
});
