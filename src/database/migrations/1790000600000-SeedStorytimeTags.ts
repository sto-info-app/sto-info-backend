import { MigrationInterface, QueryRunner } from 'typeorm';

type TagCategory =
  | 'FACTION'
  | 'ERA'
  | 'GENRE'
  | 'TONE'
  | 'THEME'
  | 'SPECIES'
  | 'CONTENT_WARNING'
  | 'FORMAT'
  | 'CONTINUITY';

interface TagSeed {
  name: string;
  slug: string;
}

/**
 * The initial shared vocabulary, including the examples used to shape the
 * Storytime tag screens. Keep this data in the migration: importing mutable
 * application constants would make an old migration change over time.
 */
const TAGS: Record<TagCategory, TagSeed[]> = {
  FACTION: [
    { name: 'Borg Collective', slug: 'borg-collective' },
    { name: 'Breen Confederacy', slug: 'breen-confederacy' },
    { name: 'Cardassian Union', slug: 'cardassian-union' },
    { name: 'Dominion', slug: 'dominion' },
    { name: 'Federation', slug: 'federation' },
    { name: 'Iconian Empire', slug: 'iconian-empire' },
    { name: 'Khitomer Alliance', slug: 'khitomer-alliance' },
    { name: 'Klingon Empire', slug: 'klingon-empire' },
    { name: 'Romulan Republic', slug: 'romulan-republic' },
    { name: 'Terran Empire', slug: 'terran-empire' },
    { name: 'Tholian Assembly', slug: 'tholian-assembly' },
    { name: 'Undine', slug: 'undine' },
    { name: 'Voth', slug: 'voth' },
  ],
  ERA: [
    { name: '22nd Century', slug: '22nd-century' },
    { name: '23rd Century', slug: '23rd-century' },
    { name: '24th Century', slug: '24th-century' },
    { name: '25th Century', slug: '25th-century' },
    { name: '32nd Century', slug: '32nd-century' },
    { name: 'Deep Space Nine Era', slug: 'deep-space-nine-era' },
    { name: 'Discovery Era', slug: 'discovery-era' },
    { name: 'Dominion War', slug: 'dominion-war' },
    { name: 'Enterprise Era', slug: 'enterprise-era' },
    { name: 'Iconian War', slug: 'iconian-war' },
    { name: 'Klingon Civil War', slug: 'klingon-civil-war' },
    { name: 'Lost Era', slug: 'lost-era' },
    { name: 'Motion Picture Era', slug: 'motion-picture-era' },
    { name: 'Original Series Era', slug: 'original-series-era' },
    { name: 'Temporal Cold War', slug: 'temporal-cold-war' },
    { name: 'The Next Generation Era', slug: 'the-next-generation-era' },
    { name: 'Voyager Era', slug: 'voyager-era' },
  ],
  GENRE: [
    { name: 'Action', slug: 'action' },
    { name: 'Adventure', slug: 'adventure' },
    { name: 'Comedy', slug: 'comedy' },
    { name: 'Court Drama', slug: 'court-drama' },
    { name: 'Drama', slug: 'drama' },
    { name: 'Exploration', slug: 'exploration' },
    { name: 'First Contact', slug: 'first-contact' },
    { name: 'Horror', slug: 'horror' },
    { name: 'Mystery', slug: 'mystery' },
    { name: 'Political Drama', slug: 'political-drama' },
    { name: 'Romance', slug: 'romance' },
    { name: 'Science Fiction', slug: 'science-fiction' },
    { name: 'Thriller', slug: 'thriller' },
    { name: 'War', slug: 'war' },
  ],
  TONE: [
    { name: 'Bittersweet', slug: 'bittersweet' },
    { name: 'Bleak', slug: 'bleak' },
    { name: 'Comic', slug: 'comic' },
    { name: 'Hopeful', slug: 'hopeful' },
    { name: 'Light-hearted', slug: 'light-hearted' },
    { name: 'Serious', slug: 'serious' },
    { name: 'Suspenseful', slug: 'suspenseful' },
    { name: 'Tragic', slug: 'tragic' },
    { name: 'Uplifting', slug: 'uplifting' },
  ],
  THEME: [
    { name: 'Diplomacy', slug: 'diplomacy' },
    { name: 'Duty', slug: 'duty' },
    { name: 'Ethics', slug: 'ethics' },
    { name: 'Family', slug: 'family' },
    { name: 'Friendship', slug: 'friendship' },
    { name: 'Grief', slug: 'grief' },
    { name: 'Identity', slug: 'identity' },
    { name: 'Loyalty', slug: 'loyalty' },
    { name: 'Prejudice', slug: 'prejudice' },
    { name: 'Redemption', slug: 'redemption' },
    { name: 'Sacrifice', slug: 'sacrifice' },
    { name: 'Survival', slug: 'survival' },
  ],
  SPECIES: [
    { name: 'Andorian', slug: 'andorian' },
    { name: 'Bajoran', slug: 'bajoran' },
    { name: 'Benzite', slug: 'benzite' },
    { name: 'Betazoid', slug: 'betazoid' },
    { name: 'Bolian', slug: 'bolian' },
    { name: 'Caitian', slug: 'caitian' },
    { name: 'Cardassian', slug: 'cardassian' },
    { name: 'Ferasan', slug: 'ferasan' },
    { name: 'Ferengi', slug: 'ferengi' },
    { name: 'Gorn', slug: 'gorn' },
    { name: 'Human', slug: 'human' },
    { name: "Jem'Hadar", slug: 'jem-hadar' },
    { name: 'Klingon', slug: 'klingon' },
    { name: 'Lethean', slug: 'lethean' },
    { name: 'Liberated Borg', slug: 'liberated-borg' },
    { name: 'Nausicaan', slug: 'nausicaan' },
    { name: 'Orion', slug: 'orion' },
    { name: 'Pakled', slug: 'pakled' },
    { name: 'Reman', slug: 'reman' },
    { name: 'Rigelian', slug: 'rigelian' },
    { name: 'Romulan', slug: 'romulan' },
    { name: 'Saurian', slug: 'saurian' },
    { name: 'Talaxian', slug: 'talaxian' },
    { name: 'Tellarite', slug: 'tellarite' },
    { name: 'Trill', slug: 'trill' },
    { name: 'Vulcan', slug: 'vulcan' },
  ],
  CONTENT_WARNING: [
    { name: 'Abuse', slug: 'abuse' },
    { name: 'Betrayal', slug: 'betrayal' },
    { name: 'Body Horror', slug: 'body-horror' },
    { name: 'Captivity', slug: 'captivity' },
    { name: 'Character Death', slug: 'character-death' },
    { name: 'Discrimination', slug: 'discrimination' },
    { name: 'Gore', slug: 'gore' },
    { name: 'Major Injury', slug: 'major-injury' },
    { name: 'Medical Trauma', slug: 'medical-trauma' },
    { name: 'Mental Illness', slug: 'mental-illness' },
    { name: 'Pregnancy', slug: 'pregnancy' },
    { name: 'Self-harm', slug: 'self-harm' },
    { name: 'Sexual Content', slug: 'sexual-content' },
    { name: 'Substance Use', slug: 'substance-use' },
    { name: 'Suicide', slug: 'suicide' },
    { name: 'Torture', slug: 'torture' },
    { name: 'Violence', slug: 'violence' },
  ],
  FORMAT: [
    { name: 'Episodic', slug: 'episodic' },
    { name: 'Epistolary', slug: 'epistolary' },
    { name: 'Novel', slug: 'novel' },
    { name: 'Novella', slug: 'novella' },
    { name: 'One-shot', slug: 'one-shot' },
    { name: 'Script', slug: 'script' },
    { name: 'Serial', slug: 'serial' },
    { name: 'Ship Log', slug: 'ship-log' },
    { name: 'Short Story', slug: 'short-story' },
  ],
  CONTINUITY: [
    { name: 'Kelvin Timeline', slug: 'kelvin-timeline' },
    { name: 'Mirror Universe', slug: 'mirror-universe' },
    { name: 'Prime Timeline', slug: 'prime-timeline' },
    { name: 'STO Alternate Universe', slug: 'sto-alternate-universe' },
    { name: 'STO Canon-compliant', slug: 'sto-canon-compliant' },
    { name: 'STO Canon-divergent', slug: 'sto-canon-divergent' },
    { name: 'STO Future Continuation', slug: 'sto-future-continuation' },
  ],
};

const TAG_ID_NAMESPACE = 'sto-info-storytime-tag:';

export class SeedStorytimeTags1790000600000 implements MigrationInterface {
  name = 'SeedStorytimeTags1790000600000';

  /**
   * Adds the agreed initial Storytime vocabulary.
   *
   * The insert deliberately does not update a conflict. Administrators may
   * already have changed an example tag's name, description or order locally;
   * a deployment must not overwrite that work. Deterministic IDs let `down`
   * remove only rows this migration inserted, not pre-existing conflicts.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    const actingUserId = await this.findActingUserId(queryRunner);
    const parameters: unknown[] = [actingUserId];
    const values: string[] = [];

    for (const [category, tags] of Object.entries(TAGS) as Array<
      [TagCategory, TagSeed[]]
    >) {
      tags.forEach((tag, displayOrder) => {
        const parameterOffset = parameters.length + 1;
        parameters.push(tag.slug, tag.name, category, displayOrder);
        values.push(`(
          md5('${TAG_ID_NAMESPACE}' || $${parameterOffset})::uuid,
          $${parameterOffset}, $${parameterOffset + 1}, NULL,
          $${parameterOffset + 2}, true, $${parameterOffset + 3}, $1, $1
        )`);
      });
    }

    await queryRunner.query(
      `
      INSERT INTO "sto_info_app"."storytime_tag" (
        "id", "slug", "name", "description", "category",
        "isAdminManaged", "displayOrder", "createdByUserId", "updatedByUserId"
      )
      VALUES ${values.join(',\n')}
      ON CONFLICT DO NOTHING
      `,
      parameters,
    );
  }

  /**
   * Removes only tags whose deterministic IDs prove this migration inserted
   * them. Join-table rows follow by cascade.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const slugs = Object.values(TAGS).flatMap(tags =>
      tags.map(tag => tag.slug),
    );

    await queryRunner.query(
      `
      DELETE FROM "sto_info_app"."storytime_tag"
      WHERE "slug" = ANY($1::varchar[])
        AND "id" = md5('${TAG_ID_NAMESPACE}' || "slug")::uuid
      `,
      [slugs],
    );
  }

  /** Finds the user recorded as the owner of migration-seeded tags. */
  private async findActingUserId(queryRunner: QueryRunner): Promise<string> {
    const seedEmail = process.env.DATASEED_USER_EMAIL?.trim();

    if (seedEmail) {
      const seedUsers = (await queryRunner.query(
        `
        SELECT "id"
        FROM "sto_info_app"."user"
        WHERE LOWER("email") = LOWER($1)
          AND "deletedAt" IS NULL
        LIMIT 1
        `,
        [seedEmail],
      )) as Array<{ id: string }>;

      if (seedUsers[0]) {
        return seedUsers[0].id;
      }
    }

    const administrators = (await queryRunner.query(`
      SELECT "id"
      FROM "sto_info_app"."user"
      WHERE "role" = 'ADMIN'
        AND "deletedAt" IS NULL
      ORDER BY "createdAt", "id"
      LIMIT 1
    `)) as Array<{ id: string }>;

    if (!administrators[0]) {
      throw new Error(
        'A live seed user or administrator is required to seed Storytime tags',
      );
    }

    return administrators[0].id;
  }
}
