import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds a news post announcing STO Storytime, released as part of
 * Backend v1.4 and Frontend v1.4.
 */
export class SeedStoInfoStorytimeAnnouncementNewsPost1788883200000 implements MigrationInterface {
  name = 'SeedStoInfoStorytimeAnnouncementNewsPost1788883200000';

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
      slug: 'sto-info-introducing-storytime',
      title: 'Introducing STO Storytime',
      summary:
        'Discover, read and create community-written Star Trek Online stories with progress tracking, Arcs, reactions, comments and more.',
      category: 'ANNOUNCEMENT',
      publishedAt: '2026-09-08T16:00:00.000Z',
      body: `STO Info has always been about helping players keep track of their life in Star Trek Online. With **STO Storytime**, that idea is expanding beyond what happens in the game and into the stories the community creates around it.

**STO Storytime is a new home for Star Trek Online fan fiction within STO Info**, where you can discover and read community-created Stories — or sign in and start writing your own.

Storytime launches as a **Beta**, so you may see parts of the facility continue to evolve as it is used by the community.

### Read without an account

You do not need an STO Info account to start exploring Storytime.

Published Stories are available for anyone to read, with the Storytime home page helping you discover what is available through:

- the **Storytime Spotlight**, featuring selected Stories and Arcs;
- newly published Stories;
- recently updated Stories;
- search;
- tags describing a Story's subject, setting and style;
- creator pages showing a writer's published work.

Stories can contain multiple Chapters, and each Story shows useful information such as its author, status, content rating, tags and available Chapters before you dive in.

Creators can also build a cast for their Story, giving Characters their own profiles with details such as species, rank, faction, occupation, ship and other information where supplied.

### Pick up where you left off

Signing in turns Storytime into a more personal reading experience.

As you read, STO Info can keep track of your progress through a Story and remember where you reached in an individual Chapter. When you return later, you can choose to resume from where you left off.

Your **Reading Library** brings together the Stories you have started, while each Story can show your current reading status and help you jump to the next Chapter you have yet to finish.

If a Story you had completed later receives another Chapter, it returns to your in-progress reading rather than quietly remaining in your completed list.

### Follow the Stories and writers you enjoy

Storytime also builds on the community features introduced in STO Info 1.3.

Signed-in members can **follow writers, Stories and Arcs**, with a personal Storytime activity feed helping you keep up with new publications and updates from the things you are interested in.

You can also leave a **thumbs up or thumbs down**, join the conversation through comments and replies, and create your own **Reading Lists**.

Reading Lists can remain private for your own use or be made public so that you can share your recommendations with other people.

### Stories, Chapters and Arcs

A Story can grow over time through multiple Chapters, but Storytime is not limited to individual works.

**Arcs** let Stories be brought together into an ordered reading journey. An Arc could connect several related Stories, organise a larger collaborative project or simply provide a recommended order in which to read a collection.

You do not need to be a writer to curate an Arc. Any signed-in member can create one, and where somebody else's Story is being included, Storytime provides an invitation and approval process so that creators retain control over how their work is used.

Readers can then follow the Arc in order and see their progress through it.

### Write your own Stories

If you have a story to tell, signing in gives you access to the Storytime creator tools.

You can create Stories and Chapters, write using the supported Markdown formatting, organise your Chapters, build your cast and add artwork including Story banners, profile images, Chapter covers and Character portraits.

Chapters can also include optional YouTube videos. These use privacy-conscious loading: YouTube content is not loaded simply because somebody opens the Chapter; the reader chooses whether to play it.

Storytime supports different languages, publication states and content ratings, giving creators control over how their work is presented.

Stories can also be **Public, Unlisted or Private**, allowing work to be prepared before it is ready to be discovered.

### Work together

Storytime has been designed with collaborative storytelling in mind.

A Story owner can invite other STO Info members to help with selected parts of their Story, while a separate Crew Credits system makes it possible to recognise contributors without automatically giving them editing access.

Invitations clearly show what access is being offered before somebody accepts.

The same idea extends to Arcs, allowing people to collaborate on larger collections while keeping ownership and publishing decisions with the person responsible for the work.

### A safe home for fan-created stories

Storytime includes content ratings, reporting and moderation facilities alongside its publishing tools.

Creators are asked to agree to the **STO Storytime Content Policy, Terms of Use and Fan Content & Intellectual Property Notice** before publishing. These documents set out what can be published and reinforce that Storytime is an unofficial, non-commercial fan community.

Readers can report content they believe breaks the rules, with reports reviewed rather than automatically removing somebody's work. Creators are also given a route to appeal moderation decisions.

Content warnings and ratings are shown where appropriate so readers can make informed choices about what they want to read.

### This is just the beginning

STO Storytime is one of the largest additions to STO Info so far, but this first release is deliberately labelled **Beta**.

The foundations are now in place for the STO community to read, write, collaborate, organise and discuss fan-created stories in one place, while leaving room for Storytime to continue growing from real-world use and feedback.

Whether you want to write an epic spanning dozens of Chapters, curate a collection of connected Stories, or simply find something new to read between missions, **STO Storytime is now part of STO Info**.

**The next chapter is yours.**`,
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
