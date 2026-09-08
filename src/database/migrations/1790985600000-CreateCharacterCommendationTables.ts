import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCharacterCommendationTables1790985600000 implements MigrationInterface {
  name = 'CreateCharacterCommendationTables1790985600000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "sto_info_app"."character_commendation" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" varchar(255) NOT NULL,
      "description" text, "iconUrl" varchar(512), "iconUrlKlingon" varchar(512),
      "accentColor" varchar(9), "factionRestriction" varchar(50),
      "sortOrder" integer NOT NULL DEFAULT 0, "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
      CONSTRAINT "PK_character_commendation" PRIMARY KEY ("id"),
      CONSTRAINT "UX_character_commendation_name" UNIQUE ("name"))`);
    await queryRunner.query(`CREATE TABLE "sto_info_app"."character_commendation_progress" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(), "characterId" uuid NOT NULL, "commendationId" uuid NOT NULL,
      "currentRank" integer NOT NULL DEFAULT 0,
      "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
      CONSTRAINT "PK_character_commendation_progress" PRIMARY KEY ("id"),
      CONSTRAINT "UX_character_commendation_progress_character_commendation" UNIQUE ("characterId", "commendationId"),
      CONSTRAINT "CK_character_commendation_progress_rank" CHECK ("currentRank" BETWEEN 0 AND 4),
      CONSTRAINT "FK_character_commendation_progress_character" FOREIGN KEY ("characterId") REFERENCES "sto_info_app"."character"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "FK_character_commendation_progress_commendation" FOREIGN KEY ("commendationId") REFERENCES "sto_info_app"."character_commendation"("id") ON DELETE CASCADE ON UPDATE CASCADE)`);
    await queryRunner.query(
      `CREATE INDEX "IDX_character_commendation_progress_characterId" ON "sto_info_app"."character_commendation_progress" ("characterId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_character_commendation_progress_commendationId" ON "sto_info_app"."character_commendation_progress" ("commendationId")`,
    );

    // --- Seed: commendation categories (12), ordered as the duty officer
    // window lists them. Diplomacy and Marauding are the faction-exclusive
    // pair; the rest are earned by every captain.
    await queryRunner.query(`
      INSERT INTO "sto_info_app"."character_commendation"
        ("name", "description", "iconUrl", "iconUrlKlingon", "accentColor", "factionRestriction", "sortOrder")
      VALUES
        ('Diplomacy',   'Assignments handling first contact, negotiation and cultural exchange.',        '/assets/commendations/diplomacy.png',   NULL,                                            '#4b84c4', 'Federation', 10),
        ('Marauding',   'Raids on enemy shipping, seizing prisoners, plunder and salvage.',              '/assets/commendations/marauding.png',   '/assets/commendations/marauding-klingon.png',   '#8f2f2f', 'Klingon',    20),
        ('Science',     'Research assignments in astrophysics, anomaly analysis and study.',             '/assets/commendations/science.png',     '/assets/commendations/science-klingon.png',     '#2f8f8f', NULL,         30),
        ('Engineering', 'Assignments repairing, refitting and maintaining ship and station systems.',    '/assets/commendations/engineering.png', '/assets/commendations/engineering-klingon.png', '#c7952e', NULL,         40),
        ('Military',    'Combat, security and tactical drill assignments.',                              '/assets/commendations/military.png',    '/assets/commendations/military-klingon.png',    '#b5482f', NULL,         50),
        ('Exploration', 'Survey and charting assignments across unexplored space.',                      '/assets/commendations/exploration.png', '/assets/commendations/exploration-klingon.png', '#3f9c68', NULL,         60),
        ('Espionage',   'Covert assignments gathering intelligence and running agents.',                 '/assets/commendations/espionage.png',   '/assets/commendations/espionage-klingon.png',   '#6b5aa6', NULL,         70),
        ('Medical',     'Assignments treating casualties, containing outbreaks and running sickbay.',    '/assets/commendations/medical.png',     '/assets/commendations/medical-klingon.png',     '#c45f8f', NULL,         80),
        ('Colonial',    'Assignments supporting colonies, settlements and civilian infrastructure.',     '/assets/commendations/colonial.png',    '/assets/commendations/colonial-klingon.png',    '#7f9c3f', NULL,         90),
        ('Trade',       'Assignments trading commodities and negotiating commercial deals.',             '/assets/commendations/trade.png',       '/assets/commendations/trade-klingon.png',       '#d08a2b', NULL,        100),
        ('Development', 'Assignments training the crew and developing the ship''s capabilities.',        '/assets/commendations/development.png', '/assets/commendations/development-klingon.png', '#5a5fa6', NULL,        110),
        ('Recruitment', 'Assignments recruiting duty officers and bridge officer candidates.',           '/assets/commendations/recruitment.png', '/assets/commendations/recruitment-klingon.png', '#2f8fc4', NULL,        120)
    `);
  }

  /**
   * Reverts the migration from the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX_character_commendation_progress_commendationId"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX_character_commendation_progress_characterId"`,
    );
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."character_commendation_progress"`,
    );
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."character_commendation"`,
    );
  }
}
