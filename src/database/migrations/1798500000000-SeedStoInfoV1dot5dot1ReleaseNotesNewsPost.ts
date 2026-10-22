import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds the release notes for STO Info v1.5.1, covering Backend v1.5.1,
 * Frontend v1.5.1 and the file scan worker v1.0.1.
 *
 * The post is dated as it lands, after the two announcements seeded before
 * it, so that it sits above them on the site's news as v1.4's did. Fleet
 * Community's ScopeNewsPosts has run in every database this reaches, so the
 * slug is unique only among the site's own posts and the upsert names that
 * predicate.
 */
export class SeedStoInfoV151ReleaseNotesNewsPost1798500000000 implements MigrationInterface {
  name = 'SeedStoInfoV151ReleaseNotesNewsPost1798500000000';

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
      slug: 'sto-info-version-1-5-1-release',
      title: 'Update: Fleet Communities (v1.5.1)',
      summary:
        'STO Info 1.5.1 introduces Fleet Communities, with rosters, recruitment, events, news and chat; puts Settings into tabs with cogs that lead to them; gives every page the full LCARS look; and checks every picture before it is shown.',
      category: 'RELEASE_NOTES',
      publishedHoursAgo: 0,
      body: `### What's new

STO Info 1.5.1 is the largest update the site has had. It introduces Fleet Communities, puts Settings into tabs with cogs around the site that lead to them, gives every page the full LCARS look, and changes how every picture you upload is checked and shown. It also brings a new service, the file scan worker, into production for the first time.

### Fleet Communities

Fleet Communities records the groups you play with. You can now:

- browse the Fleet Directory's Communities, Fleets and Armadas, and follow a Community;
- register your own Community, its Fleets and its Armadas, with artwork, a description and a choice of who can see each;
- run each one through four roles, Owner, Admin, Officer and Member, delegating exactly what each Officer may do;
- say which Fleet each of your Captains is in, and answer when a roster asks;
- recruit, with open joining, application forms of up to 20 questions, or invitations, and follow your own applications from your Dashboard;
- import the game's roster exports, read a Fleet's history of joins, departures, renames, rank changes and contribution, and correct it;
- read eight reports, Growth, Activity, Tenure, Ranks, Contribution, Attendance, Recruitment and Holdings, and download them as CSV files;
- arrange Fleets into Armadas, and record each Fleet's holdings tier by tier;
- publish news with covers, follow an activity feed, and schedule once-only or repeating events with answers, waitlists, reminders and attendance;
- chat in channels for your Fleet, Armada and Community, and with friends, with replies, mentions, emoji, presence and typing;
- report a member or a message to the site's administrators, and ask for your roster data to be erased.

[Introducing Fleet Communities](/news/sto-info-introducing-fleet-communities) walks through all of it, and the new Fleets section of Help has a guide for every part, most with a walk-through video.

### Settings, cogs and the LCARS refresh

- Settings now has Account, Chat, Fleet, Notifications and Custom Tracking tabs, and each setting is saved the moment it changes.
- A cog beside Chat, Notifications, every Fleet page, an event's reminders, a roster import, a Character's roster proposals and the Galactic Personnel Registry goes straight to the setting that governs it.
- Every date and time is shown in the zone you choose under Dates and times, or your device's.
- Notifications has a Dashboard tile and side link with its unread count, shows five at a time, and lets you delete a notice, or every read one at once.
- Every page now wears the full LCARS look: rotating colour, pill buttons, panel cards, folding sections remembered per page, LCARS form controls, and layouts that fit a phone and honour reduced motion.
- The Help home is a grid of section tiles, with new Fleets, STO Info settings and Running the site sections, and a guide's video shown under its summary.

[Settings in tabs, cogs where you need them, and a fresh LCARS look](/news/sto-info-settings-tabs-and-the-lcars-refresh) has the details.

### Pictures are checked before they are shown

Every picture uploaded to STO Info, whether a profile picture, a Captain's portrait, Storytime artwork, a Custom Tracking picture, Fleet artwork or a news cover, now goes into quarantine and is scanned by the new file scan worker before it is published. The cropper stays open while that happens and tells you when the picture is Available, or that it was Rejected and nothing has changed. Roster exports go through the same scan before a row of them is read.

Pictures are now served from private storage through signed addresses that expire, so a picture that is removed stops being shown within two hours wherever it was. A page left open renews its pictures by itself. Pictures uploaded before this update keep showing, and will be checked in the same way.

- You can now remove a profile photo or a Captain's photo from your Dashboard.
- Deleting a Story, a Chapter, a cast member, an Arc, a Spotlight entry, a Custom Tracking field, an STO account or a Character now takes its pictures down with it, and what earlier deletions left behind has been tidied up.

### Privacy Policy and Terms of Use

**Please note:** the Privacy Policy and Terms of Use were updated on 29 September 2026 to cover Fleet Communities: what a roster upload keeps and discards, how files are scanned, what STO Info works out from rosters, and who can read chat and for how long. Every member receives a one-time notice under Notifications. Audit records of news posts, contact requests and member reports now keep identifiers only, and error reports sent for diagnosis have personal details masked.

### Contact us

Contact us offers a Fleet Communities topic for anything about the Fleet section, including a dispute over who runs a Community or a request to have your roster data erased.

### For site administrators

- Features can be switched on and off, and publication paused, from Admin › Operations › Site Settings, each setting in a panel of its own and each change with a reason, and every site admin action asks for a reason and is kept in a new Security Log.
- Scan Diagnostics shows the worker's heartbeat, scan usage, the backlog, alerts, failed jobs with retry or discard, withdrawn pictures still to be deleted, rescan campaigns, private image delivery and a publication pause.
- Fleet tools: suspend, reinstate or close a Community, Fleet or Armada; settle a dispute by moving ownership; read a Fleet's roster imports for 24 hours, with the look logged; decide reported members and chat messages; hold chat evidence for an investigation; and verify and carry out roster erasures.
- Alerts are raised when the file pipeline needs attention, such as a purge owed for a day, and Help has a Running the site section covering every tool.
- A Site Statistics page under Admin › Operations counts members and how many are active, sign-ups, Storytime content published, Fleet Communities and chat, STO records, news and the open reports, over today, seven days, thirty days and all time, with sign-ups and members last seen by week.

### Other improvements

- A news post now takes the whole width of the page, with Previous and Next at its foot leading to the posts either side of it.
- The Developers, Volunteers and Supporters pages under About show each person as an LCARS panel, in the shape the rest of the site uses.
- A day you typed, such as when an STO account or a Character was created, is now kept as a date and no longer shifts with the clock.
- A Captain's page links to its account's Endeavour Perks, and its rank icon is named by its rank for screen readers.
- Chat, its log and every message's actions can be used from the keyboard, and the site honours reduced motion throughout.
- Storytime closes a removed item's open reports, and deleting a Story deletes its Chapters, cast and pictures with it.
- Custom Tracking takes a deleted account's or Character's answers with it.
- The site keeps serving, rate limiting and accepting uploads while its background services are briefly unavailable, and is served only through Cloudflare.
- Underlying code has been reorganised to clear every outstanding static-analysis finding, and dependencies are at their latest supported maintenance releases.
- Various behind-the-scenes reliability, testing, security and deployment improvements.

---

### Release information

This news post covers the following releases:

- [Backend v1.5.1](https://github.com/sto-info-app/sto-info-backend/releases/tag/v1.5.1)
- [Frontend v1.5.1](https://github.com/sto-info-app/sto-info-frontend/releases/tag/v1.5.1)
- [File scan worker v1.0.1](https://github.com/sto-info-app/sto-info-file-scan-worker/releases/tag/v1.0.1), a new service making its first production release`,
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
