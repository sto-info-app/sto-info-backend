/**
 * Support commands for the frontend's Playwright journeys.
 *
 * The journeys drive a real browser against a real backend, and almost
 * everything they need they can do the way a member would — sign in, build a
 * hierarchy, record answers, make things public. Three things they cannot:
 *
 *   - turn the feature flag on, because there is no screen for it;
 *   - make an accepted agreement look out of date, because the current version
 *     is a compile-time constant and cannot move while the app is running;
 *   - make a deletion look 180 days old, because waiting is not a test.
 *
 * Those need the database, and this is where that is allowed to happen. It
 * lives in the backend rather than the frontend so that it borrows the
 * backend's own connection and secrets: the E2E harness never needs database
 * credentials of its own, and there is no test-only route on the running
 * server for anybody to find.
 *
 * Where a command has a real service behind it — purging a member's data,
 * running the retention sweep — it calls that service rather than writing its
 * own SQL. A rehearsal of a job that is not the job proves nothing.
 *
 * Every command prints one line of JSON on stdout so the harness can read it.
 *
 * Usage: npm run e2e:support -- <command> [arguments]
 */

import { INestApplicationContext, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import { CustomTrackingCleanupService } from '../src/cron/jobs/custom-tracking-cleanup/custom-tracking-cleanup.service';
import { CustomTrackingImageCleanupService } from '../src/custom-tracking/retention/custom-tracking-image-cleanup.service';
import { CustomTrackingPurgeService } from '../src/custom-tracking/retention/custom-tracking-purge.service';

const SCHEMA = process.env.DB_SCHEMA ?? 'sto_info_app';

/** The tables a member's own tracking data lives in, deepest first. */
const OWNED_TABLES = [
  'custom_tracking_section',
  'custom_tracking_tab',
  'custom_tracking_field',
  'custom_tracking_option',
  'custom_tracking_value',
];

interface SupportContext {
  app: INestApplicationContext;
  dataSource: DataSource;
}

type SupportResult = Record<string, unknown>;

async function userIdFor(
  dataSource: DataSource,
  email: string,
): Promise<string> {
  const rows: { id: string }[] = await dataSource.query(
    `SELECT "id" FROM "${SCHEMA}"."user" WHERE lower("email") = lower($1)`,
    [email],
  );

  if (rows.length === 0) {
    throw new Error(`No account exists for ${email}.`);
  }

  return rows[0].id;
}

/**
 * Turn the feature on or off the way an operator would, by writing the setting
 * the application reads. Nothing else in the system knows how to do this, so a
 * journey that starts with the feature switched off would otherwise be stuck.
 */
async function setFlag(
  { dataSource }: SupportContext,
  state: string,
): Promise<SupportResult> {
  const value = state === 'on' ? 'true' : 'false';

  await dataSource.query(
    `UPDATE "${SCHEMA}"."app_setting" SET "value" = $1, "updatedAt" = now() WHERE "key" = 'CUSTOM_TRACKING_ENABLED'`,
    [value],
  );

  return { key: 'CUSTOM_TRACKING_ENABLED', value };
}

/**
 * Put a member back to never having used the feature.
 *
 * This is the same purge that runs when somebody closes their account, which
 * is the point: if it left something behind, a second run of the journeys
 * would trip over the leftovers and say so.
 */
async function reset(
  { app, dataSource }: SupportContext,
  email: string,
): Promise<SupportResult> {
  const userId = await userIdFor(dataSource, email);
  const purge = app.get(CustomTrackingPurgeService);
  const summary = await purge.purgeUsers([userId]);

  return { email, ...summary };
}

/**
 * Make the acceptance on file look like an older version of the agreement.
 *
 * The live version is a constant, so it cannot be moved forward while the app
 * is running; moving the acceptance backwards puts the member in exactly the
 * state a new version would, which is what the journey is about.
 */
async function staleAcceptance(
  { dataSource }: SupportContext,
  email: string,
): Promise<SupportResult> {
  const userId = await userIdFor(dataSource, email);

  const result: [unknown[], number] = await dataSource.query(
    `UPDATE "${SCHEMA}"."custom_tracking_policy_acceptance" SET "policyVersion" = '0.9' WHERE "userId" = $1 RETURNING "id"`,
    [userId],
  );

  return { email, rowsChanged: result[1] };
}

/**
 * Backdate everything this member has deleted, so the retention sweep sees it
 * as past its window.
 */
async function age(
  { dataSource }: SupportContext,
  email: string,
  days: string,
): Promise<SupportResult> {
  const userId = await userIdFor(dataSource, email);
  const interval = `${Number.parseInt(days, 10)} days`;
  const changed: Record<string, number> = {};

  for (const table of OWNED_TABLES) {
    const owner =
      table === 'custom_tracking_section'
        ? `"userId" = $1`
        : `"id" IN (${ownedIdsQuery(table)})`;

    const result: [unknown[], number] = await dataSource.query(
      `UPDATE "${SCHEMA}"."${table}" SET "deletedAt" = "deletedAt" - $2::interval WHERE "deletedAt" IS NOT NULL AND ${owner} RETURNING "id"`,
      [userId, interval],
    );

    changed[table] = result[1];
  }

  return { email, days: Number.parseInt(days, 10), changed };
}

/**
 * The join back to the owning member for tables that do not carry a userId of
 * their own. Written once here rather than five times, because five copies of
 * a join is five chances to get one of them wrong.
 */
function ownedIdsQuery(table: string): string {
  const joins: Record<string, string> = {
    custom_tracking_tab: `SELECT t."id" FROM "${SCHEMA}"."custom_tracking_tab" t JOIN "${SCHEMA}"."custom_tracking_section" s ON s."id" = t."sectionId" WHERE s."userId" = $1`,
    custom_tracking_field: `SELECT f."id" FROM "${SCHEMA}"."custom_tracking_field" f JOIN "${SCHEMA}"."custom_tracking_tab" t ON t."id" = f."tabId" JOIN "${SCHEMA}"."custom_tracking_section" s ON s."id" = t."sectionId" WHERE s."userId" = $1`,
    custom_tracking_option: `SELECT o."id" FROM "${SCHEMA}"."custom_tracking_option" o JOIN "${SCHEMA}"."custom_tracking_field" f ON f."id" = o."fieldId" JOIN "${SCHEMA}"."custom_tracking_tab" t ON t."id" = f."tabId" JOIN "${SCHEMA}"."custom_tracking_section" s ON s."id" = t."sectionId" WHERE s."userId" = $1`,
    custom_tracking_value: `SELECT v."id" FROM "${SCHEMA}"."custom_tracking_value" v JOIN "${SCHEMA}"."custom_tracking_field" f ON f."id" = v."fieldId" JOIN "${SCHEMA}"."custom_tracking_tab" t ON t."id" = f."tabId" JOIN "${SCHEMA}"."custom_tracking_section" s ON s."id" = t."sectionId" WHERE s."userId" = $1`,
  };

  return joins[table];
}

/**
 * Disable or re-enable an account.
 *
 * The moderation routes that normally do this need an administrator signed in,
 * and the journey is about what happens to published content afterwards rather
 * than about who pressed the button.
 */
async function disabled(
  { dataSource }: SupportContext,
  email: string,
  state: string,
): Promise<SupportResult> {
  const userId = await userIdFor(dataSource, email);
  const isDisabled = state === 'on';

  await dataSource.query(
    `UPDATE "${SCHEMA}"."user" SET "isAccountDisabled" = $2, "disabledAt" = CASE WHEN $2 THEN now() ELSE NULL END, "disabledReason" = CASE WHEN $2 THEN 'End-to-end journey' ELSE NULL END WHERE "id" = $1`,
    [userId, isDisabled],
  );

  return { email, isAccountDisabled: isDisabled };
}

/** Run the nightly retention job now, exactly as the cron pipeline runs it. */
async function cleanup({ app }: SupportContext): Promise<SupportResult> {
  await app.get(CustomTrackingCleanupService).cleanup();

  return { ran: 'custom-tracking-cleanup' };
}

/**
 * What the member still has, live and deleted, plus anything waiting to be
 * deleted from Cloudflare. This is how a journey checks that a sweep removed
 * what it should and kept what it should.
 */
async function counts(
  { dataSource }: SupportContext,
  email: string,
): Promise<SupportResult> {
  const userId = await userIdFor(dataSource, email);
  const live: Record<string, number> = {};
  const deleted: Record<string, number> = {};

  for (const table of OWNED_TABLES) {
    const owner =
      table === 'custom_tracking_section'
        ? `"userId" = $1`
        : `"id" IN (${ownedIdsQuery(table)})`;

    const rows: { live: string; deleted: string }[] = await dataSource.query(
      `SELECT count(*) FILTER (WHERE "deletedAt" IS NULL) AS live, count(*) FILTER (WHERE "deletedAt" IS NOT NULL) AS deleted FROM "${SCHEMA}"."${table}" WHERE ${owner}`,
      [userId],
    );

    live[table] = Number.parseInt(rows[0].live, 10);
    deleted[table] = Number.parseInt(rows[0].deleted, 10);
  }

  const queue: { count: string }[] = await dataSource.query(
    `SELECT count(*) AS count FROM "${SCHEMA}"."custom_tracking_image_cleanup"`,
  );

  return {
    email,
    live,
    deleted,
    imageCleanupQueue: Number.parseInt(queue[0].count, 10),
  };
}

/**
 * Switch the feature on and put this member back to never having used it.
 *
 * The two halves are one command because starting the application costs more
 * than either of them does, and the harness runs both at once every time.
 */
async function begin(
  context: SupportContext,
  email: string,
): Promise<SupportResult> {
  await setFlag(context, 'on');

  return { began: await reset(context, email) };
}

/**
 * Undo `begin`: clear what the journeys built, then switch the feature off.
 *
 * The purge queues the member's pictures for deletion rather than deleting
 * them, because in production the nightly reconciliation pass is what empties
 * that queue. Nothing runs nightly during a test run, so the pass is run here
 * too — otherwise every run would leave a handful of pictures in Cloudflare
 * that nothing in the database mentions any more.
 */
async function finish(
  context: SupportContext,
  email: string,
): Promise<SupportResult> {
  const cleared = await reset(context, email);
  const pictures = await context.app
    .get(CustomTrackingImageCleanupService)
    .reconcile();

  await setFlag(context, 'off');

  return { finished: cleared, pictures };
}

const COMMANDS: Record<
  string,
  (context: SupportContext, ...args: string[]) => Promise<SupportResult>
> = {
  flag: setFlag,
  reset,
  begin,
  finish,
  'stale-acceptance': staleAcceptance,
  age,
  disabled,
  cleanup,
  counts,
};

async function main(): Promise<void> {
  const [name, ...args] = process.argv.slice(2);
  const command = COMMANDS[name];

  if (!command) {
    throw new Error(
      `Unknown command "${name}". Try one of: ${Object.keys(COMMANDS).join(', ')}.`,
    );
  }

  // The journeys read stdout, so the application's own start-up chatter has to
  // stay off it.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  Logger.overrideLogger(false);

  try {
    const result = await command(
      { app, dataSource: app.get(DataSource) },
      ...args,
    );

    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await app.close();
  }
}

void main().catch((error: Error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
