import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds the release notes for STO Info v1.4.38, covering Backend v1.4.38 and
 * Frontend v1.4.38.
 */
export class SeedStoInfoV1438ReleaseNotesNewsPost1792700000000 implements MigrationInterface {
  name = 'SeedStoInfoV1438ReleaseNotesNewsPost1792700000000';

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
      slug: 'sto-info-version-1-4-38-release',
      title:
        'Update: Captain Progress Summary & Collapsible Sections (v1.4.38)',
      summary:
        'Your Captain overview now shows progress across every tracker at a glance, long sections can be folded away, Admiralty Tours of Duty match the game, and STO Account launchers are clearer.',
      category: 'RELEASE_NOTES',
      publishedAt: '2026-10-12T18:00:00.000Z',
      body: `### What's new

This update focuses on the Captain overview page, making it quicker to see how a Captain is progressing and easier to get to the information you want.

### Captain progress summary

Each Captain's overview page now ends with a **Progress Summary**.

- One card is shown for each tracker your Captain can use: Reputations, R&D, Specializations, Admiralty and Commendations.
- Each card shows the tracker's overall percentage with a progress bar beneath it.
- Selecting a card takes you straight to that tracker's tab.
- The figures are refreshed each time you return to the overview, so a change made on a tracker tab is reflected straight away.
- Cards follow the same rules as the tabs themselves, so a tracker your Captain has not yet unlocked is not shown.

### Collapsible Captain sections

Long Captain pages are now easier to move around.

- **Character Data**, **Biography** and **Commander's Notes** on your Captain's overview can each be folded away and opened again.
- The edit control for Character Data stays on its bar, so it is available whether the section is open or folded.
- Biography and Commander's Notes now have their own edit controls, which open the edit page scrolled directly to that field.
- Character Data now shows whether the Captain is **Publicly Visible**.
- Spacing between sections on the overview has been tidied up.
- The Biography can also be folded away on Galactic Personnel Registry Captain pages, Storytime Character pages and Team member profiles.

### Admiralty Tours of Duty

The Admiralty tracker's Tour of Duty now runs from **0 to 9**, matching Star Trek Online.

In the game, the tenth step pays out the tour reward and starts the tour again, so a tour is never actually sitting at ten. Pressing the position a tour is already at steps it back by one, as the campaign tiers already do.

**Please note:** any Tour of Duty previously recorded at step ten will be reset to zero when this update is applied, since in the game that tour had already paid out and started again.

### STO Account launchers

The **Launcher** choice on the Add and Edit STO Account forms has been made clearer.

- The previous "None" option, which could leave an existing launcher unchanged when selected, has been removed.
- A launcher is now required whenever the chosen platform offers one.
- Platforms without launchers leave the field alone.

### Other improvements

- Fixed a problem that could cause newly uploaded profile and Captain pictures to show as unavailable in some environments.
- Upload errors are now reported more accurately, with a malformed upload no longer being described as too large.
- Updated underlying application components and dependencies to their latest supported maintenance releases, resolving all outstanding security advisories.
- Various behind-the-scenes reliability, testing, security and deployment improvements.

---

### Release information

This news post covers the following releases:

- [Backend v1.4.38](https://github.com/sto-info-app/sto-info-backend/releases/tag/v1.4.38)
- [Frontend v1.4.38](https://github.com/sto-info-app/sto-info-frontend/releases/tag/v1.4.38)`,
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
