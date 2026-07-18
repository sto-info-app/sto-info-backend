import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds a news post announcing the character reputation tracking update
 * released in Backend v1.1.1 and Frontend v1.1.1.
 */
export class SeedStoInfoReputationTrackingUpdateNewsPost1784332800000 implements MigrationInterface {
  name = 'SeedStoInfoReputationTrackingUpdateNewsPost1784332800000';

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
      slug: 'sto-info-reputation-tracking-update',
      title: 'Reputation Tracking Update',
      summary:
        'Track your characters’ reputations, explore the new roadmap and resources pages, and enjoy stronger account security.',
      category: 'RELEASE_NOTES',
      publishedAt: '2026-07-18T03:00:00.000Z',
      body: `This STO Info update introduces reputation tracking for your characters, two brand new pages to explore, and extra ways to keep your account safe and under your control.

### What is new

#### Character reputation tracking

- You can now record and track reputation progress for each of your characters.
- Reputations appear directly on the character page in a new LCARS-style tabbed layout, keeping everything about a character in one place.

#### New pages to explore

- A new Roadmap page shows what is planned for STO Info, so you can see what is coming next.
- A new Resources page gathers useful links to other Star Trek Online sites, tools, and communities.

#### Account safety and control

- Changing or resetting your password now signs you out everywhere else, so only you stay signed in.
- Clearer messages confirm when your password has been changed successfully.
- If you ever decide to leave, you can now close your STO Info account yourself, with a confirmation step to prevent accidents.

### Fixes

- The scroll-to-top button now works reliably again.
- Signing in now returns you to exactly the page you were heading to, including any options that were part of the link.
- The version number shown at the bottom of the page is now accurate.
- Section titles now look consistent across the app.

### Behind-the-scenes improvements

- Ongoing maintenance keeps the app secure and up to date.
- Tidy-ups and additional testing help keep everything running reliably.

### Release information

This news post covers the following releases:

- [Backend v1.1.1](https://github.com/sto-info-app/sto-info-backend/releases/tag/v1.1.1)
- [Frontend v1.1.1](https://github.com/sto-info-app/sto-info-frontend/releases/tag/v1.1.1)`,
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
