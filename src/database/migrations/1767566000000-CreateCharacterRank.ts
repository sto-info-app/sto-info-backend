import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCharacterRank1767566000000 implements MigrationInterface {
  name = 'CreateCharacterRank1767566000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "sto_info_app"."character_rank" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "levelFrom" integer NOT NULL,
        "levelTo" integer NOT NULL,
        "rankTitle" character varying(100) NOT NULL,
        "iconUrl" character varying(511),
        "factionId" uuid NOT NULL,
        CONSTRAINT "PK_character_rank" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."character_rank" 
      ADD CONSTRAINT "FK_character_rank_faction" 
      FOREIGN KEY ("factionId") REFERENCES "sto_info_app"."character_faction"("id") 
      ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    // --- Seeding Data ---
    const factions = [
      'Starfleet (2409)',
      'TOS Starfleet',
      'Discovery Starfleet',
      'Klingon Defense Force',
      'Romulan Republic',
      'Dominion',
    ];

    const ranksData = [
      {
        from: 0,
        to: 0,
        titles: [
          'Cadet',
          'Lieutenant Junior Grade',
          'Citizen',
          'Warrior',
          'Citizen',
          null,
        ],
        urls: [
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/82fd6cad-dfb5-465c-2d0a-30a7ae2e2100/public',
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/82fd6cad-dfb5-465c-2d0a-30a7ae2e2100/public',
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/82fd6cad-dfb5-465c-2d0a-30a7ae2e2100/public',
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/44821a1d-a613-449f-94c6-64e82843ca00/public',
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/82692c0e-4d1b-459e-e926-098193473500/public',
          null,
        ],
      },
      {
        from: 1,
        to: 9,
        titles: [
          'Lieutenant',
          'Lieutenant',
          'Lieutenant',
          'Lieutenant',
          'Lieutenant',
          null,
        ],
        urls: [
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/ae204f97-aa7e-4740-eaf6-e5d561a78e00/public',
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/ae204f97-aa7e-4740-eaf6-e5d561a78e00/public',
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/ae204f97-aa7e-4740-eaf6-e5d561a78e00/public',
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/940093e7-142c-4cc4-f2f3-27c377222700/public',
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/970edf0c-9efa-4483-4df8-29c293439800/public',
          null,
        ],
      },
      {
        from: 10,
        to: 19,
        titles: [
          'Lieutenant Commander',
          'Lieutenant Commander',
          'Centurion',
          'Lieutenant Commander',
          'Centurion',
          null,
        ],
        urls: [
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/94d82aa7-8d52-421f-9abd-69e944f88400/public',
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/94d82aa7-8d52-421f-9abd-69e944f88400/public',
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/94d82aa7-8d52-421f-9abd-69e944f88400/public',
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/2cb527a5-5da2-4ad1-fbf8-d4560f425a00/public',
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/c41f09b7-8dbd-4537-45b1-436d631bef00/public',
          null,
        ],
      },
      {
        from: 20,
        to: 29,
        titles: [
          'Commander',
          'Commander',
          'Subcommander',
          'Commander',
          'Subcommander',
          null,
        ],
        urls: [
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/cac631a7-69a5-4466-ebef-e8a601536c00/public',
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/cac631a7-69a5-4466-ebef-e8a601536c00/public',
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/cac631a7-69a5-4466-ebef-e8a601536c00/public',
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/72e0df0b-992e-404e-5202-eba5bcbb6e00/public',
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/35fb2c6e-18dd-42ec-f21f-c848f6980f00/public',
          null,
        ],
      },
      {
        from: 30,
        to: 39,
        titles: [
          'Captain',
          'Captain',
          'Commander',
          'Captain',
          'Commander',
          null,
        ],
        urls: [
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/1809db07-3dcf-4888-f227-898e94e24800/public',
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/1809db07-3dcf-4888-f227-898e94e24800/public',
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/1809db07-3dcf-4888-f227-898e94e24800/public',
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/9a1b38bc-a7d6-4bf8-9a12-44e2a45ff100/public',
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/764821a1-6f2d-4562-e682-2497e4d2ed00/public',
          null,
        ],
      },
      {
        from: 40,
        to: 44,
        titles: [
          'Rear Admiral, Lower Half',
          'Rear Admiral, Lower Half',
          'Subadmiral I',
          'Brigadier General',
          'Subadmiral I',
          null,
        ],
        urls: [
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/fbcf9b63-f148-464c-c15c-947727023d00/public',
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/fbcf9b63-f148-464c-c15c-947727023d00/public',
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/fbcf9b63-f148-464c-c15c-947727023d00/public',
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/f7b9b6dc-3972-4474-9a18-12fd6ae4d700/public',
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/258d5e33-87b8-4eaf-b3b4-ceb3e0f1e400/public',
          null,
        ],
      },
      {
        from: 45,
        to: 49,
        titles: [
          'Rear Admiral, Upper Half',
          'Rear Admiral, Upper Half',
          'Subadmiral II',
          'Major General',
          'Subadmiral II',
          null,
        ],
        urls: [
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/e06cbf28-12f0-4a06-a0ba-09db322cb200/public',
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/e06cbf28-12f0-4a06-a0ba-09db322cb200/public',
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/e06cbf28-12f0-4a06-a0ba-09db322cb200/public',
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/4566ff82-100f-415f-6380-176d354ee200/public',
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/edd84dbb-6e89-4050-0106-196386629700/public',
          null,
        ],
      },
      {
        from: 50,
        to: 54,
        titles: [
          'Vice Admiral',
          'Vice Admiral',
          'Vice Admiral',
          'Lieutenant General',
          'Vice Admiral',
          null,
        ],
        urls: [
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/8828b43b-1d25-42da-fd67-c9af905d1b00/public',
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/8828b43b-1d25-42da-fd67-c9af905d1b00/public',
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/8828b43b-1d25-42da-fd67-c9af905d1b00/public',
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/b0b8f0a5-ee7b-4e6c-cea1-4d013d963b00/public',
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/6bb93b94-bb60-427e-73bf-82775cd41800/public',
          null,
        ],
      },
      {
        from: 55,
        to: 59,
        titles: ['Admiral', 'Admiral', 'Admiral', 'General', 'Admiral', null],
        urls: [
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/2cb9dc3a-0008-44f8-9435-23c8dd132800/public',
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/2cb9dc3a-0008-44f8-9435-23c8dd132800/public',
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/2cb9dc3a-0008-44f8-9435-23c8dd132800/public',
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/ff838b62-d325-4a85-34a3-26956e9a2a00/public',
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/f458e1b7-1e4f-4c24-d5d8-3fba79051900/public',
          null,
        ],
      },
      {
        from: 60,
        to: 65,
        titles: [
          'Fleet Admiral',
          'Fleet Admiral',
          'Fleet Admiral',
          'Dahar Master',
          'Fleet Admiral',
          'Honored First',
        ],
        urls: [
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/d9f864eb-4c5a-45b6-de79-c3a915de2500/public',
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/d9f864eb-4c5a-45b6-de79-c3a915de2500/public',
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/d9f864eb-4c5a-45b6-de79-c3a915de2500/public',
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/5256d569-4985-4b5b-f05d-f13356a25d00/public',
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/65edf73f-6145-4790-68fd-4cd1db9d8b00/public',
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/1e0d408c-dbfb-4ee5-3884-a044ea08a900/public',
        ],
      },
    ];

    for (const rank of ranksData) {
      for (let i = 0; i < rank.titles.length; i++) {
        const title = rank.titles[i];
        const url = rank.urls[i];
        if (!title) continue;
        const factionName = factions[i];

        await queryRunner.query(
          `INSERT INTO "sto_info_app"."character_rank" ("levelFrom", "levelTo", "rankTitle", "iconUrl", "factionId")
           SELECT $1, $2, $3, $4, id FROM "sto_info_app"."character_faction" WHERE name = $5`,
          [rank.from, rank.to, title, url, factionName],
        );
      }
    }
  }

  /**
   * Reverts the migration from the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "sto_info_app"."character_rank"`);
  }
}
