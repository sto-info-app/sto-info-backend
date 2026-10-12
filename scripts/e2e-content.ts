/**
 * News, Storytime and account fixtures for the frequent end-to-end cases.
 *
 * The cases read and edit through the browser. What they cannot do there is
 * create a published post or a published Story without an administrator
 * walking the forms, switch Storytime on, or put a permission back after a
 * case has taken it away. Those go through the same services the application
 * uses, so a case that passes is the real publish path and not a row inserted
 * beside it.
 *
 * Notes travel as base64url because a demonstration note contains spaces and
 * the command line would otherwise split it. `--null--` and `--empty--` are
 * the two values that are not a note.
 */

import { randomUUID } from 'node:crypto';

import { INestApplicationContext } from '@nestjs/common';

import { DataSource } from 'typeorm';

import { PERMISSION_CODES } from '../src/access-control/constants/permission-codes.constants';
import { NewsCategory } from '../src/news/enums/news-category.enum';
import { NewsStatus } from '../src/news/enums/news-status.enum';
import { NewsService } from '../src/news/news.service';
import { AccountService } from '../src/sto/account/account.service';
import { StorytimeArcService } from '../src/storytime/arcs/storytime-arc.service';
import { StorytimeChapterService } from '../src/storytime/chapters/storytime-chapter.service';
import { StorytimeVisibility } from '../src/storytime/enums/storytime-visibility.enum';
import { StorytimeStoryService } from '../src/storytime/stories/storytime-story.service';
import { FIXTURE_ACTORS } from './e2e-actors';

const SCHEMA = process.env.DB_SCHEMA ?? 'sto_info_app';
const STORYTIME_KEY = 'STORYTIME_ENABLED';
const CREATE_PERMISSION = PERMISSION_CODES.STORYTIME_STORY_CREATE;

interface ContentContext {
  app: INestApplicationContext;
  dataSource: DataSource;
}

interface AccountRow {
  id: string;
  handle: string;
  handleSlug: string;
  notes: string | null;
  publiclyVisible: boolean;
}

interface CharacterRow {
  id: string;
  accountId: string;
  handle: string;
  slug: string;
  publiclyVisible: boolean;
  notes: string | null;
}

/** A member's accounts and captains, plus one public and one private profile. */
export async function snapshot(
  { dataSource }: ContentContext,
  email: string,
): Promise<object> {
  const userId = await userIdFor(dataSource, email);
  const accounts = (await dataSource.query(
    `
      SELECT "id", "handle", "handleSlug", "notes", "publiclyVisible"
      FROM "${SCHEMA}"."account"
      WHERE "userId" = $1
        AND "deletedAt" IS NULL
      ORDER BY "handle"
    `,
    [userId],
  )) as AccountRow[];
  const accountIds = accounts.map(account => account.id);
  const characters =
    accountIds.length === 0
      ? []
      : ((await dataSource.query(
          `
            SELECT "id", "accountId", "handle", "fullHandleSlug" AS slug,
                   "publiclyVisible", "notes"
            FROM "${SCHEMA}"."character"
            WHERE "accountId" = ANY($1::uuid[])
              AND "deletedAt" IS NULL
            ORDER BY "handle"
          `,
          [accountIds],
        )) as CharacterRow[]);
  const profiles = (await dataSource.query(
    `
      SELECT "username", "publiclyVisible"
      FROM "${SCHEMA}"."user_profile"
      WHERE "username" LIKE 'demo-user-%'
        AND "deletedAt" IS NULL
      ORDER BY "username"
    `,
  )) as Array<{ username: string; publiclyVisible: boolean }>;
  const publicProfile = profiles.find(profile => profile.publiclyVisible);
  const privateProfile = profiles.find(profile => !profile.publiclyVisible);

  if (!publicProfile || !privateProfile) {
    throw new Error(
      'The demonstration seed has no public and private profile to search.',
    );
  }

  return {
    email,
    publicUsername: publicProfile.username,
    privateUsername: privateProfile.username,
    accounts: accounts.map(account => ({
      ...account,
      characters: characters.filter(
        character => character.accountId === account.id,
      ),
    })),
  };
}

/**
 * Replace one account's notes.
 *
 * @returns The notes that were there before, so a case can put them back.
 */
export async function setAccountNote(
  { dataSource }: ContentContext,
  email: string,
  handleSlug: string,
  encodedNote: string,
): Promise<object> {
  const userId = await userIdFor(dataSource, email);
  const previous = await accountNotes(dataSource, userId, handleSlug);

  await dataSource.query(
    `
      UPDATE "${SCHEMA}"."account"
      SET "notes" = $3,
          "updatedAt" = now()
      WHERE "userId" = $1
        AND "handleSlug" = $2
        AND "deletedAt" IS NULL
    `,
    [userId, handleSlug, decodeNote(encodedNote)],
  );

  return { previous };
}

/**
 * Put two accounts' publication flags, and one account's notes, back.
 *
 * One command because each boot of the support process costs more than the
 * updates, and a failing case has to undo all three.
 */
export async function restoreAccounts(
  { dataSource }: ContentContext,
  email: string,
  publicSlug: string,
  publicState: string,
  privateSlug: string,
  privateState: string,
  noteSlug: string,
  encodedNote: string,
): Promise<object> {
  const userId = await userIdFor(dataSource, email);

  await setPublication(dataSource, userId, publicSlug, publicState);
  await setPublication(dataSource, userId, privateSlug, privateState);
  await dataSource.query(
    `
      UPDATE "${SCHEMA}"."account"
      SET "notes" = $3,
          "updatedAt" = now()
      WHERE "userId" = $1
        AND "handleSlug" = $2
        AND "deletedAt" IS NULL
    `,
    [userId, noteSlug, decodeNote(encodedNote)],
  );

  return { restored: true };
}

/** Soft-delete one account of this member, if the case created it. */
export async function discardAccount(
  { app, dataSource }: ContentContext,
  email: string,
  handle: string,
): Promise<object> {
  const userId = await userIdFor(dataSource, email);
  const rows = (await dataSource.query(
    `
      SELECT "id"
      FROM "${SCHEMA}"."account"
      WHERE "userId" = $1
        AND ("handle" = $2 OR "handleSlug" = $2)
        AND "deletedAt" IS NULL
      LIMIT 1
    `,
    [userId, handle],
  )) as Array<{ id: string }>;

  if (!rows[0]) {
    return { discarded: false, handle };
  }

  await app.get(AccountService).removeForUser(rows[0].id, userId);

  return { discarded: true, handle };
}

/** Publish one bulletin and leave a draft that the public site must not show. */
export async function seedNews({
  app,
  dataSource,
}: ContentContext): Promise<object> {
  const news = app.get(NewsService);
  const authorId = await userIdFor(dataSource, fixtureEmail('ADM'));

  await clearNews(news, dataSource);

  const stamp = Date.now().toString(36);
  const publishedTitle = `E2E Published Bulletin ${stamp}`;
  const draftTitle = `E2E Draft Bulletin ${stamp}`;
  const draftSecret = `e2e-draft-secret-${stamp}`;
  const published = await news.create(
    {
      title: publishedTitle,
      slug: `e2e-published-${stamp}`,
      summary: 'A bulletin published for the frequent suite.',
      body: 'The published bulletin body.',
      category: NewsCategory.GENERAL,
      status: NewsStatus.PUBLISHED,
    },
    authorId,
  );
  const draft = await news.create(
    {
      title: draftTitle,
      slug: `e2e-draft-${stamp}`,
      summary: 'This draft summary must not be public.',
      body: draftSecret,
      category: NewsCategory.GENERAL,
      status: NewsStatus.DRAFT,
    },
    authorId,
  );

  return {
    publishedTitle: published.title,
    publishedSlug: published.slug,
    draftTitle: draft.title,
    draftSlug: draft.slug,
    draftSecret,
  };
}

/** Remove the bulletins the frequent suite published. */
export async function clearNewsCommand({
  app,
  dataSource,
}: ContentContext): Promise<object> {
  const removed = await clearNews(app.get(NewsService), dataSource);

  return { removed };
}

/** Switch Storytime off. The running server notices within its setting cache. */
export async function storytimeOff({
  dataSource,
}: ContentContext): Promise<object> {
  return setStorytime(dataSource, false);
}

/** Switch Storytime on, without publishing a voyage. */
export async function storytimeOn({
  dataSource,
}: ContentContext): Promise<object> {
  return setStorytime(dataSource, true);
}

/**
 * The name and registry flag stored for one member.
 *
 * The personal-details form only accepts an alphanumeric username, and the
 * fixture accounts were created with hyphens, so that form cannot save them.
 * Cases that need the flag, or a username the form will accept, change it
 * here and put the stored values back afterwards.
 */
export async function readProfileIdentity(
  dataSource: DataSource,
  email: string,
): Promise<{
  username: string;
  firstName: string | null;
  publiclyVisible: boolean;
}> {
  const userId = await userIdFor(dataSource, email);
  const rows = (await dataSource.query(
    `
      SELECT "username", "firstName", "publiclyVisible"
      FROM "${SCHEMA}"."user_profile"
      WHERE "userId" = $1
        AND "deletedAt" IS NULL
      LIMIT 1
    `,
    [userId],
  )) as Array<{
    username: string;
    firstName: string | null;
    publiclyVisible: boolean;
  }>;

  if (!rows[0]) {
    throw new Error(`No profile for ${email}.`);
  }

  return rows[0];
}

/**
 * Replace the username, first name and registry flag for one member.
 *
 * @param dataSource - The application database.
 * @param email - The member whose profile is changed.
 * @param username - The public username to store. Letters, digits, and . _ -
 * @param firstName - The first name to store, or null to clear it.
 * @param state - `public` lists them in the registry. `private` does not.
 */
export async function writeProfileIdentity(
  dataSource: DataSource,
  email: string,
  username: string,
  firstName: string | null,
  state: string,
): Promise<{ username: string; publiclyVisible: boolean }> {
  if (!/^[A-Za-z0-9._-]{1,50}$/.test(username)) {
    throw new Error(
      `Username "${username}" is not one this command will write.`,
    );
  }

  if (state !== 'public' && state !== 'private') {
    throw new Error(`Publication "${state}" must be public or private.`);
  }

  const userId = await userIdFor(dataSource, email);
  const taken = (await dataSource.query(
    `
      SELECT "userId"
      FROM "${SCHEMA}"."user_profile"
      WHERE lower("username") = lower($1)
        AND "userId" <> $2
        AND "deletedAt" IS NULL
      LIMIT 1
    `,
    [username, userId],
  )) as Array<{ userId: string }>;

  if (taken[0]) {
    throw new Error(`Username ${username} already belongs to somebody else.`);
  }

  await dataSource.query(
    `
      UPDATE "${SCHEMA}"."user_profile"
      SET "username" = $2,
          "firstName" = $3,
          "publiclyVisible" = $4,
          "updatedAt" = now()
      WHERE "userId" = $1
        AND "deletedAt" IS NULL
    `,
    [userId, username, firstName, state === 'public'],
  );

  const written = await readProfileIdentity(dataSource, email);

  if (
    written.username !== username ||
    written.publiclyVisible !== (state === 'public')
  ) {
    throw new Error(`Profile for ${email} was not updated.`);
  }

  return {
    username: written.username,
    publiclyVisible: written.publiclyVisible,
  };
}

/**
 * Remove stories and arcs whose titles were created by the weekly cases.
 *
 * The prefix is the only thing those cases are allowed to leave behind.
 */
export async function discardWeeklyStories(
  context: ContentContext,
  ownerEmail: string,
): Promise<object> {
  const ownerId = await userIdFor(context.dataSource, ownerEmail);
  const stories = await removeOwned(context, ownerId, 'storytime_story', id =>
    context.app.get(StorytimeStoryService).remove(id, ownerId),
  );
  const arcs = await removeOwned(context, ownerId, 'storytime_arc', id =>
    context.app.get(StorytimeArcService).remove(id, ownerId),
  );

  return { stories, arcs };
}

/**
 * Switch Storytime on, publish a voyage with two chapters, leave a draft,
 * and take creator permission away from one fixture actor.
 */
export async function storytimeBegin(
  context: ContentContext,
  ownerEmail: string,
  readerEmail: string,
): Promise<object> {
  await setStorytime(context.dataSource, true);
  await setCreatorPermission(context.dataSource, readerEmail, 'deny');

  const seeded = await seedStories(context, ownerEmail);

  return seeded;
}

/** Remove the voyage, give creator permission back, and switch Storytime off. */
export async function storytimeFinish(
  context: ContentContext,
  ownerEmail: string,
  readerEmail: string,
): Promise<object> {
  await clearStories(context, ownerEmail);
  await setCreatorPermission(context.dataSource, readerEmail, 'allow');
  await setStorytime(context.dataSource, false);

  return { finished: true };
}

async function seedStories(
  { app, dataSource }: ContentContext,
  ownerEmail: string,
): Promise<object> {
  const ownerId = await userIdFor(dataSource, ownerEmail);
  const stories = app.get(StorytimeStoryService);
  const chapters = app.get(StorytimeChapterService);

  await clearStories({ app, dataSource }, ownerEmail);

  const stamp = Date.now().toString(36);
  const draftSecret = `e2e-story-secret-${stamp}`;
  const story = await stories.create(
    {
      title: `E2E Published Voyage ${stamp}`,
      slug: `e2e-voyage-${stamp}`,
      shortDescription: 'A voyage published for the frequent suite.',
      description: 'The published voyage.',
      visibility: StorytimeVisibility.PUBLIC,
    },
    ownerId,
  );
  const opening = await publishChapter(
    chapters,
    story.id,
    ownerId,
    `E2E Opening ${stamp}`,
    `e2e-opening-${stamp}`,
    'The opening page of the published voyage.',
  );
  const continuing = await publishChapter(
    chapters,
    story.id,
    ownerId,
    `E2E Continuing ${stamp}`,
    `e2e-continuing-${stamp}`,
    'The voyage continues on this page.',
  );

  await stories.acceptContentPolicy(story.id, ownerId);
  const published = await stories.publish(story.id, ownerId);
  const draft = await stories.create(
    {
      title: `E2E Hidden Draft ${stamp}`,
      slug: `e2e-draft-voyage-${stamp}`,
      description: draftSecret,
      visibility: StorytimeVisibility.PRIVATE,
    },
    ownerId,
  );

  return {
    publishedTitle: published.title,
    publishedSlug: published.slug,
    openingTitle: opening.title,
    openingSlug: opening.slug,
    continuingTitle: continuing.title,
    continuingSlug: continuing.slug,
    draftTitle: draft.title,
    draftSlug: draft.slug,
    draftSecret,
  };
}

async function publishChapter(
  chapters: StorytimeChapterService,
  storyId: string,
  ownerId: string,
  title: string,
  slug: string,
  contentSource: string,
): Promise<{ title: string; slug: string }> {
  const created = await chapters.create(
    storyId,
    { title, slug, contentSource },
    ownerId,
  );

  const published = await chapters.publish(created.id, ownerId);

  return { title: published.title, slug: published.slug };
}

async function removeOwned(
  { dataSource }: ContentContext,
  ownerId: string,
  table: 'storytime_story' | 'storytime_arc',
  remove: (id: string) => Promise<void>,
): Promise<number> {
  const rows = (await dataSource.query(
    `
      SELECT "id"
      FROM "${SCHEMA}"."${table}"
      WHERE "ownerUserId" = $1
        AND "deletedAt" IS NULL
        AND "title" LIKE 'E2E Weekly%'
    `,
    [ownerId],
  )) as Array<{ id: string }>;

  for (const row of rows) {
    await remove(row.id);
  }

  return rows.length;
}

async function clearStories(
  { app, dataSource }: ContentContext,
  ownerEmail: string,
): Promise<void> {
  const ownerId = await userIdFor(dataSource, ownerEmail);
  const rows = (await dataSource.query(
    `
      SELECT "id"
      FROM "${SCHEMA}"."storytime_story"
      WHERE "ownerUserId" = $1
        AND "deletedAt" IS NULL
        AND (
          "title" LIKE 'E2E Published Voyage%'
          OR "title" LIKE 'E2E Hidden Draft%'
        )
    `,
    [ownerId],
  )) as Array<{ id: string }>;
  const stories = app.get(StorytimeStoryService);

  for (const row of rows) {
    await stories.remove(row.id, ownerId);
  }
}

async function clearNews(
  news: NewsService,
  dataSource: DataSource,
): Promise<number> {
  const rows = (await dataSource.query(
    `
      SELECT "id"
      FROM "${SCHEMA}"."news_post"
      WHERE "deletedAt" IS NULL
        AND (
          "title" LIKE 'E2E Published Bulletin%'
          OR "title" LIKE 'E2E Draft Bulletin%'
        )
    `,
  )) as Array<{ id: string }>;

  for (const row of rows) {
    await news.remove(row.id);
  }

  return rows.length;
}

async function setStorytime(
  dataSource: DataSource,
  enabled: boolean,
): Promise<object> {
  const value = enabled ? 'true' : 'false';

  await dataSource.query(
    `
      UPDATE "${SCHEMA}"."app_setting"
      SET "value" = $1,
          "updatedAt" = now()
      WHERE "key" = $2
    `,
    [value, STORYTIME_KEY],
  );

  const rows = (await dataSource.query(
    `SELECT "value" FROM "${SCHEMA}"."app_setting" WHERE "key" = $1`,
    [STORYTIME_KEY],
  )) as Array<{ value: string }>;

  if (rows[0]?.value !== value) {
    throw new Error(`${STORYTIME_KEY} is not ${value}.`);
  }

  return { key: STORYTIME_KEY, value };
}

async function setCreatorPermission(
  dataSource: DataSource,
  email: string,
  effect: 'deny' | 'allow',
): Promise<void> {
  const actor = FIXTURE_ACTORS.find(candidate => candidate.email === email);

  if (!actor) {
    throw new Error(
      `Refusing to change creator permission for ${email}. Only a fixture actor is accepted.`,
    );
  }

  const userId = await userIdFor(dataSource, email);
  const granterId = await userIdFor(dataSource, fixtureEmail('ADM'));
  const permissions = (await dataSource.query(
    `SELECT "id" FROM "${SCHEMA}"."permission" WHERE "code" = $1 LIMIT 1`,
    [CREATE_PERMISSION],
  )) as Array<{ id: string }>;

  if (!permissions[0]) {
    throw new Error(`Permission ${CREATE_PERMISSION} is not seeded.`);
  }

  await dataSource.query(
    `
      UPDATE "${SCHEMA}"."user_permission_override"
      SET "deletedAt" = now(),
          "updatedAt" = now()
      WHERE "userId" = $1
        AND "permissionId" = $2
        AND "deletedAt" IS NULL
    `,
    [userId, permissions[0].id],
  );

  if (effect === 'allow') {
    return;
  }

  await dataSource.query(
    `
      INSERT INTO "${SCHEMA}"."user_permission_override"
        ("id", "userId", "permissionId", "effect", "reason", "grantedByUserId", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, 'DENY', 'End-to-end missing creator permission', $4, now(), now())
    `,
    [randomUUID(), userId, permissions[0].id, granterId],
  );
}

async function setPublication(
  dataSource: DataSource,
  userId: string,
  handleSlug: string,
  state: string,
): Promise<void> {
  if (state !== 'public' && state !== 'private') {
    throw new Error(`Publication "${state}" must be public or private.`);
  }

  await dataSource.query(
    `
      UPDATE "${SCHEMA}"."account"
      SET "publiclyVisible" = $3,
          "updatedAt" = now()
      WHERE "userId" = $1
        AND "handleSlug" = $2
        AND "deletedAt" IS NULL
    `,
    [userId, handleSlug, state === 'public'],
  );

  const rows = (await dataSource.query(
    `
      SELECT "publiclyVisible"
      FROM "${SCHEMA}"."account"
      WHERE "userId" = $1
        AND "handleSlug" = $2
        AND "deletedAt" IS NULL
      LIMIT 1
    `,
    [userId, handleSlug],
  )) as Array<{ publiclyVisible: boolean }>;

  if (rows[0]?.publiclyVisible !== (state === 'public')) {
    throw new Error(`No account ${handleSlug} to update.`);
  }
}

async function accountNotes(
  dataSource: DataSource,
  userId: string,
  handleSlug: string,
): Promise<string | null> {
  const rows = (await dataSource.query(
    `
      SELECT "notes"
      FROM "${SCHEMA}"."account"
      WHERE "userId" = $1
        AND "handleSlug" = $2
        AND "deletedAt" IS NULL
      LIMIT 1
    `,
    [userId, handleSlug],
  )) as Array<{ notes: string | null }>;

  if (!rows[0]) {
    throw new Error(`No account ${handleSlug} for that member.`);
  }

  return rows[0].notes;
}

async function userIdFor(
  dataSource: DataSource,
  email: string,
): Promise<string> {
  const rows = (await dataSource.query(
    `
      SELECT "id"
      FROM "${SCHEMA}"."user"
      WHERE lower("email") = lower($1)
        AND "deletedAt" IS NULL
      LIMIT 1
    `,
    [email],
  )) as Array<{ id: string }>;

  if (!rows[0]) {
    throw new Error(`No user for ${email}.`);
  }

  return rows[0].id;
}

function fixtureEmail(code: string): string {
  const actor = FIXTURE_ACTORS.find(candidate => candidate.code === code);

  if (!actor) {
    throw new Error(`Fixture actor ${code} is not defined.`);
  }

  return actor.email;
}

function decodeNote(encoded: string): string | null {
  if (encoded === '--null--') {
    return null;
  }

  if (encoded === '--empty--') {
    return '';
  }

  return Buffer.from(encoded, 'base64url').toString('utf8');
}
