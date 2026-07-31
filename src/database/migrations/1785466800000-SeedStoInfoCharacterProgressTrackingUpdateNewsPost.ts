import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds a news post announcing the character progress tracking update
 * released in Backend v1.2.1 and Frontend v1.2.1.
 */
export class SeedStoInfoCharacterProgressTrackingUpdateNewsPost1785466800000 implements MigrationInterface {
  name = 'SeedStoInfoCharacterProgressTrackingUpdateNewsPost1785466800000';

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
      slug: 'sto-info-character-progress-tracking-update',
      title: 'Character Progress Tracking Update',
      summary:
        'Track Research & Development and Captain Specializations, with level-aware character tabs and improved progress tools.',
      category: 'RELEASE_NOTES',
      publishedAt: '2026-07-31T03:00:00.000Z',
      body: `This STO Info update expands character progression tracking with Research & Development and Captain Specializations, while making each tracker easier to use from the character page.

### What is new

#### Research & Development tracking

- Record each captain's progress across all eight Research & Development schools.
- Track school levels from 0 to 20 and see the crafting quality unlocked at each milestone.
- View total levels, overall completion, and the number of schools at maximum level.

#### Captain Specialization tracking

- Record points spent across all primary and secondary Captain Specializations.
- See overall completion and when a Specialization Qualification has been unlocked.
- Choose the captain's active Primary and Secondary Specializations directly from the tracker.

### Character progress improvements

- Reputations, Research & Development, and Specializations are available as tabs on each character page.
- Each tracker includes search, hide-completed, refresh, and summary tools.
- Level-aware notices show when a feature has not yet unlocked and link directly to the captain editor. Research & Development unlocks at level 15; Reputations and Specializations unlock at level 50.
- Tracker state is now cleared correctly when a captain is below the required level.

See the updates in this video:
https://youtu.be/UG0aHIOLbV4

### Fixes and polish

- Reputation progress now uses the same consistent character ownership checks as the new trackers.
- Removed duplicate loading indicators from character tracking views.
- Corrected character card styling and refined tracker wording, layout, and accessibility.
- Improved shared progress components so the tracking pages behave consistently.
- Fixed an issue to allow the rendering of YouTube embedded videos in the news and release notes.

### Behind-the-scenes improvements

- Added secure backend APIs and database support for R&D and Specialization progress.
- Specialization slot changes are saved atomically so a captain can have no more than one active Primary and one active Secondary Specialization.
- Updated dependencies, security overrides, automated checks, and supporting test coverage.

### Release information

This news post covers the following releases:

- [Backend v1.2.1](https://github.com/sto-info-app/sto-info-backend/releases/tag/v1.2.1)
- [Frontend v1.2.1](https://github.com/sto-info-app/sto-info-frontend/releases/tag/v1.2.1)`,
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
