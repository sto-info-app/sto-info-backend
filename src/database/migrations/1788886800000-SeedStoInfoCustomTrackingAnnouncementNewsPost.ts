import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds a news post announcing Custom Tracking, released as part of
 * Backend v1.4 and Frontend v1.4.
 */
export class SeedStoInfoCustomTrackingAnnouncementNewsPost1788886800000 implements MigrationInterface {
  name = 'SeedStoInfoCustomTrackingAnnouncementNewsPost1788886800000';

  /**
   * The STO Info post to seed. Body is authored as Markdown.
   */
  private readonly _posts: {
    slug: string;
    title: string;
    summary: string;
    category: 'RELEASE_NOTES' | 'ANNOUNCEMENT' | 'GENERAL';
    publishedAt: string;
    body: string;
  }[] = [
    {
      slug: 'sto-info-introducing-custom-tracking',
      title: 'Introducing Custom Tracking',
      summary:
        'Create your own account and captain trackers with configurable sections, tabs and fields, while staying in control of what is shared publicly.',
      category: 'ANNOUNCEMENT',
      publishedAt: '2026-09-08T17:00:00.000Z',
      body: `No two Star Trek Online players keep track of quite the same things.

STO Info already provides dedicated tracking for areas such as Reputations, R&D, Specialisations and other parts of your Captains' progress. But there will always be something another player wants to record that does not belong in one of those predefined trackers.

With **Custom Tracking**, you can now decide what STO Info should track for you.

### Build your own tracking system

Custom Tracking lets you create your own information and progress trackers for either your **STO Accounts** or your individual **Captains**.

Rather than giving you one fixed form, STO Info lets you organise your tracker using:

**Sections → Tabs → Fields**

For example, you might want to keep track of personal goals for a Captain, record milestones you have set yourself, maintain a checklist for things you want to complete, or add role-playing information and notes that are not represented elsewhere in STO Info.

You could even create something completely different that is useful to the way **you** play Star Trek Online.

The structure is yours.

### More than just text boxes

Custom Tracking includes a wide range of different field types so your trackers are not limited to simple notes.

Depending on what you are recording, you can use fields for things such as:

- short and long-form text;
- numbers and scores;
- progress;
- dates, times and durations;
- yes/no and tick-box values;
- your own lists of choices;
- colours;
- tags;
- images;
- YouTube videos.

Fields can also be configured to suit what you are recording, and you can arrange Sections, Tabs and Fields in the order that works best for you.

Once a field has been created, its type remains fixed so that information already recorded against it continues to mean the same thing.

### Configure once, use it with your Accounts and Captains

The structure of Custom Tracking is managed from **Settings → Custom Tracking**.

Once you have built the layout you want, you can fill in the actual values for your Accounts and Captains.

Custom Tracking information is also integrated into the normal Account and Captain pages, so your own information can sit alongside the STO data you are already using rather than living in a completely separate part of the site.

Values can be edited from those pages as well, making it much easier to update something while you are already looking at the Account or Captain it belongs to.

### You decide what is public

Custom Tracking has been designed around the same privacy controls as the rest of STO Info.

Creating a field does not automatically mean sharing its value with everybody.

You control whether Custom Tracking content can be made public, and public information still has to pass through the existing STO Info visibility settings for your profile, Account or Captain before somebody else can see it.

That means Custom Tracking cannot bypass your existing privacy choices.

When information is shared, it can appear alongside your Account or Captain in the **Galactic Personnel Registry**, making Custom Tracking useful for adding your own information to a public profile as well as for private record keeping.

If something is not available to a visitor, STO Info simply leaves it out rather than advertising that hidden information exists.

### Images and richer information

Custom Tracking can also hold information that does not fit neatly into a conventional form.

Picture fields let you upload and crop an image for the tracker, while video fields can reference YouTube content. Markdown fields provide more flexible formatted notes, and progress fields can give you a visual representation of how far you have got.

This means Custom Tracking can be anything from a simple personal checklist to a much richer collection of information about an Account or Captain.

### Safeguards for your information

Because Custom Tracking can contain information entirely of your own choosing, the first time you use the facility you will be asked to accept the **Custom Tracking Content Agreement**.

The agreement sets out what Custom Tracking is for and what should not be stored or published through it. If the agreement changes materially in future, you will be asked to review it again before continuing to edit Custom Tracking content.

STO Info also warns you if you try to leave an editor with unsaved changes, reducing the chance of accidentally losing something you have just entered.

### Your STO Info, your way

Dedicated trackers will continue to be the best option for parts of STO where STO Info provides purpose-built functionality.

Custom Tracking is different.

It is there for the things **you** decide are worth keeping track of.

Whether that is a personal checklist, role-playing information, your own goals and milestones, notes about a Captain, or something I have not thought of at all, STO Info 1.4 gives you the tools to build the tracker yourself.

**You choose the information. You choose the layout. You choose who can see it.**`,
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
          VALUES ($1, $2, $3, $4, $5, 'PUBLISHED', $6)
          ON CONFLICT ("slug") DO UPDATE SET
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
          post.publishedAt,
        ],
      );
    }
  }

  /**
   * Reverts the migration from the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "sto_info_app"."news_post" WHERE "slug" = ANY($1)`,
      [this._posts.map(post => post.slug)],
    );
  }
}
