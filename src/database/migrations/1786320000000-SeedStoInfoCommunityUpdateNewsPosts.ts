import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds the news posts covering the community update released in Backend
 * v1.3.3 and Frontend v1.3.3: the release notes for the update itself, and an
 * announcement introducing the new Community section with its expected FAQs.
 */
export class SeedStoInfoCommunityUpdateNewsPosts1786320000000 implements MigrationInterface {
  name = 'SeedStoInfoCommunityUpdateNewsPosts1786320000000';

  /**
   * The STO Info posts to seed. Bodies are authored as Markdown.
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
      slug: 'sto-info-community-and-home-page-update',
      title:
        'Community and Friends added, plus Home Page and Character Updates',
      summary:
        'Since the last release, STO Info has added the Community section, refreshed the home page, and improved captain pages and links.',
      category: 'RELEASE_NOTES',
      publishedAt: '2026-08-11T03:00:00.000Z',
      body: `Since the last release, STO Info has added the new Community section, refreshed the home page, and improved captain pages and links.

### What is new

#### The Galactic Personnel Registry

- A public directory of STO Info members who have chosen to share their record with the fleet.
- Browse member profiles and see the STO accounts and captains they command on the [registry](/community/registry/profiles).
- Find members quickly through the Search, Recently Joined and Recently Active views.
- Appearing in the [registry](/community/registry/profiles) is entirely your choice: nothing is shown until you opt in from your profile, and you decide exactly which STO accounts and captains appear.
- Your real name, email address and private notes are never shown.

#### Friends, blocking and reporting

- Send a friend request to any member you find in the registry.
- A request has to be accepted before it becomes a friendship, so nobody joins your list uninvited.
- Keep track of your friends and pending requests from the [Friends page](/community/friends).
- Block a member to hide your records from each other and stop friend requests passing between you. The other member is never told.
- Report a member to the site's administrators if their profile or behaviour breaks the rules. Reports are private and are reviewed by the team.

#### Playing Since

- Your public record can now show how long you have been playing Star Trek Online, taken from the oldest of your publicly visible STO accounts.

#### General improvements

- The home page now greets you with the latest news and a tidier dashboard-style layout.
- The public roadmap has been refreshed to reflect the latest progress.
- Captain pages now show the captain's full handle, including the account it belongs to.
- Captain web addresses are shorter and easier to share, and older links still work.

### Release information

This news post covers the following releases:

- [Backend v1.3.3](https://github.com/sto-info-app/sto-info-backend/releases/tag/v1.3.3)
- [Frontend v1.3.3](https://github.com/sto-info-app/sto-info-frontend/releases/tag/v1.3.3)`,
    },
    {
      slug: 'sto-info-introducing-the-community',
      title: 'Introducing the STO Info Community',
      summary:
        'Meet the new Community section: the Galactic Personnel Registry, friends, and the controls that keep your record private until you choose otherwise.',
      category: 'ANNOUNCEMENT',
      publishedAt: '2026-08-11T04:00:00.000Z',
      body: `The new Community section is now open. It's where you can find fellow officers, share your service record, and build a friends list — all on your terms.

### What is the Galactic Personnel Registry?

The [Galactic Personnel Registry](/community/registry/profiles) is a public directory of STO Info members who have chosen to make their record public. Anyone can browse it — you do not even need to be signed in — and each record shows the member's username, profile picture, when they joined, when they were last seen, and the STO accounts and captains they have chosen to share.

Nothing about you appears in the registry unless you switch it on, and your real name, email address and private notes are never shown.

### How to appear in the registry

1. Sign in and open your [Dashboard](/dashboard).
2. [Edit your personal details](/dashboard/profile) and switch on "Show me in the Galactic Personnel Registry".
3. Mark any STO accounts and captains you would like to share as "Publicly Visible". Anything you leave switched off stays private.

You can change your mind at any time — switch the toggle off and your record disappears from the [registry](/community/registry/profiles).

### Making friends

When you are viewing another member's record, choose "Add Friend" to send them a friend request. They can accept or decline, and you can withdraw a request you have sent. Once accepted, you will find each other on the [Friends page](/community/friends), and either of you can end the friendship later if you wish.

### Staying in control

- **Blocking** — if you would rather not hear from someone, you can block them from their record. Blocking ends any friendship between you, stops either of you sending the other a friend request, and hides your records from each other. The other member is never told.
- **Reporting** — if a member's profile or behaviour breaks the rules, choose "Report" on their record, pick the closest reason and add a few details. Reports go privately to the site's administrators for review.

### Frequently asked questions

#### Do I have to take part?

No. The registry is entirely opt-in, and your record is private until you switch on the toggle in your profile.

#### What becomes public when I opt in?

Your username, profile picture, join date, last sign-in date and — if you have shared an STO account — how long you have been playing Star Trek Online. Your STO accounts and captains only appear if you have also marked them as "Publicly Visible". Your real name, email address and private notes are never shown.

#### Can I change my mind later?

Yes. Switch off "Show me in the Galactic Personnel Registry" in your profile and your record is removed from the registry straight away. You can also hide individual accounts or captains at any time.

#### Do I need to be signed in to browse the registry?

No. Anyone can browse the registry. You only need to sign in to send friend requests, block members or report a member.

#### How do friend requests work?

A friendship only forms when the other member accepts your request, so nobody is added to a friends list uninvited. Either member can end a friendship at any time.

#### Will someone know if I block them?

No. Blocking is private — the other member is never told. Your records are hidden from each other, and friend requests can no longer pass between you.

#### Will someone know if I report them?

No. Reports are only visible to the site's administrators, who review each one and decide what action to take. The reported member is not told who raised the report, and you will not be notified of the outcome of the report.

#### Is STO Info linked to Cryptic or other accounts and data?

No. STO Info only contains data that members have manually submitted to the site. It is not linked to Cryptic or any other entities' accounts, systems or data.

#### Where does the "Playing Since" date come from?

It is taken from the oldest creation date among the STO accounts you have marked as publicly visible. If you have not shared an account, no date is shown.`,
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
