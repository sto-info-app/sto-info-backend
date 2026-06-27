import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds a news post announcing the Endeavour update released in
 * Backend v1.0.187 and Frontend v1.0.214, including the changes from
 * Frontend v1.0.212.
 */
export class SeedStoInfoEndeavourUpdateNewsPost1782086400000 implements MigrationInterface {
  name = 'SeedStoInfoEndeavourUpdateNewsPost1782086400000';

  /**
   * The STO Info post to seed. Body is authored as Markdown.
   */
  private readonly posts: {
    slug: string;
    title: string;
    summary: string;
    category: 'RELEASE_NOTES' | 'ANNOUNCEMENT' | 'GENERAL';
    publishedAt: string;
    body: string;
  }[] = [
    {
      slug: 'sto-info-endeavour-tracking-dashboard-update',
      title: 'Endeavour Tracking and Dashboard Update',
      summary:
        'This update introduces the newest addition to STO Info: Endeavour tracking, plus an improved account management UI, and performance enhancements.',
      category: 'RELEASE_NOTES',
      publishedAt: '2026-06-17T18:00:00.000Z',
      body: `A new STO Info update has been deployed, adding Endeavour support together with several improvements across the application.

### New features

#### Endeavour Tracking

Endeavour tracking has now been added. A brand new Endeavour Perks dashboard has been added, allowing you to view your accumulated Endeavour perk bonuses in a dedicated interface.

#### Improved Account Management

Several improvements have been made to account management to provide a smoother and more intuitive experience when managing your Star Trek Online accounts, and your Endeavour perk progress is now included in the account management interface.

### Performance improvements

- Improved dashboard responsiveness through performance optimisations.
- Reduced unnecessary interface updates for a faster user experience.

### Reliability and stability

- Improved database startup and deployment reliability.
- Enhanced validation for profile picture uploads.
- Improved validation of image URLs throughout the application.
- Updated interface styling and font rendering for a more consistent appearance.

### Security and maintenance

This release also includes dependency updates, security improvements, framework upgrades, and general maintenance work to keep STO Info reliable, secure, and ready for future features.

Thank you to everyone using STO Info and providing feedback as the project continues to grow. Live long and prosper 🖖

---

### Release information

This news post covers the following releases:

- [Backend v1.0.187](https://github.com/sto-info-app/sto-info-backend/releases/tag/v1.0.187)
- [Frontend v1.0.212](https://github.com/sto-info-app/sto-info-frontend/releases/tag/v1.0.212)
- [Frontend v1.0.214](https://github.com/sto-info-app/sto-info-frontend/releases/tag/v1.0.214)`,
    },
  ];

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const post of this.posts) {
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
      [this.posts.map(post => post.slug)],
    );
  }
}
