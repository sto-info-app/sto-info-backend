import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds a news post announcing Fleet Communities, released as part of
 * Backend v1.5.1, Frontend v1.5.1 and the file scan worker v1.0.1.
 *
 * The post is dated as it lands, two hours before the release notes seeded
 * after it, so that the notes sit above the announcements on the site's news
 * as v1.4's did. Fleet Community's ScopeNewsPosts has run in every database
 * this reaches, so the slug is unique only among the site's own posts and the
 * upsert names that predicate.
 */
export class SeedStoInfoFleetCommunitiesAnnouncementNewsPost1798300000000 implements MigrationInterface {
  name = 'SeedStoInfoFleetCommunitiesAnnouncementNewsPost1798300000000';

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
      slug: 'sto-info-introducing-fleet-communities',
      title: 'Introducing Fleet Communities',
      summary:
        'Register your Community, its Fleets and its Armadas, import rosters and keep their history, recruit, schedule events, publish news, record holdings, and chat with your Fleet and your friends.',
      category: 'ANNOUNCEMENT',
      publishedHoursAgo: 2,
      body: `STO Info has always been about the individual player: your STO accounts, your Captains, and what each of them has done. But almost nobody plays Star Trek Online alone.

With **Fleet Communities**, STO Info now records the groups you play with: your Community, the Fleets in it and the Armadas they ally in, with their rosters, their recruitment, their events, their news and their chat, all in one place.

### Three kinds of record

Fleet Communities uses three words, and they mean the same thing on every page:

- **Community** — this site's own umbrella for your group. It holds the Fleets and Armadas you register, it is not tied to one platform, and its name is yours to choose.
- **Fleet** — one in-game Fleet on one platform, recorded under the name the game shows, character for character.
- **Armada** — one in-game Armada on one platform, allying some of a Community's own Fleets the way the game arranges them: one Alpha, up to three Betas, and up to three Gammas under each Beta.

A Fleet can also be recorded with no Community at all, as a Fleet nobody here runs, so that anybody looking for it still finds it.

### Find a Fleet, or follow a Community

The new **Fleet Directory**, under Fleets in the side bar, lists the public Communities, Fleets and Armadas on three tabs. Search them by name, and narrow the Fleets by platform, allegiance, whether they are recruiting and when their roster was last imported. Every card tells two records of the same name apart.

Signed in, you can **follow a Community** to see what it publishes to its followers. The Communities you follow are gathered on a new Fleets tile on your Dashboard, with your upcoming events and your Fleet activity beneath them.

### Register your own

Anybody signed in can register a Community and becomes its Owner, then register its Fleets and Armadas into it. Each record has its own banner and emblem, a description, a choice of how people join, and a choice of who can see it, from Anyone down to Only me.

Every Community, Fleet and Armada is run through the same four roles: **Owner**, **Admin**, **Officer** and **Member**. The Owner decides exactly what each Officer may do, can grant or deny a single capability to a particular person, can hand the Community over to one of its Admins, and can close a record when its time comes. Every change is kept in the record's history.

### Your Characters and their Fleets

Each of your Captains can now say which Fleet it is in, and which it was in before, from its own page on your Dashboard. That record is yours alone: you write it, you choose who sees it, and nothing a Fleet does can write it for you.

When a Fleet's roster lists a Captain with exactly your Character's name and handle, STO Info asks you whether it is yours rather than assuming. You decide, and you can say no.

### Joining and recruiting

A Fleet chooses how it recruits: open to anybody who meets its requirements, taking applications on a form of its own, by invitation only, or not at all. You join, apply or accept an invitation with one of your Characters, and follow everything you have sent from **Your Fleet applications** on your Dashboard.

Those who run a Fleet decide applications, invite people by their STO Info username, and look after their members, with a reason recorded for every decision. STO Info cannot invite anybody in the game, so an officer still sends the in-game invitation; the record here is where it is kept.

### Rosters, history and reports

If your Fleet is on Windows, you can import the roster export the game writes. STO Info checks the file before anything is kept, tells you how it would be read, and discards the officer-only comment columns before it reads a single row.

Each export is a snapshot of one moment, and the more of them a Fleet imports, the more its **History** can say: who joined, rejoined or left, who was renamed, whose rank changed, and how contribution rose between one export and the next. Renames are suggested with a confidence, never assumed, and a Fleet's investigators can confirm or reject them, order the Fleet's ranks, correct an import read on the wrong clock, and settle two exports that disagree.

Eight **Reports** turn those records into tables and charts: Growth, Activity, Tenure, Ranks and Contribution from the roster history, and Attendance, Recruitment and Holdings from what the Fleet does on STO Info. The Fleet's Owner chooses who sees each one, any report can be downloaded as a CSV file, and a figure that would let a single member be picked out is hidden.

### Armadas and holdings

A Fleet asks to join an Armada from its own page, and the Armada's managers approve it into an Alpha, Beta or Gamma position, move it, or let it go, with every placement kept in the Armada's history. While a Fleet is in an Armada, its members are members of the Armada too.

A Fleet's **Holdings** tab records how far it has got with each of its holdings, from the Fleet Starbase to the Fleet Colony World, track by track, with a history of every change.

### News, activity and events

Every Community, Fleet and Armada has news of its own, written in Markdown with an optional cover picture and published to the readers its writers choose. Beside it runs an **activity feed**: a quiet record of what has happened there, such as a post published, an event added or a member joining.

Each also has a **calendar**. An event can happen once or repeat, runs on the clock its organiser chose, and is shown in yours. Answer Going, Maybe or Can't go as one of your Characters, take a place from the waitlist when one comes free, ask to be reminded fifteen minutes, an hour or a day before, and let the organisers record who came.

### Chat

**Chat** is live conversation for the people in a Fleet, its Armada and its Community, and between friends. Every record has a General channel for all its members, and its moderators can add up to three more, each kept for the roles that may read and post in it.

Reply to a message, mention somebody by typing @, add emoji from the picker in the corner of the message box, and see when a friend is online or typing, if they have chosen to let you. Direct messages are between friends only, and you can start one from the + beside Direct messages or from a friend's profile.

Chat is for talking now: you can read back the last four hours, and every message is deleted after 45 days. A Fleet's administrators can export a transcript of a channel, giving a purpose that is logged, and anybody can report a message straight to the site's administrators. What others see of you in chat is set on the new Chat tab of Settings.

### Privacy and safety

Nothing about your Characters is shared with a Fleet unless you share it, and every record, post and event is shown only to the people it was published to. A roster row shows that a name was listed, never who plays it, and anybody a roster lists, with an account here or without one, can ask for their roster data to be erased from every Fleet.

Fleet Communities keeps some things for a set time and then forgets them: chat for 45 days, uploaded roster files for 180 days, activity for twelve months. The new Help guide **How long things are kept** gives every figure, and the Privacy Policy and Terms of Use have been updated to cover it all.

Reports of members and of chat messages go to the site's administrators, who can suspend a record, settle a dispute over who runs a Community, or take down a picture, with a reason kept for every action.

### Help is built in

The Help section has a new **Fleets** topic with a guide for every part of Fleet Communities, from registering a Community to reading a roster report, most with a walk-through video. Every Fleet page links to its own guide.

Whether you run a Fleet of hundreds or play with three friends, **Fleet Communities is now part of STO Info**. Find your Fleet in the Fleet Directory, or register your Community today.`,
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
