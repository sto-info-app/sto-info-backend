import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from '@jest/globals';

/**
 * Keeps Armadas out of the roster pipeline (FC-024).
 *
 * An STO roster export says nothing about Armadas — ADR-0004 — so no import
 * may place, move or take out a Fleet. Where a Fleet sits is entered by hand,
 * by a person holding `armada.manage`, and nothing read from a CSV may change
 * it, however a later change to the pipeline is written.
 *
 * The rule is kept by what the pipeline's code can name: none of it mentions
 * an Armada entity or table, so none of it can write one. A blunt check, and
 * deliberately so. If a stage of the pipeline ever needs to read an Armada,
 * the question to answer first is why, and the answer belongs in the plan
 * before it belongs on the list below.
 */

/** The Fleet folder, two levels up from `src/fleet/imports/__tests__`. */
const FLEET = join(__dirname, '..', '..');

/** Every stage a roster export passes through, from upload to projection. */
const PIPELINE = ['imports', 'identity', 'projection', 'roster'];

/** What code touching an Armada's shape would have to name. */
const ARMADA_NAMES = [
  'ArmadaFleetMembershipEntity',
  'ArmadaJoinRequestEntity',
  'ArmadaActionEntity',
  'StoArmadaEntity',
  'armada_fleet_membership',
  'armada_join_request',
  'armada_action',
  'sto_armada',
  '/armadas/',
];

/**
 * Lists every source file beneath a directory, specs and all.
 *
 * @param directory - Where to start.
 * @returns Absolute paths of every TypeScript file found.
 */
function sourcesUnder(directory: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      found.push(...sourcesUnder(path));
    } else if (entry.endsWith('.ts')) {
      found.push(path);
    }
  }

  return found;
}

describe('Roster import and Armada isolation', () => {
  const files = PIPELINE.flatMap(stage => sourcesUnder(join(FLEET, stage)));
  const offenders = files
    // This file names what it looks for.
    .filter(path => path !== __filename)
    .flatMap(path => {
      const contents = readFileSync(path, 'utf8');

      return ARMADA_NAMES.filter(name => contents.includes(name)).map(
        name => `${relative(FLEET, path).split(sep).join('/')}: ${name}`,
      );
    });

  it('names no Armada entity or table anywhere a roster export passes', () => {
    expect(offenders).toEqual([]);
  });

  it('still finds the pipeline, so the sweep is working', () => {
    // Without this, moving the folders would make the check above pass.
    expect(files.length).toBeGreaterThan(50);
    expect(
      files.some(path => path.endsWith('roster-import.publisher.ts')),
    ).toBe(true);
  });
});
