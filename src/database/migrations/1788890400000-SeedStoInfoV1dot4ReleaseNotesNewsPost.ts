import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds the release notes for STO Info v1.4, covering Backend v1.4 and
 * Frontend v1.4.
 */
export class SeedStoInfoV14ReleaseNotesNewsPost1788890400000 implements MigrationInterface {
  name = 'SeedStoInfoV14ReleaseNotesNewsPost1788890400000';

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
      slug: 'sto-info-version-1-4-release',
      title: 'STO Info 1.4 — Storytime, Custom Tracking and More',
      summary:
        'STO Info 1.4 introduces Storytime and Custom Tracking, adds Admiralty and Commendation progress, new privacy and session settings, Help guides and more.',
      category: 'RELEASE_NOTES',
      publishedAt: '2026-09-08T18:00:00.000Z',
      body: `STO Info 1.4 is one of the biggest updates to the site so far, introducing two major new facilities alongside new Captain progression trackers, privacy and session options, help content and a range of usability improvements.

### STO Storytime — Beta

**STO Storytime** introduces community-created Star Trek Online fan fiction directly within STO Info.

You can now:

- browse and read published Stories without signing in;
- search published Storytime content and discover new or recently updated Stories;
- explore curated **Storytime Spotlight** selections;
- read multi-Chapter Stories with previous and next Chapter navigation;
- view Story casts and individual Character profiles;
- explore **Arcs**, which organise multiple Stories into a reading order;
- see authors, Story information, content ratings and tags before choosing what to read.

Signed-in members gain additional reader features including:

- automatic Story and Chapter reading progress;
- the option to resume a Chapter from where you previously stopped;
- a personal Reading Library;
- following writers, Stories and Arcs;
- a personal Storytime activity feed;
- thumbs-up and thumbs-down reactions;
- comments and replies;
- private or publicly shareable Reading Lists;
- progress through Story Arcs.

Writers can create and publish their own Stories and Chapters, including supported Markdown formatting, language settings, content ratings, visibility controls, scheduled Chapter publishing, artwork, casts, YouTube video content, tags, collaborators and Crew Credits.

Arcs can be created by any signed-in member, allowing readers as well as writers to curate reading orders. Storytime includes invitation and approval workflows where other people's work is involved.

Storytime also launches with reporting, moderation and appeals, together with dedicated Content Policy, Terms of Use and Fan Content & Intellectual Property documents.

**Storytime is launching as a Beta.** The facility is open to readers and writers, but some parts may continue to be refined as the community starts using it.

### Custom Tracking

**Custom Tracking** lets you create your own trackers for STO Accounts and Captains.

Create your own layout using:

**Sections → Tabs → Fields**

A wide range of field types is available, covering text, numbers, progress, dates and times, yes/no values, choices, colours, tags, pictures, YouTube videos and more.

You can:

- create separate Account and Captain tracking layouts;
- organise and reorder your Sections, Tabs and Fields;
- configure fields to suit the information you are recording;
- enter different values for each Account or Captain;
- view your tracking information alongside the normal Account and Captain details;
- edit tracked values directly while viewing your own Account or Captain;
- choose what Custom Tracking information may be shown publicly;
- display permitted information through the Galactic Personnel Registry.

Public Custom Tracking follows STO Info's existing visibility chain, so it cannot override your profile, Account or Captain privacy settings.

A dedicated Custom Tracking Content Agreement and new Help guides explain how the facility works and how public visibility is determined.

### Admiralty Tracking

Captain progress tracking now includes **Admiralty**.

The new Admiralty tab lets you record progress across all four campaigns:

- Federation;
- Klingon;
- Romulan;
- Ferengi.

Each campaign tracks both its campaign tier and current Tour of Duty step, with an overall summary showing your progress across the Admiralty system.

### Duty Officer Commendations

A new **Commendations** tracker has also been added to Captain progress.

You can record your current rank across the Duty Officer commendation categories, with STO Info automatically showing the categories appropriate to your Captain's allegiance.

Federation-side Captains are shown Diplomacy while Klingon-side Captains receive Marauding, with faction-appropriate artwork where available.

### Updated Reputation and R&D presentation

The ordering of **Reputations** and **R&D Schools** has been adjusted to better match the order used in Star Trek Online.

The R&D **Kits** school has also been renamed **Kits and Modules** to match the game's current terminology.

### New Settings and Privacy Mode

STO Info now has an expanded **Settings** area.

A new **Privacy Mode** can obscure sensitive Account information on screen when enabled, giving you an easier way to keep private details out of view when required.

Your Privacy Mode choice is saved to your STO Info account.

### Choose your inactivity timeout

You can now choose how long STO Info should allow your signed-in session to remain inactive before it expires.

Available options are:

- 1 hour;
- 4 hours;
- 8 hours.

This lets you choose a shorter session on a device where privacy matters more, or a longer one when you are actively using STO Info over an extended period.

### New Help area

A new **Help** section has been added to STO Info and is available from the site's navigation.

It contains non-technical guides covering the Community, STO Storytime, Custom Tracking and relevant management facilities for members who have access to them.

The Help area will provide a central place for guidance as STO Info continues to grow.

### Improved handling of connection problems

STO Info is now less aggressive when a single request to the service fails.

Rather than immediately treating one failed connection as a complete outage, the app can recognise an unstable connection and show a warning while continuing to operate where possible.

If the connection recovers, the warning clears. A full service interruption is only shown if the problem continues.

Features such as Storytime and Custom Tracking also provide clearer information when they are temporarily unavailable rather than incorrectly presenting the situation as a missing page.

### Public profile improvements

When your own STO Info profile is publicly listed, the Dashboard and Profile areas now provide a direct route to your public **Galactic Personnel Registry** profile.

Custom Tracking information that you have chosen to share can also appear on the relevant public Account and Captain Registry pages.

### Interface and accessibility improvements

The 1.4 release includes a range of smaller usability improvements throughout STO Info, including:

- LCARS tab controls that wrap more cleanly on narrower screens instead of requiring awkward horizontal scrolling;
- improved keyboard and screen-reader behaviour across new Storytime and Custom Tracking interfaces;
- clearer controls for ordering items;
- more consistent collapsible sections and information panels;
- clearer feature-unavailable and service-interruption messages;
- improved image selection and cropping for supported uploads;
- assorted layout and responsive-display refinements.

### Administration and moderation

For those helping to run STO Info, version 1.4 also introduces a more flexible permissions system.

This includes:

- a dedicated Storytime Curator role;
- individually managed permissions;
- Storytime moderation tools;
- Spotlight curation;
- Storytime tag management;
- improved administration navigation;
- easier member searching when sending individual STO Info notifications.

These changes allow Storytime responsibilities to be delegated without providing access to unrelated site administration.

Thank you to everyone using, testing and providing feedback on STO Info as it continues to grow. Live long and prosper 🖖

---

### Release information

This news post covers the following releases:

- [Backend v1.4](https://github.com/sto-info-app/sto-info-backend/releases/tag/v1.4)
- [Frontend v1.4](https://github.com/sto-info-app/sto-info-frontend/releases/tag/v1.4)`,
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
