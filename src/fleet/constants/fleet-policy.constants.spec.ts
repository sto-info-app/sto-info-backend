import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CHAT_MEMBER_HISTORY_HOURS,
  CHAT_TRANSCRIPT_HISTORY_DAYS,
  FLEET_CUSTOM_CHANNEL_LIMIT,
  MAX_FLEET_COMMUNITIES_PER_OWNER,
  PUBLISHED_CHAT_RETENTION_DAYS,
  PUBLISHED_IMPORT_SOURCE_RETENTION_DAYS,
} from './fleet-policy.constants';

/**
 * FC-006's second acceptance criterion: the defaults retain three channels per
 * level and the separate four-hour, seven-day, 45-day and 180-day policies.
 *
 * These are confirmed product requirements rather than engineering choices, and
 * the point of pinning them in a test is that changing one has to be
 * deliberate. A figure altered by accident — a refactor, a merge, a
 * well-meaning tidy-up — makes the privacy policy wrong, and nothing else in
 * the codebase would notice.
 */
describe('fleet policy constants', () => {
  it('keeps the four confirmed windows separate and distinct', () => {
    expect(CHAT_MEMBER_HISTORY_HOURS).toBe(4);
    expect(CHAT_TRANSCRIPT_HISTORY_DAYS).toBe(7);
    expect(PUBLISHED_CHAT_RETENTION_DAYS).toBe(45);
    expect(PUBLISHED_IMPORT_SOURCE_RETENTION_DAYS).toBe(180);
  });

  it('keeps three custom channels at each level', () => {
    expect(FLEET_CUSTOM_CHANNEL_LIMIT).toBe(3);
  });

  it('caps ownership at ten Fleet Communities', () => {
    expect(MAX_FLEET_COMMUNITIES_PER_OWNER).toBe(10);
  });

  /**
   * The limit exists twice: here, and in the trigger that enforces it. It has
   * to, because a count checked in a service is a read-then-write that two
   * concurrent creates both pass, and only the database can settle that.
   *
   * A duplicated figure is a figure that drifts, so the migration is read and
   * the number looked for in it. Raising the limit in one place and not the
   * other would otherwise produce a form that promises ten and a database that
   * refuses the eighth.
   */
  it('enforces the same limit in the migration that owns the trigger', () => {
    const migration = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        'database',
        'migrations',
        '1792800000000-LimitFleetCommunitiesPerOwner.ts',
      ),
      'utf8',
    );

    expect(migration).toContain(
      `IF live_count >= ${MAX_FLEET_COMMUNITIES_PER_OWNER} THEN`,
    );
    expect(migration).toContain(
      `a user may own at most ${MAX_FLEET_COMMUNITIES_PER_OWNER} live Fleet Communities`,
    );
  });

  /**
   * The windows nest: history is read within a transcript's reach, and a
   * transcript is exported from within what is still retained. Stated as a
   * relationship rather than as four independent numbers, because that is the
   * property `ConfigCheckService` enforces against a configured retention.
   */
  it('nests the access windows inside the retention period', () => {
    expect(CHAT_MEMBER_HISTORY_HOURS / 24).toBeLessThan(
      CHAT_TRANSCRIPT_HISTORY_DAYS,
    );
    expect(CHAT_TRANSCRIPT_HISTORY_DAYS).toBeLessThan(
      PUBLISHED_CHAT_RETENTION_DAYS,
    );
  });

  /**
   * The three fixed figures have no environment variable behind them, decided
   * with Steve on 17 September 2026 and recorded in ADR-0011. Nothing in R20 or
   * R22 describes them as configurable, and a published window an operator can
   * quietly widen is a policy statement that can stop being true without being
   * corrected.
   *
   * Asserted by reading the file rather than by trusting the values above: an
   * `process.env` added here later would still satisfy every other test in this
   * suite.
   */
  it('reads nothing from the environment', () => {
    const source = readFileSync(
      join(__dirname, 'fleet-policy.constants.ts'),
      'utf8',
    );

    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/ConfigService/);
  });
});
