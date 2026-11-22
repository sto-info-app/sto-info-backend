import { MigrationInterface, QueryRunner } from 'typeorm';

import { LOCAL_FIXTURE_COMMUNITY_ID } from './1794000000000-SeedLocalFleetFixtures';

/** The second local Community: public, taking applications. */
export const LOCAL_SECOND_COMMUNITY_ID = '7a1c2e3f-4b5d-4e6f-8a9b-0c1d2e3f4a5b';

/** The third local Community: shown to its members only, by invitation. */
export const LOCAL_PRIVATE_COMMUNITY_ID =
  '8b2d3f4a-5c6e-4f7a-9b0c-1d2e3f4a5b6c';

/** The two Armadas in the Fixture Community, Windows and Federation. */
export const LOCAL_ALPHA_ARMADA_ID = '9c3e4a5b-6d7f-4a8b-8c1d-2e3f4a5b6c7d';
export const LOCAL_BETA_ARMADA_ID = 'ad4f5b6c-7e8a-4b9c-9d2e-3f4a5b6c7d8e';

/**
 * The Fleets, by what they are for. Each has a fixed identity, so the seed
 * is idempotent and its reversal exact.
 */
export const LOCAL_FLEET_IDS = {
  /** The Alpha of the Alpha Armada. */
  alpha: 'be5a6c7d-8f9b-4cad-8e3f-4a5b6c7d8e9f',
  /** A Beta of the Alpha Armada, with the Gamma under it. */
  betaOne: 'cf6b7d8e-9a0c-4dbe-9f4a-5b6c7d8e9fa0',
  /** A Beta of the Alpha Armada, with a request open to move to the Beta Armada. */
  betaTwo: 'da7c8e9f-0b1d-4ecf-8a5b-6c7d8e9fa0b1',
  /** The Gamma under Beta One. */
  gamma: 'eb8d9fa0-1c2e-4fda-9b6c-7d8e9fa0b1c2',
  /** The Alpha of the Beta Armada. */
  lead: 'fc9ea0b1-2d3f-4aeb-8c7d-8e9fa0b1c2d3',
  /** A Federation Fleet in no Armada. */
  free: '0dafb1c2-3e4a-4bfc-9d8e-9fa0b1c2d3e4',
  /** A Klingon Fleet, which no Federation Armada takes. */
  klingon: '1eb0c2d3-4f5b-4cad-8e9f-a0b1c2d3e4f5',
  /** The second Community's two Fleets. */
  secondWindows: '2fc1d3e4-5a6c-4dbe-9fa0-b1c2d3e4f5a6',
  secondXbox: '30d2e4f5-6b7d-4ecf-8ab1-c2d3e4f5a6b7',
  /** The private Community's Fleet. */
  privateWindows: '41e3f5a6-7c8e-4fda-9bc2-d3e4f5a6b7c8',
} as const;

/** The placements, by the Fleet placed. */
export const LOCAL_PLACEMENT_IDS = {
  alpha: '52f4a6b7-8d9f-4aeb-8cd3-e4f5a6b7c8d9',
  betaOne: '6305b7c8-9ea0-4bfc-9de4-f5a6b7c8d9ea',
  betaTwo: '7416c8d9-afb1-4cad-8ef5-a6b7c8d9eafb',
  gamma: '8527d9ea-b0c2-4dbe-9fa6-b7c8d9eafb0c',
  lead: '9638eafb-c1d3-4ecf-8ab7-c8d9eafb0c1d',
} as const;

/** The request open for Beta Two to move to the Beta Armada. */
export const LOCAL_MOVE_REQUEST_ID = 'a749fb0c-d2e4-4fda-9bc8-d9eafb0c1d2e';

/** What one Fleet is seeded as. */
interface FleetSeed {
  readonly id: string;
  readonly communityId: string;
  readonly platform: string;
  readonly name: string;
  readonly slug: string;
  /** The general faction's name, or null for none stated. */
  readonly allegiance: string | null;
  readonly recruitment: 'OPEN' | 'APPLICATION' | 'INVITE_ONLY' | 'CLOSED';
  /** Who may see it: everybody, or the Community's members alone. */
  readonly visibility: 'PUBLIC' | 'COMMUNITY';
}

const FLEETS: readonly FleetSeed[] = [
  {
    id: LOCAL_FLEET_IDS.alpha,
    communityId: LOCAL_FIXTURE_COMMUNITY_ID,
    platform: 'Windows',
    name: 'Fixture Alpha Fleet',
    slug: 'fixture-alpha-fleet',
    allegiance: 'Federation',
    visibility: 'PUBLIC',
    recruitment: 'APPLICATION',
  },
  {
    id: LOCAL_FLEET_IDS.betaOne,
    communityId: LOCAL_FIXTURE_COMMUNITY_ID,
    platform: 'Windows',
    name: 'Fixture Beta One',
    slug: 'fixture-beta-one',
    allegiance: 'Federation',
    visibility: 'PUBLIC',
    recruitment: 'OPEN',
  },
  {
    id: LOCAL_FLEET_IDS.betaTwo,
    communityId: LOCAL_FIXTURE_COMMUNITY_ID,
    platform: 'Windows',
    name: 'Fixture Beta Two',
    slug: 'fixture-beta-two',
    allegiance: 'Federation',
    visibility: 'PUBLIC',
    recruitment: 'APPLICATION',
  },
  {
    id: LOCAL_FLEET_IDS.gamma,
    communityId: LOCAL_FIXTURE_COMMUNITY_ID,
    platform: 'Windows',
    name: 'Fixture Gamma Fleet',
    slug: 'fixture-gamma-fleet',
    allegiance: 'Federation',
    visibility: 'PUBLIC',
    recruitment: 'INVITE_ONLY',
  },
  {
    id: LOCAL_FLEET_IDS.lead,
    communityId: LOCAL_FIXTURE_COMMUNITY_ID,
    platform: 'Windows',
    name: 'Fixture Lead Fleet',
    slug: 'fixture-lead-fleet',
    allegiance: 'Federation',
    visibility: 'PUBLIC',
    recruitment: 'APPLICATION',
  },
  {
    id: LOCAL_FLEET_IDS.free,
    communityId: LOCAL_FIXTURE_COMMUNITY_ID,
    platform: 'Windows',
    name: 'Fixture Free Fleet',
    slug: 'fixture-free-fleet',
    allegiance: 'Federation',
    visibility: 'PUBLIC',
    recruitment: 'OPEN',
  },
  {
    id: LOCAL_FLEET_IDS.klingon,
    communityId: LOCAL_FIXTURE_COMMUNITY_ID,
    platform: 'Windows',
    name: 'Fixture Klingon Fleet',
    slug: 'fixture-klingon-fleet',
    allegiance: 'Klingon',
    visibility: 'PUBLIC',
    recruitment: 'APPLICATION',
  },
  {
    id: LOCAL_FLEET_IDS.secondWindows,
    communityId: LOCAL_SECOND_COMMUNITY_ID,
    platform: 'Windows',
    name: 'Second Fixture Fleet',
    slug: 'second-fixture-fleet',
    allegiance: 'Federation',
    visibility: 'PUBLIC',
    recruitment: 'APPLICATION',
  },
  {
    id: LOCAL_FLEET_IDS.secondXbox,
    communityId: LOCAL_SECOND_COMMUNITY_ID,
    platform: 'Xbox',
    name: 'Second Fixture Console Fleet',
    slug: 'second-fixture-console-fleet',
    allegiance: 'Klingon',
    visibility: 'PUBLIC',
    recruitment: 'OPEN',
  },
  {
    id: LOCAL_FLEET_IDS.privateWindows,
    communityId: LOCAL_PRIVATE_COMMUNITY_ID,
    platform: 'Windows',
    name: 'Private Fixture Fleet',
    slug: 'private-fixture-fleet',
    allegiance: 'Federation',
    visibility: 'COMMUNITY',
    recruitment: 'INVITE_ONLY',
  },
];

/** A placement: the Fleet, the Armada, its position and, for a Gamma, its Beta. */
interface PlacementSeed {
  readonly id: string;
  readonly armadaId: string;
  readonly fleetId: string;
  readonly position: 'ALPHA' | 'BETA' | 'GAMMA';
  readonly parentId: string | null;
  /** How many days ago it was placed. */
  readonly daysAgo: number;
}

const PLACEMENTS: readonly PlacementSeed[] = [
  {
    id: LOCAL_PLACEMENT_IDS.alpha,
    armadaId: LOCAL_ALPHA_ARMADA_ID,
    fleetId: LOCAL_FLEET_IDS.alpha,
    position: 'ALPHA',
    parentId: null,
    daysAgo: 30,
  },
  {
    id: LOCAL_PLACEMENT_IDS.betaOne,
    armadaId: LOCAL_ALPHA_ARMADA_ID,
    fleetId: LOCAL_FLEET_IDS.betaOne,
    position: 'BETA',
    parentId: null,
    daysAgo: 25,
  },
  {
    id: LOCAL_PLACEMENT_IDS.betaTwo,
    armadaId: LOCAL_ALPHA_ARMADA_ID,
    fleetId: LOCAL_FLEET_IDS.betaTwo,
    position: 'BETA',
    parentId: null,
    daysAgo: 20,
  },
  {
    id: LOCAL_PLACEMENT_IDS.gamma,
    armadaId: LOCAL_ALPHA_ARMADA_ID,
    fleetId: LOCAL_FLEET_IDS.gamma,
    position: 'GAMMA',
    parentId: LOCAL_PLACEMENT_IDS.betaOne,
    daysAgo: 10,
  },
  {
    id: LOCAL_PLACEMENT_IDS.lead,
    armadaId: LOCAL_BETA_ARMADA_ID,
    fleetId: LOCAL_FLEET_IDS.lead,
    position: 'ALPHA',
    parentId: null,
    daysAgo: 15,
  },
];

/**
 * Local-only Fleet Community fixtures for testing Armadas, the directories
 * and a move between Armadas by hand (FC-056, FC-057).
 *
 * Runs only with NODE_ENV `local`, and only once an account with
 * `DATASEED_FLEET_OWNER_EMAIL` exists, which owns everything it makes, as
 * the Fixture Community seed before it. Everything has a fixed identity, so
 * running it again adds nothing and reverting it removes exactly what it
 * made:
 *
 * - In the Fixture Community, two Windows Federation Armadas: the Alpha
 *   Armada with an Alpha, two Betas and a Gamma under the first Beta, and
 *   the Beta Armada with an Alpha alone. Six Windows Federation Fleets fill
 *   them, one left in no Armada and one, Beta Two, with a request open to
 *   move to the Beta Armada. A Klingon Fleet sits in no Armada, since none
 *   takes it.
 * - A second public Community taking applications, with a Windows
 *   Federation Fleet and an Xbox Klingon one.
 * - A third Community shown to its members only and joined by invitation,
 *   with one Fleet, so the directories have something they leave out.
 *
 * No roster is seeded: importing an export through the page uses the real
 * path, and that is what wants testing.
 */
export class SeedLocalFleetArmadaFixtures1798700000000 implements MigrationInterface {
  name = 'SeedLocalFleetArmadaFixtures1798700000000';

  /**
   * Seeds the fixtures, for the owner the environment names.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!isLocal()) {
      return;
    }

    const email = process.env.DATASEED_FLEET_OWNER_EMAIL?.trim();

    if (!email) {
      return;
    }

    const owners: Array<{ id: string }> = await queryRunner.query(
      `SELECT "id" FROM "sto_info_app"."user"
        WHERE lower("email") = lower($1) AND "deletedAt" IS NULL`,
      [email],
    );

    if (owners.length === 0) {
      return;
    }

    const ownerId = owners[0].id;

    await queryRunner.query(
      `INSERT INTO "sto_info_app"."fleet_community"
         ("id", "ownerUserId", "name", "slug", "description", "recruitmentState", "visibility")
       VALUES
         ($1, $2, 'Second Fixture Community', 'second-fixture-community',
          'A second local Community, taking applications.', 'APPLICATION', 'PUBLIC'),
         ($3, $2, 'Private Fixture Community', 'private-fixture-community',
          'A local Community its members alone can see.', 'INVITE_ONLY', 'COMMUNITY')
       ON CONFLICT ("id") DO NOTHING`,
      [LOCAL_SECOND_COMMUNITY_ID, ownerId, LOCAL_PRIVATE_COMMUNITY_ID],
    );

    for (const [id, name, slug] of [
      [LOCAL_ALPHA_ARMADA_ID, 'Fixture Alpha Armada', 'fixture-alpha-armada'],
      [LOCAL_BETA_ARMADA_ID, 'Fixture Beta Armada', 'fixture-beta-armada'],
    ]) {
      await queryRunner.query(
        `INSERT INTO "sto_info_app"."sto_armada"
           ("id", "communityId", "platformId", "exactGameName", "exactGameNameNormalized", "slug", "allegianceFactionId")
         SELECT $1, $2, "platform"."id", $3, $4, $5, "faction"."id"
           FROM "sto_info_app"."platform" AS "platform",
                "sto_info_app"."character_general_faction" AS "faction"
          WHERE "platform"."name" = 'Windows' AND "platform"."deletedAt" IS NULL
            AND "faction"."name" = 'Federation'
         ON CONFLICT ("id") DO NOTHING`,
        [id, LOCAL_FIXTURE_COMMUNITY_ID, name, normalise(name), slug],
      );
    }

    for (const fleet of FLEETS) {
      await queryRunner.query(
        `INSERT INTO "sto_info_app"."sto_fleet"
           ("id", "communityId", "platformId", "exactGameName", "exactGameNameNormalized", "slug", "allegianceFactionId", "recruitmentState", "visibility")
         SELECT $1, $2, "platform"."id", $3, $4, $5,
                (SELECT "id" FROM "sto_info_app"."character_general_faction" WHERE "name" = $6),
                $7::"sto_info_app"."fleet_recruitment_state_enum",
                $9::"sto_info_app"."fleet_audience_enum"
           FROM "sto_info_app"."platform" AS "platform"
          WHERE "platform"."name" = $8 AND "platform"."deletedAt" IS NULL
         ON CONFLICT ("id") DO NOTHING`,
        [
          fleet.id,
          fleet.communityId,
          fleet.name,
          normalise(fleet.name),
          fleet.slug,
          fleet.allegiance,
          fleet.recruitment,
          fleet.platform,
          fleet.visibility,
        ],
      );
    }

    for (const placement of PLACEMENTS) {
      await queryRunner.query(
        `INSERT INTO "sto_info_app"."armada_fleet_membership"
           ("id", "communityId", "armadaId", "fleetId", "position", "parentMembershipId", "validFrom", "reason", "recordedByUserId")
         VALUES ($1, $2, $3, $4, $5::"sto_info_app"."armada_position_enum", $6,
                 now() - make_interval(days => $7::int), 'Seeded for local testing', $8)
         ON CONFLICT ("id") DO NOTHING`,
        [
          placement.id,
          LOCAL_FIXTURE_COMMUNITY_ID,
          placement.armadaId,
          placement.fleetId,
          placement.position,
          placement.parentId,
          placement.daysAgo,
          ownerId,
        ],
      );
    }

    // Beta Two has asked to move to the Beta Armada (FC-057); it stays in
    // the Alpha Armada until that request is answered.
    await queryRunner.query(
      `INSERT INTO "sto_info_app"."armada_join_request"
         ("id", "communityId", "armadaId", "fleetId", "requestedByUserId", "message", "expiresAt")
       VALUES ($1, $2, $3, $4, $5, 'Seeded request to move, for local testing',
               now() + make_interval(days => 14))
       ON CONFLICT ("id") DO NOTHING`,
      [
        LOCAL_MOVE_REQUEST_ID,
        LOCAL_FIXTURE_COMMUNITY_ID,
        LOCAL_BETA_ARMADA_ID,
        LOCAL_FLEET_IDS.betaTwo,
        ownerId,
      ],
    );
  }

  /**
   * Removes exactly what the seed made.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!isLocal()) {
      return;
    }

    const fleetIds = Object.values(LOCAL_FLEET_IDS);
    const armadaIds = [LOCAL_ALPHA_ARMADA_ID, LOCAL_BETA_ARMADA_ID];
    const communityIds = [
      LOCAL_SECOND_COMMUNITY_ID,
      LOCAL_PRIVATE_COMMUNITY_ID,
    ];

    await queryRunner.query(
      `DELETE FROM "sto_info_app"."armada_join_request" WHERE "fleetId" = ANY($1::uuid[]) OR "armadaId" = ANY($2::uuid[])`,
      [fleetIds, armadaIds],
    );
    await queryRunner.query(
      `DELETE FROM "sto_info_app"."armada_fleet_membership" WHERE "fleetId" = ANY($1::uuid[]) OR "armadaId" = ANY($2::uuid[])`,
      [fleetIds, armadaIds],
    );
    // A retired slug remembers what it pointed at, so it is found by target.
    await queryRunner.query(
      `DELETE FROM "sto_info_app"."fleet_slug_history"
        WHERE "targetId" = ANY($1::uuid[]) OR "targetId" = ANY($2::uuid[]) OR "targetId" = ANY($3::uuid[])`,
      [fleetIds, armadaIds, communityIds],
    );
    // Aliases, grants, memberships and role assignments cascade.
    await queryRunner.query(
      `DELETE FROM "sto_info_app"."sto_fleet" WHERE "id" = ANY($1::uuid[])`,
      [fleetIds],
    );
    await queryRunner.query(
      `DELETE FROM "sto_info_app"."sto_armada" WHERE "id" = ANY($1::uuid[])`,
      [armadaIds],
    );
    await queryRunner.query(
      `DELETE FROM "sto_info_app"."fleet_community" WHERE "id" = ANY($1::uuid[])`,
      [communityIds],
    );
  }
}

/**
 * Folds a name as the registration does, for the duplicate check.
 *
 * @param name - The exact game name.
 * @returns The folded name.
 */
function normalise(name: string): string {
  return name.normalize('NFC').toLowerCase();
}

/**
 * Whether this is a local database.
 *
 * @returns True with NODE_ENV `local`.
 */
function isLocal(): boolean {
  return process.env.NODE_ENV?.trim().toLowerCase() === 'local';
}
