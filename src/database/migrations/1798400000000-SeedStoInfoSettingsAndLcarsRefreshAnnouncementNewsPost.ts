import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds a news post announcing the Settings tabs, the cogs that lead to them
 * and the site-wide LCARS refresh, released as part of Backend v1.5.1 and
 * Frontend v1.5.1.
 *
 * The post is dated as it lands, an hour before the release notes seeded
 * after it, so that the notes sit above the announcements on the site's news
 * as v1.4's did. Fleet Community's ScopeNewsPosts has run in every database
 * this reaches, so the slug is unique only among the site's own posts and the
 * upsert names that predicate.
 */
export class SeedStoInfoSettingsAndLcarsRefreshAnnouncementNewsPost1798400000000 implements MigrationInterface {
  name = 'SeedStoInfoSettingsAndLcarsRefreshAnnouncementNewsPost1798400000000';

  /**
   * The STO Info post to seed. Body is authored as Markdown, and the post is
   * dated this many hours before the migration runs.
   */
  private readonly _posts: {
    slug: string;
    title: string;
    summary: string;
    category: 'RELEASE_NOTES' | 'ANNOUNCEMENT' | 'GENERAL';
    publishedHoursAgo: number;
    body: string;
  }[] = [
    {
      slug: 'sto-info-settings-tabs-and-the-lcars-refresh',
      title:
        'Settings in tabs, cogs where you need them, and a fresh LCARS look',
      summary:
        'Settings now has a tab for each part of the site and saves as you change it, cogs around the site go straight to the right setting, and every page wears the full LCARS look with sections you can fold away.',
      category: 'ANNOUNCEMENT',
      publishedHoursAgo: 1,
      body: `Alongside Fleet Communities, this update changes how STO Info itself looks and behaves for you: where your settings live, how you reach them, and how every page is drawn.

### Settings, in tabs

Settings, on your Dashboard, now has a tab for each part of the site: **Account**, **Chat**, **Fleet**, **Notifications** and **Custom Tracking**. The arrow keys move between them, each section has a help link under its heading, and the page's address names the tab, so a link can open the right one.

- **Account** holds Privacy Mode, your login inactivity timeout, the zone dates and times are shown in, and whether you are listed in the Galactic Personnel Registry.
- **Chat** holds who can see when you are online, Appear offline, and whether people see when you are typing.
- **Fleet** holds the zone Star Trek Online roster exports are read in.
- **Notifications** has a switch for each kind of notice you can turn off: mentions, replies, direct messages, roster association proposals and event reminders.
- **Custom Tracking** leads to Configure Custom Tracking, as before.

There is nothing to press any more. **Each setting is saved the moment you change it**, with a brief Saved note beside it. One that cannot be saved is put back, and the page says so.

### Cogs that go straight to the right setting

A small cog now sits beside the headings whose behaviour you can change: beside Chat, beside Notifications, on every Fleet page, beside an event's reminders, beside a roster import's help, beside the roster proposals on a Character's page, and beside the Galactic Personnel Registry wherever it appears. Choose it and Settings opens on the right tab, scrolls to that setting, puts the keyboard on it and rings it for a moment. The cog is shown only while you are signed in.

### Dates and times, in your zone

Every date and time on STO Info is now shown in one zone, chosen under Dates and times on the Account tab. Left on Automatically, it follows whichever device you are using. Choose a zone if you would rather your dates stayed put when you travel. A day you typed, such as when an STO account was created, is kept as a day and no longer shifts with the clock.

### Notifications and Chat, on your Dashboard

Notifications has a tile and a side link of its own on your Dashboard, showing how many are unread. It shows five at a time, each can be marked read or unread or deleted, and Delete all read clears every one you have read. Chat has a tile and a side link too.

### A fresh LCARS look, everywhere

Every page now wears the full LCARS look, not only the Dashboard.

- **Colour rotates** across the site the way the Dashboard's tiles always have: navigation, section bars, form fields and choosers each take their turn through the palette, so no page is a wall of one colour. Green and red are kept for one job each: green confirms, red refuses or removes.
- **Every section folds.** Each bar that heads a block of content can be folded away and opened again, and every search and filter panel folds too. Everything starts open, and the site remembers what you folded, page by page, on the device you folded it on.
- **Panels and cards** share one family: a coloured spine, a heading block, and the name of what they show. Fleet records, member cards, Custom Tracking cards and the chat list all use it.
- **Every standalone action is a pill**, and every "Help with …" link is a small help button that looks the same wherever it is.
- **Native form controls**, such as drop-downs and tick boxes, are drawn the LCARS way, and a drop-down is only as wide as its choices need.
- **It fits on a phone.** The shell and every Fleet page lay out at phone width, and if your device asks for reduced motion, the site honours it throughout.

### Help, reorganised

The Help home is now a grid of section tiles. Three sections are new: **Fleets**, **STO Info settings**, and **Running the site** for site administrators. A guide with a walk-through video shows it under its summary, and the Fleet pages, the admin pages and Settings each link to their own guide.

### Smaller things you may notice

- You can now remove a profile photo or a Captain's photo from your Dashboard, as well as replace it.
- A Captain's page links to its account's Endeavour Perks.`,
    },
  ];

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const post of this._posts) {
      await queryRunner.query(
        `
          INSERT INTO "sto_info_app"."news_post"
            ("slug", "title", "summary", "body", "category", "status", "publishedAt")
          VALUES ($1, $2, $3, $4, $5, 'PUBLISHED', NOW() - make_interval(hours => $6::int))
          ON CONFLICT ("slug") WHERE "communityId" IS NULL DO UPDATE SET
            "title" = EXCLUDED."title",
            "summary" = EXCLUDED."summary",
            "body" = EXCLUDED."body",
            "category" = EXCLUDED."category",
            "status" = EXCLUDED."status",
            "publishedAt" = EXCLUDED."publishedAt"
        `,
        [
          post.slug,
          post.title,
          post.summary,
          post.body,
          post.category,
          post.publishedHoursAgo,
        ],
      );
    }
  }

  /**
   * Reverts the migration from the database, leaving a Community's post of
   * the same slug alone.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "sto_info_app"."news_post" WHERE "slug" = ANY($1) AND "communityId" IS NULL`,
      [this._posts.map(post => post.slug)],
    );
  }
}
